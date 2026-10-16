import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
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
let accountB = ''
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
async function uploadImport(path, { fileName, content, type = 'sales', token = adminToken, headers = {} }) {
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
  const form = new FormData()
  form.append('file', new Blob([content]), fileName)
  if (type) form.append('type', type)
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers: requestHeaders, body: form, signal: AbortSignal.timeout(8_000) })
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

  const reportParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
  const reportDay = new Date(Date.UTC(Number(reportParts.year), Number(reportParts.month) - 1, Number(reportParts.day)) - 86_400_000).toISOString().slice(0, 10)
  const canonicalFields = { id: 'FID', billNo: 'FBillNo', date: 'FDate', modifiedAt: 'FModified', partyNumber: 'FPartyNo', partyName: 'FParty', materialName: 'FMaterial', quantity: 'FQty', unit: 'FUnit', unitPrice: 'FUnitPrice', currency: 'FCurrency', originalAmount: 'FOriginal', amountCny: 'FCNY', settledAmountCny: 'FSettled', status: 'FStatus', upstreamId: 'FSourceID', upstreamBillNo: 'FSourceBillNo', upstreamLineId: 'FSourceLineID', taxAmount: 'FTax', taxAmountCny: 'FTaxCNY' }
  const fixtureModifiedAt = new Date(Date.now() - 10 * 60_000).toISOString()
  const documents = {
    shipment: { id: 'shipment-1', billNo: 'LIVE-OUT-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'C-1', partyName: '测试客户甲', materialName: '成品 A', quantity: '1', unit: '件', unitPrice: '10000', currency: 'CNY', originalAmount: '10000', amountCny: '10000', settledAmountCny: '0', upstreamBillNo: 'LIVE-SO-001', status: '已审核' },
    'purchase-receipt': { id: 'receipt-1', billNo: 'LIVE-IN-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'S-1', partyName: '测试供应商乙', materialName: '原料 B', quantity: '2', unit: '箱', unitPrice: '3000', currency: 'CNY', originalAmount: '6000', amountCny: '6000', settledAmountCny: '0', upstreamBillNo: 'LIVE-PO-001', status: '已审核' },
    'sales-order': { id: 'sales-order-1', billNo: 'LIVE-SO-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'C-1', partyName: '测试客户甲', materialName: '成品 A', quantity: '3', unit: '件', unitPrice: '8000', currency: 'CNY', originalAmount: '24000', amountCny: '24000', settledAmountCny: '0', status: '部分发货' },
    'purchase-order': { id: 'purchase-order-1', billNo: 'LIVE-PO-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'S-1', partyName: '测试供应商乙', materialName: '原料 B', quantity: '5', unit: '箱', unitPrice: '2800', currency: 'CNY', originalAmount: '14000', amountCny: '14000', settledAmountCny: '0', status: '已审核' },
    receivable: { id: 'receivable-1', billNo: 'LIVE-AR-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'C-1', partyName: '测试客户甲', materialName: '应收账款', quantity: '0', unit: '', currency: 'CNY', originalAmount: '15000', amountCny: '15000', settledAmountCny: '9000', upstreamBillNo: 'LIVE-SI-001', status: '部分收款' },
    payable: { id: 'payable-1', billNo: 'LIVE-AP-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'S-1', partyName: '测试供应商乙', materialName: '应付账款', quantity: '0', unit: '', currency: 'CNY', originalAmount: '11000', amountCny: '11000', settledAmountCny: '4000', upstreamBillNo: 'LIVE-PI-001', status: '部分付款' },
    'sales-invoice': { id: 'sales-invoice-1', billNo: 'LIVE-SI-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'C-1', partyName: '测试客户甲', materialName: '成品 A', quantity: '1', unit: '件', unitPrice: '10000', currency: 'CNY', originalAmount: '10000', amountCny: '10000', settledAmountCny: '0', upstreamBillNo: 'LIVE-OUT-001', status: '已开票' },
    'purchase-invoice': { id: 'purchase-invoice-1', billNo: 'LIVE-PI-001', date: reportDay, modifiedAt: fixtureModifiedAt, partyNumber: 'S-1', partyName: '测试供应商乙', materialName: '原料 B', quantity: '2', unit: '箱', unitPrice: '3000', currency: 'CNY', originalAmount: '6000', amountCny: '6000', settledAmountCny: '0', upstreamBillNo: 'LIVE-IN-001', status: '已收票' }
  }
  let incrementalSalesOrder = null
  const queryRequests = []
  const sourceKinds = Object.keys(documents)
  const dailyReportSources = Object.fromEntries(sourceKinds.map(kind => [kind, { formId: `TEST_${kind.replaceAll('-', '_').toUpperCase()}`, fields: { ...canonicalFields } }]))
  const masterCanonicalFields = { id: 'MID', number: 'MNumber', name: 'MName', status: 'MStatus', department: 'MDepartment', password: 'MPassword' }
  const masterRecords = {
    customer: { id: 'master-customer-1', number: 'C-1', name: '测试客户甲', status: '启用' },
    supplier: { id: 'master-supplier-1', number: 'S-1', name: '测试供应商乙', status: '启用' },
    salesperson: { id: 'master-sales-1', number: 'E-1', name: '销售员丙', department: '销售部' },
    user: { id: 'master-user-1', number: 'U-1', name: 'ERP 用户丁', status: '启用', password: 'must-not-be-read' },
  }
  const masterKinds = Object.keys(masterRecords)
  const masterDataSources = Object.fromEntries(masterKinds.map(kind => [kind, { formId: `TEST_MASTER_${kind.toUpperCase()}`, fields: { id: masterCanonicalFields.id, number: masterCanonicalFields.number, name: masterCanonicalFields.name, ...(kind === 'salesperson' ? { department: masterCanonicalFields.department } : { status: masterCanonicalFields.status }) } }]))
  const allSources = { ...dailyReportSources, ...masterDataSources }
  const formAllowlist = Object.fromEntries(Object.values(allSources).map(mapping => [mapping.formId, Object.values(mapping.fields)]))
  let invalidERPData = false
  let invalidMasterData = false
  const erp = createServer(async (request, response) => {
    if (request.url?.includes('LoginByAppSecret')) {
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'kdservice-session=fixture; Path=/; HttpOnly' })
      response.end(JSON.stringify({ LoginResultType: 1 })); return
    }
    if (!request.url?.includes('ExecuteBillQuery')) { response.writeHead(404); response.end(); return }
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const payload = JSON.parse(JSON.parse(body)[0])
    const kind = sourceKinds.find(sourceKind => dailyReportSources[sourceKind].formId === payload.FormId)
    const masterKind = masterKinds.find(sourceKind => masterDataSources[sourceKind].formId === payload.FormId)
    queryRequests.push({ kind, filterString: payload.FilterString, orderString: payload.OrderString })
    const docs = kind ? [{ ...documents[kind] }, ...(kind === 'sales-order' && incrementalSalesOrder ? [{ ...incrementalSalesOrder }] : [])] : []
    const masterRecord = masterKind ? { ...masterRecords[masterKind] } : null
    if (invalidMasterData && masterKind === 'customer' && masterRecord) masterRecord.id = ''
    if (invalidERPData && kind === 'sales-order') for (const document of docs) document.amountCny = 'not-a-number'
    const cutoff = /FModified\s*>=\s*'([^']+)'/.exec(payload.FilterString)?.[1]
    const filteredDocs = cutoff ? docs.filter(document => Date.parse(document.modifiedAt) >= Date.parse(`${cutoff.replace(' ', 'T')}Z`)) : docs
    const fieldMap = kind ? canonicalFields : masterCanonicalFields
    const sourceRows = kind ? filteredDocs : masterRecord ? [masterRecord] : []
    const rows = sourceRows.map(row => payload.FieldKeys.split(',').map(field => row[Object.keys(fieldMap).find(key => fieldMap[key] === field)] ?? ''))
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ Result: { Rows: rows } }))
  })
  const erpPort = await new Promise((resolve, reject) => erp.listen(0, '127.0.0.1', () => resolve(erp.address().port)).once('error', reject))
  try {
    const savedK3 = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { baseUrl: `http://127.0.0.1:${erpPort}`, accountId: 'test-erp-account', username: 'fixture', organization: 'test-org', appId: 'test-app', appSecret: 'not-a-real-secret', lcid: 2052, formAllowlist, dailyReportSources, masterDataSources, k3DataSyncSchedule: { enabled: false, intervalHours: 1 } } })
    assert.equal(savedK3.response.status, 200, JSON.stringify(savedK3.data))
    const unsupportedMasterMapping = structuredClone(masterDataSources)
    unsupportedMasterMapping.customer.fields.email = 'FEmail'
    const unsafeMappingSave = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { masterDataSources: unsupportedMasterMapping, formAllowlist: { ...formAllowlist, [masterDataSources.customer.formId]: [...formAllowlist[masterDataSources.customer.formId], 'FEmail'] } } })
    assert.equal(unsafeMappingSave.response.status, 400, 'unsupported fields are rejected even if the K3 Form allowlist contains them')
    const synchronized = await api('/api/daily-reports/k3-sync', { method: 'POST' })
    assert.equal(synchronized.response.status, 200, JSON.stringify(synchronized.data))
    assert.equal(synchronized.data.totalRows, 8)
    const platformUsersBeforeSync = (await api('/api/auth/users')).data.users.length
    const fullSyncQueryStart = queryRequests.length
    const fullSync = await api('/api/k3cloud/sync', { method: 'POST' })
    assert.equal(fullSync.response.status, 200, JSON.stringify(fullSync.data))
    assert.equal(fullSync.data.business.totalRows, 0, 'the second sync asks only for rows changed since the last successful watermark')
    assert.equal(fullSync.data.business.mode, 'incremental')
    assert.equal(fullSync.data.business.rowCounts['sales-order'], 1, 'unchanged rows remain in the merged scoped snapshot')
    const incrementalRequests = queryRequests.slice(fullSyncQueryStart).filter(request => request.kind)
    assert.equal(incrementalRequests.length, 8)
    assert.ok(incrementalRequests.every(request => request.filterString.includes('FModified >=') && request.orderString === 'FModified ASC'), 'each modifiedAt-mapped source uses an allowlisted incremental filter and stable order')
    assert.equal(fullSync.data.masterData.totalRows, 4)
    const masterSnapshot = await api('/api/k3cloud/master-data')
    assert.equal(masterSnapshot.response.status, 200)
    assert.deepEqual(masterSnapshot.data.rowCounts, { customer: 1, supplier: 1, salesperson: 1, user: 1 })
    assert.equal(masterSnapshot.data.records.customer[0].name, '测试客户甲')
    assert.equal(masterSnapshot.data.records.salesperson[0].department, '销售部')
    assert.equal(Object.hasOwn(masterSnapshot.data.records.user[0], 'password'), false, 'ERP user snapshots never expose credentials')
    assert.equal((await api('/api/auth/users')).data.users.length, platformUsersBeforeSync, 'ERP users are not provisioned as PLM accounts')

    const memberEmail = 'k3-member@example.test'
    const memberInvite = await api('/api/auth/users', { method: 'POST', body: { displayName: 'K3 API member', email: memberEmail, role: 'member' } })
    assert.equal(memberInvite.response.status, 201, JSON.stringify(memberInvite.data))
    const memberPassword = randomBytes(32).toString('base64url')
    const memberActivation = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: memberInvite.data.activationToken, password: memberPassword } })
    assert.equal(memberActivation.response.status, 200, JSON.stringify(memberActivation.data))
    const memberLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: memberEmail, password: memberPassword, accountId: accountA } })
    assert.equal(memberLogin.response.status, 200, JSON.stringify(memberLogin.data))
    const memberToken = memberLogin.data.accessToken
    scopes.set(memberToken, memberLogin.data.user)
    assert.equal((await api(`/api/daily-reports/summary?date=${reportDay}`, { token: memberToken })).response.status, 200, 'member retains the permitted reporting view')
    const memberMasterData = await api('/api/k3cloud/master-data', { token: memberToken })
    assert.equal(memberMasterData.response.status, 403, JSON.stringify(memberMasterData.data))
    assert.equal(memberMasterData.data.error, 'forbidden')
    assert.equal((await api('/api/k3cloud/sync-status', { token: memberToken })).response.status, 403)
    assert.equal((await api('/api/integrations/settings', { token: memberToken })).response.status, 403)
    assert.equal((await api('/api/k3cloud/sync', { method: 'POST', token: memberToken, body: {} })).response.status, 403)
    assert.equal((await api('/api/k3cloud/query', { method: 'POST', token: memberToken, body: { formId: 'TEST_MASTER_CUSTOMER', fieldKeys: 'MID', limit: 1, startRow: 0 } })).response.status, 403)

    const managerEmail = 'k3-plm-manager@example.test'
    const managerInvite = await api('/api/auth/users', { method: 'POST', body: { displayName: 'K3 PLM manager', email: managerEmail, role: 'plm_manager' } })
    assert.equal(managerInvite.response.status, 201, JSON.stringify(managerInvite.data))
    const managerPassword = randomBytes(32).toString('base64url')
    const managerActivation = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: managerInvite.data.activationToken, password: managerPassword } })
    assert.equal(managerActivation.response.status, 200, JSON.stringify(managerActivation.data))
    const managerLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: managerEmail, password: managerPassword, accountId: accountA } })
    assert.equal(managerLogin.response.status, 200, JSON.stringify(managerLogin.data))
    const managerToken = managerLogin.data.accessToken
    scopes.set(managerToken, managerLogin.data.user)
    assert.equal((await api('/api/k3cloud/master-data', { token: managerToken })).response.status, 200, 'PLM managers may read the approved K3 snapshot')
    assert.equal((await api('/api/k3cloud/sync-status', { token: managerToken })).response.status, 200, 'PLM managers may read the approved K3 schedule status')

    const enabledSchedule = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { k3DataSyncSchedule: { enabled: true, intervalHours: 6 } } })
    assert.equal(enabledSchedule.response.status, 200, JSON.stringify(enabledSchedule.data))
    assert.equal((await api('/api/k3cloud/sync-status')).data.schedule.schedulerState, 'scheduled')
    const disabledSchedule = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { k3DataSyncSchedule: { enabled: false, intervalHours: 6 } } })
    assert.equal(disabledSchedule.response.status, 200)
    const liveSummary = await api(`/api/daily-reports/summary?date=${reportDay}`)
    assert.equal(liveSummary.data.source, 'k3cloud')
    assert.equal(liveSummary.data.liveErpConnected, true)
    assert.equal(liveSummary.data.isMock, false)
    assert.equal(liveSummary.data.orders.sales.amountCny, 24000)
    assert.equal(liveSummary.data.orders.purchase.amountCny, 14000)
    assert.equal(liveSummary.data.balances.receivables.outstandingAmountCny, 6000)
    assert.equal(liveSummary.data.balances.payables.outstandingAmountCny, 7000)
    assert.equal(liveSummary.data.invoices.sales.rows[0].unitPrice, 10000)
    assert.equal(liveSummary.data.invoices.purchase.rows[0].unitPrice, 3000)
    assert.ok(liveSummary.data.fulfillment.sales.rows[0].linkedDocuments.some(row => row.kind === 'sales-order' && row.billNo === 'LIVE-SO-001'))
    assert.ok(liveSummary.data.fulfillment.purchase.rows[0].linkedDocuments.some(row => row.kind === 'purchase-order' && row.billNo === 'LIVE-PO-001'))
    assert.ok(liveSummary.data.balances.receivables.rows[0].linkedDocuments.some(row => row.kind === 'sales-invoice' && row.billNo === 'LIVE-SI-001'))
    assert.ok(liveSummary.data.invoices.sales.rows[0].linkedDocuments.some(row => row.kind === 'receivable' && row.billNo === 'LIVE-AR-001'))
    assert.ok(liveSummary.data.balances.payables.rows[0].linkedDocuments.some(row => row.kind === 'purchase-invoice' && row.billNo === 'LIVE-PI-001'))
    assert.ok(liveSummary.data.invoices.purchase.rows[0].linkedDocuments.some(row => row.kind === 'payable' && row.billNo === 'LIVE-AP-001'))
    assert.equal(liveSummary.data.sales.reconciliation.monthDifference.k3Amount, 10000)
    assert.match(liveSummary.data.notice, /非按报表日重算/)
    const earlierReportDay = new Date(Date.parse(`${reportDay}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
    const earlierSummary = await api(`/api/daily-reports/summary?date=${earlierReportDay}`)
    assert.equal(earlierSummary.data.orders.sales.count, 0, 'orders are selected by report date')
    assert.equal(earlierSummary.data.balances.receivables.outstandingAmountCny, 6000, 'current receivables do not get silently truncated by the selected report date')
    assert.equal(earlierSummary.data.balances.payables.outstandingAmountCny, 7000)
    const livePreview = await api('/api/reports/preview')
    assert.match(livePreview.data.text, /LIVE\\-SO\\-001/)
    assert.match(livePreview.data.text, /LIVE\\-PO\\-001/)
    assert.match(livePreview.data.text, /LIVE\\-AR\\-001/)
    assert.match(livePreview.data.text, /LIVE\\-AP\\-001/)

    invalidERPData = true
    documents['sales-order'].modifiedAt = new Date(Date.now() + 60_000).toISOString()
    const changedK3Secret = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { appSecret: 'test-retry-secret', dailyReportSources } })
    assert.equal(changedK3Secret.response.status, 200)
    const invalidSourceSync = await api('/api/daily-reports/k3-sync', { method: 'POST' })
    assert.equal(invalidSourceSync.response.status, 502, 'invalid ERP data fails the whole sync transaction')
    const afterDataFailure = await api(`/api/daily-reports/summary?date=${reportDay}`)
    assert.equal(afterDataFailure.data.orders.sales.amountCny, 24000, 'invalid ERP rows do not overwrite the previous live snapshot')
    invalidERPData = false
    documents['sales-order'].modifiedAt = fixtureModifiedAt

    invalidMasterData = true
    const failedFullSync = await api('/api/k3cloud/sync', { method: 'POST' })
    assert.equal(failedFullSync.response.status, 502, 'invalid master data must fail without publishing a partial master snapshot')
    const masterAfterFailure = await api('/api/k3cloud/master-data')
    assert.deepEqual(masterAfterFailure.data.records, masterSnapshot.data.records, 'a failed master-data sync preserves the last successful snapshot')
    invalidMasterData = false

    const brokenSources = structuredClone(dailyReportSources)
    brokenSources['sales-order'].fields.amountCny = 'FNOT_ALLOWLISTED'
    const savedBrokenMapping = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { dailyReportSources: brokenSources } })
    assert.equal(savedBrokenMapping.response.status, 200)
    const refusedSync = await api('/api/daily-reports/k3-sync', { method: 'POST' })
    assert.equal(refusedSync.response.status, 409, 'the sync rejects fields outside the K3 read-only allowlist')
    const preservedSummary = await api(`/api/daily-reports/summary?date=${reportDay}`)
    assert.equal(preservedSummary.data.orders.sales.amountCny, 24000, 'failed sync does not replace the previous committed snapshot')

    const restoredMappings = await api('/api/integrations/settings/k3cloud', { method: 'PUT', body: { appSecret: 'test-delta-secret', dailyReportSources } })
    assert.equal(restoredMappings.response.status, 200)
    incrementalSalesOrder = { ...documents['sales-order'], id: 'sales-order-2', billNo: 'LIVE-SO-002', materialName: '成品 B', quantity: '2', unitPrice: '2500', originalAmount: '5000', amountCny: '5000', modifiedAt: new Date(Date.now() + 60_000).toISOString() }
    const deltaQueryStart = queryRequests.length
    const deltaSync = await api('/api/daily-reports/k3-sync', { method: 'POST' })
    assert.equal(deltaSync.response.status, 200, JSON.stringify(deltaSync.data))
    assert.equal(deltaSync.data.mode, 'incremental')
    assert.equal(deltaSync.data.changedRowCounts['sales-order'], 1, 'the new order line is fetched once while unchanged rows stay in the snapshot')
    assert.ok(queryRequests.slice(deltaQueryStart).some(request => request.kind === 'sales-order' && request.filterString.includes('FModified >=') && request.orderString === 'FModified ASC'))
    const incrementedSummary = await api(`/api/daily-reports/summary?date=${reportDay}`)
    assert.equal(incrementedSummary.data.orders.sales.count, 2)
    assert.equal(incrementedSummary.data.orders.sales.amountCny, 29000)
  } finally { await new Promise(resolve => erp.close(resolve)) }

  const newTenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: '日报隔离租户 B', organizationName: '隔离组织 B', accountName: '隔离账套 B' } })
  assert.equal(newTenant.response.status, 201, JSON.stringify(newTenant.data))
  accountB = newTenant.data.scope.accountId
  const switchB = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountB } })
  assert.equal(switchB.response.status, 200)
  scopes.set(adminToken, switchB.data.user)
  const reportsB = await api('/api/daily-reports?from=2026-10-15&to=2026-10-15')
  assert.equal(reportsB.response.status, 200)
  assert.equal(reportsB.data.reports.some(report => report.id === reportId), false)
  const businessB = await api(`/api/daily-reports/summary?date=${reportDay}`)
  assert.equal(businessB.data.liveErpConnected, false)
  assert.equal(businessB.data.orders.sales.rows.some(row => row.billNo === 'LIVE-SO-001'), false, 'business document snapshots stay isolated by tenant, organization and account')
  assert.equal((await api('/api/k3cloud/master-data')).data.lastSyncedAt, null, 'master-data snapshots are isolated by tenant, organization and account')
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
  assert.equal((await api('/api/daily-reports/k3-sync', { method: 'POST', token: reviewerToken })).response.status, 403)
  assert.equal((await api('/api/k3cloud/sync', { method: 'POST', token: reviewerToken })).response.status, 403)

  await stopServer()
  await startServer()
  const persisted = await api(`/api/daily-reports/snapshots/${snapshotId}`)
  assert.equal(persisted.response.status, 200, 'the authenticated snapshot survives a server restart against the isolated SQLite database')
  assert.equal(persisted.data.snapshot.data.reports.find(report => report.id === reportId).amountCny, 200)
  assert.equal(persisted.data.deliveries.length, 2)
})

test('historical daily import validates CSV/XLSX and commits atomically within the authenticated scope', { concurrency: false }, async () => {
  const invalidCsv = '业务日期,客户/供应商,单据编号,数量,币种,原币金额,汇率,备注\n2024-03-01,历史客户,IMP-ATOMIC-001,2,USD,10,7.2,"逗号,备注"\nnot-a-date,历史客户,IMP-ATOMIC-002,1,CNY,20,1,无效日期\n'
  const invalidPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: invalidCsv })
  assert.equal(invalidPreview.response.status, 200, JSON.stringify(invalidPreview.data))
  assert.equal(invalidPreview.data.totalRows, 2)
  assert.equal(invalidPreview.data.errorRows, 1)
  assert.ok(invalidPreview.data.rows.find(row => row.line === 3).errors.length)
  const rejectedBatch = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: invalidPreview.data.previewId } })
  assert.equal(rejectedBatch.response.status, 422)
  const atomicCheck = await api('/api/daily-reports?from=2024-03-01&to=2024-03-01')
  assert.equal(atomicCheck.data.reports.some(report => report.documentNo === 'IMP-ATOMIC-001'), false, 'an invalid row prevents every row in the batch from being written')

  const validCsv = '业务日期,客户/供应商,单据编号,数量,币种,原币金额,汇率,备注\n2024-03-01,历史客户,IMP-VALID-001,2,USD,125.5,7.2,"往期,已核对"\n2024-03-01,历史客户,IMP-VALID-001,2,USD,125.5,7.2,重复文件行\n'
  const validPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: validCsv })
  assert.equal(validPreview.response.status, 200, JSON.stringify(validPreview.data))
  assert.equal(validPreview.data.importableRows, 1)
  assert.equal(validPreview.data.duplicateRows, 1)
  assert.equal(validPreview.data.errorRows, 0)
  const imported = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: validPreview.data.previewId } })
  assert.equal(imported.response.status, 200, JSON.stringify(imported.data))
  assert.equal(imported.data.importedCount, 1)
  assert.equal(imported.data.skippedDuplicates, 1)
  const importedRows = await api('/api/daily-reports?from=2024-03-01&to=2024-03-01&type=sales')
  const historic = importedRows.data.reports.find(report => report.documentNo === 'IMP-VALID-001')
  assert.equal(historic.source, 'history-import')
  assert.equal(historic.amountCny, 903.6, 'the server recomputes CNY amount from original amount and exchange rate')
  const repeatPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: validCsv })
  assert.equal(repeatPreview.data.duplicateRows, 2)
  const repeatCommit = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: repeatPreview.data.previewId } })
  assert.equal(repeatCommit.data.importedCount, 0)
  assert.equal(repeatCommit.data.skippedDuplicates, 2)

  const importWorkbook = new ExcelJS.Workbook(), importSheet = importWorkbook.addWorksheet('日报')
  importSheet.addRow(['类型', '日期', '客户/供应商', '单据编号', '数量', '币种', '原币金额', '汇率', '备注'])
  importSheet.addRow(['采购', new Date('2024-04-05T00:00:00.000Z'), '历史供应商', 'IMP-XLSX-001', 3, 'JPY', 1000, 0.05, 'Excel 导入'])
  const xlsxPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'historic.xlsx', content: Buffer.from(await importWorkbook.xlsx.writeBuffer()) })
  assert.equal(xlsxPreview.response.status, 200, JSON.stringify(xlsxPreview.data))
  assert.equal(xlsxPreview.data.importableRows, 1)
  const xlsxCommit = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: xlsxPreview.data.previewId } })
  assert.equal(xlsxCommit.data.importedCount, 1)
  const xlsxRows = await api('/api/daily-reports?from=2024-04-05&to=2024-04-05&type=purchase')
  assert.equal(xlsxRows.data.reports.find(report => report.documentNo === 'IMP-XLSX-001').amountCny, 50)

  const scopePreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: validCsv })
  assert.equal(scopePreview.response.status, 200)
  const switchedB = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountB } })
  assert.equal(switchedB.response.status, 200)
  scopes.set(adminToken, switchedB.data.user)
  const foreignCommit = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: scopePreview.data.previewId } })
  assert.equal(foreignCommit.response.status, 404, 'preview IDs cannot be reused in a different tenant/org/account scope')
  const switchedA = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: accountA } })
  assert.equal(switchedA.response.status, 200)
  scopes.set(adminToken, switchedA.data.user)
  const sameScopeCommit = await api('/api/daily-reports/import/commit', { method: 'POST', body: { previewId: scopePreview.data.previewId } })
  assert.equal(sameScopeCommit.response.status, 200)
  assert.equal(sameScopeCommit.data.importedCount, 0)

  const unauthorizedPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: validCsv, token: 'reviewer-token-not-resolved' })
  assert.equal(unauthorizedPreview.response.status, 401)
  const reviewerLogin = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email: 'daily-reviewer@example.test', password: 'reviewer-test-password-123', accountId: accountA } })
  assert.equal(reviewerLogin.response.status, 200)
  const reviewerToken = reviewerLogin.data.accessToken
  scopes.set(reviewerToken, reviewerLogin.data.user)
  const reviewerPreview = await uploadImport('/api/daily-reports/import/preview', { fileName: 'history.csv', content: validCsv, token: reviewerToken })
  assert.equal(reviewerPreview.response.status, 403)
  assert.equal((await api('/api/daily-reports/import/commit', { method: 'POST', token: reviewerToken, body: { previewId: 'not-a-preview' } })).response.status, 403)
  assert.equal((await api('/api/daily-reports/import/preview', { method: 'POST', scope: false })).response.status, 400)
})
