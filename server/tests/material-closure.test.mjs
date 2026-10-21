import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = '', databaseFile = '', origin = '', child
let db
let adminToken = '', memberToken = '', reviewerToken = '', managerToken = ''
const scopes = new Map()
const children = new Set()
const mockRows = [
  { FID: 'fixture-source-1', FNumber: '3.01.02.00007', FName: '夹具注塑件', FSpec: '原规格', FUnit: '件', FGroup: '3.01.02', FGroupId: 'fixture-group-3', FOrg: 'fixture-org' },
  { FID: 'fixture-source-2', FNumber: '3.01.02.00012', FName: '最大号夹具', FSpec: '规格二', FUnit: '件', FGroup: '3.01.02', FGroupId: 'fixture-group-3', FOrg: 'fixture-org' },
]
let mockServer, mockOrigin = '', mockRequests = 0, unexpectedMockPaths = []
const fields = { id: 'FID', number: 'FNumber', name: 'FName', specification: 'FSpec', unit: 'FUnit', groupNumber: 'FGroup', groupId: 'FGroupId', organization: 'FOrg' }

async function allocatePort() {
  const server = createNetServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve)); return port
}
async function startMock() {
  mockServer = createHttpServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    if (req.url?.includes('AuthService.LoginByAppSecret')) {
      mockRequests++; res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['ASP.NET_SessionId=fixture-session; Path=/'] })
      return res.end(JSON.stringify({ LoginResultType: 1, KDSVCSessionId: 'fixture-session', Context: { UserLocale: 1033 } }))
    }
    if (req.url?.includes('ExecuteBillQuery')) {
      mockRequests++
      let payload = {}; try { payload = JSON.parse(raw) } catch {}
      const query = JSON.parse(Array.isArray(payload) ? payload[0] : payload.data ?? payload)
      const start = Number(query.StartRow ?? query.startRow ?? 0), limit = Number(query.Limit ?? query.limit ?? 200)
      const rows = mockRows.slice(start, start + limit).map(row => (query.FieldKeys ?? query.fieldKeys ?? '').split(',').map(k => row[k]))
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(rows))
    }
    unexpectedMockPaths.push(`${req.method} ${req.url}`); res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture endpoint not allowed' }))
  })
  const port = await new Promise((resolve, reject) => mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port)).once('error', reject))
  mockOrigin = `http://127.0.0.1:${port}`
}
async function startServer() {
  const port = await allocatePort(); const serverOrigin = `http://127.0.0.1:${port}`; origin = serverOrigin
  // Deliberately do not inherit process.env: only explicit, non-secret test settings enter the child.
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing-legacy.json'), LEGACY_DATA_FILE: join(tempDir, 'missing-legacy.json'),
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '',
  }
  const processChild = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] }); processChild.origin = serverOrigin
  child = processChild; children.add(processChild)
  processChild.stdoutText = ''; processChild.stderrText = ''; processChild.stdout.on('data', chunk => { processChild.stdoutText += chunk.toString() }); processChild.stderr.on('data', chunk => { processChild.stderrText += chunk.toString() })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early (${child.exitCode}): ${child.stderrText}`)
    try { if ((await fetch(`${serverOrigin}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return child } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become healthy: ${child.stderrText}`)
}
async function stopServer(target = child) {
  if (!target || target.exitCode !== null) return
  target.kill('SIGTERM'); await Promise.race([new Promise(resolve => target.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
  if (target.exitCode === null) target.kill('SIGKILL')
}
async function api(path, { method = 'GET', body, token = adminToken, headers = {}, baseOrigin = origin } = {}) {
  const requestHeaders = {}
  if (token) { requestHeaders.Authorization = `Bearer ${token}`; const active = scopes.get(token); if (active) { requestHeaders['X-Tenant-ID'] = active.tenantId; requestHeaders['X-Organization-ID'] = active.organizationId; requestHeaders['X-Account-ID'] = active.accountId } }
  Object.assign(requestHeaders, headers); if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(`${baseOrigin}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}
