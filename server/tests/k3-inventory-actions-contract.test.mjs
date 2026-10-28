import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
const inventoryPath = '/Kingdee.K3.SCM.WebApi.ServicesStub.InventoryQueryService.GetInventoryData,Kingdee.K3.SCM.WebApi.ServicesStub.common.kdsvc'
const loginPath = '/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc'
const sourceEndpoint = '/k3cloud/Kingdee.K3.SCM.WebApi.ServicesStub.InventoryQueryService.GetInventoryData,Kingdee.K3.SCM.WebApi.ServicesStub.common.kdsvc'
const probeConfig = { enabled: true, parameters: { fstockorgnumbers: 'TEST-ORG-01', fstocknumbers: 'TEST-WH-01', fmaterialnumbers: 'TEST-ITEM-01', isshowauxprop: false, isshowstockloc: false, pageindex: 1 } }
const expectedParameters = { ...probeConfig.parameters, pagerows: 5 }
const expectedK3RequestBody = JSON.stringify({ parameters: [JSON.stringify(expectedParameters)] })
const safeMockRows = [{ marker: 'MOCK-SAFE-ROW-1' }, { marker: 'MOCK-SAFE-ROW-2' }]
const safeMockPayload = { Result: { rows: safeMockRows }, envelopeMarker: 'MOCK-RAW-ENVELOPE' }
const unknownMockPayload = { opaqueEnvelope: { marker: 'MOCK-UNKNOWN-RAW', rows: [{ marker: 'MOCK-UNKNOWN-ROW' }] } }
const genericInventoryError = { error: 'k3cloud_inventory_data_failed', message: 'GetInventoryData 响应无法安全限量，未返回原始响应。' }
const scopes = new Map()
let tempDir, databaseFile, origin, child, mockServer, mockOrigin, mockMode = 'safe-rows', mockCalls = [], adminToken, adminUser
let otherScopeSequence = 0

