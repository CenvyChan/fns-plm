import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = ''
let databaseFile = ''
let apiProcess
let apiEnv
let apiPort
let mockServer
let origin = ''
let mockOrigin = ''
let accessToken = ''
const tokenScopes = new Map()
const queryCounts = { login: 0, query: 0, metadata: 0, flowable: 0, comments: 0, completed: [] }
const dingtalkMockCalls = []
const dingtalkMockResponses = []
let dingtalkMockDelayMs = 0
let scopeTasks = new Map()
const groupOwners = new Map()
const candidateGroupsByTask = new Map()

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(value))
}

async function requestBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function listenLoopback(server) {
  const port = await new Promise((resolvePort, reject) => server.listen(0, '127.0.0.1', () => resolvePort(server.address().port)).once('error', reject))
  return `http://127.0.0.1:${port}`
}

async function unusedPort() {
  const server = createServer()
  const port = await new Promise((resolvePort, reject) => server.listen(0, '127.0.0.1', () => resolvePort(server.address().port)).once('error', reject))
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}

async function waitForServer() {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Isolated integration-test API exited early (${apiProcess.exitCode}).`)
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })
      if (response.ok) return
    } catch { /* local API is still starting */ }
    await new Promise(resolveSleep => setTimeout(resolveSleep, 100))
  }
  throw new Error('Isolated integration-test API did not become healthy.')
}

async function startApiProcess() {
  apiProcess = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env: apiEnv, stdio: ['ignore', 'ignore', 'ignore'] })
  await waitForServer()
}

async function stopApiProcess() {
  if (!apiProcess || apiProcess.exitCode !== null) return
  apiProcess.kill('SIGTERM')
  await Promise.race([new Promise(resolveExit => apiProcess.once('exit', resolveExit)), new Promise(resolveDelay => setTimeout(resolveDelay, 4000))])
  if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL')
}

async function api(path, { method = 'GET', body, token = accessToken, headers = {} } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    const scope = tokenScopes.get(token)
    if (scope) {
      requestHeaders['X-Tenant-ID'] = scope.tenantId
      requestHeaders['X-Organization-ID'] = scope.organizationId
      requestHeaders['X-Account-ID'] = scope.accountId
    }
  }
  Object.assign(requestHeaders, headers)
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

function assertStatus(result, status, context) {
  assert.equal(result.response.status, status, `${context}: ${JSON.stringify(result.data)}`)
}

function flowableTenant(scope) {
  return `tenant:${scope.tenantId}:organization:${scope.organizationId}:account:${scope.accountId}`
}

function signCallback(secret) {
  const timestamp = String(Date.now())
  return {
    'x-ddpaas-signature-timestamp': timestamp,
    'x-ddpaas-signature': createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'),
  }
}

function callbackPayload(taskId, overrides = {}) {
  return {
    corpId: 'mock-corp-id',
    userId: 'mock-dingtalk-user',
    outTrackId: taskId,
    content: { cardPrivateData: { params: { action: 'approve', taskId, comment: `Mock approval for ${taskId}` } } },
    ...overrides,
  }
}

async function startScope(accountId) {
  const switched = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId } })
  assertStatus(switched, 200, 'switch workspace account')
  tokenScopes.set(accessToken, switched.data.user)
  return switched.data.user
}

async function saveProvider(provider, config) {
  const saved = await api(`/api/integrations/settings/${provider}`, { method: 'PUT', body: config })
  assertStatus(saved, 200, `save ${provider} connector in current internal scope`)
  return saved.data.settings
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-integrations-scope-test-'))
  databaseFile = join(tempDir, 'integration-test.sqlite')

  mockServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', mockOrigin || 'http://127.0.0.1')
      const path = url.pathname
      if (req.method === 'POST' && path === '/dingtalk-mock') {
        const body = await requestBody(req)
        dingtalkMockCalls.push(JSON.parse(body || '{}'))
        if (dingtalkMockDelayMs) await new Promise(resolveDelay => setTimeout(resolveDelay, dingtalkMockDelayMs))
        const result = dingtalkMockResponses.shift()
        return json(res, 200, result === 'fail' ? { errcode: 310000, errmsg: 'isolated mock rejected message' } : { errcode: 0, errmsg: 'ok' })
      }
      if (req.method === 'POST' && path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc')) {
        queryCounts.login += 1
        await requestBody(req)
        return json(res, 200, { LoginResultType: 1 }, { 'set-cookie': 'sid=scope-mock; Path=/; HttpOnly' })
      }
      if (req.method === 'POST' && path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.QueryBusinessInfo.common.kdsvc')) {
        const cookie = req.headers.cookie ?? ''
        const body = await requestBody(req)
        const payload = JSON.parse(JSON.parse(body)[0])
        if (!cookie.includes('sid=scope-mock')) return json(res, 403, { error: 'mock session required' })
        queryCounts.metadata += 1
        if (payload.FormId !== 'PUR_PurchaseOrder') return json(res, 200, { Message: '业务对象不存在' })
        return json(res, 200, { Id: payload.FormId, Key: 'FBillHead', Items: [
          { Key: 'FBillNo', Name: '单据编号', MustInput: 1 },
          { Key: 'F_PAEZ_Text', Name: '企业自定义文本', IsViewVisible: true },
          { Key: 'F_Hidden_Example', Name: '隐藏字段', IsViewVisible: false },
          { Key: 'F_Flex_Example', Name: '弹性域父字段', ElementType: 60523 },
          { Key: 'FAUXPROPID__FF100001', Name: 'metadata 标识' },
        ] })
      }
      if (req.method === 'POST' && path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc')) {
        const cookie = req.headers.cookie ?? ''
        const body = await requestBody(req)
        const payload = JSON.parse(JSON.parse(body)[0])
        if (!cookie.includes('sid=scope-mock')) return json(res, 403, { error: 'mock session required' })
        queryCounts.query += 1
        if (payload.FormId !== 'BD_MATERIAL') return json(res, 200, { Result: { Rows: [] } })
        return json(res, 200, [[`mock-row-${queryCounts.query}`]])
      }

      if (path.includes('/flowable-rest/process-api/')) {
        queryCounts.flowable += 1
        const authorization = req.headers.authorization ?? ''
        if (!authorization.startsWith('Basic ')) return json(res, 401, { message: 'basic auth required' })
        if (req.method === 'GET' && path.endsWith('/runtime/tasks')) {
          const tenantId = url.searchParams.get('tenantId') ?? ''
          const groupId = url.searchParams.get('candidateGroup') ?? ''
          const taskId = url.searchParams.get('taskId') ?? ''
          const rows = [...scopeTasks.values()].filter(task => {
            if (task.tenantId !== tenantId) return false
            if (groupId && candidateGroupsByTask.get(task.id) !== groupId) return false
            if (taskId && task.id !== taskId) return false
            return Boolean(groupId)
          })
          return json(res, 200, { data: rows, size: rows.length, total: rows.length })
        }
        const taskPath = /\/runtime\/tasks\/([^/]+)(?:\/comments)?$/.exec(path)
        if (taskPath && req.method === 'GET') {
          const task = scopeTasks.get(decodeURIComponent(taskPath[1]))
          return task ? json(res, 200, task) : json(res, 404, { message: 'task missing' })
        }
        if (taskPath && req.method === 'POST' && path.endsWith('/comments')) {
          await requestBody(req)
          queryCounts.comments += 1
          return json(res, 201, { id: `mock-comment-${queryCounts.comments}` })
        }
        if (taskPath && req.method === 'POST') {
          await requestBody(req)
          queryCounts.completed.push(decodeURIComponent(taskPath[1]))
          return json(res, 200, { id: decodeURIComponent(taskPath[1]), action: 'complete' })
        }
        return json(res, 200, { data: [], size: 0, total: 0 })
      }
      return json(res, 404, { message: 'mock route not found' })
    })().catch(() => { if (!res.headersSent) json(res, 500, { message: 'local mock failed' }) })
  })
  mockOrigin = await listenLoopback(mockServer)

  apiPort = await unusedPort()
  origin = `http://127.0.0.1:${apiPort}`
  apiEnv = {
    ...process.env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${resolve(serverDir, 'tests/dingtalk-fetch-mock.mjs')}`.trim(),
    DINGTALK_TEST_MOCK_URL: `${mockOrigin}/dingtalk-mock`,
    DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing-workspace.json'), LEGACY_DATA_FILE: join(tempDir, 'missing-workspace.json'),
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '',
    FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', FLOWABLE_USER_MAP_JSON: '{}', FLOWABLE_GROUP_MAP_JSON: '{}',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '',
  }
  await startApiProcess()
})

after(async () => {
  await stopApiProcess()
  if (mockServer?.listening) await new Promise(resolveClose => mockServer.close(resolveClose))
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('K3Cloud cache, Flowable identity, and DingTalk callbacks stay bound to complete tenant/org/account scope with mocks only', { concurrency: false }, async () => {
  const random = randomUUID().replaceAll('-', '').slice(0, 10)
  const email = `integration-scope-${random}@example.test`
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: 'Integration Scope Test', email, password: `test-${randomBytes(16).toString('hex')}` } })
  assertStatus(setup, 201, 'isolated test admin setup')
  accessToken = setup.data.accessToken
  const scopeA = setup.data.user
  tokenScopes.set(accessToken, scopeA)

  const second = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: `Mock Tenant ${random}`, organizationName: `Mock Org ${random}`, accountName: `Mock Account ${random}` } })
  assertStatus(second, 201, 'create second mock tenant/org/account scope')
  const scopeBRecord = second.data.scope
  const scopeAKey = flowableTenant(scopeA), scopeBKey = flowableTenant(scopeBRecord)
  for (const layer of ['tenantId', 'organizationId', 'accountId']) assert.notEqual(scopeA[layer], scopeBRecord[layer], `${layer} must differ between test scopes`)
  assert.notEqual(scopeAKey, scopeBKey)

  await startScope(scopeA.accountId)
  const reportTaskA = await api('/api/tasks', { method: 'POST', body: { title: 'Scope A report-only task', priority: 'medium', status: 'todo', dueDate: '2099-01-01' } })
  assertStatus(reportTaskA, 201, 'create isolated scope A report data')
  const previewA = await api('/api/reports/preview')
  assertStatus(previewA, 200, 'scope A report preview')
  assert.equal(previewA.data.summary.taskTotal, 1)
  assert.equal(previewA.data.channelStatus.configured, false)
  assert.equal(previewA.data.previewOnly, true)

  const enableBeforeConfig = await api('/api/reports/schedules', { method: 'POST', body: { name: 'Mock weekly report', cadence: 'weekly', time: '23:59', dayOfWeek: 5, timezone: 'Asia/Tokyo', enabled: true } })
  assertStatus(enableBeforeConfig, 409, 'plans cannot be enabled before a webhook is configured')
  const invalidEnabledType = await api('/api/reports/schedules', { method: 'POST', body: { name: 'Bad enabled value', cadence: 'daily', time: '09:00', timezone: 'UTC', enabled: 'true' } })
  assertStatus(invalidEnabledType, 400, 'plan enabled flag must be a boolean')
  const createdPlan = await api('/api/reports/schedules', { method: 'POST', body: { name: 'Mock weekly report', cadence: 'daily', time: '23:59', timezone: 'Asia/Tokyo', enabled: false } })
  assertStatus(createdPlan, 201, 'create a disabled report plan without real credentials')
  assert.equal(createdPlan.data.enabled, false)
  assert.equal(createdPlan.data.deliveryConfigured, false)
  assert.equal(createdPlan.data.schedulerState, 'disabled')
  const blockedManual = await api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' })
  assertStatus(blockedManual, 503, 'manual plan run without credentials is blocked')
  assert.equal(dingtalkMockCalls.length, 0, 'no-credential paths must not call the mock or a real DingTalk endpoint')
  const invalidPatch = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { enabled: 'false' } })
  assertStatus(invalidPatch, 400, 'plan patch must reject string booleans')
  const editedPlan = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { name: 'Edited weekly report', cadence: 'weekly', time: '10:30', dayOfWeek: 4, timezone: 'Asia/Tokyo' } })
  assertStatus(editedPlan, 200, 'edit plan name, cadence, weekday, time and timezone')
  assert.equal(editedPlan.data.name, 'Edited weekly report')
  assert.equal(editedPlan.data.cadence, 'weekly')
  assert.equal(editedPlan.data.dayOfWeek, 4)
  assert.equal(editedPlan.data.time, '10:30')
  assert.equal(editedPlan.data.enabled, false)

  const scheduleDefinition = await api('/api/report-definitions', { method: 'POST', body: { name: 'Schedule pinned v1', template: 'daily-sales', filters: {} } })
  assertStatus(scheduleDefinition, 201, 'create schedule-bound report definition v1')
  await startScope(scopeBRecord.accountId)
  const previewB = await api('/api/reports/preview')
  assertStatus(previewB, 200, 'scope B report preview')
  assert.equal(previewB.data.summary.taskTotal, 0, 'report content must not include scope A tasks')
  assert.equal(previewB.data.channelStatus.configured, false, 'DingTalk config must be scope-local')
  const schedulesB = await api('/api/reports/schedules')
  assertStatus(schedulesB, 200, 'scope B report schedules')
  assert.equal(schedulesB.data.schedules.length, 0, 'scope B must not see scope A plans')
  const planB = await api('/api/reports/schedules', { method: 'POST', body: { name: 'Mock weekly report', cadence: 'daily', time: '23:59', timezone: 'Asia/Tokyo', enabled: false } })
  assertStatus(planB, 201, 'create independent scope B plan with same display name')
  assert.notEqual(planB.data.id, createdPlan.data.id)
  const crossScopeDefinitionBinding = await api(`/api/reports/schedules/${planB.data.id}`, { method: 'PATCH', body: { definitionId: scheduleDefinition.data.id, definitionVersion: 1 } })
  assertStatus(crossScopeDefinitionBinding, 404, 'schedule cannot bind a definition from another complete workspace scope')

  await startScope(scopeA.accountId)
  const mockWebhook = 'https://oapi.dingtalk.com/robot/send?access_token=mock-only'
  await saveProvider('dingtalk', { webhookUrl: mockWebhook, webhookSecret: `mock-report-secret-${random}` })
  const dailyFields = { id: 'FID', billNo: 'FBillNo', date: 'FDate', partyName: 'FParty', originalAmount: 'FAmount', amountCny: 'FCNY', settledAmountCny: 'FSettled' }
  const dailyKinds = ['shipment', 'purchase-receipt', 'sales-order', 'purchase-order', 'receivable', 'payable', 'sales-invoice', 'purchase-invoice']
  const dailySources = Object.fromEntries(dailyKinds.map(kind => [kind, { formId: `TEST_${kind.replaceAll('-', '_').toUpperCase()}`, fields: { ...dailyFields } }]))
  const dailyAllowlist = Object.fromEntries(Object.values(dailySources).map(mapping => [mapping.formId, Object.values(mapping.fields)]))
  await saveProvider('k3cloud', { baseUrl: mockOrigin, accountId: 'mock-erp-account', username: 'mock-erp-user', organization: 'mock-erp-organization', appId: 'mock-app-id', appSecret: 'mock-app-secret-daily-only', lcid: '2052', formAllowlist: dailyAllowlist, dailyReportSources: dailySources })
  const enablePlan = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { enabled: true } })
  assertStatus(enablePlan, 200, 'enable plan after saving an isolated fake webhook')
  assert.equal(enablePlan.data.schedulerState, 'scheduled')
  assert.equal(enablePlan.data.deliveryConfigured, true)
  const reportAfterSetup = await api('/api/reports/preview')
  assert.equal(reportAfterSetup.data.channelStatus.configured, true)

  dingtalkMockResponses.push('fail')
  const failedRun = await api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' })
  assertStatus(failedRun, 502, 'failed mocked delivery is visible to the caller')
  assert.equal(failedRun.data.ok, false)
  assert.equal(dingtalkMockCalls.length, 1)
  const failedPlanState = await api('/api/reports/schedules')
  assert.match(failedPlanState.data.schedules[0].lastResult, /^failed:/)
  const retryRun = await api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' })
  assertStatus(retryRun, 200, 'manual retry succeeds after a failed delivery')
  assert.equal(retryRun.data.ok, true)
  assert.equal(dingtalkMockCalls.length, 2)

  // A schedule pins an immutable definition revision: preview is read-only, while
  // only actual sends create schedule snapshots.  The existing K3 and DingTalk
  // services above are local mocks, so this exercises the real delivery path safely.
  const anonymousSnapshots = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`, { token: '' })
  assertStatus(anonymousSnapshots, 401, 'schedule snapshots require authentication')
  const memberEmail = `schedule-reader-${random}@example.test`, memberPassword = `member-${randomBytes(12).toString('hex')}`
  const memberCreated = await api('/api/auth/users', { method: 'POST', body: { displayName: 'Schedule Reader', email: memberEmail, role: 'member' } })
  assertStatus(memberCreated, 201, 'create a member to exercise schedule authorization')
  const memberActivated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: memberCreated.data.activationToken, password: memberPassword } })
  assertStatus(memberActivated, 200, 'activate schedule reader')
  const memberLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: memberEmail, password: memberPassword } })
  assertStatus(memberLogin, 200, 'log in as schedule reader')
  tokenScopes.set(memberLogin.data.accessToken, memberLogin.data.user)
  const businesslineSnapshots = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`, { token: memberLogin.data.accessToken })
  assertStatus(businesslineSnapshots, 403, 'schedule snapshots are admin-only')
  const businesslinePreview = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`, { token: memberLogin.data.accessToken })
  assertStatus(businesslinePreview, 200, 'existing businessline read permissions allow schedule preview')
  const memberCreatePlan = await api('/api/reports/schedules', { method: 'POST', token: memberLogin.data.accessToken, body: { name: 'Denied schedule', cadence: 'daily', time: '23:59', timezone: 'UTC', enabled: false } })
  assertStatus(memberCreatePlan, 403, 'member cannot write report schedules')
  for (const invalidRefs of [
    { definitionId: scheduleDefinition.data.id },
    { definitionVersion: 1 },
    { definitionId: scheduleDefinition.data.id, definitionVersion: 0 },
    { definitionId: scheduleDefinition.data.id, definitionVersion: 1.5 },
    { definitionId: scheduleDefinition.data.id, definitionVersion: '1' },
    { definitionId: 'missing-definition', definitionVersion: 1 },
  ]) {
    const invalidSchedule = await api('/api/reports/schedules', { method: 'POST', body: { name: 'Invalid definition binding', cadence: 'daily', time: '23:59', timezone: 'UTC', ...invalidRefs } })
    assertStatus(invalidSchedule, invalidRefs.definitionId === 'missing-definition' ? 404 : 400, `reject invalid schedule definition refs ${JSON.stringify(invalidRefs)}`)
  }
  const bindDefinition = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { definitionId: scheduleDefinition.data.id, definitionVersion: 1 } })
  assertStatus(bindDefinition, 200, 'bind schedule to exact definition revision')
  assert.equal(bindDefinition.data.definitionId, scheduleDefinition.data.id)
  assert.equal(bindDefinition.data.definitionVersion, 1)
  const omittedBindingPatch = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { name: 'Edited weekly report' } })
  assertStatus(omittedBindingPatch, 200, 'omitting refs in PATCH preserves the binding')
  assert.equal(omittedBindingPatch.data.definitionId, scheduleDefinition.data.id)
  assert.equal(omittedBindingPatch.data.definitionVersion, 1)
  for (const invalidRefs of [{ definitionId: scheduleDefinition.data.id }, { definitionVersion: 1 }, { definitionId: scheduleDefinition.data.id, definitionVersion: 0 }, { definitionId: scheduleDefinition.data.id, definitionVersion: 999 }]) {
    const invalidBinding = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: invalidRefs })
    assertStatus(invalidBinding, invalidRefs.definitionVersion === 999 ? 404 : 400, `reject invalid binding patch ${JSON.stringify(invalidRefs)}`)
  }
  const schedulePreview = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`)
  assertStatus(schedulePreview, 200, 'preview pinned schedule definition')
  assert.equal(schedulePreview.data.previewOnly, true)
  assert.equal(schedulePreview.data.definitionId, scheduleDefinition.data.id)
  assert.equal(schedulePreview.data.definitionVersion, 1)
  assert.equal(schedulePreview.data.definition.name, 'Schedule pinned v1')
  for (const key of ['title', 'text', 'rows', 'summary', 'generatedAt', 'source', 'notice', 'amountBasis']) assert.ok(Object.hasOwn(schedulePreview.data, key), `schedule preview includes ${key}`)
  const snapshotsBeforePreview = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`)
  assertStatus(snapshotsBeforePreview, 200, 'read schedule run snapshots')
  assert.equal(snapshotsBeforePreview.data.snapshots.length, 0, 'preview does not archive a run')

  const reviseDefinition = await api(`/api/report-definitions/${scheduleDefinition.data.id}`, { method: 'PATCH', body: { name: 'Schedule pinned v2', template: 'daily-sales', filters: {}, expectedVersion: 1 } })
  assertStatus(reviseDefinition, 200, 'create immutable definition revision v2')
  assert.equal(reviseDefinition.data.version, 2)
  const pinnedPreviewAfterEdit = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`)
  assert.equal(pinnedPreviewAfterEdit.data.definitionVersion, 1, 'editing a definition does not silently move its schedule')
  assert.equal(pinnedPreviewAfterEdit.data.definition.name, 'Schedule pinned v1')
  const pinnedRun = await api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' })
  assertStatus(pinnedRun, 200, 'send schedule using its pinned v1 definition after v2 exists')
  assert.equal(dingtalkMockCalls.length, 3)
  assert.match(JSON.stringify(dingtalkMockCalls.at(-1)), /Schedule pinned v1/)
  const snapshotsAfterRun = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`)
  assertStatus(snapshotsAfterRun, 200, 'read archived schedule run')
  assert.equal(snapshotsAfterRun.data.snapshots.length, 1)
  const archivedV1 = snapshotsAfterRun.data.snapshots[0]
  assert.equal(archivedV1.scheduleId, createdPlan.data.id)
  assert.equal(archivedV1.definitionId, scheduleDefinition.data.id)
  assert.equal(archivedV1.definitionVersion, 1)
  assert.equal(archivedV1.report.definition.name, 'Schedule pinned v1')
  for (const key of ['title', 'text', 'generatedAt', 'rows', 'summary']) assert.ok(Object.hasOwn(archivedV1.report, key), `snapshot report includes ${key}`)
  const rebindLatest = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { definitionId: scheduleDefinition.data.id, definitionVersion: 2 } })
  assertStatus(rebindLatest, 200, 'explicitly rebind schedule to v2')
  const v2Preview = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`)
  assert.equal(v2Preview.data.definitionVersion, 2)
  assert.equal(v2Preview.data.definition.name, 'Schedule pinned v2')
  const v2Run = await api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' })
  assertStatus(v2Run, 200, 'send explicitly rebound v2 definition')
  assert.equal(dingtalkMockCalls.length, 4)
  assert.match(JSON.stringify(dingtalkMockCalls.at(-1)), /Schedule pinned v2/)
  const snapshotsAfterV2 = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`)
  assert.equal(snapshotsAfterV2.data.snapshots.length, 2)
  const archivedOld = snapshotsAfterV2.data.snapshots.find(item => item.definitionVersion === 1)
  assert.equal(archivedOld.report.definition.name, 'Schedule pinned v1', 'later definition changes do not mutate archived content')
  assert.equal(snapshotsAfterV2.data.snapshots.find(item => item.definitionVersion === 2).report.definition.name, 'Schedule pinned v2')
  const dailyArchive = await api('/api/daily-reports/snapshots', { method: 'POST', body: { reportDate: '2026-10-19', scope: 'both' } })
  assertStatus(dailyArchive, 201, 'create a daily report archive before definition edits')
  const dailySnapshotsBeforeDefinitionEdit = await api('/api/daily-reports/snapshots')
  assertStatus(dailySnapshotsBeforeDefinitionEdit, 200, 'read daily report archives before definition edit')
  assert.ok(dailySnapshotsBeforeDefinitionEdit.data.snapshots.length > 0, 'daily archive baseline is nonempty')
  const currentBinding = { definitionId: rebindLatest.data.definitionId, definitionVersion: rebindLatest.data.definitionVersion }
  const archivedBeforeFurtherEdit = structuredClone(snapshotsAfterV2.data.snapshots)
  const furtherRevision = await api(`/api/report-definitions/${scheduleDefinition.data.id}`, { method: 'PATCH', body: { name: 'Schedule pinned v3', template: 'daily-sales', filters: {}, expectedVersion: 2 } })
  assertStatus(furtherRevision, 200, 'create another immutable revision while schedule remains pinned to v2')
  const snapshotsAfterFurtherEdit = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`)
  assert.deepEqual(snapshotsAfterFurtherEdit.data.snapshots, archivedBeforeFurtherEdit, 'definition edits leave archived snapshots deeply unchanged')
  const dailySnapshotsAfterDefinitionEdit = await api('/api/daily-reports/snapshots')
  assert.deepEqual(dailySnapshotsAfterDefinitionEdit.data, dailySnapshotsBeforeDefinitionEdit.data, 'definition edits leave daily report snapshots unchanged')
  const bindingBeforeRestart = await api('/api/reports/schedules')
  const persistedBeforeRestart = bindingBeforeRestart.data.schedules.find(item => item.id === createdPlan.data.id)
  assert.deepEqual({ definitionId: persistedBeforeRestart.definitionId, definitionVersion: persistedBeforeRestart.definitionVersion }, currentBinding)
  await stopApiProcess()
  await startApiProcess()
  const bindingAfterRestart = await api('/api/reports/schedules')
  const persistedAfterRestart = bindingAfterRestart.data.schedules.find(item => item.id === createdPlan.data.id)
  assert.deepEqual({ definitionId: persistedAfterRestart.definitionId, definitionVersion: persistedAfterRestart.definitionVersion }, currentBinding, 'schedule revision binding persists across API process restart')
  const snapshotsAfterRestart = await api(`/api/reports/schedules/${createdPlan.data.id}/snapshots`)
  assert.deepEqual(snapshotsAfterRestart.data.snapshots, archivedBeforeFurtherEdit, 'immutable archived snapshot persists unchanged across restart')
  const previewAfterRestart = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`)
  assert.equal(previewAfterRestart.data.definitionVersion, 2)
  assert.equal(previewAfterRestart.data.definition.name, 'Schedule pinned v2', 'preview stays on pinned revision after restart and later definition edit')
  const detach = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { definitionId: null, definitionVersion: null } })
  assertStatus(detach, 200, 'explicitly detach both revision references')
  assert.equal(detach.data.definitionId ?? null, null)
  assert.equal(detach.data.definitionVersion ?? null, null)
  const detachedPreview = await api(`/api/reports/schedules/${createdPlan.data.id}/preview`)
  assertStatus(detachedPreview, 200, 'detached schedule preserves legacy fixed workspace preview')
  const rebindOld = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { definitionId: scheduleDefinition.data.id, definitionVersion: 1 } })
  assertStatus(rebindOld, 200, 'explicitly rebind old historical revision')
  assert.equal(rebindOld.data.definitionVersion, 1)

  dingtalkMockDelayMs = 250
  const overlappingRuns = await Promise.all([
    api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' }),
    api(`/api/reports/schedules/${createdPlan.data.id}/run`, { method: 'POST' }),
  ])
  dingtalkMockDelayMs = 0
  assert.deepEqual(overlappingRuns.map(item => item.response.status).sort(), [200, 409], 'a scoped plan only permits one in-flight manual send')
  assert.equal(dingtalkMockCalls.length, 5, 'the overlapping request must not reach even the local DingTalk mock')

  const disablePlan = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'PATCH', body: { enabled: false } })
  assertStatus(disablePlan, 200, 'disable a report plan')
  assert.equal(disablePlan.data.schedulerState, 'disabled')
  const aPlansAfterB = await api('/api/reports/schedules')
  assert.equal(aPlansAfterB.data.schedules.length, 1, 'scope A must retain only its own plan')
  const deletedB = await api(`/api/reports/schedules/${planB.data.id}`, { method: 'DELETE' })
  assertStatus(deletedB, 404, 'scope A cannot delete scope B plan by guessed ID')
  const deletedA = await api(`/api/reports/schedules/${createdPlan.data.id}`, { method: 'DELETE' })
  assertStatus(deletedA, 204, 'delete a report plan')
  const emptyAPlans = await api('/api/reports/schedules')
  assert.equal(emptyAPlans.data.schedules.length, 0)

  // Flowable/DingTalk environment defaults are scope-bound; K3Cloud must use PLM encrypted settings only.
  const defaultsDb = join(tempDir, 'defaults.sqlite')
  const defaultsEnv = {
    ...process.env, NODE_ENV: 'test', DATABASE_FILE: defaultsDb,
    APP_ENCRYPTION_KEY: '6c'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'defaults-encryption.key'),
    CONNECTOR_DEFAULT_TENANT_ID: 'default-tenant', CONNECTOR_DEFAULT_ORGANIZATION_ID: 'default-organization', CONNECTOR_DEFAULT_ACCOUNT_ID: 'default-account',
    FLOWABLE_BASE_URL: 'http://127.0.0.1:1/flowable-rest/process-api', FLOWABLE_USERNAME: 'test-flowable-user', FLOWABLE_PASSWORD: 'test-flowable-password-placeholder', FLOWABLE_USER_MAP_JSON: '{"alice@example.test":"user-a"}', FLOWABLE_GROUP_MAP_JSON: '{"user-a":["group-a"]}',
    K3CLOUD_BASE_URL: 'http://127.0.0.1:1/k3cloud', K3CLOUD_ACCOUNT_ID: 'test-erp-account', K3CLOUD_USERNAME: 'test-erp-user', K3CLOUD_ORGANIZATION: 'test-erp-org', K3CLOUD_APP_ID: 'test-app-id', K3CLOUD_APP_SECRET: 'test-app-secret-placeholder', K3CLOUD_QUERY_ALLOWLIST: '{"BD_MATERIAL":["FNumber"]}',
    DINGTALK_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=test-placeholder', DINGTALK_WEBHOOK_SECRET: 'test-ding-secret-placeholder', DINGTALK_CARD_CALLBACK_SECRET: 'test-card-secret-placeholder', DINGTALK_CORP_ID: 'test-corp', DINGTALK_USER_MAP_JSON: '{"test-corp:test-user":"flowable-user"}',
    REDIS_URL: '',
  }
  const bindingScript = `
    import assert from 'node:assert/strict';
    const { connectorCredentialConfig } = await import('./dist/integrations/configuration.js');
    const exact = { tenantId: 'default-tenant', organizationId: 'default-organization', accountId: 'default-account' };
    assert.equal(connectorCredentialConfig(exact, 'flowable').groupMap['user-a'][0], 'group-a');
    assert.deepEqual(connectorCredentialConfig(exact, 'k3cloud'), {}, 'K3Cloud settings must be entered in PLM and never read from environment defaults');
    assert.equal(connectorCredentialConfig(exact, 'dingtalk').corpId, 'test-corp');
    for (const layer of ['tenantId', 'organizationId', 'accountId']) {
      for (const value of ['', 'forged-' + layer]) {
        const scope = { ...exact, [layer]: value };
        for (const provider of ['flowable', 'k3cloud', 'dingtalk']) assert.deepEqual(connectorCredentialConfig(scope, provider), {}, provider + ' must reject partial or forged ' + layer);
      }
    }
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', bindingScript], { cwd: serverDir, env: defaultsEnv, stdio: 'pipe' })

  // The SSO code needs all three IDs independently; no real authorization-code exchange is performed.
  const ssoKeys = ['DINGTALK_SSO_CLIENT_ID', 'DINGTALK_SSO_CLIENT_SECRET', 'DINGTALK_SSO_CORP_ID', 'DINGTALK_SSO_TENANT_ID', 'DINGTALK_SSO_ORGANIZATION_ID', 'DINGTALK_SSO_ACCOUNT_ID']
  const priorSsoEnv = Object.fromEntries(ssoKeys.map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, { DINGTALK_SSO_CLIENT_ID: 'test-client', DINGTALK_SSO_CLIENT_SECRET: 'test-secret-placeholder', DINGTALK_SSO_CORP_ID: 'test-corp', DINGTALK_SSO_TENANT_ID: 'scope-tenant', DINGTALK_SSO_ORGANIZATION_ID: 'scope-org', DINGTALK_SSO_ACCOUNT_ID: 'scope-account' })
    const sso = await import('../dist/dingtalk-sso.js')
    assert.equal(sso.dingtalkSsoStatus().configured, true)
    for (const key of ['DINGTALK_SSO_TENANT_ID', 'DINGTALK_SSO_ORGANIZATION_ID', 'DINGTALK_SSO_ACCOUNT_ID']) {
      delete process.env[key]
      const result = sso.dingtalkSsoStatus()
      assert.equal(result.configured, false, `${key} must be required independently`)
      assert.ok(result.missing.includes(key))
      process.env[key] = ({ DINGTALK_SSO_TENANT_ID: 'scope-tenant', DINGTALK_SSO_ORGANIZATION_ID: 'scope-org', DINGTALK_SSO_ACCOUNT_ID: 'scope-account' })[key]
    }
  } finally {
    for (const key of ssoKeys) {
      if (priorSsoEnv[key] === undefined) delete process.env[key]
      else process.env[key] = priorSsoEnv[key]
    }
  }

  queryCounts.login = 0; queryCounts.query = 0
  const k3Config = {
    baseUrl: mockOrigin, accountId: 'mock-erp-account', username: 'mock-erp-user', organization: 'mock-erp-organization',
    appId: 'mock-app-id', appSecret: 'mock-app-secret-only', lcid: '2052', formAllowlist: { BD_MATERIAL: ['FNumber'] },
  }
  const savedK3Settings = await saveProvider('k3cloud', k3Config)
  assert.equal(savedK3Settings.secrets.appId, true, 'K3Cloud AppId presence must be reported without returning its value')
  assert.equal(savedK3Settings.secrets.appSecret, true, 'K3Cloud AppSecret presence must be reported without returning its value')
  assert.equal(Object.hasOwn(savedK3Settings.config, 'appId'), false, 'K3Cloud AppId must not be echoed in the settings summary')
  assert.equal(JSON.stringify(savedK3Settings).includes('mock-app-id'), false, 'K3Cloud AppId must not be returned by the settings API')
  assert.equal(JSON.stringify(savedK3Settings).includes('mock-app-secret-only'), false, 'K3Cloud AppSecret must not be returned by the settings API')
  const catalog = await api('/api/k3cloud/form-catalog')
  assertStatus(catalog, 200, 'read-only K3Cloud FormId hint catalog')
  assert.equal(catalog.data.entries.find(item => item.formId === 'SAL_OUTSTOCK').sourceCatalogMarkedVerified, true)
  assert.match(catalog.data.note, /不代表当前 PLM 账套可用/)
  const metadataBeforeTest = await api('/api/k3cloud/metadata/discover', { method: 'POST', body: { formId: 'PUR_PurchaseOrder' } })
  assertStatus(metadataBeforeTest, 409, 'metadata discovery requires a successful connection test')
  const invalidMetadataForm = await api('/api/k3cloud/metadata/discover', { method: 'POST', body: { formId: 'bad/form' } })
  assertStatus(invalidMetadataForm, 400, 'metadata discovery rejects malformed FormId before an ERP request')
  assert.equal(queryCounts.metadata, 0)
  const testedK3 = await api('/api/integrations/settings/k3cloud/test', { method: 'POST', body: {} })
  assertStatus(testedK3, 200, 'test mock K3Cloud credentials before metadata discovery')
  assert.equal(testedK3.data.status.authenticated, true)
  const discoveredMetadata = await api('/api/k3cloud/metadata/discover', { method: 'POST', body: { formId: 'PUR_PurchaseOrder' } })
  assertStatus(discoveredMetadata, 200, 'discover metadata through PLM read-only adapter')
  assert.equal(discoveredMetadata.data.source, 'query_metadata')
  assert.ok(discoveredMetadata.data.fields.some(field => field.key === 'F_PAEZ_Text' && field.isCustom))
  assert.ok(discoveredMetadata.data.hiddenCustomKeys.includes('F_Hidden_Example'))
  assert.ok(discoveredMetadata.data.flexParentKeys.includes('F_Flex_Example'))
  assert.ok(!discoveredMetadata.data.fields.some(field => field.key.includes('__')))
  assert.equal(queryCounts.metadata, 1)
  const afterDiscoverySettings = await api('/api/integrations/settings')
  assert.deepEqual(afterDiscoverySettings.data.providers.k3cloud.config.formAllowlist, { BD_MATERIAL: ['FNumber'] }, 'discovery must not silently expand the account allowlist')
  const k3Query = { formId: 'BD_MATERIAL', fieldKeys: 'FNumber', limit: 1 }
  let resultA = await api('/api/k3cloud/query', { method: 'POST', body: k3Query })
  assertStatus(resultA, 200, 'scope A mocked K3Cloud query')
  assert.equal(resultA.data.rows[0].FNumber, 'mock-row-1')
  assert.equal(resultA.data.cached, false)
  resultA = await api('/api/k3cloud/query', { method: 'POST', body: k3Query })
  assertStatus(resultA, 200, 'scope A K3Cloud cache hit')
  assert.equal(resultA.data.rows[0].FNumber, 'mock-row-1')
  assert.equal(resultA.data.cached, true)
  assert.equal(queryCounts.query, 1)

  await startScope(scopeBRecord.accountId)
  await saveProvider('k3cloud', k3Config)
  let resultB = await api('/api/k3cloud/query', { method: 'POST', body: k3Query })
  assertStatus(resultB, 200, 'scope B mocked K3Cloud query')
  assert.equal(resultB.data.rows[0].FNumber, 'mock-row-2', 'scope B must not receive scope A cache content even when connector credentials and query are identical')
  assert.equal(resultB.data.cached, false)
  resultB = await api('/api/k3cloud/query', { method: 'POST', body: k3Query })
  assertStatus(resultB, 200, 'scope B K3Cloud cache hit')
  assert.equal(resultB.data.rows[0].FNumber, 'mock-row-2')
  assert.equal(resultB.data.cached, true)
  assert.equal(queryCounts.query, 2)
  assert.equal(queryCounts.login, 2, 'K3Cloud authentication session keys must include the full internal scope')

  const queriesBeforeInvalidScope = queryCounts.query
  for (const [header, forgedValue] of [
    ['X-Tenant-ID', 'forged-tenant'], ['X-Organization-ID', 'forged-organization'], ['X-Account-ID', scopeA.accountId],
  ]) {
    const denied = await api('/api/k3cloud/query', { method: 'POST', body: k3Query, headers: { [header]: forgedValue } })
    assert.ok(denied.response.status >= 400, `${header} forgery must be rejected`)
  }
  for (const header of ['X-Tenant-ID', 'X-Organization-ID', 'X-Account-ID']) {
    const denied = await api('/api/k3cloud/query', { method: 'POST', body: k3Query, headers: { [header]: '' } })
    assert.ok(denied.response.status >= 400, `${header} omission must be rejected`)
  }
  assert.equal(queryCounts.query, queriesBeforeInvalidScope, 'invalid scope requests must be stopped before calling K3Cloud')
  await startScope(scopeA.accountId)
  const isolatedA = await api('/api/k3cloud/query', { method: 'POST', body: k3Query })
  assertStatus(isolatedA, 200, 'scope A cache remains independent after scope B query')
  assert.equal(isolatedA.data.rows[0].FNumber, 'mock-row-1')
  assert.equal(isolatedA.data.cached, true)

  // Connector records are tied to the exact same tenant/org/account tuple as the request.
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    for (const scope of [scopeA, scopeBRecord]) {
      const row = db.prepare("SELECT tenant_id AS tenantId, organization_id AS organizationId, account_id AS accountId, provider, encrypted_config AS encryptedConfig FROM connector_configs WHERE account_id=? AND provider='k3cloud'").get(scope.accountId)
      assert.deepEqual({ tenantId: row.tenantId, organizationId: row.organizationId, accountId: row.accountId, provider: row.provider }, { tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId, provider: 'k3cloud' })
      assert.equal(row.encryptedConfig.includes('mock-app-id'), false, 'K3Cloud AppId must remain encrypted at rest')
      assert.equal(row.encryptedConfig.includes('mock-app-secret-only'), false, 'K3Cloud credentials must remain encrypted at rest')
    }
  } finally { db.close() }

  const actorA = `flowable-mapped-a-${random}`
  const actorB = `flowable-mapped-b-${random}`
  const groupA = `candidate-group-a-${random}`
  const groupB = `candidate-group-b-${random}`
  const taskA = { id: `mock-candidate-task-a-${random}`, tenantId: scopeAKey, assignee: null, name: 'Mock candidate task A', processInstanceId: `mock-process-a-${random}` }
  const taskB = { id: `mock-candidate-task-b-${random}`, tenantId: scopeBKey, assignee: null, name: 'Mock candidate task B', processInstanceId: `mock-process-b-${random}` }
  scopeTasks = new Map([[taskA.id, taskA], [taskB.id, taskB]])
  candidateGroupsByTask.set(taskA.id, groupA)
  candidateGroupsByTask.set(taskB.id, groupB)

  const mockFlowable = { baseUrl: `${mockOrigin}/flowable-rest/process-api`, username: 'mock-flowable-user', password: 'mock-flowable-password-only', timeoutMs: 3000 }
  const dingSecretA = `mock-ding-secret-a-${random}`
  const dingSecretB = `mock-ding-secret-b-${random}`
  const mockDing = (secret, mappedUser) => ({
    webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=mock-only',
    corpId: 'mock-corp-id', cardCallbackSecret: secret,
    userMapping: { 'mock-corp-id:mock-dingtalk-user': mappedUser },
  })

  await startScope(scopeA.accountId)
  await saveProvider('flowable', { ...mockFlowable, userMap: { [email]: actorA }, groupMap: {} })
  await saveProvider('dingtalk', mockDing(dingSecretA, actorA))
  const missingGroup = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretA), body: callbackPayload(taskA.id) })
  assertStatus(missingGroup, 403, 'DingTalk identity without a scoped candidate-group mapping must not approve a candidate group task')
  assert.deepEqual(queryCounts.completed, [])

  await saveProvider('flowable', { ...mockFlowable, userMap: { [email]: actorA }, groupMap: { [actorA]: [groupA] } })
  const approvedA = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretA), body: callbackPayload(taskA.id) })
  assertStatus(approvedA, 200, 'signed DingTalk callback with exact scope/user/group mapping')
  assert.deepEqual(queryCounts.completed, [taskA.id])

  await startScope(scopeBRecord.accountId)
  await saveProvider('flowable', { ...mockFlowable, userMap: { [email]: actorB }, groupMap: {} })
  await saveProvider('dingtalk', mockDing(dingSecretB, actorB))
  const crossScopeA = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretB), body: callbackPayload(taskA.id) })
  assertStatus(crossScopeA, 403, 'scope B signed identity must not act on scope A tenant task')
  assert.deepEqual(queryCounts.completed, [taskA.id])

  const missingDingIdentity = await saveProvider('dingtalk', { ...mockDing(dingSecretB, actorB), userMapping: {} })
  assert.equal(missingDingIdentity.secrets.cardCallbackSecret, true)
  const unmappedDingTalk = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretB), body: callbackPayload(taskB.id) })
  assertStatus(unmappedDingTalk, 403, 'valid callback signature without a scope-local DingTalk user mapping must be denied')
  await saveProvider('dingtalk', mockDing(dingSecretB, actorB))

  const missingGroupB = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretB), body: callbackPayload(taskB.id) })
  assertStatus(missingGroupB, 403, 'scope B candidate group must be independently mapped')
  await saveProvider('flowable', { ...mockFlowable, userMap: { [email]: actorB }, groupMap: { [actorB]: [groupB] } })
  const approvedB = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(dingSecretB), body: callbackPayload(taskB.id) })
  assertStatus(approvedB, 200, 'scope B callback should succeed only after its own candidate-group map is saved')
  assert.deepEqual(queryCounts.completed, [taskA.id, taskB.id])

  const badSignature = await api('/api/dingtalk/cards/callback', { method: 'POST', token: '', headers: signCallback(`${dingSecretA}-wrong`), body: callbackPayload(taskB.id) })
  assertStatus(badSignature, 403, 'a forged or wrong-scope callback signature must not complete a task')
  assert.deepEqual(queryCounts.completed, [taskA.id, taskB.id])

  // A valid callback must be scoped from the encrypted connector row and the Flowable task's full tenant ID,
  // not from request-supplied tenant/org/account hints. The mock Flowable endpoint accepts only Basic Auth.
  assert.ok(queryCounts.flowable > 0)
  assert.ok(queryCounts.comments >= 2)
  assert.equal(queryCounts.completed.length, 2)
  console.log(JSON.stringify({
    providers: ['K3Cloud mock', 'Flowable mock', 'DingTalk callback mock'],
    internalScopes: 2,
    connectorDefaultTripleBinding: 'passed',
    dingtalkSsoRequiresEachScopeLayer: 'passed',
    k3cloudSessionAndCacheIsolation: 'passed',
    missingOrForgedScopeHeadersRejectedBeforeProviderCall: 'passed',
    flowableCandidateGroupsScopedPerAccount: 'passed',
    dingtalkIdentityAndCallbackScopeBinding: 'passed',
    realEnterpriseServicesContacted: false,
  }))
})
