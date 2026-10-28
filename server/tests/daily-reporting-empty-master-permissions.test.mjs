import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = '', databaseFile = '', origin = '', child, adminToken = ''
const scopes = new Map()
async function port() {
  const server = createServer()
  const value = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve)); return value
}
async function start() {
  const p = await port(); origin = `http://127.0.0.1:${p}`
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(p), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ACCOUNT_ID: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderrText = ''; child.stderr.on('data', chunk => { child.stderrText += chunk })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(child.stderrText); try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw new Error(`API startup timeout: ${child.stderrText}`)
}
async function stop() { if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 4000))]); if (child.exitCode === null) child.kill('SIGKILL') } }
async function api(path, { method = 'GET', body, token = adminToken, auth = true } = {}) {
  const headers = {}
  if (auth && token) { headers.Authorization = `Bearer ${token}`; const s = scopes.get(token); if (s) { headers['X-Tenant-ID'] = s.tenantId; headers['X-Organization-ID'] = s.organizationId; headers['X-Account-ID'] = s.accountId } }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  const text = await response.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { response, data }
}
async function uploadCsv(token, content = '类型,日期,客户/供应商,单据编号,数量,币种,原币金额,汇率\nsales,2026-10-15,自由输入客商,CSV-REG-01,1,CNY,10,1\n') {
  const headers = {}, s = scopes.get(token)
  headers.Authorization = `Bearer ${token}`
  headers['X-Tenant-ID'] = s.tenantId; headers['X-Organization-ID'] = s.organizationId; headers['X-Account-ID'] = s.accountId
  const form = new FormData(); form.append('file', new Blob([content]), 'regression.csv')
  const response = await fetch(`${origin}/api/daily-reports/import/preview`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(8000) })
  return { response, data: await response.json() }
}
async function loginInvited(email, role) {
  const invited = await api('/api/auth/users', { method: 'POST', body: { displayName: role, email, role } }); assert.equal(invited.response.status, 201, JSON.stringify(invited.data))
  const password = randomBytes(24).toString('base64url')
  const activated = await api('/api/auth/activate', { method: 'POST', auth: false, token: '', body: { token: invited.data.activationToken, password } }); assert.equal(activated.response.status, 200, JSON.stringify(activated.data))
  const logged = await api('/api/auth/mobile/login', { method: 'POST', auth: false, token: '', body: { email, password, accountId: scopes.get(adminToken).accountId } }); assert.equal(logged.response.status, 200, JSON.stringify(logged.data))
  scopes.set(logged.data.accessToken, logged.data.user); return logged.data
}
before(async () => { tempDir = mkdtempSync(join(tmpdir(), 'daily-report-permission-regression-')); databaseFile = join(tempDir, 'test.sqlite'); await start() })
after(async () => { await stop(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })

test('empty-master daily reporting blocks member writes/import bypass, then honors scoped party assignments and role boundaries', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', auth: false, token: '', body: { displayName: '权限回归管理员', email: 'empty-master-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data)); adminToken = setup.data.accessToken; scopes.set(adminToken, setup.data.user)
  const empty = await api('/api/daily-reporting/management'); assert.equal(empty.response.status, 200); assert.equal(empty.data.masterDataConfigured, false)
  const member = await loginInvited('empty-master-member@example.test', 'member'), reviewer = await loginInvited('empty-master-reviewer@example.test', 'reviewer'), manager = await loginInvited('empty-master-manager@example.test', 'plm_manager')
  for (const type of ['sales', 'purchase']) {
    const rejected = await api('/api/daily-reports', { method: 'POST', token: member.accessToken, body: { type, date: '2026-10-15', partyName: '无主档自由文本', documentNo: `NO-MASTER-${type}`, quantity: 1, currency: 'CNY', originalAmount: 10, exchangeRate: 1 } })
    assert.equal(rejected.response.status, 400, JSON.stringify(rejected.data))
  }
  const memberCsv = await uploadCsv(member.accessToken); assert.equal(memberCsv.response.status, 403, JSON.stringify(memberCsv.data))
  const memberPurchaseCsv = await uploadCsv(member.accessToken, '类型,日期,客户/供应商,单据编号,数量,币种,原币金额,汇率\npurchase,2026-10-15,自由文本供应商,CSV-REG-PURCHASE,1,CNY,10,1\n'); assert.equal(memberPurchaseCsv.response.status, 403, JSON.stringify(memberPurchaseCsv.data))
  assert.equal((await api('/api/daily-reports/import/commit', { method: 'POST', token: member.accessToken, body: { previewId: 'arbitrary' } })).response.status, 403)
  assert.equal((await api('/api/daily-reports/summary?date=2026-10-15', { token: reviewer.accessToken })).response.status, 200, 'reviewer retains reporting read access')
  assert.equal((await api('/api/daily-reports', { method: 'POST', token: reviewer.accessToken, body: { type: 'sales', date: '2026-10-15', partyName: '只读', quantity: 1, currency: 'CNY', originalAmount: 10, exchangeRate: 1 } })).response.status, 403)
  const adminCsv = await uploadCsv(adminToken); assert.equal(adminCsv.response.status, 200, JSON.stringify(adminCsv.data)); assert.ok(adminCsv.data.previewId)
  const adminCommit = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: adminCsv.data.previewId } }); assert.equal(adminCommit.response.status, 200, JSON.stringify(adminCommit.data))
  const managerDirect = await api('/api/daily-reports', { method: 'POST', token: manager.accessToken, body: { type: 'purchase', date: '2026-10-15', partyName: '管理录入', quantity: 1, currency: 'CNY', originalAmount: 15, exchangeRate: 1 } }); assert.equal(managerDirect.response.status, 201, JSON.stringify(managerDirect.data))
  const managerCsv = await uploadCsv(manager.accessToken); assert.equal(managerCsv.response.status, 200, JSON.stringify(managerCsv.data))
  const managerCommit = await api('/api/daily-reports/import/commit', { method: 'POST', token: manager.accessToken, body: { previewId: managerCsv.data.previewId } }); assert.equal(managerCommit.response.status, 200, JSON.stringify(managerCommit.data))

  const customer = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'customer', name: 'FNS归属客户', legacyCompanyCode: 'FNS', legacyId: 'fns-c-1' } }); assert.equal(customer.response.status, 201, JSON.stringify(customer.data))
  const assigned = await api('/api/daily-reporting/assignments', { method: 'POST', body: { kind: 'customer', partyId: customer.data.id, userIds: [member.user.id] } }); assert.equal(assigned.response.status, 200, JSON.stringify(assigned.data))
  const scopedWrite = await api('/api/daily-reports', { method: 'POST', token: member.accessToken, body: { type: 'sales', date: '2026-10-15', partyId: customer.data.id, partyName: 'spoof', quantity: 1, currency: 'CNY', originalAmount: 20, exchangeRate: 1 } }); assert.equal(scopedWrite.response.status, 201, JSON.stringify(scopedWrite.data)); assert.equal(scopedWrite.data.partyId, customer.data.id)
  const assignedWithoutId = await api('/api/daily-reports', { method: 'POST', token: member.accessToken, body: { type: 'sales', date: '2026-10-15', partyName: '自由文本尝试', quantity: 1, currency: 'CNY', originalAmount: 20, exchangeRate: 1 } }); assert.equal(assignedWithoutId.response.status, 400, 'an assignment does not authorize free-text party bypass')
  const outside = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: 'FNS sibling', organizationName: 'FNS sibling org', accountName: 'FNS sibling account' } }); assert.equal(outside.response.status, 201, JSON.stringify(outside.data))
  const switchedAdmin = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: outside.data.scope.accountId } }); assert.equal(switchedAdmin.response.status, 200, JSON.stringify(switchedAdmin.data)); scopes.set(adminToken, switchedAdmin.data.user)
  const inviteInOtherScope = await api('/api/auth/users', { method: 'POST', body: { displayName: '同用户另一scope成员', email: 'empty-master-member@example.test', role: 'member' } })
  assert.equal(inviteInOtherScope.response.status, 201, JSON.stringify(inviteInOtherScope.data))
  const memberSwitch = await api('/api/auth/switch-scope', { method: 'POST', token: member.accessToken, body: { accountId: outside.data.scope.accountId } }); assert.equal(memberSwitch.response.status, 200, JSON.stringify(memberSwitch.data)); scopes.set(member.accessToken, memberSwitch.data.user)
  const leaked = await api('/api/daily-reports', { method: 'POST', token: member.accessToken, body: { type: 'sales', date: '2026-10-15', partyId: customer.data.id, partyName: 'FNS归属客户', quantity: 1, currency: 'CNY', originalAmount: 30, exchangeRate: 1 } })
  assert.equal(leaked.response.status, 400, 'other workspace cannot borrow FNS assignment or party ID')
})
