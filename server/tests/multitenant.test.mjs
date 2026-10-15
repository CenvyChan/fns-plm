import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = ''
let databaseFile = ''
let child
let origin = ''
let accessToken = ''
let accountA = ''
let accountB = ''
const tokenScopes = new Map()
const legacyMarker = `legacy-private-${Date.now()}`

async function waitForServer() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API process exited early (${child.exitCode}): ${child.stderrText}`)
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })
      if (response.ok) return
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  throw new Error(`API did not become healthy: ${child.stderrText}`)
}

async function api(path, { method = 'GET', body, token = accessToken, headers = {}, scope = true } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    const active = scope ? tokenScopes.get(token) : undefined
    if (active) {
      requestHeaders['X-Tenant-ID'] = active.tenantId
      requestHeaders['X-Organization-ID'] = active.organizationId
      requestHeaders['X-Account-ID'] = active.accountId
    }
  }
  Object.assign(requestHeaders, headers)
  if (token) requestHeaders.Authorization = `Bearer ${token}`
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  if (body !== undefined && !isFormData) requestHeaders['Content-Type'] = 'application/json'
  const requestBody = body === undefined ? undefined : isFormData ? body : JSON.stringify(body)
  const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, body: requestBody, signal: AbortSignal.timeout(8_000) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-isolation-test-'))
  databaseFile = join(tempDir, 'test.sqlite')
  const legacyFile = join(tempDir, 'legacy-workspace.json')
  writeFileSync(legacyFile, JSON.stringify({
    tasks: [{ id: legacyMarker, title: legacyMarker, dueDate: '2026-12-31', priority: 'medium', status: 'todo', createdAt: new Date().toISOString() }],
    projects: [], kpiRules: [], reviews: [], materials: [], boms: [], documents: [], salesBomSnapshots: [],
  }))
  const server = (await import('node:net')).createServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve))
  origin = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_FILE: databaseFile, APP_ENCRYPTION_KEY: '7f'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing-legacy.json'), LEGACY_DATA_FILE: legacyFile,
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '',
    FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', FLOWABLE_USER_MAP_JSON: '{}',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '',
  }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdoutText = ''; child.stderrText = ''
  child.stdout.on('data', chunk => { child.stdoutText += chunk.toString() })
  child.stderr.on('data', chunk => { child.stderrText += chunk.toString() })
  await waitForServer()
})

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 4_000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('Node tenant-deployment BPMN stays in sync with the standalone Flowable engine model', () => {
  const apiModel = readFileSync(resolve(serverDir, 'workflow/processes/plm-approvals.bpmn20.xml'))
  const engineModel = readFileSync(resolve(serverDir, '../flowable-service/src/main/resources/processes/plm-approvals.bpmn20.xml'))
  assert.deepEqual(apiModel, engineModel, 'the same BPMN model must be used by the Node tenant deployment adapter and Flowable engine')
})

test('tenant data, mobile authentication, role enforcement, and connector secrets stay isolated', { concurrency: false }, async () => {
  const health = await api('/api/health', { token: '' })
  assert.equal(health.response.status, 200, 'health status is intentionally public and contains no workspace data')
  assert.equal(health.data.ok, true)
  for (const [method, path, body] of [
    ['GET', '/api/workspace'], ['GET', '/api/tasks'], ['GET', '/api/projects'], ['GET', '/api/materials'],
    ['GET', '/api/boms'], ['GET', '/api/documents'], ['GET', '/api/kpi-rules'], ['GET', '/api/reviews'], ['GET', '/api/sales-bom-snapshots'],
    ['GET', '/api/documents/anonymous/files'], ['GET', '/api/documents/anonymous/files/file/content'],
    ['GET', '/api/auth/scopes'], ['GET', '/api/auth/users'],
    ['GET', '/api/integrations/status'], ['GET', '/api/integrations/settings'], ['GET', '/api/k3cloud/status'],
    ['POST', '/api/k3cloud/query', {}], ['GET', '/api/workflow/status'], ['GET', '/api/workflow/tasks'], ['GET', '/api/workflow/audit'],
    ['GET', '/api/workflow/tasks/anonymous-task'], ['GET', '/api/reports/preview'], ['GET', '/api/reports/schedules'],
    ['POST', '/api/tasks', { title: 'anonymous-write-must-fail' }],
    ['POST', '/api/projects', { name: 'anonymous-write-must-fail' }],
    ['POST', '/api/materials', { partNo: 'ANON-001', name: 'anonymous-write-must-fail', unit: 'pcs', lifecycle: 'draft' }],
    ['POST', '/api/documents/anonymous/files', {}], ['POST', '/api/boms/anonymous/lines', {}], ['DELETE', '/api/boms/anonymous/lines/line'],
    ['PUT', '/api/integrations/settings/dingtalk', { webhookUrl: 'https://invalid.example' }], ['POST', '/api/integrations/settings/dingtalk/test', {}],
    ['POST', '/api/workflow/demo-tasks', { title: 'anonymous-workflow-write', businessType: 'material', businessId: 'ANON-001' }],
    ['POST', '/api/workflow/tasks/anonymous-task/complete', { decision: 'approve', comment: 'anonymous' }],
    ['POST', '/api/workflow/instances', { processDefinitionKey: 'anonymous' }],
    ['POST', '/api/reports/schedules', { name: 'anonymous' }], ['PATCH', '/api/reports/schedules/anonymous', { enabled: true }],
    ['DELETE', '/api/reports/schedules/anonymous'], ['POST', '/api/reports/schedules/anonymous/run', {}], ['POST', '/api/reports/send', {}],
    ['POST', '/api/auth/tenants', { tenantName: 'anonymous' }], ['POST', '/api/auth/users', { email: 'anonymous@example.test' }],
  ]) {
    const result = await api(path, { method, body, token: '' })
    assert.equal(result.response.status, 401, `anonymous ${method} ${path} must require authentication`)
  }
  const unsignedCallback = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', body: {} })
  assert.ok(unsignedCallback.response.status < 200 || unsignedCallback.response.status >= 300, 'unsigned DingTalk callbacks must not be accepted anonymously')

  const status = await api('/api/auth/status', { token: '' })
  assert.equal(status.response.status, 200)
  assert.equal(status.data.setupRequired, true)
  assert.equal(status.data.dingtalkSso.configured, false, 'missing DingTalk credentials must be shown as unconfigured')
  const unconfiguredSso = await api('/api/auth/dingtalk/mobile-login', { method: 'POST', token: '', body: { authCode: 'test-one-time-code' } })
  assert.equal(unconfiguredSso.response.status, 503, 'SSO must not claim success before enterprise credentials are configured')

  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: {
    displayName: 'Isolation Admin', email: 'admin@example.test', password: 'test-password-12345',
  } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  accessToken = setup.data.accessToken
  tokenScopes.set(accessToken, setup.data.user)
  accountA = setup.data.user.accountId
  assert.equal(setup.data.user.tenantName, '平台管理', 'bootstrap must not require real enterprise metadata')
  assert.equal(setup.data.user.organizationName, '平台组织')
  assert.equal(setup.data.user.accountName, '系统管理账套')
  assert.ok(accessToken, 'mobile setup must issue a Bearer token')
  const missingScopeHeaders = await api('/api/materials', { scope: false })
  assert.equal(missingScopeHeaders.response.status, 400, 'protected APIs require the three current workspace scope headers')
  const forgedScope = await api('/api/materials', { headers: { 'X-Account-ID': 'forged-account-id' } })
  assert.equal(forgedScope.response.status, 403, 'client-supplied scope headers must match the server-verified membership')

  const migrated = await api('/api/workspace')
  assert.equal(migrated.response.status, 200)
  assert.ok(migrated.data.tasks.some(task => task.id === legacyMarker), 'legacy workspace should migrate into the initial account')

  const taskAId = `tenant-a-task-${Date.now()}`
  const createdA = await api('/api/tasks', { method: 'POST', body: { id: taskAId, title: 'Private Tenant A Task', dueDate: '2026-12-31', priority: 'high', status: 'todo' } })
  assert.equal(createdA.response.status, 201, JSON.stringify(createdA.data))

  const mobileTasks = await api('/api/workflow/tasks')
  assert.equal(mobileTasks.response.status, 200, JSON.stringify(mobileTasks.data))
  assert.equal(mobileTasks.data.mode, 'demo')
  assert.ok(Array.isArray(mobileTasks.data.tasks))
  const demoApproval = await api('/api/workflow/demo-tasks', { method: 'POST', body: {
    businessType: 'material', businessId: 'MAT-MOBILE-01', title: 'Bearer-authenticated approval', preview: { partNo: 'MAT-MOBILE-01', revision: 'A' },
  } })
  assert.equal(demoApproval.response.status, 201, JSON.stringify(demoApproval.data))
  const mobileTask = demoApproval.data.task
  const mobileDetail = await api(`/api/workflow/tasks/${encodeURIComponent(mobileTask.id)}`)
  assert.equal(mobileDetail.response.status, 200)
  assert.equal(mobileDetail.data.task.preview.partNo, 'MAT-MOBILE-01')
  const completed = await api(`/api/workflow/tasks/${encodeURIComponent(mobileTask.id)}/complete`, { method: 'POST', body: { decision: 'approve', comment: '移動端审批接口回归通过' } })
  assert.equal(completed.response.status, 200, JSON.stringify(completed.data))
  assert.equal(completed.data.task.approvedBy, 'admin@example.test', 'server derives demo actor from the authenticated account')
  const replay = await api(`/api/workflow/tasks/${encodeURIComponent(mobileTask.id)}/complete`, { method: 'POST', body: { decision: 'approve', comment: '不得重复审批' } })
  assert.equal(replay.response.status, 409, 'already completed approval cannot be replayed')

  const connector = await api('/api/integrations/settings/dingtalk', { method: 'PUT', body: {
    webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=non-production-test-value',
    webhookSecret: 'connector-secret-for-encryption-test',
  } })
  assert.equal(connector.response.status, 200, JSON.stringify(connector.data))
  assert.equal(connector.data.settings.secrets.webhookSecret, true)
  assert.equal(JSON.stringify(connector.data).includes('connector-secret-for-encryption-test'), false, 'secret must not be returned to the client')

  const newTenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: 'Tenant B', organizationName: 'Org B', accountName: 'Account B' } })
  assert.equal(newTenant.response.status, 201, JSON.stringify(newTenant.data))
  accountB = newTenant.data.scope.accountId
  assert.notEqual(accountA, accountB)

  const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    const stored = db.prepare("SELECT encrypted_config AS encryptedConfig FROM connector_configs WHERE account_id = ? AND provider = 'dingtalk'").get(accountA)
    assert.ok(stored?.encryptedConfig)
    assert.equal(stored.encryptedConfig.includes('connector-secret-for-encryption-test'), false, 'database must store ciphertext rather than cleartext secret')
  } finally { db.close() }

  const switchB = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountB } })
  assert.equal(switchB.response.status, 200, JSON.stringify(switchB.data))
  tokenScopes.set(accessToken, switchB.data.user)
  const workspaceB = await api('/api/workspace')
  assert.equal(workspaceB.response.status, 200)
  assert.equal(workspaceB.data.tasks.some(task => task.id === legacyMarker), false, 'legacy data must not be copied into a later tenant')
  assert.equal(workspaceB.data.tasks.length, 0, 'new enterprise accounts should begin with an empty task collection')
  assert.equal(workspaceB.data.materials.length, 0, 'new enterprise accounts should not inherit sample PLM materials')
  assert.equal(workspaceB.data.tasks.some(task => task.id === taskAId), false, 'Tenant B must not receive Tenant A tasks')
  const connectorB = await api('/api/integrations/settings')
  assert.equal(connectorB.response.status, 200)
  assert.equal(connectorB.data.providers.dingtalk.secrets.webhookSecret, false, 'connector secrets must be account-scoped')
  const approvalsB = await api('/api/workflow/tasks')
  assert.equal(approvalsB.response.status, 200)
  assert.equal(approvalsB.data.tasks.some(task => task.id === mobileTask.id), false, 'approval tasks must not cross account boundaries')

  const taskBId = `tenant-b-task-${Date.now()}`
  const createdB = await api('/api/tasks', { method: 'POST', body: { id: taskBId, title: 'Private Tenant B Task', dueDate: '2026-12-31', priority: 'medium', status: 'todo' } })
  assert.equal(createdB.response.status, 201, JSON.stringify(createdB.data))
  const switchA = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountA } })
  assert.equal(switchA.response.status, 200)
  tokenScopes.set(accessToken, switchA.data.user)
  const workspaceA = await api('/api/workspace', { headers: { 'X-Workspace-Account': accountB } })
  assert.equal(workspaceA.response.status, 200)
  assert.ok(workspaceA.data.tasks.some(task => task.id === taskAId))
  assert.equal(workspaceA.data.tasks.some(task => task.id === taskBId), false, 'untrusted account headers cannot switch workspace data')

  const unauthenticated = await api('/api/workspace', { token: '' })
  assert.equal(unauthenticated.response.status, 401)

  const member = await api('/api/auth/users', { method: 'POST', body: {
    displayName: 'Read-only Member', email: 'member@example.test', role: 'member',
  } })
  assert.equal(member.response.status, 201, JSON.stringify(member.data))
  assert.ok(member.data.activationToken, 'a new user receives an individual one-time activation token')
  assert.equal(member.data.user.passwordEnabled, false, 'new users cannot log in with a shared or unset password')
  const beforeActivation = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'member@example.test', password: 'member-password-123' } })
  assert.equal(beforeActivation.response.status, 401, 'password login stays unavailable until the member activates their own password')
  const activated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: member.data.activationToken, password: 'member-individual-password-123' } })
  assert.equal(activated.response.status, 200, JSON.stringify(activated.data))
  const replayedActivation = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: member.data.activationToken, password: 'another-individual-password-456' } })
  assert.equal(replayedActivation.response.status, 410, 'activation tokens must be single-use')
  const boundIdentity = await api(`/api/auth/users/${encodeURIComponent(member.data.user.id)}`, { method: 'PATCH', body: { dingtalkUserId: 'verified-user-7', dingtalkUnionId: 'verified-union-7' } })
  assert.equal(boundIdentity.response.status, 200, JSON.stringify(boundIdentity.data))
  const memberDirectory = await api('/api/auth/users')
  assert.equal(memberDirectory.data.users.find(user => user.id === member.data.user.id).dingtalkUserId, 'verified-user-7')
  const memberLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'member@example.test', password: 'member-password-123' } })
  assert.equal(memberLogin.response.status, 401, 'the unactivated bootstrap password is never usable')
  const activatedLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'member@example.test', password: 'member-individual-password-123' } })
  assert.equal(activatedLogin.response.status, 200, JSON.stringify(activatedLogin.data))
  assert.ok(activatedLogin.data.accessToken)
  tokenScopes.set(activatedLogin.data.accessToken, activatedLogin.data.user)
  const forbiddenWrite = await api('/api/materials', { method: 'POST', token: activatedLogin.data.accessToken, body: { id: 'member-material', partNo: 'DRAFT-MEMBER', name: 'Blocked', unit: 'pcs', lifecycle: 'draft' } })
  assert.equal(forbiddenWrite.response.status, 403, 'member must not write managed PLM records')
  const memberTask = await api('/api/tasks', { method: 'POST', token: activatedLogin.data.accessToken, body: { title: 'Member task', dueDate: '2026-12-31', priority: 'low', status: 'todo' } })
  assert.equal(memberTask.response.status, 201, JSON.stringify(memberTask.data))
  const disabledMember = await api(`/api/auth/users/${encodeURIComponent(member.data.user.id)}`, { method: 'PATCH', body: { disabled: true } })
  assert.equal(disabledMember.response.status, 200)
  const revokedSession = await api('/api/tasks', { token: activatedLogin.data.accessToken })
  assert.equal(revokedSession.response.status, 401, 'offboarding revokes previously issued sessions immediately')
})

test('project workbench template, scoped plans/files, atomic KPI set, and dual-review flow', { concurrency: false }, async () => {
  const today = new Date().toISOString().slice(0, 10)
  const templates = await api('/api/project-template-library')
  assert.equal(templates.response.status, 200)
  assert.ok(templates.data.some(template => template.id === 'tpl-product-development'))
  for (const id of ['tpl-enterprise-system-implementation', 'tpl-equipment-introduction']) {
    const template = templates.data.find(item => item.id === id)
    assert.ok(template, `industry template ${id} must be available`)
    assert.ok(template.phases.length >= 4)
    assert.ok(template.phases.every(phase => phase.deliverables && phase.acceptanceCriteria && phase.milestones.length && phase.tasks.length), 'each built-in phase must include deliverables, acceptance criteria, milestones, and tasks')
  }

  const created = await api('/api/projects/from-template', { method: 'POST', body: {
    templateId: 'tpl-product-development', name: `QA 项目工作台 ${Date.now()}`, startDate: today,
  } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  const project = created.data.project
  assert.ok(created.data.counts.phases >= 3)
  assert.ok(created.data.counts.milestones >= 4)
  assert.ok(created.data.counts.tasks >= 6)
  const projectTask = created.data.tasks[0]
  const projectPhase = created.data.phases[0]

  const otherProject = await api('/api/projects', { method: 'POST', body: { name: `QA 隔离项目 ${Date.now()}`, startDate: today, dueDate: today } })
  assert.equal(otherProject.response.status, 201, JSON.stringify(otherProject.data))
  const invalidOwner = await api('/api/projects', { method: 'POST', body: { name: 'must reject foreign owner', ownerId: 'not-an-account-member' } })
  assert.equal(invalidOwner.response.status, 400, 'projects cannot be assigned to users outside the current account')
  const crossProjectTask = await api('/api/tasks', { method: 'POST', body: {
    title: 'must reject cross-project phase', projectId: otherProject.data.id, phaseId: projectPhase.id, dueDate: today,
  } })
  assert.equal(crossProjectTask.response.status, 400, 'phase relationships must remain within the selected project')
  const crossProjectMove = await api(`/api/tasks/${encodeURIComponent(projectTask.id)}`, { method: 'PATCH', body: { projectId: otherProject.data.id } })
  assert.equal(crossProjectMove.response.status, 400, 'moving a task cannot retain a phase from another project')
  const negativeEstimate = await api('/api/tasks', { method: 'POST', body: { title: 'negative estimate', projectId: project.id, estimateHours: -1 } })
  assert.equal(negativeEstimate.response.status, 400, 'estimated hours must be non-negative')
  const invalidAssignee = await api('/api/tasks', { method: 'POST', body: { title: 'foreign assignee', projectId: project.id, assigneeId: 'not-an-account-member' } })
  assert.equal(invalidAssignee.response.status, 400, 'task assignee IDs must resolve to an active user in the current account')
  const assignedTask = await api('/api/tasks', { method: 'POST', body: { title: 'dependency predecessor', projectId: project.id, phaseId: projectPhase.id, assigneeId: tokenScopes.get(accessToken).id, estimateHours: 2 } })
  assert.equal(assignedTask.response.status, 201, JSON.stringify(assignedTask.data))
  const dependentTask = await api('/api/tasks', { method: 'POST', body: { title: 'dependency successor', projectId: project.id, phaseId: projectPhase.id, dependencyIds: [assignedTask.data.id] } })
  assert.equal(dependentTask.response.status, 201, JSON.stringify(dependentTask.data))
  const dependencyCycle = await api(`/api/tasks/${encodeURIComponent(assignedTask.data.id)}`, { method: 'PATCH', body: { dependencyIds: [dependentTask.data.id] } })
  assert.equal(dependencyCycle.response.status, 400, 'task dependencies must not introduce a cycle')
  const deletePredecessor = await api(`/api/tasks/${encodeURIComponent(assignedTask.data.id)}`, { method: 'DELETE' })
  assert.equal(deletePredecessor.response.status, 409, 'tasks with dependents cannot be deleted until dependency links are cleared')
  const crossProjectEvent = await api('/api/project-events', { method: 'POST', body: {
    projectId: project.id, taskId: 'not-a-task-in-this-project', code: 'QA-EVENT-XREF', type: 'issue', title: 'invalid reference', description: 'test', owner: 'Isolation Admin', department: 'QA', startDate: today, dueDate: today, status: 'open', projectWeight: 0,
  } })
  assert.equal(crossProjectEvent.response.status, 400, 'events cannot reference tasks from another project')
  const foreignEventOwner = await api('/api/project-events', { method: 'POST', body: {
    projectId: project.id, code: 'QA-EVENT-OWNER', type: 'issue', title: 'invalid owner', description: 'test', owner: 'Unknown', ownerId: 'not-an-account-member', department: 'QA', startDate: today, dueDate: today, status: 'open', projectWeight: 0,
  } })
  assert.equal(foreignEventOwner.response.status, 400, 'project event owners must be current account members')

  const ruleOne = await api('/api/kpi-rules', { method: 'POST', body: {
    code: 'QA-KPI-60', name: 'QA 交付达成率', category: '交付', formula: '按期完成数 / 计划数', unit: '%', target: 90, direction: 'higher', weight: 60, cycle: '季度', owner: 'QA', status: 'draft',
  } })
  const ruleTwo = await api('/api/kpi-rules', { method: 'POST', body: {
    code: 'QA-KPI-40', name: 'QA 质量达成率', category: '质量', formula: '通过数 / 验收数', unit: '%', target: 95, direction: 'higher', weight: 40, cycle: '季度', owner: 'QA', status: 'draft',
  } })
  assert.equal(ruleOne.response.status, 201, JSON.stringify(ruleOne.data))
  assert.equal(ruleTwo.response.status, 201, JSON.stringify(ruleTwo.data))
  const oneAtATime = await api(`/api/kpi-rules/${encodeURIComponent(ruleOne.data.id)}`, { method: 'PATCH', body: { status: 'active' } })
  assert.equal(oneAtATime.response.status, 409, 'individual activation must be rejected so the active weight never becomes partially configured')
  const wrongWeightSet = await api('/api/kpi-rules/activate-set', { method: 'POST', body: { ids: [ruleOne.data.id] } })
  assert.equal(wrongWeightSet.response.status, 409)
  const activated = await api('/api/kpi-rules/activate-set', { method: 'POST', body: { ids: [ruleOne.data.id, ruleTwo.data.id] } })
  assert.equal(activated.response.status, 200, JSON.stringify(activated.data))
  assert.equal(activated.data.activeWeight, 100)
  assert.equal(activated.data.rules.filter(rule => rule.status === 'active' && [ruleOne.data.id, ruleTwo.data.id].includes(rule.id)).reduce((sum, rule) => sum + rule.weight, 0), 100)

  const eventCreated = await api('/api/project-events', { method: 'POST', body: {
    projectId: project.id, phaseId: projectPhase.id, taskId: projectTask.id, code: 'QA-EVENT-REVIEW', type: 'deliverable', title: 'QA 双阶段评审验收', description: '验证项目事件绩效自评与主管评审。', owner: 'Isolation Admin', department: 'QA', startDate: today, dueDate: today, status: 'open', projectWeight: 25,
  } })
  assert.equal(eventCreated.response.status, 201, JSON.stringify(eventCreated.data))
  const completedEvent = await api(`/api/project-events/${encodeURIComponent(eventCreated.data.id)}`, { method: 'PATCH', body: { status: 'completed' } })
  assert.equal(completedEvent.response.status, 200, JSON.stringify(completedEvent.data))
  const startedReview = await api(`/api/project-events/${encodeURIComponent(eventCreated.data.id)}/start-review`, { method: 'POST', body: { reviewer: 'QA 主管', period: '2026 Q4' } })
  assert.equal(startedReview.response.status, 201, JSON.stringify(startedReview.data))
  const review = startedReview.data
  assert.equal(review.rulesSnapshot.length, 2)

  const reviewerEmail = `project-reviewer-${Date.now()}@example.test`, reviewerPassword = 'project-reviewer-individual-password-321'
  const reviewerUser = await api('/api/auth/users', { method: 'POST', body: { displayName: 'Project QA Reviewer', email: reviewerEmail, role: 'reviewer' } })
  assert.equal(reviewerUser.response.status, 201, JSON.stringify(reviewerUser.data))
  const reviewerActivation = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: reviewerUser.data.activationToken, password: reviewerPassword } })
  assert.equal(reviewerActivation.response.status, 200, JSON.stringify(reviewerActivation.data))
  const reviewerLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: reviewerEmail, password: reviewerPassword } })
  assert.equal(reviewerLogin.response.status, 200, JSON.stringify(reviewerLogin.data))
  const reviewerToken = reviewerLogin.data.accessToken
  tokenScopes.set(reviewerToken, reviewerLogin.data.user)
  const unauthorizedSelf = await api(`/api/project-event-reviews/${encodeURIComponent(review.id)}/self`, { method: 'PATCH', token: reviewerToken, body: { scores: review.rulesSnapshot.map(rule => ({ kpiRuleId: rule.kpiRuleId, actual: 0, comment: 'not the event owner' })), comment: 'not the event owner' } })
  assert.equal(unauthorizedSelf.response.status, 403, `only the designated event owner may submit self-review: ${JSON.stringify(unauthorizedSelf.data)}`)

  const self = await api(`/api/project-event-reviews/${encodeURIComponent(review.id)}/self`, { method: 'PATCH', body: {
    scores: review.rulesSnapshot.map((rule, index) => ({ kpiRuleId: rule.kpiRuleId, actual: index ? 95 : 90, comment: '自评记录' })), comment: '交付与质量指标已提供可追溯证据。',
  } })
  assert.equal(self.response.status, 200, JSON.stringify(self.data))
  assert.equal(self.data.status, 'manager-review')
  const selfApproval = await api(`/api/project-event-reviews/${encodeURIComponent(review.id)}/manager`, { method: 'PATCH', body: {
    scores: review.rulesSnapshot.map(rule => ({ kpiRuleId: rule.kpiRuleId, actual: 90, score: 100, comment: '复核' })), comment: '自评人不得批准自己的绩效。',
  } })
  assert.equal(selfApproval.response.status, 403)
  const managerApproval = await api(`/api/project-event-reviews/${encodeURIComponent(review.id)}/manager`, { method: 'PATCH', token: reviewerToken, body: {
    scores: review.rulesSnapshot.map(rule => ({ kpiRuleId: rule.kpiRuleId, actual: 90, score: 100, comment: '证据已复核' })), comment: '证据充分，按规则批准。',
  } })
  assert.equal(managerApproval.response.status, 200, JSON.stringify(managerApproval.data))
  assert.equal(managerApproval.data.status, 'approved')
  const reopenReviewedEvent = await api(`/api/project-events/${encodeURIComponent(eventCreated.data.id)}`, { method: 'PATCH', body: { status: 'open' } })
  assert.equal(reopenReviewedEvent.response.status, 409, 'events with an audit review cannot be reopened and erase the review context')

  const activeRuleDelete = await api(`/api/kpi-rules/${encodeURIComponent(ruleOne.data.id)}`, { method: 'DELETE' })
  assert.equal(activeRuleDelete.response.status, 409, 'active KPI rules cannot be deleted outside the atomic rule-set flow')
  const spareRule = await api('/api/kpi-rules', { method: 'POST', body: {
    code: 'QA-KPI-SPARE', name: 'QA 可替换规则', category: '治理', formula: '按期数 / 计划数', unit: '%', target: 100, direction: 'higher', weight: 100, cycle: '季度', owner: 'QA', status: 'draft',
  } })
  assert.equal(spareRule.response.status, 201, JSON.stringify(spareRule.data))
  const editedSpareRule = await api(`/api/kpi-rules/${encodeURIComponent(spareRule.data.id)}`, { method: 'PATCH', body: { target: 101 } })
  assert.equal(editedSpareRule.response.status, 200, JSON.stringify(editedSpareRule.data))
  assert.equal(editedSpareRule.data.revision, spareRule.data.revision + 1)
  const activateSpare = await api('/api/kpi-rules/activate-set', { method: 'POST', body: { ids: [spareRule.data.id] } })
  assert.equal(activateSpare.response.status, 200)
  const referencedRuleDelete = await api(`/api/kpi-rules/${encodeURIComponent(ruleOne.data.id)}`, { method: 'DELETE' })
  assert.equal(referencedRuleDelete.response.status, 409, 'rules captured in a performance audit snapshot must remain available')
  const activeSpareDelete = await api(`/api/kpi-rules/${encodeURIComponent(spareRule.data.id)}`, { method: 'DELETE' })
  assert.equal(activeSpareDelete.response.status, 409)
  const restoreRuleSet = await api('/api/kpi-rules/activate-set', { method: 'POST', body: { ids: [ruleOne.data.id, ruleTwo.data.id] } })
  assert.equal(restoreRuleSet.response.status, 200)
  const deleteDraft = await api(`/api/kpi-rules/${encodeURIComponent(spareRule.data.id)}`, { method: 'DELETE' })
  assert.equal(deleteDraft.response.status, 204)

  const csv = `WBS编码,任务名称,所属阶段编码,计划开始,计划截止,优先级,状态,进度,预计工时,验收标准,任务说明\nQA-IMP-001,CSV 计划导入验收,${projectPhase.code},${today},${today},高,待办,0,3,测试计划可追踪,文件导入端到端验证\n`
  const importForm = new FormData()
  importForm.append('file', new Blob([csv], { type: 'text/csv' }), 'qa-project-plan.csv')
  const imported = await api(`/api/projects/${encodeURIComponent(project.id)}/import-plan`, { method: 'POST', body: importForm })
  assert.equal(imported.response.status, 200, JSON.stringify(imported.data))
  assert.equal(imported.data.counts.tasks, 1)
  const taskList = await api('/api/tasks')
  assert.ok(taskList.data.some(task => task.projectId === project.id && task.wbsCode === 'QA-IMP-001'))

  const attachmentForm = new FormData()
  attachmentForm.append('title', 'QA 验收附件')
  attachmentForm.append('file', new Blob(['project attachment QA evidence'], { type: 'text/plain' }), 'qa-evidence.txt')
  const attachment = await api(`/api/projects/${encodeURIComponent(project.id)}/files`, { method: 'POST', body: attachmentForm })
  assert.equal(attachment.response.status, 201, JSON.stringify(attachment.data))
  const fileId = attachment.data.file.id
  const files = await api(`/api/projects/${encodeURIComponent(project.id)}/files`)
  assert.ok(files.data.some(file => file.id === fileId && file.sha256 && file.title === 'QA 验收附件'))

  const projectReport = await api('/api/project-reports', { method: 'POST', body: {
    id: `QA-REPORT-${Date.now()}`, projectId: project.id, period: '2026 Q4', progress: 72,
    achievements: '完成核心验证', blockers: '等待供应商样件', risks: '交付周期存在波动', decisionsNeeded: '确认备选方案', nextSteps: '安排复测与阶段评审',
  } })
  assert.equal(projectReport.response.status, 201, JSON.stringify(projectReport.data))
  assert.equal(projectReport.data.authorId, tokenScopes.get(accessToken).id, 'report author must be derived from the authenticated session')
  const invalidReportProgress = await api('/api/project-reports', { method: 'POST', body: { projectId: project.id, period: 'invalid', progress: 101, achievements: '', blockers: '', risks: '', decisionsNeeded: '', nextSteps: '' } })
  assert.equal(invalidReportProgress.response.status, 400, 'project report progress must stay within 0–100')
  const reports = await api('/api/project-reports')
  assert.ok(reports.data.some(report => report.id === projectReport.data.id))

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'X-Tenant-ID': tokenScopes.get(accessToken).tenantId,
    'X-Organization-ID': tokenScopes.get(accessToken).organizationId,
    'X-Account-ID': tokenScopes.get(accessToken).accountId,
  }
  const workbookResponse = await fetch(`${origin}/api/projects/${encodeURIComponent(project.id)}/export.xlsx`, { headers: authHeaders })
  const workbook = Buffer.from(await workbookResponse.arrayBuffer())
  assert.equal(workbookResponse.status, 200)
  assert.deepEqual([...workbook.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'workbook must be a valid XLSX zip container')
  const archiveResponse = await fetch(`${origin}/api/projects/${encodeURIComponent(project.id)}/archive.zip`, { headers: authHeaders })
  const archive = Buffer.from(await archiveResponse.arrayBuffer())
  assert.equal(archiveResponse.status, 200)
  assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'project archive must be a valid ZIP')
  const archivePath = join(tempDir, `project-${Date.now()}.zip`)
  writeFileSync(archivePath, archive)
  const archiveEntries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' }).trim().split('\n')
  const manifestPath = `${project.code}/project-data.json`
  assert.ok(archiveEntries.includes(manifestPath), 'archive must contain a project data manifest')
  assert.ok(archiveEntries.includes(`${project.code}/project-workbook.xlsx`), 'archive must contain the workbook')
  const manifest = JSON.parse(execFileSync('unzip', ['-p', archivePath, manifestPath], { encoding: 'utf8' }))
  assert.equal(manifest.project.id, project.id)
  assert.ok(manifest.reports.some(report => report.id === projectReport.data.id), 'project report must be archived')
  const attachmentPath = archiveEntries.find(name => name.startsWith(`${project.code}/attachments/`) && name.endsWith('qa-evidence.txt'))
  assert.ok(attachmentPath, 'archive must contain project attachments')
  assert.equal(execFileSync('unzip', ['-p', archivePath, attachmentPath], { encoding: 'utf8' }), 'project attachment QA evidence')

  const switchToB = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountB } })
  assert.equal(switchToB.response.status, 200)
  tokenScopes.set(accessToken, switchToB.data.user)
  const projectsB = await api('/api/projects')
  const reportsB = await api('/api/project-reports')
  const projectFilesB = await api(`/api/projects/${encodeURIComponent(project.id)}/files`)
  assert.equal(projectsB.data.some(item => item.id === project.id), false, 'project data must not cross account boundaries')
  assert.equal(reportsB.data.some(item => item.id === projectReport.data.id), false, 'project reports must not cross account boundaries')
  assert.equal(projectFilesB.response.status, 404, 'project attachment metadata must be scoped to the current account')
  const switchBackA = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountA } })
  assert.equal(switchBackA.response.status, 200)
  tokenScopes.set(accessToken, switchBackA.data.user)
})
