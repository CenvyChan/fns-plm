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
    ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
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
async function api(path, { method = 'GET', body, token = adminToken, scope = true } = {}) {
  const headers = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
    const active = scope ? scopes.get(token) : undefined
    if (active) {
      headers['X-Tenant-ID'] = active.tenantId
      headers['X-Organization-ID'] = active.organizationId
      headers['X-Account-ID'] = active.accountId
    }
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data, text }
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'momentum-k3-migration-test-'))
  databaseFile = join(tempDir, 'isolated.sqlite')
  await startServer()
})
after(async () => {
  await stopServer()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('M06 imports exact historical K3 headers and lines atomically, preserves inactive rows, and is idempotent', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: 'M06 迁移管理员', email: 'k3-migration-admin@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data))
  adminToken = setup.data.accessToken
  scopes.set(adminToken, setup.data.user)
  assert.equal((await api('/api/daily-reporting/migration/k3/status', { token: '' })).response.status, 401)

  const headerA = {
    legacyRecordId: '11', formId: 'SAL_OUTSTOCK', fid: '501', businessType: 'SALES_OUT', billNo: 'SO-501', date: '2025-12-31',
    status: 'C', approveDate: '2025-12-31T10:30:00.000Z', orgNumber: 'FNS-ORG', partyNumber: 'C-001', partyName: '旧客户甲', currency: 'CNY',
    totalAmountExact: '10.1200', totalQuantityExact: '1.250000', legacyPartyMappingId: '77', active: true, inactiveAt: null, snapshotAt: '2026-10-16T10:00:00.000Z',
  }
  const headerB = {
    legacyRecordId: '12', formId: 'STK_InStock', fid: '502', businessType: 'PURCHASE_IN', billNo: 'PI-502', date: '2025-12-30',
    status: 'C', approveDate: null, orgNumber: 'FNS-ORG', partyNumber: 'S-002', partyName: '旧供应商乙', currency: 'USD',
    totalAmountExact: '4.5000', totalQuantityExact: '2.000000', legacyPartyMappingId: null, active: false, inactiveAt: '2026-01-02T00:00:00.000Z', snapshotAt: '2026-10-16T10:00:00.000Z',
  }
  const firstHeaderBatch = await api('/api/daily-reporting/migration/k3/headers', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 2, rows: [headerA] } })
  assert.equal(firstHeaderBatch.response.status, 201, JSON.stringify(firstHeaderBatch.data))
  assert.equal(firstHeaderBatch.data.inserted, 1)
  const conflictingHeader = await api('/api/daily-reporting/migration/k3/headers', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 2, rows: [{ ...headerA, totalAmountExact: '10.1300' }] } })
  assert.equal(conflictingHeader.response.status, 409, 'same legacy identity with changed content is a conflict, not an overwrite')
  const secondHeaderBatch = await api('/api/daily-reporting/migration/k3/headers', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 2, rows: [headerB] } })
  assert.equal(secondHeaderBatch.response.status, 201, JSON.stringify(secondHeaderBatch.data))
  assert.equal(secondHeaderBatch.data.total, 2)

  const premature = await api('/api/daily-reporting/migration/k3/finalize', { method: 'POST', body: { companyCode: 'FNS', expectedHeaders: 2, expectedLines: 3 } })
  assert.equal(premature.response.status, 422, 'headers are not published until every expected detail arrives')
  assert.equal((await api('/api/daily-reporting/migration/k3/status')).data.finalized, null)

  const longSpecification = '规'.repeat(294)
  assert.equal(longSpecification.length, 294)
  const lines = [
    { legacyRecordId: '101', legacyHeaderRecordId: '11', formId: 'SAL_OUTSTOCK', fid: '501', entryId: '7001', sequence: 1, materialNumber: 'MAT-001', materialName: '旧物料甲', specification: '规格 A', quantityExact: '1.250000', unit: '件', unitPriceExact: '8.096000', originalAmountExact: '10.1200', amountCnyExact: '10.1200' },
    { legacyRecordId: '102', legacyHeaderRecordId: '12', formId: 'STK_InStock', fid: '502', entryId: '7002', sequence: 1, materialNumber: 'MAT-002', materialName: '旧物料乙', specification: '规格 B', quantityExact: '2.000000', unit: '箱', unitPriceExact: '2.250000', originalAmountExact: '4.5000', amountCnyExact: '4.5000' },
    { legacyRecordId: '103', legacyHeaderRecordId: '11', formId: 'SAL_OUTSTOCK', fid: '501', entryId: '7003', sequence: 2, materialNumber: 'MAT-003', materialName: '旧物料丙', specification: longSpecification, quantityExact: '1.000000', unit: '件', unitPriceExact: '1.000000', originalAmountExact: '1.0000', amountCnyExact: '1.0000' },
  ]
  const stagedLines = await api('/api/daily-reporting/migration/k3/lines', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 3, rows: lines } })
  assert.equal(stagedLines.response.status, 201, JSON.stringify(stagedLines.data))
  assert.equal(stagedLines.data.total, 3)
  const finalized = await api('/api/daily-reporting/migration/k3/finalize', { method: 'POST', body: { companyCode: 'FNS', expectedHeaders: 2, expectedLines: 3 } })
  assert.equal(finalized.response.status, 201, JSON.stringify(finalized.data))
  assert.equal(finalized.data.summary.headerCount, 2)
  assert.equal(finalized.data.summary.lineCount, 3)
  assert.equal(finalized.data.summary.inactiveHeaderCount, 1)
  assert.equal(finalized.data.summary.inactiveLineCount, 1)

  const status = await api('/api/daily-reporting/migration/k3/status')
  assert.equal(status.response.status, 200)
  assert.equal(status.data.staged, null)
  assert.equal(status.data.finalized.digest.length, 64)
  const dailySummary = await api('/api/daily-reports/summary?date=2025-12-31')
  assert.equal(dailySummary.response.status, 200)
  assert.equal(dailySummary.data.source, 'history-import')
  assert.equal(dailySummary.data.liveErpConnected, false)
  assert.match(dailySummary.data.notice, /不是实时 ERP 连接/)
  assert.equal(dailySummary.data.k3HistoricalMigration.inactiveLineCount, 1)
  const salesLines = await api('/api/daily-reports/k3-lines?type=sales')
  assert.ok(salesLines.data.rows.some(row => row.legacyRecordId === '101' && row.materialNumber === 'MAT-001' && row.specification === '规格 A' && row.amountCnyExact === '10.1200' && row.quantityExact === '1.250000'))
  assert.ok(salesLines.data.rows.some(row => row.legacyRecordId === '103' && row.specification === longSpecification && row.specification.length === 294), '294-character source specification is stored without truncation')

  const duplicateHeader = await api('/api/daily-reporting/migration/k3/headers', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 2, rows: [headerA] } })
  assert.equal(duplicateHeader.response.status, 200)
  assert.equal(duplicateHeader.data.skipped, 1)
  const duplicateLines = await api('/api/daily-reporting/migration/k3/lines', { method: 'POST', body: { companyCode: 'FNS', expectedCount: 3, rows: lines } })
  assert.equal(duplicateLines.response.status, 200)
  assert.equal(duplicateLines.data.skipped, 3)
  const duplicateFinalize = await api('/api/daily-reporting/migration/k3/finalize', { method: 'POST', body: { companyCode: 'FNS', expectedHeaders: 2, expectedLines: 3 } })
  assert.equal(duplicateFinalize.response.status, 200)
  assert.equal((await api('/api/daily-reporting/migration/k3/status')).data.finalized.lineCount, 3)
})
