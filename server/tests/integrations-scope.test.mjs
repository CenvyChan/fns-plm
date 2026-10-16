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
let mockServer
let origin = ''
let mockOrigin = ''
let accessToken = ''
const tokenScopes = new Map()
const queryCounts = { login: 0, query: 0, flowable: 0, comments: 0, completed: [] }
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
      if (req.method === 'POST' && path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc')) {
        queryCounts.login += 1
        await requestBody(req)
        return json(res, 200, { LoginResultType: 1 }, { 'set-cookie': 'sid=scope-mock; Path=/; HttpOnly' })
      }
      if (req.method === 'POST' && path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc')) {
        const cookie = req.headers.cookie ?? ''
        await requestBody(req)
        if (!cookie.includes('sid=scope-mock')) return json(res, 403, { error: 'mock session required' })
        queryCounts.query += 1
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

  const apiPort = await unusedPort()
  origin = `http://127.0.0.1:${apiPort}`
  const env = {
    ...process.env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort),
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
  apiProcess = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'ignore', 'ignore'] })
  await waitForServer()
})

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill('SIGTERM')
    await Promise.race([new Promise(resolveExit => apiProcess.once('exit', resolveExit)), new Promise(resolveDelay => setTimeout(resolveDelay, 4000))])
    if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL')
  }
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

  // Environment-based connector defaults must be present only for the exact full triple.
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
    assert.equal(connectorCredentialConfig(exact, 'k3cloud').accountId, 'test-erp-account');
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

  const k3Config = {
    baseUrl: mockOrigin, accountId: 'mock-erp-account', username: 'mock-erp-user', organization: 'mock-erp-organization',
    appId: 'mock-app-id', appSecret: 'mock-app-secret-only', lcid: '2052', formAllowlist: { BD_MATERIAL: ['FNumber'] },
  }
  await saveProvider('k3cloud', k3Config)
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
