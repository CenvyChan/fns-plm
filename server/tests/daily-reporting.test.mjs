import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import ExcelJS from 'exceljs'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = ''
let databaseFile = ''
let origin = ''
let child
let adminToken = ''
let accountA = ''
const scopes = new Map()

async function allocatePort() {
  const net = await import('node:net')
  const server = net.createServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve))
  return port
}
async function startServer() {
  const port = await allocatePort()
  origin = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
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
    catch { /* service is still starting */ }
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
async function api(path, { method = 'GET', body, token = adminToken, scope = true, headers = {} } = {}) {
  const requestHeaders = {}
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`
    const active = scope ? scopes.get(token) : undefined
    if (active) {
      requestHeaders['X-Tenant-ID'] = active.tenantId
      requestHeaders['X-Organization-ID'] = active.organizationId
      requestHeaders['X-Account-ID'] = active.accountId
    }
  }
  Object.assign(requestHeaders, headers)
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8_000) })
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('spreadsheetml')) return { response, data: null, text: '', bytes: Buffer.from(await response.arrayBuffer()) }
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data, text }
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-daily-report-test-'))
  databaseFile = join(tempDir, 'isolated.sqlite')
  await startServer()
})
after(async () => {
  await stopServer()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('daily reports stay scoped and complete the mock reconciliation, immutable snapshot, correction and export flow', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: '日报回归管理员', email: 'daily-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  adminToken = setup.data.accessToken
  scopes.set(adminToken, setup.data.user)
  accountA = setup.data.user.accountId

  assert.equal((await api('/api/daily-reports', { token: '' })).response.status, 401)
  assert.equal((await api('/api/daily-reports', { scope: false })).response.status, 400)
  assert.equal((await api('/api/daily-reports', { headers: { 'X-Account-ID': 'forged-account' } })).response.status, 403)

  const dayReports = await api('/api/daily-reports?from=2026-10-15&to=2026-10-15')
  assert.equal(dayReports.response.status, 200)
  assert.equal(dayReports.data.mockEnabled, true)
  assert.ok(dayReports.data.reports.some(report => report.id === 'mock-daily-sales-001'))
  const mockRows = await api('/api/daily-reports/k3-lines?type=sales')
  assert.equal(mockRows.response.status, 200)
  assert.ok(mockRows.data.rows.some(row => row.kind === 'shipment'))

  const created = await api('/api/daily-reports', { method: 'POST', body: {
    type: 'sales', date: '2026-10-15', partyName: '<script>alert(1)</script>', documentNo: 'TEST-DR-001',
    quantity: 2, currency: 'CNY', originalAmount: 200, exchangeRate: 1, note: '隔离测试记录', source: 'history-import',
  } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  const reportId = created.data.id
  assert.equal(created.data.amountCny, 200)
  assert.equal(created.data.createdBy, setup.data.user.id)
  assert.equal(created.data.source, 'manual', 'client input cannot claim a privileged import source')

  const linked = await api(`/api/daily-reports/${reportId}/links`, { method: 'PUT', body: { links: [{ k3RowId: 'mock-k3-sales-001', allocatedAmount: 300, allocatedQuantity: 1 }] } })
  assert.equal(linked.response.status, 200, JSON.stringify(linked.data))
  assert.ok(linked.data.warnings.some(value => value.includes('超额')), 'allow over-allocation but return a warning')
  const wrongType = await api(`/api/daily-reports/${reportId}/links`, { method: 'PUT', body: { links: [{ k3RowId: 'mock-k3-purchase-001', allocatedAmount: 1, allocatedQuantity: 1 }] } })
  assert.equal(wrongType.response.status, 400, 'sales reports cannot link purchase receipts')
  const foreignId = await api(`/api/daily-reports/${reportId}/links`, { method: 'PUT', body: { links: [{ k3RowId: 'not-in-this-account', allocatedAmount: 1, allocatedQuantity: 1 }] } })
  assert.equal(foreignId.response.status, 403, 'unknown/out-of-scope snapshot IDs are refused')

  const summary = await api('/api/daily-reports/summary?date=2026-10-15')
  assert.equal(summary.response.status, 200)
  assert.equal(summary.data.sales.reconciliation.dailyCoverage.coverageRate, 100)
  assert.equal(summary.data.sales.reconciliation.monthDifference.difference, -392)
  assert.ok(summary.data.sales.reconciliation.k3Allocation.overAllocatedAmount > 0)
  assert.ok(summary.data.sales.reconciliation.k3Allocation.crossDateCount > 0)
  assert.equal(summary.data.orders.sales.amountCny, 24000)
  assert.equal(summary.data.orders.purchase.amountCny, 14000)
  assert.equal(summary.data.balances.receivables.outstandingAmountCny, 10800)
  assert.equal(summary.data.balances.payables.outstandingAmountCny, 7000)
  assert.match(summary.data.notice, /本地隔离演示/)

  const adjustment = await api('/api/daily-reports', { method: 'POST', body: { type: 'sales', date: '2026-10-15', partyName: '隔离负数调整', quantity: 1, currency: 'CNY', originalAmount: -25, exchangeRate: 1 } })
  assert.equal(adjustment.response.status, 201)
  const adjustmentLink = await api(`/api/daily-reports/${adjustment.data.id}/links`, { method: 'PUT', body: { links: [{ k3RowId: 'mock-k3-sales-002', allocatedAmount: -300, allocatedQuantity: 1 }] } })
  assert.equal(adjustmentLink.response.status, 200)
  const signedRows = await api('/api/daily-reports/k3-lines?type=sales')
  const partiallyOffsetRow = signedRows.data.rows.find(row => row.id === 'mock-k3-sales-002')
  assert.equal(partiallyOffsetRow.allocatedAmount, 1500, 'absolute linked amounts must not offset each other')
  assert.equal(partiallyOffsetRow.remainingAmount, 1092)

  const archived = await api('/api/daily-reports/snapshots', { method: 'POST', body: { reportDate: '2026-10-15', scope: 'both' } })
  assert.equal(archived.response.status, 201, JSON.stringify(archived.data))
  assert.equal(archived.data.version, 1)
  assert.equal(archived.data.isComplete, true)
  const snapshotId = archived.data.id
  const immutableCopy = await api(`/api/daily-reports/snapshots/${snapshotId}`)
  assert.equal(immutableCopy.data.snapshot.data.reports.find(report => report.id === reportId).amountCny, 200)

  const changed = await api(`/api/daily-reports/${reportId}`, { method: 'PATCH', body: {
    type: 'sales', date: '2026-10-15', partyName: '<script>alert(1)</script>', documentNo: 'TEST-DR-001', quantity: 2,
    currency: 'CNY', originalAmount: 250, exchangeRate: 1, note: '已更正',
  } })
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data))
  assert.equal(changed.data.updatedBy, setup.data.user.id)
  const purchaseOnly = await api('/api/daily-reports/snapshots', { method: 'POST', body: { reportDate: '2026-10-16', scope: 'purchase' } })
  assert.equal(purchaseOnly.response.status, 201)
  assert.ok(!purchaseOnly.data.data.corrections.some(item => item.referenceId === reportId), 'purchase-only snapshot must not consume sales corrections')
  const stillPending = await api('/api/daily-reports/snapshots')
  assert.equal(stillPending.data.corrections.find(item => item.referenceId === reportId).reportedInSnapshotId, null)
  const nextDay = await api('/api/daily-reports/snapshots', { method: 'POST', body: { reportDate: '2026-10-16', scope: 'both' } })
  assert.equal(nextDay.response.status, 201)
  assert.ok(nextDay.data.data.corrections.some(item => item.referenceId === reportId && item.diffAmount === 50), 'next-day snapshot carries the correction without rewriting the prior archive')
  const oldAgain = await api(`/api/daily-reports/snapshots/${snapshotId}`)
  assert.equal(oldAgain.data.snapshot.data.reports.find(report => report.id === reportId).amountCny, 200)

  const html = await api(`/api/daily-reports/snapshots/${snapshotId}/export.html`)
  assert.equal(html.response.status, 200)
  assert.match(html.response.headers.get('content-type'), /text\/html/)
  assert.match(html.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html.text, /<script>alert\(1\)<\/script>/)
  const xlsx = await api(`/api/daily-reports/snapshots/${snapshotId}/export.xlsx`)
  assert.equal(xlsx.response.status, 200)
  assert.match(xlsx.response.headers.get('content-type'), /spreadsheetml/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx.bytes)
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['摘要', '日报明细', 'K3快照', '关联与分摊', '销售对账', '采购对账', '应收明细', '应付明细'])

  for (const channel of ['email', 'dingtalk']) {
    const simulated = await api(`/api/daily-reports/snapshots/${snapshotId}/deliveries`, { method: 'POST', body: { channel } })
    assert.equal(simulated.response.status, 201)
    assert.equal(simulated.data.status, 'simulated')
    assert.match(simulated.data.message, /未连接 SMTP、钉钉/)
  }
  const preview = await api('/api/reports/preview')
  assert.equal(preview.response.status, 200)
  assert.match(preview.data.text, /销售 \/ 采购经营日报/)
  assert.match(preview.data.text, /应收未收/)
  assert.match(preview.data.text, /应付未付/)

  const newTenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: '日报隔离租户 B', organizationName: '隔离组织 B', accountName: '隔离账套 B' } })
  assert.equal(newTenant.response.status, 201, JSON.stringify(newTenant.data))
  const accountB = newTenant.data.scope.accountId
  const switchB = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountB } })
  assert.equal(switchB.response.status, 200)
  scopes.set(adminToken, switchB.data.user)
  const reportsB = await api('/api/daily-reports?from=2026-10-15&to=2026-10-15')
  assert.equal(reportsB.response.status, 200)
  assert.equal(reportsB.data.reports.some(report => report.id === reportId), false)
  assert.equal((await api(`/api/daily-reports/snapshots/${snapshotId}`)).response.status, 404)
  assert.equal((await api('/api/daily-reports', { headers: { 'X-Tenant-ID': setup.data.user.tenantId } })).response.status, 403)
  const switchA = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountA } })
  assert.equal(switchA.response.status, 200)
  scopes.set(adminToken, switchA.data.user)

  const invite = await api('/api/auth/users', { method: 'POST', body: { displayName: '隔离只读评审', email: 'daily-reviewer@example.test', role: 'reviewer' } })
  assert.equal(invite.response.status, 201, JSON.stringify(invite.data))
  const activated = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: invite.data.activationToken, password: 'reviewer-test-password-123' } })
  assert.equal(activated.response.status, 200)
  const reviewerLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'daily-reviewer@example.test', password: 'reviewer-test-password-123', accountId: accountA } })
  assert.equal(reviewerLogin.response.status, 200)
  const reviewerToken = reviewerLogin.data.accessToken
  scopes.set(reviewerToken, reviewerLogin.data.user)
  assert.equal((await api('/api/daily-reports', { method: 'POST', token: reviewerToken, body: { type: 'sales', date: '2026-10-15', partyName: '不能写入', quantity: 1, currency: 'CNY', originalAmount: 1, exchangeRate: 1 } })).response.status, 403)

  await stopServer()
  await startServer()
  const persisted = await api(`/api/daily-reports/snapshots/${snapshotId}`)
  assert.equal(persisted.response.status, 200, 'the authenticated snapshot survives a server restart against the isolated SQLite database')
  assert.equal(persisted.data.snapshot.data.reports.find(report => report.id === reportId).amountCny, 200)
  assert.equal(persisted.data.deliveries.length, 2)
})
