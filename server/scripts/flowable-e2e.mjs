import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'

const serverDir = resolve(import.meta.dirname, '..')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const timeout = milliseconds => AbortSignal.timeout(milliseconds)
let testDir = ''
let apiProcess
let accessToken = ''
let activeScope
let apiOrigin = ''

function fail(message) { throw new Error(message) }
function tenantFor(scope) { return `tenant:${scope.tenantId}:organization:${scope.organizationId}:account:${scope.accountId}` }
function randomLabel(prefix) { return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 12)}` }

async function unusedPort() {
  const server = createServer()
  const port = await new Promise((resolvePort, reject) => server.listen(0, '127.0.0.1', () => resolvePort(server.address().port)).once('error', reject))
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

async function api(path, { method = 'GET', body, headers = {}, token = accessToken, scope = activeScope } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    if (scope) {
      requestHeaders['X-Tenant-ID'] = scope.tenantId
      requestHeaders['X-Organization-ID'] = scope.organizationId
      requestHeaders['X-Account-ID'] = scope.accountId
    }
  }
  Object.assign(requestHeaders, headers)
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(`${apiOrigin}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: timeout(20_000) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

async function waitForApi() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) fail('The isolated API process exited before becoming healthy.')
    try {
      const response = await fetch(`${apiOrigin}/api/health`, { signal: timeout(1000) })
      if (response.ok) return
    } catch { /* continue until the local API is ready */ }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 150))
  }
  fail('The isolated API process did not become healthy.')
}

function assertStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label}: ${JSON.stringify(result.data)}`)
}

async function flowableRequest(baseUrl, authorization, path, { method = 'GET', body, formData } = {}) {
  const headers = { Accept: 'application/json', Authorization: authorization }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    ...(formData ? { body: formData } : body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: timeout(15_000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) fail(`Local Flowable request failed (HTTP ${response.status}) at ${path}.`)
  return data
}

async function createCandidateGroupTask(baseUrl, authorization, tenantId, groupId, label) {
  const processKey = `candidateScope${label}${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="urn:momentum:scope-e2e"><bpmn:process id="${processKey}" name="Scope candidate E2E" isExecutable="true"><bpmn:startEvent id="start"/><bpmn:userTask id="review" name="Candidate group review" flowable:candidateGroups="${groupId}"/><bpmn:endEvent id="end"/><bpmn:sequenceFlow id="toReview" sourceRef="start" targetRef="review"/><bpmn:sequenceFlow id="toEnd" sourceRef="review" targetRef="end"/></bpmn:process></bpmn:definitions>`
  const formData = new FormData()
  formData.append('file', new Blob([xml], { type: 'application/xml' }), `${processKey}.bpmn20.xml`)
  formData.append('tenantId', tenantId)
  await flowableRequest(baseUrl, authorization, '/repository/deployments', { method: 'POST', formData })
  const definitions = await flowableRequest(baseUrl, authorization, `/repository/process-definitions?key=${encodeURIComponent(processKey)}&tenantId=${encodeURIComponent(tenantId)}&size=10`)
  assert.ok((definitions.data ?? []).some(definition => definition.key === processKey && definition.tenantId === tenantId), 'candidate BPMN definition must be deployed to the exact composite tenant')
  const process = await flowableRequest(baseUrl, authorization, '/runtime/process-instances', {
    method: 'POST', body: { processDefinitionKey: processKey, tenantId, businessKey: randomLabel(`candidate-${label}`) },
  })
  assert.equal(process.tenantId, tenantId, 'candidate process instance must retain the composite tenant ID')
  const tasks = await flowableRequest(baseUrl, authorization, `/runtime/tasks?processInstanceId=${encodeURIComponent(process.id)}&tenantId=${encodeURIComponent(tenantId)}&size=10`)
  const task = (tasks.data ?? []).find(row => row.processInstanceId === process.id)
  assert.ok(task?.id, 'candidate group process must create a live task')
  assert.equal(task.tenantId, tenantId)
  assert.equal(task.assignee, null, 'candidate group task is not pre-assigned to an unrelated user')
  return { processInstanceId: process.id, taskId: task.id }
}

async function main() {
  const baseUrl = (process.env.FLOWABLE_BASE_URL ?? '').trim()
  const username = process.env.FLOWABLE_USERNAME ?? ''
  const password = process.env.FLOWABLE_PASSWORD ?? ''
  if (!baseUrl || !username || !password) fail('Set FLOWABLE_BASE_URL, FLOWABLE_USERNAME and FLOWABLE_PASSWORD for a local Flowable E2E run.')
  let parsedUrl
  try { parsedUrl = new URL(baseUrl) } catch { fail('FLOWABLE_BASE_URL is invalid.') }
  if (!loopbackHosts.has(parsedUrl.hostname)) fail('The scope E2E only accepts a loopback Flowable URL; it will not contact a remote or production service.')
  if (!parsedUrl.pathname.endsWith('/flowable-rest/process-api')) fail('FLOWABLE_BASE_URL must use the bundled /flowable-rest/process-api path.')
  if (password.length < 24) fail('The local Flowable test service password must be at least 24 characters.')

  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const initialHealth = await flowableRequest(baseUrl, authorization, '/runtime/tasks?size=1')
  assert.ok(Array.isArray(initialHealth.data), 'Flowable health probe should return task query data')

  testDir = mkdtempSync(join(tmpdir(), 'momentum-flowable-scope-e2e-'))
  const port = await unusedPort()
  apiOrigin = `http://127.0.0.1:${port}`
  const emptyEnv = {
    FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', FLOWABLE_USER_MAP_JSON: '{}',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '',
  }
  const env = {
    ...process.env, ...emptyEnv,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    DATABASE_FILE: join(testDir, 'scope-e2e.sqlite'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY_FILE: join(testDir, 'encryption.key'),
    DATA_FILE: join(testDir, 'missing-legacy.json'), LEGACY_DATA_FILE: join(testDir, 'missing-legacy.json'),
    DOCUMENT_STORAGE_DIR: join(testDir, 'documents'), INTEGRATION_DATA_DIR: join(testDir, 'integrations'),
    REDIS_URL: '', CORS_ORIGIN: '',
  }
  apiProcess = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'ignore', 'ignore'] })
  await waitForApi()

  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  const adminEmail = `flowable-scope-${suffix}@example.test`
  const adminPassword = `scope-e2e-${randomBytes(16).toString('hex')}`
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: 'Flowable Scope E2E', email: adminEmail, password: adminPassword }, scope: undefined })
  assertStatus(setup, 201, 'isolated admin setup')
  accessToken = setup.data.accessToken
  activeScope = setup.data.user
  const scopeA = activeScope
  const actorA = `flowable-user-a-${suffix}`
  const groupA = `flowable-group-a-${suffix}`

  const createdScopeB = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: `Flowable Scope B ${suffix}`, organizationName: `Flowable Org B ${suffix}`, accountName: `Flowable Account B ${suffix}` } })
  assertStatus(createdScopeB, 201, 'create isolated second tenant/org/account')
  const scopeBRecord = createdScopeB.data.scope
  assert.notEqual(scopeA.tenantId, scopeBRecord.tenantId)
  assert.notEqual(scopeA.organizationId, scopeBRecord.organizationId)
  assert.notEqual(scopeA.accountId, scopeBRecord.accountId)

  const scopeAFlowableTenant = tenantFor(scopeA)
  const scopeBFlowableTenant = tenantFor(scopeBRecord)
  assert.notEqual(scopeAFlowableTenant, scopeBFlowableTenant, 'composite Flowable tenant IDs must differ across all three internal layers')

  async function switchScope(accountId) {
    const result = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId } })
    assertStatus(result, 200, `switch to account ${accountId}`)
    activeScope = result.data.user
    return activeScope
  }
  async function saveFlowable(actor, groups = []) {
    const result = await api('/api/integrations/settings/flowable', { method: 'PUT', body: {
      baseUrl, username, password,
      userMap: { [adminEmail]: actor },
      groupMap: { [actor]: groups },
    } })
    assertStatus(result, 200, 'save Flowable connector scoped to current triple')
    assert.equal(JSON.stringify(result.data).includes(password), false, 'connector secrets must never be returned to the test client')
  }
  async function startAssignedProcess(actor, label) {
    const result = await api('/api/workflow/instances', { method: 'POST', body: {
      processDefinitionKey: 'materialApproval',
      businessKey: randomLabel(`business-${label}`),
      variables: { businessType: 'material', businessId: randomLabel(`material-${label}`), title: `Scope E2E ${label}`, assignee: actor },
    } })
    assertStatus(result, 201, `start assigned process ${label}`)
    assert.equal(result.data.process.tenantId, tenantFor(activeScope), 'process instance tenant must be derived from current internal tenant/org/account')
    return { processInstanceId: result.data.process.id, businessKey: result.data.process.businessKey }
  }
  async function getCurrentTasks() {
    const result = await api('/api/workflow/tasks')
    assertStatus(result, 200, 'list current mapped user and candidate group tasks')
    assert.equal(result.data.mode, 'flowable')
    return result.data.tasks
  }
  async function complete(taskId, label) {
    const result = await api(`/api/workflow/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', body: { decision: 'approve', comment: `Scope E2E approval ${label}` } })
    assertStatus(result, 200, `complete mapped task ${label}`)
    assert.equal(result.data.mode, 'flowable')
  }
  async function checkHistory(processInstanceId) {
    const historic = await flowableRequest(baseUrl, authorization, `/history/historic-process-instances/${encodeURIComponent(processInstanceId)}`)
    assert.ok(historic.endTime, 'completed process must have a Flowable history endTime')
  }

  await saveFlowable(actorA)
  const unmappedAssignee = await api('/api/workflow/instances', { method: 'POST', body: {
    processDefinitionKey: 'materialApproval', businessKey: randomLabel('unmapped'),
    variables: { businessType: 'material', businessId: randomLabel('unmapped-material'), title: 'Must be rejected', assignee: `unmapped-${suffix}` },
  } })
  assertStatus(unmappedAssignee, 403, 'a process cannot assign to an engine user absent from this scope userMap')
  const processA = await startAssignedProcess(actorA, 'assigned-A')
  const assignedTaskA = (await getCurrentTasks()).find(task => task.processInstanceId === processA.processInstanceId)
  assert.ok(assignedTaskA?.id, 'scope A mapped user must receive its assignee task')
  assert.equal(assignedTaskA.tenantId, scopeAFlowableTenant)
  assert.equal(assignedTaskA.assignee, actorA)

  const candidateA = await createCandidateGroupTask(baseUrl, authorization, scopeAFlowableTenant, groupA, 'A')
  let tasksA = await getCurrentTasks()
  assert.equal(tasksA.some(task => task.id === candidateA.taskId), false, 'candidate group task must remain hidden until its group is mapped in scope A')
  const hiddenDetailA = await api(`/api/workflow/tasks/${encodeURIComponent(candidateA.taskId)}`)
  assertStatus(hiddenDetailA, 403, 'candidate group task detail without a group mapping')
  const hiddenCompleteA = await api(`/api/workflow/tasks/${encodeURIComponent(candidateA.taskId)}/complete`, { method: 'POST', body: { decision: 'approve', comment: 'must not complete without mapping' } })
  assertStatus(hiddenCompleteA, 403, 'candidate group task completion without a group mapping')
  await saveFlowable(actorA, [groupA])
  tasksA = await getCurrentTasks()
  assert.ok(tasksA.some(task => task.id === candidateA.taskId), 'mapped candidate group task must be visible in scope A')
  const candidateDetailA = await api(`/api/workflow/tasks/${encodeURIComponent(candidateA.taskId)}`)
  assertStatus(candidateDetailA, 200, 'mapped candidate group task detail')

  const scopeB = await switchScope(scopeBRecord.accountId)
  const actorB = `flowable-user-b-${suffix}`
  const groupB = `flowable-group-b-${suffix}`
  await saveFlowable(actorB)
  const processB = await startAssignedProcess(actorB, 'assigned-B')
  const assignedTaskB = (await getCurrentTasks()).find(task => task.processInstanceId === processB.processInstanceId)
  assert.ok(assignedTaskB?.id, 'scope B mapped user must receive its assignee task')
  assert.equal(assignedTaskB.tenantId, scopeBFlowableTenant)
  assert.equal(assignedTaskB.assignee, actorB)
  const candidateB = await createCandidateGroupTask(baseUrl, authorization, scopeBFlowableTenant, groupB, 'B')
  let tasksB = await getCurrentTasks()
  assert.equal(tasksB.some(task => task.id === candidateB.taskId), false, 'candidate group task must remain hidden until mapped in scope B')
  assert.equal(tasksB.some(task => task.id === assignedTaskA.id), false, 'scope B query must not return scope A task')
  await saveFlowable(actorB, [groupB])
  tasksB = await getCurrentTasks()
  assert.ok(tasksB.some(task => task.id === candidateB.taskId), 'scope B must use its own candidate-group mapping')
  assert.equal(tasksB.some(task => task.id === candidateA.taskId), false, 'scope B must not disclose scope A candidate group task')

  for (const [header, forgedValue] of [
    ['X-Tenant-ID', 'forged-tenant'],
    ['X-Organization-ID', 'forged-organization'],
    ['X-Account-ID', scopeA.accountId],
  ]) {
    const forged = await api('/api/workflow/tasks', { headers: { [header]: forgedValue } })
    assertStatus(forged, 403, `${header} must independently reject scope forgery before Flowable access`)
  }
  for (const header of ['X-Tenant-ID', 'X-Organization-ID', 'X-Account-ID']) {
    const missing = await api('/api/workflow/tasks', { headers: { [header]: '' } })
    assertStatus(missing, 400, `${header} must independently be required`)
  }

  for (const taskId of [assignedTaskA.id, candidateA.taskId]) {
    const detail = await api(`/api/workflow/tasks/${encodeURIComponent(taskId)}`)
    assertStatus(detail, 403, 'scope B must reject scope A task detail despite mapped engine identities')
    const deniedComplete = await api(`/api/workflow/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', body: { decision: 'approve', comment: 'cross-scope completion must be denied' } })
    assertStatus(deniedComplete, 403, 'scope B must reject cross-scope task completion')
  }
  const currentB = await getCurrentTasks()
  assert.equal(currentB.some(task => task.id === assignedTaskA.id || task.id === candidateA.taskId), false, 'scope B query must return no scope A tasks')

  await switchScope(scopeA.accountId)
  const currentA = await getCurrentTasks()
  assert.ok(currentA.some(task => task.id === assignedTaskA.id))
  assert.ok(currentA.some(task => task.id === candidateA.taskId))
  assert.equal(currentA.some(task => task.id === assignedTaskB.id || task.id === candidateB.taskId), false, 'scope A query must return no scope B tasks')
  for (const taskId of [assignedTaskB.id, candidateB.taskId]) {
    const denied = await api(`/api/workflow/tasks/${encodeURIComponent(taskId)}/complete`, { method: 'POST', body: { decision: 'approve', comment: 'reverse cross-scope completion must be denied' } })
    assertStatus(denied, 403, 'scope A must reject scope B completion')
  }

  await complete(assignedTaskA.id, 'assigned-A')
  await complete(candidateA.taskId, 'candidate-A')
  await checkHistory(processA.processInstanceId)
  await checkHistory(candidateA.processInstanceId)
  assert.equal((await getCurrentTasks()).some(task => task.id === assignedTaskA.id || task.id === candidateA.taskId), false)

  await switchScope(scopeB.accountId)
  await complete(assignedTaskB.id, 'assigned-B')
  await complete(candidateB.taskId, 'candidate-B')
  await checkHistory(processB.processInstanceId)
  await checkHistory(candidateB.processInstanceId)
  assert.equal((await getCurrentTasks()).some(task => task.id === assignedTaskB.id || task.id === candidateB.taskId), false)

  console.log(JSON.stringify({
    flowable: 'local-loopback-instance',
    internalScopes: 2,
    compositeTenantIsolation: 'passed',
    mappedAssigneeIsolation: 'passed',
    candidateGroupMapping: 'passed',
    unmappedAssigneeDenied: true,
    missingOrForgedScopeLayerDenied: true,
    crossScopeQueryDetailAndCompletionDenied: true,
    completedProcessesWithHistory: 4,
    productionServicesContacted: false,
  }))
}

try {
  await main()
} catch (error) {
  console.error(`Flowable scope E2E failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
} finally {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill('SIGTERM')
    await Promise.race([new Promise(resolveExit => apiProcess.once('exit', resolveExit)), new Promise(resolveDelay => setTimeout(resolveDelay, 4000))])
    if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL')
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true })
}