async function freePort() {
  const server = createServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value
}
async function startMockK3() {
  const port = await freePort(); mockOrigin = `http://127.0.0.1:${port}`
  mockServer = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8'), url = req.url ?? ''
      mockCalls.push({ method: req.method, url, bodyText: text })
      res.setHeader('content-type', 'application/json')
      if (url.endsWith(loginPath)) {
        if (mockMode === 'login-error') { res.statusCode = 401; res.end(JSON.stringify({ error: 'MOCK-LOGIN-DETAIL' })); return }
        res.setHeader('set-cookie', 'session=local-mock; Path=/')
        res.end(JSON.stringify({ LoginResultType: 1 }))
        return
      }
      if (url.endsWith(inventoryPath)) {
        if (mockMode === 'http-error') { res.statusCode = 502; res.end(JSON.stringify({ error: 'MOCK-UPSTREAM-DETAIL' })); return }
        if (mockMode === 'invalid-json') { res.end('{not-json'); return }
        if (mockMode === 'business-error') { res.end(JSON.stringify({ actionname: 'MOCK-BUSINESS-DETAIL' })); return }
        if (mockMode === 'unknown-shape') { res.end(JSON.stringify(unknownMockPayload)); return }
        if (mockMode === 'ambiguous-shape') { res.end(JSON.stringify({ rows: [{ marker: 'MOCK-AMBIGUOUS-ROOT-ROW' }], Result: { Rows: [{ marker: 'MOCK-AMBIGUOUS-NESTED-ROW' }] } })); return }
        if (mockMode === 'over-five') { res.end(JSON.stringify({ rows: Array.from({ length: 6 }, (_, index) => ({ marker: `MOCK-OVERLIMIT-${index}` })) })); return }
        res.end(JSON.stringify(safeMockPayload))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'unexpected-mock-path' }))
    })
  })
  await new Promise((resolve, reject) => mockServer.listen(port, '127.0.0.1', resolve).once('error', reject))
}
async function startApi() {
  const port = await freePort(); origin = `http://127.0.0.1:${port}`
  const env = {
    PATH: process.env.PATH, HOME: tempDir, TMPDIR: tempDir, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'), DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}', DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '',
  }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderrText = ''; child.stderr.on('data', chunk => child.stderrText += chunk)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error(`API exited: ${child.stderrText}`)
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(700) })).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error(`API health timeout: ${child.stderrText}`)
}
async function stopApi() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 4000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
async function api(path, { method = 'GET', body, token = adminToken, scope = true, headers = {} } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    const selected = scope && scopes.get(token)
    if (selected) { requestHeaders['X-Tenant-ID'] = selected.tenantId; requestHeaders['X-Organization-ID'] = selected.organizationId; requestHeaders['X-Account-ID'] = selected.accountId }
  }
  Object.assign(requestHeaders, headers)
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(origin + path, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  const text = await response.text(); let data
  try { data = JSON.parse(text) } catch { data = text }
  return { response, data, text }
}
function inventoryCalls() { return mockCalls.filter(call => call.url.endsWith(inventoryPath)) }
async function addOtherScope(accountNames = { tenantName: 'Other tenant', organizationName: 'Other org', accountName: 'Other account' }) {
  const db = new Database(databaseFile), now = new Date().toISOString()
  const suffix = String(++otherScopeSequence)
  const ids = { tenantId: `mock-other-tenant-${suffix}`, organizationId: `mock-other-org-${suffix}`, accountId: accountNames.accountId ?? `mock-other-account-${suffix}` }
  db.prepare("INSERT INTO tenants(id,name,code,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(ids.tenantId, accountNames.tenantName, `MOCK-OTHER-TENANT-${suffix}`, now, now)
  db.prepare("INSERT INTO organizations(id,tenant_id,name,code,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(ids.organizationId, ids.tenantId, accountNames.organizationName, `MOCK-OTHER-ORG-${suffix}`, now, now)
  db.prepare("INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,'k3cloud','active',?,?)").run(ids.accountId, ids.tenantId, ids.organizationId, accountNames.accountName, `MOCK-OTHER-ACCOUNT-${suffix}`, now, now)
  db.prepare("INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,'admin',0,?)").run(`mock-other-membership-${suffix}`, adminUser.id, ids.tenantId, ids.organizationId, ids.accountId, now)
  db.close()
  const login = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'inventory-admin@example.test', password: 'test-password-12345', accountId: ids.accountId } })
  assert.equal(login.response.status, 200, JSON.stringify(login.data))
  scopes.set(login.data.accessToken, login.data.user)
  return login.data.accessToken
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'k3-inventory-actions-')); databaseFile = join(tempDir, 'isolated.sqlite')
  await startMockK3(); await startApi()
})
after(async () => {
  mockMode = 'safe-rows'; await stopApi()
  if (mockServer) await new Promise(resolve => mockServer.close(resolve))
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('GetInventoryData requires per-scope opt-in, uses synthetic filters and caps output at five rows', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: 'Inventory admin', email: 'inventory-admin@example.test', password: 'test-password-12345', tenantName: 'Synthetic tenant', organizationName: 'Synthetic org', accountName: 'Synthetic account' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  adminToken = setup.data.accessToken; adminUser = setup.data.user; scopes.set(adminToken, adminUser)
  const actionPath = '/api/k3cloud/actions/GetInventoryData'
  assert.equal((await api(actionPath, { token: '' })).response.status, 401)
  assert.equal((await api(actionPath, { scope: false })).response.status, 400)
  assert.equal((await api(actionPath, { headers: { 'X-Account-ID': 'forged-account' } })).response.status, 403)

  const configured = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { baseUrl: `${mockOrigin}/k3cloud`, accountId: 'mock-erp-account', username: 'mock-erp-user', organization: 'mock-erp-org', appId: 'mock-app-id', appSecret: 'mock-app-secret', lcid: '2052' } })
  assert.equal(configured.response.status, 200, JSON.stringify(configured.data))
  assert.equal(mockCalls.length, 0, 'saving a local mock connector does not contact K3')
  const disabled = await api(actionPath, { method: 'POST' })
  assert.equal(disabled.response.status, 503)
  assert.equal(disabled.data.error, 'k3cloud_inventory_probe_not_configured')
  assert.equal(mockCalls.length, 0, 'probe is disabled until explicitly configured in this scope')
  const probeSaved = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { baseUrl: `${mockOrigin}/k3cloud`, accountId: 'mock-erp-account', username: 'mock-erp-user', organization: 'mock-erp-org', appId: 'mock-app-id', appSecret: 'mock-app-secret', lcid: '2052', inventoryDataProbe: probeConfig } })
  assert.equal(probeSaved.response.status, 200, JSON.stringify(probeSaved.data))

  assert.equal(sourceEndpoint, `/k3cloud${inventoryPath}`)

  assert.equal((await api(actionPath, { method: 'POST', body: { pagerows: 2 } })).response.status, 400, 'caller cannot customize request body')
  assert.equal((await api(`${actionPath}?pageindex=2`, { method: 'POST' })).response.status, 400, 'caller cannot customize query parameters')
  assert.equal(mockCalls.length, 0, 'rejected expansions are blocked before K3')

  const first = await api(actionPath, { method: 'POST' })
  assert.equal(first.response.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.method, 'GetInventoryData')
  assert.equal(first.data.readOnly, true)
  assert.deepEqual(first.data.parameterKeys, Object.keys(probeConfig.parameters))
  assert.equal(first.data.pageIndex, 1)
  assert.equal(first.data.pageRows, 5)
  assert.doesNotMatch(first.text, /TEST-ORG-01|TEST-WH-01|TEST-ITEM-01/, 'configured filter values are not echoed to clients')
  assert.equal(first.data.responseShapeVerified, false)
  assert.equal(first.data.responseRowLimitVerified, false)
  assert.match(first.data.verificationNote, /外部响应格式和分页语义仍需在获准的专用环境中验证/)
  assert.deepEqual(first.data.result, { rows: safeMockRows }, 'successful responses contain only the controlled rows structure')
  assert.doesNotMatch(first.text, /MOCK-RAW-ENVELOPE/)
  assert.equal(inventoryCalls().length, 1)
  assert.equal(inventoryCalls().at(-1).method, 'POST')
  assert.equal(inventoryCalls().at(-1).url, sourceEndpoint)
  assert.equal(inventoryCalls().at(-1).bodyText, expectedK3RequestBody)
  assert.ok(mockCalls.some(call => call.url.endsWith(loginPath)))

  const second = await api(actionPath, { method: 'POST' })
  assert.equal(second.response.status, 200)
  assert.equal(inventoryCalls().length, 2, 'business results are fetched again rather than cached')
  assert.equal(inventoryCalls().at(-1).bodyText, expectedK3RequestBody)

  for (const mode of ['unknown-shape', 'ambiguous-shape', 'over-five', 'http-error', 'invalid-json', 'business-error']) {
    mockMode = mode
    const beforeCalls = inventoryCalls().length
    const failed = await api(actionPath, { method: 'POST' })
    assert.equal(failed.response.status, 502, mode)
    assert.deepEqual(failed.data, genericInventoryError, mode)
    assert.doesNotMatch(failed.text, /MOCK-UNKNOWN-RAW|MOCK-UNKNOWN-ROW|MOCK-AMBIGUOUS|MOCK-OVERLIMIT|MOCK-UPSTREAM-DETAIL|MOCK-BUSINESS-DETAIL|not-json/, mode)
    assert.equal(inventoryCalls().length, beforeCalls + 1, `${mode} still uses exactly one fixed K3 request`)
    assert.equal(inventoryCalls().at(-1).method, 'POST', mode)
    assert.equal(inventoryCalls().at(-1).url, sourceEndpoint, mode)
    assert.equal(inventoryCalls().at(-1).bodyText, expectedK3RequestBody, mode)
  }
  mockMode = 'safe-rows'

  const foreignToken = await addOtherScope()
  const callsBeforeForeignScope = mockCalls.length
  const foreignAction = await api(actionPath, { method: 'POST', token: foreignToken })
  assert.equal(foreignAction.response.status, 503)
  assert.equal(foreignAction.data.error, 'k3cloud_not_configured')
  assert.equal(mockCalls.length, callsBeforeForeignScope, 'another scope does not inherit connector or probe settings')

  const callsBeforeLockedActions = mockCalls.length
  for (const [action, expectedState] of [['GetSysReportData', 'not-implemented'], ['StockReportQueryService.GetReportData', 'locked']]) {
    const stub = await api(`/api/k3cloud/actions/${encodeURIComponent(action)}`, { method: 'POST' })
    assert.equal(stub.response.status, 501)
    assert.equal(stub.data.action, action)
    assert.equal(stub.data.state, expectedState)
    assert.match(stub.data.message, /不会发起 K3 请求/)
    assert.equal((await api(`/api/k3cloud/actions/${encodeURIComponent(action)}`, { method: 'POST', body: { SchemeId: 'guess', FieldKeys: 'guess' } })).response.status, 400)
  }
  assert.equal((await api('/api/k3cloud/actions/UnknownMethod', { method: 'POST' })).response.status, 404)
  assert.equal(mockCalls.length, callsBeforeLockedActions, 'locked placeholders and unknown actions never invoke the K3 client')

  const sameNamesDifferentIdsToken = await addOtherScope({ tenantName: 'Synthetic tenant', organizationName: 'Synthetic org', accountName: 'Synthetic account', accountId: 'mock-same-names-account' })
  const callsBeforeDuplicateScopeAction = mockCalls.length
  const isolated = await api(actionPath, { method: 'POST', token: sameNamesDifferentIdsToken })
  assert.equal(isolated.response.status, 503, 'matching display names do not copy configuration across different scope IDs')
  assert.equal(mockCalls.length, callsBeforeDuplicateScopeAction)
  assert.equal((await api(actionPath, { method: 'POST', token: adminToken })).response.status, 200, 'the configured scope remains independently usable')
  assert.equal(mockCalls.length, callsBeforeDuplicateScopeAction + 1, 'only the configured scope reaches the K3 query endpoint')
})