async function makeRole(role, email, accountId) {
  const invited = await api('/api/auth/users', { method: 'POST', body: { displayName: role, email, role } })
  assert.equal(invited.response.status, 201, JSON.stringify(invited.data))
  const activated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: invited.data.activationToken, password: 'test-password-12345' } })
  assert.equal(activated.response.status, 200)
  const logged = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email, password: 'test-password-12345', accountId } })
  assert.equal(logged.response.status, 200, JSON.stringify(logged.data)); scopes.set(logged.data.accessToken, logged.data.user); return logged.data.accessToken
}
const rule = { kind: 'raw', prefix: '3.01.02.' }

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'material-closure-http-')); databaseFile = join(tempDir, 'isolated.sqlite')
  await startMock(); await startServer(); db = new Database(databaseFile)
})
after(async () => { for (const target of children) await stopServer(target); db?.close(); if (mockServer) await new Promise(resolve => mockServer.close(resolve)); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })

test('material closure uses authenticated scoped HTTP API, allowlisted K3 fixtures, atomic allocation and durable audit', { concurrency: false }, async () => {
  assert.equal((await api('/api/material-closure/source', { token: '' })).response.status, 401)
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: '闭环管理员', email: 'closure-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data)); adminToken = setup.data.accessToken; scopes.set(adminToken, setup.data.user)
  const accountId = setup.data.user.accountId
  memberToken = await makeRole('member', 'closure-member@example.test', accountId)
  reviewerToken = await makeRole('reviewer', 'closure-reviewer@example.test', accountId)
  managerToken = await makeRole('plm_manager', 'closure-manager@example.test', accountId)
  assert.equal((await api('/api/material-closure/source', { token: memberToken })).response.status, 403)
  assert.equal((await api('/api/material-closure/source', { token: reviewerToken })).response.status, 403)
  assert.equal((await api('/api/material-closure/source', { token: managerToken })).response.status, 200)
  for (const header of ['X-Tenant-ID', 'X-Organization-ID', 'X-Account-ID']) assert.equal((await api('/api/material-closure/source', { headers: { [header]: 'forged-scope' } })).response.status, 403)

  const k3 = { baseUrl: `${mockOrigin}/`, accountId: 'fixture-account', username: 'fixture-user', organization: 'fixture-org', appId: 'fixture-app', appSecret: 'fixture-secret', password: 'fixture-password', lcid: '1033', formAllowlist: { BD_MATERIAL: Object.values(fields) }, materialSource: { formId: 'BD_MATERIAL', fields } }
  const configured = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: k3 }); assert.equal(configured.response.status, 200, JSON.stringify(configured.data))
  assert.equal((await api('/api/material-closure/source/refresh', { method: 'POST', token: memberToken })).response.status, 403)
  const refreshed = await api('/api/material-closure/source/refresh', { method: 'POST' }); assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.data) + ' settings=' + JSON.stringify(configured.data?.settings))
  const snapshotId = refreshed.data.snapshot.id
  assert.equal(refreshed.data.rows.length, 2); assert.equal(mockRequests > 0, true)
  assert.equal((await api('/api/material-closure/drafts', { method: 'POST', body: { sourceId: 'absent-source' } })).response.status, 404)
  // Separate valid sessions in all three scope variants; explicitly assert the selected account.
  const newTenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: 'Closure tenant B', organizationName: 'Closure org B', accountName: 'Closure account B' } })
  assert.equal(newTenant.response.status, 201, JSON.stringify(newTenant.data))
  const altOrg = await api('/api/auth/organizations', { method: 'POST', body: { organizationName: 'Closure org A2', accountName: 'Closure account A2' } })
  assert.equal(altOrg.response.status, 201, JSON.stringify(altOrg.data))
  const altAccount = await api('/api/auth/accounts', { method: 'POST', body: { accountName: 'Closure account A3' } })
  assert.equal(altAccount.response.status, 201, JSON.stringify(altAccount.data))
  const alternateTokens = []
  for (const targetAccount of [newTenant.data.scope.accountId, altOrg.data.account.id, altAccount.data.account.id]) {
    const login = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'closure-admin@example.test', password: 'test-password-12345', accountId: targetAccount } })
    assert.equal(login.response.status, 200)
    assert.equal(login.data.user.accountId, targetAccount, 'the test must use the requested real account, not a login fallback')
    const token = login.data.accessToken; scopes.set(token, login.data.user); alternateTokens.push(token)
    assert.equal((await api('/api/material-closure/source', { token })).data.snapshot, null)
    assert.equal((await api('/api/material-closure/drafts', { method: 'POST', token, body: { sourceId: 'fixture-source-1' } })).response.status, 404)
  }
  assert.notEqual(scopes.get(alternateTokens[0]).tenantId, setup.data.user.tenantId)
  assert.equal(scopes.get(alternateTokens[1]).tenantId, setup.data.user.tenantId)
  assert.notEqual(scopes.get(alternateTokens[1]).organizationId, setup.data.user.organizationId)
  assert.equal(scopes.get(alternateTokens[2]).organizationId, setup.data.user.organizationId)
  assert.notEqual(scopes.get(alternateTokens[2]).accountId, accountId)
  const copied = await api('/api/material-closure/drafts', { method: 'POST', body: { sourceId: 'fixture-source-1', partNo: '3.01.02.09999', organization: 'forged', approval: 'approved', barcode: 'forged' } })
  assert.equal(copied.response.status, 201, JSON.stringify(copied.data))
  const draft = copied.data
  for (const token of alternateTokens) {
    assert.equal((await api(`/api/material-closure/drafts/${draft.id}/audit`, { token })).response.status, 404)
    assert.equal((await api(`/api/material-closure/drafts/${draft.id}/allocate`, { token, method: 'POST', body: rule })).response.status, 404)
  }
  assert.equal(draft.partNo.startsWith('DRAFT-'), true); assert.equal(draft.templateSourceId, 'fixture-source-1'); assert.equal(draft.erpGroupId, 'fixture-group-3')
  for (const unsafe of ['source number', 'organization', 'approval', 'unique barcode']) assert.equal(JSON.stringify(draft).toLowerCase().includes(unsafe.toLowerCase()), false)
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}`, { method: 'PATCH', body: { partNo: 'forged', erpGroupNumber: '3.1' } })).response.status, 400)
  const changed = await api(`/api/material-closure/drafts/${draft.id}`, { method: 'PATCH', body: { name: '夹具注塑件-修订', specification: '新规格' } })
  assert.equal(changed.response.status, 200); assert.equal(changed.data.name, '夹具注塑件-修订'); assert.equal(changed.data.erpGroupNumber, '3.01.02')
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/preview`, { method: 'POST', body: rule })).data.code, '3.01.02.00013')
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/preview`, { method: 'POST', body: rule })).data.code, '3.01.02.00013', 'preview is repeatable and reserves no number')
  const ambiguous = await api(`/api/material-closure/drafts/${draft.id}/preview`, { method: 'POST', body: { kind: 'injection', prefix: '2.01.02.0317' } })
  assert.equal(ambiguous.response.status, 200); assert.equal(ambiguous.data.blocked, true, 'ambiguous injection example must be blocked, never treated as an opaque literal')
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/allocate`, { method: 'POST', body: { kind: 'injection', prefix: '2.01.02.0317' } })).response.status, 409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_code_reservations').get().n, 0)
  const legacyCreate = await api('/api/materials', { method: 'POST', body: { partNo: '3.01.02.09999', name: '正式号绕过', unit: '件', lifecycle: 'draft' } })
  assert.equal(legacyCreate.response.status, 409, 'legacy materials CRUD must reject source-backed formal numbering')
  const legacyPatch = await api(`/api/materials/${draft.id}`, { method: 'PATCH', body: { name: '来源草稿绕过' } })
  assert.equal(legacyPatch.response.status, 409, 'legacy materials CRUD must reject editing a source draft')
  const bypass = await api('/api/workspace/materials', { method: 'PUT', body: { materials: [{ id: draft.id, partNo: '3.01.02.00099', templateSourceId: draft.templateSourceId }] } })
  assert.ok([404, 409].includes(bypass.response.status), `legacy CRUD bypass must fail closed: ${bypass.response.status}`)
  const staleScope = { 'X-Tenant-ID': 'other-tenant' }
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/audit`, { headers: staleScope })).response.status, 403)

  const source2 = await api('/api/material-closure/drafts', { method: 'POST', body: { sourceId: 'fixture-source-2' } }); assert.equal(source2.response.status, 201)
  // Expired and connector-stale snapshots must block a never-allocated draft (old receipts remain idempotent).
  const staleDraft = await api('/api/material-closure/drafts', { method: 'POST', body: { sourceId: 'fixture-source-1' } }); assert.equal(staleDraft.response.status, 201)
  const stateKey = `material-source:${scopes.get(adminToken).tenantId}:${scopes.get(adminToken).organizationId}:${scopes.get(adminToken).accountId}`
  const stateRow = db.prepare('SELECT value FROM app_state WHERE key=?').get(stateKey); assert.ok(stateRow)
  const stateValue = JSON.parse(stateRow.value); const reservationBaseline = db.prepare('SELECT COUNT(*) AS n FROM material_code_reservations').get().n
  // A duplicate ERP material number invalidates the refresh; the previous snapshot remains intact.
  const savedRows = mockRows.map(row => ({ ...row }))
  mockRows.push({ ...mockRows[0], FID: 'duplicate-material-id', FNumber: mockRows[0].FNumber })
  const duplicateRefresh = await api('/api/material-closure/source/refresh', { method: 'POST' })
  assert.equal(duplicateRefresh.response.status, 502)
  assert.equal((await api('/api/material-closure/source')).data.snapshot.id, snapshotId)
  mockRows.splice(0, mockRows.length, ...savedRows.map(row => ({ ...row })))
  mockRows[1].FGroupId = 'conflicting-group-id'
  assert.equal((await api('/api/material-closure/source/refresh', { method: 'POST' })).response.status, 502)
  assert.equal((await api('/api/material-closure/source')).data.snapshot.id, snapshotId)
  mockRows.splice(0, mockRows.length, ...savedRows.map(row => ({ ...row })))
  mockRows[0].FOrg = 'wrong-org'
  const wrongOrgRefresh = await api('/api/material-closure/source/refresh', { method: 'POST' })
  assert.equal(wrongOrgRefresh.response.status, 502)
  assert.equal((await api('/api/material-closure/source')).data.snapshot.id, snapshotId)
  mockRows.splice(0, mockRows.length, ...savedRows.map(row => ({ ...row })))
  const recovered = await api('/api/material-closure/source/refresh', { method: 'POST' }); assert.equal(recovered.response.status, 200)

  db.prepare('UPDATE app_state SET value=? WHERE key=?').run(JSON.stringify({ ...stateValue, syncedAt: new Date(Date.now()-6*60_000).toISOString() }), stateKey)
  const expiredPreview = await api(`/api/material-closure/drafts/${staleDraft.data.id}/preview`, { method: 'POST', body: rule })
  assert.equal(expiredPreview.response.status, 200); assert.equal(expiredPreview.data.blocked, true)
  assert.equal((await api(`/api/material-closure/drafts/${staleDraft.data.id}/allocate`, { method: 'POST', body: rule })).response.status, 409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_code_reservations').get().n, reservationBaseline)
  const refreshAfterExpiry = await api('/api/material-closure/source/refresh', { method: 'POST' }); assert.equal(refreshAfterExpiry.response.status, 200)
  const priorRevision = db.prepare("SELECT revision FROM connector_configs WHERE tenant_id=? AND organization_id=? AND account_id=? AND provider='k3cloud'").get(scopes.get(adminToken).tenantId, scopes.get(adminToken).organizationId, scopes.get(adminToken).accountId).revision
  const sameConfig = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: k3 }); assert.equal(sameConfig.response.status, 200)
  const nextRevision = db.prepare("SELECT revision FROM connector_configs WHERE tenant_id=? AND organization_id=? AND account_id=? AND provider='k3cloud'").get(scopes.get(adminToken).tenantId, scopes.get(adminToken).organizationId, scopes.get(adminToken).accountId).revision
  assert.equal(nextRevision, priorRevision + 1)
  assert.equal((await api(`/api/material-closure/drafts/${staleDraft.data.id}/preview`, { method: 'POST', body: rule })).data.blocked, true)
  assert.equal((await api(`/api/material-closure/drafts/${staleDraft.data.id}/allocate`, { method: 'POST', body: rule })).response.status, 409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_code_reservations').get().n, reservationBaseline)
  assert.equal((await api('/api/material-closure/source/refresh', { method: 'POST' })).response.status, 200)
  const allocationSnapshotId = (await api('/api/material-closure/source')).data.snapshot.id
  db.exec(`CREATE TRIGGER fail_allocated_audit BEFORE INSERT ON material_closure_audit WHEN NEW.event='allocated' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`)
  const failedAllocation = await api(`/api/material-closure/drafts/${draft.id}/allocate`, { method: 'POST', body: rule })
  assert.equal(failedAllocation.response.status, 502)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM material_code_reservations WHERE material_id=?').get(draft.id).n, 0)
  assert.equal((await api('/api/workspace')).data.materials.find(x => x.id === draft.id).partNo.startsWith('DRAFT-'), true, 'workspace number rolls back with failed audit')
  db.exec('DROP TRIGGER fail_allocated_audit')
  const allocated = await api(`/api/material-closure/drafts/${draft.id}/allocate`, { method: 'POST', body: rule })
  assert.equal(allocated.response.status, 200, JSON.stringify(allocated.data)); assert.equal(allocated.data.partNo, '3.01.02.00013')
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/allocate`, { method: 'POST', body: rule })).data.partNo, allocated.data.partNo, 'allocation retry is idempotent')
  assert.equal((await api(`/api/material-closure/drafts/${draft.id}/allocate`, { method: 'POST', body: { kind: 'raw', prefix: '3.1.' } })).response.status, 409)
  const concurrent = await Promise.all([api(`/api/material-closure/drafts/${source2.data.id}/allocate`, { method: 'POST', body: rule }), api(`/api/material-closure/drafts/${source2.data.id}/allocate`, { method: 'POST', body: rule })])
  assert.ok(concurrent.every(x => x.response.status === 200), JSON.stringify(concurrent.map(x => x.data)))
  assert.equal(concurrent[0].data.partNo, concurrent[1].data.partNo)
  assert.notEqual(concurrent[0].data.partNo, allocated.data.partNo)
  // Two independent API processes share the same temporary SQLite database; concurrent distinct allocations remain linear and gap-free.
  const parallelDrafts = []
  for (const sourceId of ['fixture-source-1', 'fixture-source-2']) { const r = await api('/api/material-closure/drafts', { method: 'POST', body: { sourceId } }); assert.equal(r.response.status, 201); parallelDrafts.push(r.data) }
  const firstChild = child, firstOrigin = origin
  const secondChild = await startServer();
  const dual = await Promise.all(parallelDrafts.map((item, i) => api(`/api/material-closure/drafts/${item.id}/allocate`, { method: 'POST', body: rule, baseOrigin: i ? secondChild.origin : firstOrigin })))
  assert.ok(dual.every(x => x.response.status === 200), JSON.stringify(dual.map(x => x.data)))
  const numbers = dual.map(x => Number(x.data.partNo.split('.').at(-1))).sort((a,b)=>a-b)
  assert.equal(new Set(dual.map(x => x.data.partNo)).size, 2); assert.deepEqual(numbers, [15,16])
  await stopServer(secondChild); await stopServer(firstChild); child = null; origin = ''
  await startServer()
  const audit = await api(`/api/material-closure/drafts/${draft.id}/audit`)
  assert.equal(audit.response.status, 200)
  const events = audit.data.events; assert.deepEqual(events.map(x => x.event), ['copied', 'edited', 'allocated'])
  assert.equal(events[0].payload.source.id, 'fixture-source-1'); assert.equal(events[0].payload.snapshotId, snapshotId)
  assert.equal(events[2].actor, setup.data.user.id); assert.equal(events[2].payload.rule.kind, 'raw'); assert.equal(events[2].payload.previousMaximum, 12)
  assert.equal(events[2].payload.snapshotId, allocationSnapshotId); assert.equal(events[2].payload.source.id, 'fixture-source-1')
  assert.equal((await api('/api/workspace')).data.materials.some(x => x.id === draft.id && x.partNo === allocated.data.partNo), true)

  // Allowlist errors fail closed and never call an unapproved K3 query path.
  const beforeBadConfig = mockRequests
  const bad = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { ...k3, formAllowlist: {} } }); assert.equal(bad.response.status, 200)
  assert.equal((await api('/api/material-closure/source/refresh', { method: 'POST' })).response.status, 409)
  assert.equal(mockRequests, beforeBadConfig)
  assert.deepEqual(unexpectedMockPaths, [])

  await stopServer(); await startServer()
  const workspace = await api('/api/workspace')
  assert.equal(workspace.response.status, 200); assert.ok(workspace.data.materials.some(x => x.id === draft.id && x.partNo === allocated.data.partNo))
  const rereadAudit = await api(`/api/material-closure/drafts/${draft.id}/audit`)
  assert.deepEqual(rereadAudit.data.events.map(x => x.event), ['copied', 'edited', 'allocated'])
  assert.equal(unexpectedMockPaths.length, 0)
})
