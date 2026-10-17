import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = ''
let databaseFile = ''
let origin = ''
let child
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
    try { const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) }); if (response.ok) return }
    catch { /* service is starting */ }
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
  return { response, data, text }
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-daily-admin-test-'))
  databaseFile = join(tempDir, 'isolated.sqlite')
  await startServer()
})
after(async () => {
  await stopServer()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('daily reporting master data, rates, assignments and manual K3 party mapping stay scoped and role-safe', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: '日报管理测试管理员', email: 'daily-admin-parity@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  adminToken = setup.data.accessToken
  scopes.set(adminToken, setup.data.user)

  const management = await api('/api/daily-reporting/management')
  assert.equal(management.response.status, 200, JSON.stringify(management.data))
  assert.equal(management.data.masterDataConfigured, false)
  const customer = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'customer', name: '归属测试客户一', aliases: ['客户甲'], k3Number: 'K3-C-001' } })
  assert.equal(customer.response.status, 201, JSON.stringify(customer.data))
  const supplier = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'supplier', name: '归属测试供应商一', k3Number: 'K3-S-001' } })
  assert.equal(supplier.response.status, 201, JSON.stringify(supplier.data))
  const duplicate = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'customer', name: '客户甲' } })
  assert.equal(duplicate.response.status, 409, 'an alias cannot silently create a duplicate customer')
  assert.equal((await api('/api/daily-reporting/party-options?kind=customer')).data.parties.length, 1)

  const rate = await api('/api/daily-reporting/exchange-rates', { method: 'PUT', body: { month: '2026-10', rate: '7.1234' } })
  assert.equal(rate.response.status, 200, JSON.stringify(rate.data))
  assert.equal(rate.data.rate, '7.1234')
  const importedRate = await api('/api/daily-reporting/migration/rates', { method: 'POST', body: { companyCode: 'FNS', rows: [{ month: '2026-01', rate: '7.0000', legacyCompanyCode: 'FNS' }] } })
  assert.equal(importedRate.response.status, 201, JSON.stringify(importedRate.data))
  assert.equal(importedRate.data.inserted, 1)

  const invite = await api('/api/auth/users', { method: 'POST', body: { displayName: '日报销售成员', email: 'daily-sales-member@example.test', role: 'member' } })
  assert.equal(invite.response.status, 201, JSON.stringify(invite.data))
  const activated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: invite.data.activationToken, password: 'member-test-password-12345' } })
  assert.equal(activated.response.status, 200, JSON.stringify(activated.data))
  const memberLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'daily-sales-member@example.test', password: 'member-test-password-12345', accountId: setup.data.user.accountId } })
  assert.equal(memberLogin.response.status, 200, JSON.stringify(memberLogin.data))
  const memberToken = memberLogin.data.accessToken
  scopes.set(memberToken, memberLogin.data.user)

  const assign = await api('/api/daily-reporting/assignments', { method: 'POST', body: { kind: 'customer', partyId: customer.data.id, userIds: [memberLogin.data.user.id] } })
  assert.equal(assign.response.status, 200, JSON.stringify(assign.data))
  const memberCustomers = await api('/api/daily-reporting/party-options?kind=customer', { token: memberToken })
  assert.equal(memberCustomers.response.status, 200)
  assert.deepEqual(memberCustomers.data.parties.map(item => item.id), [customer.data.id])
  const memberSuppliers = await api('/api/daily-reporting/party-options?kind=supplier', { token: memberToken })
  assert.equal(memberSuppliers.data.parties.length, 0, 'sales member must not see unassigned supplier data')
  assert.equal((await api('/api/daily-reporting/management', { token: memberToken })).response.status, 403)
  assert.equal((await api('/api/daily-reporting/exchange-rates', { token: memberToken })).response.status, 200, 'members may read the shared monthly rate')
  assert.equal((await api('/api/daily-reporting/exchange-rates', { method: 'PUT', token: memberToken, body: { month: '2026-11', rate: '7.2' } })).response.status, 403)

  const report = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-10-15', partyId: customer.data.id, partyName: '客户端伪造名称', documentNo: 'ASSIGN-001', quantity: 1, currency: 'CNY', originalAmount: 100, exchangeRate: 1 } })
  assert.equal(report.response.status, 201, JSON.stringify(report.data))
  assert.equal(report.data.partyName, customer.data.name, 'server canonicalizes name from the scoped master')
  assert.equal(report.data.partyId, customer.data.id)
  const usdReport = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-10-15', partyId: customer.data.id, quantity: 1, currency: 'USD', originalAmount: 10, exchangeRate: 99 } })
  assert.equal(usdReport.response.status, 201, JSON.stringify(usdReport.data))
  assert.equal(usdReport.data.exchangeRate, 7.1234, 'new USD reports use the managed monthly rate, not a client-supplied value')
  assert.equal(usdReport.data.amountCny, 71.234)
  const missingMonthRate = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-11-15', partyId: customer.data.id, quantity: 1, currency: 'USD', originalAmount: 10, exchangeRate: 1 } })
  assert.equal(missingMonthRate.response.status, 400, "a configured master-data scope cannot save USD without that month's exchange rate")
  await api('/api/daily-reporting/exchange-rates', { method: 'PUT', body: { month: '2026-10', rate: '8.5' } })
  const preserveHistoricalRate = await api(`/api/daily-reports/${usdReport.data.id}`, { method: 'PATCH', token: memberToken, body: { note: '历史汇率保真检查' } })
  assert.equal(preserveHistoricalRate.response.status, 200, JSON.stringify(preserveHistoricalRate.data))
  assert.equal(preserveHistoricalRate.data.exchangeRate, 7.1234, 'editing an existing row must not re-estimate from the changed monthly master')
  assert.equal(preserveHistoricalRate.data.amountCny, 71.234)
  const unassignedReport = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'purchase', date: '2026-10-15', partyId: supplier.data.id, partyName: supplier.data.name, quantity: 1, currency: 'CNY', originalAmount: 100, exchangeRate: 1 } })
  assert.equal(unassignedReport.response.status, 403, 'a member cannot submit for a party outside their assignment')
  const freeTextReport = await api('/api/daily-reports', { method: 'POST', token: memberToken, body: { type: 'sales', date: '2026-10-15', partyName: '自由输入客商', quantity: 1, currency: 'CNY', originalAmount: 100, exchangeRate: 1 } })
  assert.equal(freeTextReport.response.status, 400, 'free text is disabled after master data is configured')

  const unassignedCustomer = await api('/api/daily-reporting/masters', { method: 'POST', body: { kind: 'customer', name: '归属测试客户二' } })
  assert.equal(unassignedCustomer.response.status, 201)
  const unassignedSales = await api('/api/daily-reports', { method: 'POST', body: { type: 'sales', date: '2026-10-15', partyId: unassignedCustomer.data.id, partyName: unassignedCustomer.data.name, quantity: 1, currency: 'CNY', originalAmount: 200, exchangeRate: 1 } })
  assert.equal(unassignedSales.response.status, 201)
  const purchaseReport = await api('/api/daily-reports', { method: 'POST', body: { type: 'purchase', date: '2026-10-15', partyId: supplier.data.id, partyName: supplier.data.name, quantity: 1, currency: 'CNY', originalAmount: 300, exchangeRate: 1 } })
  assert.equal(purchaseReport.response.status, 201)
  const visibleReports = await api('/api/daily-reports?from=2026-10-15&to=2026-10-15', { token: memberToken })
  assert.equal(visibleReports.response.status, 200)
  assert.ok(visibleReports.data.reports.every(item => item.type === 'sales'), 'sales member cannot see purchase daily reports')
  assert.equal(visibleReports.data.reports.find(item => item.id === report.data.id).canEdit, true)
  assert.equal(visibleReports.data.reports.find(item => item.id === unassignedSales.data.id).canEdit, false, 'same-scope sales rows remain read-only outside the assigned customer')
  assert.equal((await api('/api/daily-reports?type=purchase', { token: memberToken })).response.status, 403)
  const salesSummary = await api('/api/daily-reports/summary?date=2026-10-15', { token: memberToken })
  assert.equal(salesSummary.response.status, 200)
  assert.equal(salesSummary.data.access.sales, true)
  assert.equal(salesSummary.data.access.purchase, false)
  assert.equal(salesSummary.data.purchase, undefined)
  assert.equal((await api('/api/daily-reports/k3-lines?type=purchase', { token: memberToken })).response.status, 403)
  assert.equal((await api(`/api/daily-reports/${unassignedSales.data.id}`, { method: 'PATCH', token: memberToken, body: { note: '越权修改' } })).response.status, 403)
  assert.equal((await api(`/api/daily-reports/${purchaseReport.data.id}`, { method: 'DELETE', token: memberToken })).response.status, 403)
  assert.equal((await api(`/api/daily-reports/${purchaseReport.data.id}/links`, { method: 'PUT', token: memberToken, body: { links: [] } })).response.status, 403)
  const mixedSnapshot = await api('/api/daily-reports/snapshots', { method: 'POST', body: { reportDate: '2026-10-15', scope: 'both' } })
  assert.equal(mixedSnapshot.response.status, 201)
  assert.equal((await api('/api/daily-reports/snapshots', { method: 'POST', token: memberToken, body: { reportDate: '2026-10-15', scope: 'both' } })).response.status, 403)
  const salesSnapshot = await api('/api/daily-reports/snapshots', { method: 'POST', token: memberToken, body: { reportDate: '2026-10-15', scope: 'sales' } })
  assert.equal(salesSnapshot.response.status, 201, JSON.stringify(salesSnapshot.data))
  const memberSnapshots = await api('/api/daily-reports/snapshots', { token: memberToken })
  assert.ok(memberSnapshots.data.snapshots.some(item => item.id === salesSnapshot.data.id))
  assert.ok(!memberSnapshots.data.snapshots.some(item => item.id === mixedSnapshot.data.id), 'mixed sales/purchase snapshots stay hidden from a sales-only member')
  assert.equal((await api(`/api/daily-reports/snapshots/${mixedSnapshot.data.id}`, { token: memberToken })).response.status, 404)
  assert.equal((await api(`/api/daily-reports/snapshots/${mixedSnapshot.data.id}/export.xlsx`, { token: memberToken })).response.status, 404)
  assert.equal((await api(`/api/daily-reports/snapshots/${salesSnapshot.data.id}/deliveries`, { method: 'POST', token: memberToken, body: { channel: 'email' } })).response.status, 201)

  const importedParty = await api('/api/daily-reporting/migration/parties', { method: 'POST', body: { companyCode: 'FNS', rows: [{ kind: 'customer', name: '旧系统待映射客户', aliases: [], legacyCompanyCode: 'FNS', legacyId: 'legacy-customer-01', k3Number: '' }] } })
  assert.equal(importedParty.response.status, 201, JSON.stringify(importedParty.data))
  assert.equal(importedParty.data.inserted, 1)
  const targetParty = (await api('/api/daily-reporting/management')).data.parties.find(item => item.legacyId === 'legacy-customer-01')
  assert.ok(targetParty)
  const legacyAssignment = await api('/api/daily-reporting/migration/assignments', { method: 'POST', body: { companyCode: 'FNS', rows: [{ kind: 'customer', legacyCompanyCode: 'FNS', legacyPartyId: 'legacy-customer-01', legacyUserId: 'legacy-user-01', legacyUsername: 'legacy.sales', legacyUserName: '旧业务员' }] } })
  assert.equal(legacyAssignment.response.status, 201, JSON.stringify(legacyAssignment.data))
  const assignmentRecord = (await api('/api/daily-reporting/management')).data.assignments.find(item => item.legacyUserId === 'legacy-user-01')
  assert.equal(assignmentRecord.partyId, targetParty.id, 'legacy party primary key may be mapped exactly')
  assert.equal(assignmentRecord.userId, null, 'legacy account does not create or auto-map a PLM user')
  assert.equal(assignmentRecord.status, 'member-unmapped')
  const usersBeforeM08 = (await api('/api/auth/users')).data.users.length
  const importedMembership = await api('/api/daily-reporting/migration/memberships', { method: 'POST', body: { companyCode: 'FNS', rows: [{ legacyUserId: 'legacy-user-02', legacyUsername: 'legacy.finance', legacyUserName: '旧财务成员', active: true, groups: ['财务组', '旧只读组'], mustChangePassword: true }] } })
  assert.equal(importedMembership.response.status, 201, JSON.stringify(importedMembership.data))
  const oldMembership = (await api('/api/daily-reporting/management')).data.legacyMemberships.find(item => item.legacyUserId === 'legacy-user-02')
  assert.equal(oldMembership.status, 'member-unmapped')
  assert.deepEqual(oldMembership.legacyGroups, ['旧只读组', '财务组'])
  assert.equal(oldMembership.legacyMustChangePassword, true)
  assert.equal((await api('/api/auth/users')).data.users.length, usersBeforeM08, 'M08 must not create a PLM user or grant a role')
  const mappedAssignment = await api(`/api/daily-reporting/assignments/${assignmentRecord.id}`, { method: 'PUT', body: { partyId: targetParty.id, userId: memberLogin.data.user.id } })
  assert.equal(mappedAssignment.response.status, 200, JSON.stringify(mappedAssignment.data))
  assert.equal(mappedAssignment.data.status, 'mapped')

  const legacyMapping = await api('/api/daily-reporting/migration/party-mappings', { method: 'POST', body: { companyCode: 'FNS', rows: [{ kind: 'customer', k3Number: 'K3-C-LEGACY-77', k3Name: '旧系统 K3 候选客户', legacyCompanyCode: 'FNS', legacyPartyId: 'legacy-customer-01', status: 'MANUAL', candidates: [{ id: 'legacy-customer-01', name: '旧系统待映射客户', score: 1 }] }] } })
  assert.equal(legacyMapping.response.status, 201, JSON.stringify(legacyMapping.data))
  const review = (await api('/api/daily-reporting/management')).data.partyMappings.find(item => item.k3Number === 'K3-C-LEGACY-77')
  assert.equal(review.status, 'PENDING', 'legacy MANUAL is preserved only as provenance and must be re-confirmed in PLM')
  assert.equal(review.legacyStatus, 'MANUAL')
  const confirmed = await api(`/api/daily-reporting/party-mappings/${review.id}`, { method: 'PUT', body: { partyId: targetParty.id } })
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data))
  assert.equal(confirmed.data.status, 'MANUAL')
  assert.equal(confirmed.data.partyId, targetParty.id)

  const batches = await api('/api/daily-reporting/migration/batches')
  assert.equal(batches.response.status, 200)
  assert.deepEqual(new Set(batches.data.batches.map(item => item.category)), new Set(['M03-parties', 'M04-rates', 'M05-assignments', 'M08-memberships', 'M13-party-mappings']))

  await stopServer()
  await startServer()
  const persistedManagement = await api('/api/daily-reporting/management')
  assert.equal(persistedManagement.response.status, 200, JSON.stringify(persistedManagement.data))
  assert.ok(persistedManagement.data.parties.some(item => item.id === targetParty.id && item.legacyId === 'legacy-customer-01' && item.name === '旧系统待映射客户'), 'legacy party identity and content survive process restart')
  assert.ok(persistedManagement.data.parties.some(item => item.id === customer.data.id && item.name === '归属测试客户一'), 'manually maintained party survives process restart')
  assert.ok(persistedManagement.data.exchangeRates.some(item => item.month === '2026-10' && item.rate === '8.5'), 'updated monthly rate survives process restart')
  const persistedImportedRate = persistedManagement.data.exchangeRates.find(item => item.month === '2026-01')
  assert.ok(persistedImportedRate, 'imported monthly rate survives process restart')
  assert.equal(Number(persistedImportedRate.rate), 7)
  assert.equal(persistedImportedRate.source, 'legacy-import')
  assert.ok(persistedManagement.data.assignments.some(item => item.id === mappedAssignment.data.id && item.partyId === targetParty.id && item.userId === memberLogin.data.user.id && item.status === 'mapped'), 'mapped member assignment survives process restart')
  assert.ok(persistedManagement.data.legacyMemberships.some(item => item.legacyUserId === 'legacy-user-02' && item.status === 'member-unmapped' && item.legacyMustChangePassword), 'M08 member facts remain pending across process restart')
  assert.ok(persistedManagement.data.partyMappings.some(item => item.id === confirmed.data.id && item.partyId === targetParty.id && item.status === 'MANUAL' && item.legacyStatus === 'MANUAL'), 'manually confirmed K3 mapping and legacy provenance survive process restart')
  const persistedBatches = await api('/api/daily-reporting/migration/batches')
  assert.equal(persistedBatches.response.status, 200)
  assert.deepEqual(new Set(persistedBatches.data.batches.map(item => item.category)), new Set(['M03-parties', 'M04-rates', 'M05-assignments', 'M08-memberships', 'M13-party-mappings']), 'migration audit batches survive process restart')
})
