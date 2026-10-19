import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = '', databaseFile = '', origin = '', child
let adminToken = ''
const scopes = new Map()

async function allocatePort() {
  const server = createServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve))
  return port
}
async function startServer() {
  const port = await allocatePort()
  origin = `http://127.0.0.1:${port}`
  const env = {
    ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing-legacy.json'), LEGACY_DATA_FILE: join(tempDir, 'missing-legacy.json'),
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '',
  }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdoutText = ''; child.stderrText = ''
  child.stdout.on('data', chunk => { child.stdoutText += chunk.toString() })
  child.stderr.on('data', chunk => { child.stderrText += chunk.toString() })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early (${child.exitCode}): ${child.stderrText}`)
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return }
    catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become healthy: ${child.stderrText}`)
}
async function stopServer() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
async function api(path, { method = 'GET', body, token = adminToken, headers = {} } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    const active = scopes.get(token)
    if (active) {
      requestHeaders['X-Tenant-ID'] = active.tenantId
      requestHeaders['X-Organization-ID'] = active.organizationId
      requestHeaders['X-Account-ID'] = active.accountId
    }
  }
  Object.assign(requestHeaders, headers)
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8_000) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-report-definitions-'))
  databaseFile = join(tempDir, 'isolated.sqlite')
  await startServer()
})
after(async () => { await stopServer(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })

test('report definitions are scoped, role-safe, validated, versioned and preview existing daily rows only', { concurrency: false }, async () => {
  const anonymous = await api('/api/report-definitions', { token: '' })
  assert.equal(anonymous.response.status, 401)
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: '报表定义管理员', email: 'definition-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  adminToken = setup.data.accessToken; scopes.set(adminToken, setup.data.user)

  const cust = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'customer', name: '定义测试客户' } })
  const supplier = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'supplier', name: '定义测试供应商' } })
  assert.equal(cust.response.status, 201); assert.equal(supplier.response.status, 201)
  const invite = await api('/api/auth/users', { method: 'POST', body: { displayName: '销售成员', email: 'definition-member@example.test', role: 'member' } })
  assert.equal(invite.response.status, 201)
  const activated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: invite.data.activationToken, password: 'member-test-password-12345' } })
  assert.equal(activated.response.status, 200)
  const login = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'definition-member@example.test', password: 'member-test-password-12345', accountId: setup.data.user.accountId } })
  assert.equal(login.response.status, 200)
  const memberToken = login.data.accessToken; scopes.set(memberToken, login.data.user)
  const assign = await api('/api/daily-reporting/assignments', { method: 'POST', body: { kind: 'customer', partyId: cust.data.id, userIds: [login.data.user.id] } })
  assert.equal(assign.response.status, 200, JSON.stringify(assign.data))

  const mkuser = async (role, email) => {
    const x = await api('/api/auth/users', { method: 'POST', body: { displayName: role, email, role } })
    assert.equal(x.response.status, 201, JSON.stringify(x.data))
    const a = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: x.data.activationToken, password: 'role-test-password-12345' } })
    assert.equal(a.response.status, 200)
    const l = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email, password: 'role-test-password-12345', accountId: setup.data.user.accountId } })
    assert.equal(l.response.status, 200, JSON.stringify(l.data)); scopes.set(l.data.accessToken, l.data.user); return l.data.accessToken
  }
  const reviewer = await mkuser('reviewer', 'definition-reviewer@example.test')
  const manager = await mkuser('plm_manager', 'definition-manager@example.test')
  const base = { name: '月度销售自定义', template: 'daily-sales', filters: { from: '2026-10-01', to: '2026-10-31', partyName: '定义测试客户' } }
  const noAuthWrite = await api('/api/report-definitions', { method: 'POST', token: '', body: base })
  assert.equal(noAuthWrite.response.status, 401)
  for (const token of [memberToken, reviewer, manager]) {
    assert.equal((await api('/api/report-definitions', { method: 'POST', token, body: { ...base, name: `不可写-${token.slice(-5)}` } })).response.status, 403, 'only admin writes definitions')
  }
  for (const bad of [
    { ...base, name: '   ' }, { ...base, name: 'x'.repeat(121) }, { ...base, template: 'arbitrary-sql' },
    { ...base, filters: { from: '2026-02-30' } }, { ...base, filters: { from: '2026-11-01', to: '2026-10-01' } },
    { ...base, filters: { from: '2026-10-01', formula: 'DROP TABLE' } }, { ...base, filters: { unknownField: 'x' } },
    { ...base, tenantId: 'forged' }, { ...base, filters: { organizationId: 'forged' } },
    { ...base, filters: { partyName: 'x'.repeat(201) } },
  ]) assert.equal((await api('/api/report-definitions', { method: 'POST', body: bad })).response.status, 400, `reject invalid definition ${JSON.stringify(bad)}`)

  const beforeSchedules = await api('/api/reports/schedules')
  const beforeSnapshots = await api('/api/daily-reports/snapshots')
  assert.equal(beforeSchedules.response.status, 200); assert.equal(beforeSnapshots.response.status, 200)
  const created = await api('/api/report-definitions', { method: 'POST', body: base })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  assert.equal(created.data.version, 1)
  assert.equal(created.response.headers.get('cache-control'), 'private, no-store')
  for (const token of [memberToken, reviewer, manager]) {
    assert.equal((await api(`/api/report-definitions/${created.data.id}`, { method: 'PATCH', token, body: { ...base, name: '越权编辑', expectedVersion: 1 } })).response.status, 403)
  }
  const duplicate = await api('/api/report-definitions', { method: 'POST', body: { ...base, name: base.name.toLowerCase() } })
  assert.equal(duplicate.response.status, 409)
  assert.equal((await api(`/api/report-definitions/${created.data.id}`, { method: 'PATCH', body: { ...base } })).response.status, 400, 'expectedVersion is mandatory')
  const changed = await api(`/api/report-definitions/${created.data.id}`, { method: 'PATCH', body: { ...base, name: '月度销售自定义-修订', expectedVersion: 1 } })
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data)); assert.equal(changed.data.version, 2)
  const stale = await api(`/api/report-definitions/${created.data.id}`, { method: 'PATCH', body: { ...base, name: '过期覆盖尝试', expectedVersion: 1 } })
  assert.equal(stale.response.status, 409)
  assert.equal((await api(`/api/report-definitions/${created.data.id}`)).data.name, '月度销售自定义-修订', 'stale update leaves current record untouched')
  assert.equal((await api('/api/report-definitions')).data.definitions.some(item => item.id === created.data.id), true)
  assert.equal((await api(`/api/report-definitions/${created.data.id}/preview`)).response.status, 200)

  const purchaseDef = await api('/api/report-definitions', { method: 'POST', body: { name: '采购专属定义', template: 'daily-purchase', filters: {} } })
  assert.equal(purchaseDef.response.status, 201)
  const memberList = await api('/api/report-definitions', { token: memberToken })
  assert.equal(memberList.response.status, 200)
  assert.equal(memberList.data.definitions.some(item => item.id === purchaseDef.data.id), false, 'sales member list must not leak purchase details')
  assert.equal((await api(`/api/report-definitions/${purchaseDef.data.id}`, { token: memberToken })).response.status, 404)
  assert.equal((await api(`/api/report-definitions/${purchaseDef.data.id}/preview`, { token: memberToken })).response.status, 404)
  assert.equal((await api('/api/report-definitions', { token: reviewer })).response.status, 200)
  assert.equal((await api('/api/report-definitions', { token: manager })).response.status, 200)

  const sale = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-10-15', partyId: cust.data.id, quantity: 2, currency: 'CNY', originalAmount: 123.45, exchangeRate: 1 } })
  assert.equal(sale.response.status, 201, JSON.stringify(sale.data))
  const outside = await api('/api/daily-reports', { method: 'POST', body: { type: 'sales', date: '2026-11-01', partyId: cust.data.id, quantity: 9, currency: 'CNY', originalAmount: 999, exchangeRate: 1 } })
  assert.equal(outside.response.status, 201, JSON.stringify(outside.data))
  const pur = await api('/api/daily-reports', { method: 'POST', body: { type: 'purchase', date: '2026-10-15', partyId: supplier.data.id, quantity: 4, currency: 'CNY', originalAmount: 500, exchangeRate: 1 } })
  assert.equal(pur.response.status, 201, JSON.stringify(pur.data))
  const soft = await api(`/api/daily-reports/${sale.data.id}`, { method: 'DELETE' })
  assert.equal(soft.response.status, 204, JSON.stringify(soft.data))
  // Use a second matching report to prove preview filters and CNY rollup without relying on deleted content.
  const rate = await api('/api/daily-reporting/exchange-rates', { method: 'PUT', body: { month: '2026-10', rate: '7.1234' } })
  assert.equal(rate.response.status, 200, JSON.stringify(rate.data))
  const kept = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-10-20', partyId: cust.data.id, quantity: 3, currency: 'USD', originalAmount: 10, exchangeRate: 7.1234 } })
  assert.equal(kept.response.status, 201, JSON.stringify(kept.data))
  const preview = await api(`/api/report-definitions/${created.data.id}/preview`)
  assert.equal(preview.response.status, 200)
  assert.equal(preview.data.rows.length, 1, 'updated definition retains its exact customer/date filters')
  assert.equal(preview.data.rows[0].id, kept.data.id)
  const previewDef = await api('/api/report-definitions', { method: 'POST', body: { name: '预览过滤验证', template: 'daily-sales', filters: { from: '2026-10-01', to: '2026-10-31', partyName: '定义测试客户' } } })
  const previewRows = await api(`/api/report-definitions/${previewDef.data.id}/preview`)
  assert.equal(previewRows.data.rows.length, 1, 'preview includes matching, non-deleted rows only')
  assert.equal(previewRows.data.rows[0].amountCny, kept.data.amountCny)
  assert.equal(previewRows.data.summary.amountCny, kept.data.amountCny, 'preview sums stored CNY amount; it does not recompute historical FX')
  assert.match(previewRows.data.amountBasis, /不重算/)
  assert.equal(previewRows.data.rows.some(row => row.id === sale.data.id), false, 'soft-deleted reports are excluded')
  assert.equal(previewRows.data.rows.some(row => row.id === outside.data.id), false, 'date filter applies')
  assert.equal((await api(`/api/report-definitions/${purchaseDef.data.id}/preview`)).data.rows.length, 2)
  assert.deepEqual((await api('/api/reports/schedules')).data.schedules, beforeSchedules.data.schedules, 'definitions do not create or modify send schedules')
  assert.deepEqual((await api('/api/daily-reports/snapshots')).data.snapshots, beforeSnapshots.data.snapshots, 'definitions do not create historical snapshots')

  const siblingAccount = await api('/api/auth/accounts', { method: 'POST', body: { accountName: '同组织其他账套' } })
  assert.equal(siblingAccount.response.status, 201, JSON.stringify(siblingAccount.data))
  const siblingOrganization = await api('/api/auth/organizations', { method: 'POST', body: { organizationName: '同租户其他组织', accountName: '其他组织账套' } })
  assert.equal(siblingOrganization.response.status, 201, JSON.stringify(siblingOrganization.data))
  for (const [label, accountId] of [['same organization, different account', siblingAccount.data.account.id], ['same tenant, different organization', siblingOrganization.data.account.id]]) {
    const switched = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId } })
    assert.equal(switched.response.status, 200, JSON.stringify(switched.data))
    scopes.set(adminToken, switched.data.user)
    assert.equal(switched.data.user.tenantId, setup.data.user.tenantId)
    assert.equal((await api('/api/report-definitions')).data.definitions.length, 0, label)
    assert.equal((await api(`/api/report-definitions/${created.data.id}`)).response.status, 404, label)
    assert.equal((await api(`/api/report-definitions/${created.data.id}/preview`)).response.status, 404, label)
    assert.equal((await api(`/api/report-definitions/${created.data.id}`, { method: 'PATCH', body: { ...base, expectedVersion: 2 } })).response.status, 404, label)
    const own = await api('/api/report-definitions', { method: 'POST', body: base })
    assert.equal(own.response.status, 201, `${label}: same name is allowed in isolated scopes`)
    const restore = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: setup.data.user.accountId } })
    assert.equal(restore.response.status, 200)
    scopes.set(adminToken, restore.data.user)
    assert.equal((await api(`/api/report-definitions/${own.data.id}`)).response.status, 404, `${label}: isolation is bidirectional`)
    assert.equal((await api(`/api/report-definitions/${created.data.id}`)).data.version, 2)
  }

  const badScope = await api('/api/report-definitions', { headers: { 'X-Account-ID': 'forged-account' } })
  assert.equal(badScope.response.status, 403, 'forged workspace scope header is rejected')
  const other = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: '隔离租户', organizationName: '隔离组织', accountName: '隔离账套' } })
  assert.equal(other.response.status, 201, JSON.stringify(other.data))
  const crossScope = await api(`/api/report-definitions/${created.data.id}`, { headers: { 'X-Account-ID': other.data.scope.accountId } })
  assert.equal(crossScope.response.status, 403, 'authenticated scope cannot be forged to another account')
  const switched = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: other.data.scope.accountId } })
  assert.equal(switched.response.status, 200, JSON.stringify(switched.data))
  scopes.set(adminToken, switched.data.user)
  assert.equal((await api('/api/report-definitions')).data.definitions.length, 0, 'new tenant/org/account tuple starts without definitions')
  assert.equal((await api(`/api/report-definitions/${created.data.id}`)).response.status, 404, 'cross-scope ID is not found')
  const restore = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: setup.data.user.accountId } })
  assert.equal(restore.response.status, 200); scopes.set(adminToken, restore.data.user)

  const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    const state = db.prepare("SELECT value FROM app_state WHERE key = ?").get(`report-definitions:${JSON.stringify([setup.data.user.tenantId, setup.data.user.organizationId, setup.data.user.accountId])}`)
    assert.ok(state, 'definition state is persisted in scoped SQLite app_state')
    const parsed = JSON.parse(state.value)
    assert.ok(parsed.audit.some(entry => entry.definitionId === created.data.id && entry.version === 1))
    assert.ok(parsed.audit.some(entry => entry.definitionId === created.data.id && entry.version === 2))
    assert.equal(parsed.audit.find(entry => entry.definitionId === created.data.id && entry.version === 1).definition.name, base.name, 'audit preserves immutable version-one snapshot')
  } finally { db.close() }

  await stopServer(); await startServer()
  const afterRestart = await api(`/api/report-definitions/${created.data.id}`)
  assert.equal(afterRestart.response.status, 200, JSON.stringify(afterRestart.data))
  assert.equal(afterRestart.data.version, 2)
  assert.equal(afterRestart.data.name, '月度销售自定义-修订')
  assert.equal((await api(`/api/report-definitions/${created.data.id}/preview`)).response.status, 200)
})
