import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

// Integration-only local fixtures. The child receives an allowlisted environment and runs offline.
const serverDir = resolve(import.meta.dirname, '..')
let tempDir, databaseFile, origin, child, token, user
const scopes = new Map()
async function freePort() {
  const server = createServer(); await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value
}
async function start() {
  const port = await freePort(); origin = `http://127.0.0.1:${port}`
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tempDir, TMPDIR: tempDir, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'), DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}', DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'ignore', 'pipe'] }); child.stderrText = ''; child.stderr.on('data', x => child.stderrText += x)
  const until = Date.now() + 20000
  while (Date.now() < until) { if (child.exitCode !== null) throw Error(`API exited: ${child.stderrText}`); try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(700) })).ok) return } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw Error(`API health timeout: ${child.stderrText}`)
}
async function stop() { if (!child || child.exitCode !== null) return; child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 4000))]); if (child.exitCode === null) child.kill('SIGKILL') }
async function api(path, { method = 'GET', body, auth = token, scope = true, headers = {} } = {}) {
  const h = {}; if (auth) { h.Authorization = `Bearer ${auth}`; const s = scope && scopes.get(auth); if (s) { h['X-Tenant-ID'] = s.tenantId; h['X-Organization-ID'] = s.organizationId; h['X-Account-ID'] = s.accountId } }
  Object.assign(h, headers); if (body !== undefined) h['Content-Type'] = 'application/json'
  const response = await fetch(origin + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) }); const text = await response.text(); let data; try { data = JSON.parse(text) } catch { data = text }; return { response, data }
}
function seedReportFixture(scope, rows) {
  const db = new Database(databaseFile), now = new Date().toISOString(), key = `operational-reporting-fixture:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
  db.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,revision=app_state.revision+1').run(key, JSON.stringify({ source: 'fixture', status: 'fixture', scope: { tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId }, generatedAt: now, rows }), now); db.close()
}
before(async () => { tempDir = mkdtempSync(join(tmpdir(), 'reports-search-http-')); databaseFile = join(tempDir, 'isolated.sqlite'); await start() })
after(async () => { await stop(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })

test('built API exposes scoped collection search and operational reports on the same isolated server', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', auth: '', body: { displayName: 'Search admin', email: 'search-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data)); token = setup.data.accessToken; user = setup.data.user; scopes.set(token, user)
  assert.equal((await api('/api/operational-reports', { auth: '' })).response.status, 401)
  assert.equal((await api('/api/operational-reports', { scope: false })).response.status, 400)
  assert.equal((await api('/api/operational-reports', { headers: { 'X-Account-ID': 'forged-account' } })).response.status, 403)

  const created = await api('/api/materials', { method: 'POST', body: { id: 'it-material-raw-1', partNo: 'IT-RAW-101', name: 'Synthetic motor', unit: 'each', lifecycle: 'draft', specification: 'IT-SPEC-ONLY-111', specificationFields: { productModel: 'IT-MODEL-ONLY-222' }, dimensions: { width: 'IT-DIM-ONLY-333' } } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  const salesBom = await api('/api/boms', { method: 'POST', body: { id: 'it-sales-bom-raw-1', bomNo: 'IT-BASE-101', parentMaterialId: created.data.id, kind: 'sales', revision: 'A', lifecycle: 'draft', lines: [] } })
  assert.equal(salesBom.response.status, 201, JSON.stringify(salesBom.data))
  for (const body of [
    { id: 'it-bom-raw-1', bomNo: 'IT-BOM-101', parentMaterialId: created.data.id, kind: 'design', revision: 'A', lifecycle: 'draft', lines: [] },
    { id: 'it-doc-raw-1', docNo: 'IT-DOC-101', title: 'Synthetic drawing', type: 'drawing', revision: 'A', lifecycle: 'draft', materialId: created.data.id },
    { id: 'it-snapshot-raw-1', orderNo: 'IT-ORDER-101', parentMaterialId: created.data.id, bomId: salesBom.data.id, bomNo: 'IT-BASE-101', bomRevision: 'A', quantity: 1, attributes: {}, lines: [] },
  ]) {
    const path = body.orderNo ? '/api/sales-bom-snapshots' : body.docNo ? '/api/documents' : '/api/boms'
    const result = await api(path, { method: 'POST', body }); assert.equal(result.response.status, 201, `${path}: ${JSON.stringify(result.data)}`)
  }
  for (const [path, expectId, expectedTotal] of [['materials', 'it-material-raw-1', 1], ['boms', 'it-bom-raw-1', 2], ['documents', 'it-doc-raw-1', 1], ['sales-bom-snapshots', 'it-snapshot-raw-1', 1]]) {
    const response = await api(`/api/${path}?q=IT-MODEL-ONLY-222&page=1&pageSize=1`)
    assert.equal(response.response.status, 200, path); assert.equal(response.data.total, expectedTotal, path); assert.equal(response.data.items[0].id, expectId, path)
  }
  const second = await api('/api/materials', { method: 'POST', body: { id: 'it-material-raw-2', partNo: 'IT-RAW-102', name: 'Second synthetic motor', unit: 'each', lifecycle: 'draft', specificationFields: { productModel: 'IT-MODEL-ONLY-222' } } })
  assert.equal(second.response.status, 201, JSON.stringify(second.data))
  const firstPage = await api('/api/materials?q=IT-MODEL-ONLY-222&page=1&pageSize=1'), secondPage = await api('/api/materials?q=IT-MODEL-ONLY-222&page=2&pageSize=1')
  assert.equal(firstPage.data.total, 2); assert.equal(firstPage.data.items.length, 1); assert.equal(secondPage.data.total, 2); assert.equal(secondPage.data.items.length, 1); assert.notEqual(secondPage.data.items[0].id, firstPage.data.items[0].id)
  for (const suffix of ['?q[]=IT-MODEL-ONLY-222', '?q=a&q=b', '?page=0', '?pageSize=201', `?q=${'x'.repeat(201)}`]) assert.equal((await api(`/api/materials${suffix}`)).response.status, 400, suffix)
  assert.equal((await api('/api/materials?q=IT-MODEL-ONLY-222', { auth: '' })).response.status, 401)

  seedReportFixture(user, [{ id: 'synthetic-report-row', warehouse: 'Local', materialNumber: 'IT-RAW-101', materialName: 'Synthetic motor', unit: 'each', quantity: 2 }])
  const reports = await api('/api/operational-reports'); assert.equal(reports.response.status, 200)
  assert.equal(reports.data.metadataPreflight.liveBusinessQueriesAllowed, false)
  assert.equal(reports.data.metadataPreflight.metadataConfirmed, false)
  const inventory = await api('/api/operational-reports/instant-inventory?q=Synthetic')
  assert.equal(inventory.response.status, 200); assert.equal(inventory.data.rows[0].id, 'synthetic-report-row'); assert.equal(inventory.data.report.metadataConfirmed, false)
  assert.equal((await api('/api/operational-reports/instant-inventory?q[]=x')).response.status, 400)

  const now = new Date().toISOString(), other = { tenantId: 'it-tenant-foreign', organizationId: 'it-org-foreign', accountId: 'it-account-foreign' }, db = new Database(databaseFile)
  db.prepare("INSERT INTO tenants(id,name,code,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(other.tenantId, 'Other', 'IT-OTHER', now, now)
  db.prepare("INSERT INTO organizations(id,tenant_id,name,code,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(other.organizationId, other.tenantId, 'Other', 'IT-OTHER', now, now)
  db.prepare("INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,'k3cloud','active',?,?)").run(other.accountId, other.tenantId, other.organizationId, 'Other', 'IT-OTHER', now, now)
  db.prepare("INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,'admin',0,?)").run('it-membership-foreign', user.id, other.tenantId, other.organizationId, other.accountId, now); db.close()
  const login = await api('/api/auth/mobile/login', { method: 'POST', auth: '', body: { email: 'search-admin@example.test', password: 'test-password-12345', accountId: other.accountId } })
  assert.equal(login.response.status, 200, JSON.stringify(login.data)); const foreignToken = login.data.accessToken; scopes.set(foreignToken, login.data.user)
  assert.equal((await api('/api/materials?q=IT-MODEL-ONLY-222', { auth: foreignToken })).data.total, 0)
  assert.equal((await api('/api/documents?q=IT-MODEL-ONLY-222', { auth: foreignToken })).data.total, 0)
  const foreignReports = await api('/api/operational-reports/instant-inventory', { auth: foreignToken }); assert.equal(foreignReports.response.status, 200); assert.deepEqual(foreignReports.data.rows, [])
})
