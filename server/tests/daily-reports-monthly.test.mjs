import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import ExcelJS from 'exceljs'
import Database from 'better-sqlite3'

const dir = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 'monthly-daily-'))
const dbPath = join(temp, 'db.sqlite'), port = await (async () => { const net = await import('node:net'); const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p })()
const origin = `http://127.0.0.1:${port}`
let child, token, user, database
const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: dbPath, APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(temp, 'enc.key'), DATA_FILE: join(temp, 'missing.json'), LEGACY_DATA_FILE: join(temp, 'missing.json'), DOCUMENT_STORAGE_DIR: join(temp, 'docs'), INTEGRATION_DATA_DIR: temp, REDIS_URL: '', FLOWABLE_BASE_URL: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}', DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '' }
async function call(path, auth = true) { const headers = {}; if (auth) { headers.Authorization = `Bearer ${token}`; headers['X-Tenant-ID'] = user.tenantId; headers['X-Organization-ID'] = user.organizationId; headers['X-Account-ID'] = user.accountId } return fetch(origin + path, { headers }) }
before(async () => {
  child = spawn(process.execPath, ['dist/index.js'], { cwd: dir, env, stdio: 'ignore' })
  for (let i = 0; i < 200; i++) { try { if ((await fetch(origin + '/api/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  const setup = await fetch(origin + '/api/auth/mobile/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Monthly Test', email: 'monthly@example.test', password: 'test-password-12345' }) })
  assert.equal(setup.status, 201); const data = await setup.json(); token = data.accessToken; user = data.user
  database = new Database(dbPath)
})
after(async () => { child?.kill('SIGTERM'); database?.close(); rmSync(temp, { recursive: true, force: true }) })

test('monthly daily endpoints return validated complete calendar, scoped aggregates, and matching workbook', async () => {
  for (const [month, length] of [['2025-02', 28], ['2024-02', 29], ['2025-04', 30], ['2025-01', 31], ['2000-01', 31], ['2999-12', 31]]) {
    const res = await call(`/api/daily-reports/monthly?month=${month}`); assert.equal(res.status, 200); const body = await res.json(); assert.equal(body.days.length, length); assert.equal(body.days.at(-1).date, `${month}-${String(length).padStart(2, '0')}`)
  }
  const key = `daily-reporting:${user.tenantId}:${user.organizationId}:${user.accountId}`
  const row = (id, amount, quantity, legacyHeaderId) => ({ id, kind: 'shipment', type: 'sales', billNo: 'BILL-X', date: '2025-01-31', partyNumber: '', partyName: '', materialName: '', quantity, quantityExact: String(quantity), unit: '', currency: 'CNY', originalAmount: amount, amountCny: amount, amountCnyExact: String(amount), settledAmountCny: 0, status: '已审核', source: 'history-import', snapshotAt: '2025-01-31T00:00:00Z', active: true, ...(legacyHeaderId ? { legacyHeaderId } : {}) })
  const state = { reports: [
    { id: 'sys-1', type: 'sales', date: '2025-01-31', quantity: 1.25, amountCny: 9.99, amountCnyExact: '9.99' },
    { id: 'sys-2', type: 'sales', date: '2025-01-31', quantity: -0.25, amountCny: -1.11, amountCnyExact: '-1.11' },
    { id: 'sys-3', type: 'sales', date: '2025-01-31', quantity: 0.001, amountCny: 0.005, amountCnyExact: '0.005' },
    { id: 'sys-4', type: 'sales', date: '2025-01-30', quantity: 0.001, amountCny: -0.005, amountCnyExact: '-0.005' },
    { id: 'deleted', type: 'sales', date: '2025-01-31', quantity: 100, amountCny: 100, deletedAt: '2025-02-01' },
  ], k3Rows: [row('line-1', 50, 5, 'head-1'), row('line-2', 70, 7, 'head-1'), { ...row('inactive', 1000, 100, undefined), id: 'inactive', active: false }], k3HistoricalHeaders: [{ id: 'head-1', legacyCompanyCode: 'XX', legacyRecordId: 'r', formId: 'f', fid: 'f1', kind: 'shipment', type: 'sales', businessType: 'SALES_OUT', billNo: 'BILL-X', date: '2025-01-31', status: '已审核', orgNumber: '', partyNumber: '', partyName: '', currency: 'CNY', totalAmountExact: '12.345', totalQuantityExact: '1.5', active: true, snapshotAt: '2025-01-31T00:00:00Z' }], links: [], snapshots: [], corrections: [], deliveries: [], mockEnabled: false, k3Sync: { source: 'history-import', lastSyncedAt: '2025-01-31T00:00:00Z', rowCounts: {} } }
  database.prepare('INSERT INTO app_state(key,value,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=app_state.revision+1,updated_at=excluded.updated_at').run(key, JSON.stringify(state), new Date().toISOString())
  const response = await call('/api/daily-reports/monthly?month=2025-01'); assert.equal(response.status, 200); const data = await response.json(); const last = data.days.at(-1).sales
  assert.deepEqual(last.system, { count: 3, quantity: 1.001, amountCny: 8.89 }); assert.deepEqual(last.k3, { count: 1, quantity: 1.5, amountCny: 12.35 }); assert.equal(last.difference, -3.46); assert.equal(data.k3AvailableByType.sales, true); assert.equal(data.k3AvailableByType.purchase, false); assert.equal(data.totals.sales.system.amountCny, 8.88); assert.equal(data.days.length, 31); assert.equal(data.days[0].sales.system.count, 0)
  for (const bad of ['1999-12', '3000-01', '2025-13', '2025-00', '2025-2', '2025-02-30', '2025-1']) assert.equal((await call(`/api/daily-reports/monthly?month=${bad}`)).status, 400)
  assert.equal((await call('/api/daily-reports/monthly?month=2025-01', false)).status, 401)
  const crossScope = await fetch(`${origin}/api/daily-reports/monthly?month=2025-01`, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': user.tenantId, 'X-Organization-ID': user.organizationId, 'X-Account-ID': 'other-account' } }); assert.equal(crossScope.status, 403)
  const file = await call('/api/daily-reports/monthly/export.xlsx?month=2025-01')
  assert.equal(file.status, 200)
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()))
  const sheet = workbook.getWorksheet('销售逐日核对'), summarySheet = workbook.getWorksheet('采销逐日汇总')
  assert.equal(sheet.getRow(32).getCell(1).value, '2025-01-31')
  assert.equal(sheet.getRow(32).getCell(8).value, -3.46)
  for (const [index, day] of data.days.entries()) {
    assert.equal(summarySheet.getRow(index + 2).getCell(1).value, day.date)
    assert.equal(summarySheet.getRow(index + 2).getCell(4).value, day.sales.system.amountCny)
    assert.equal(sheet.getRow(index + 2).getCell(4).value, day.sales.system.amountCny)
  }
  assert.equal(summarySheet.getRow(33).getCell(4).value, data.totals.sales.system.amountCny)
  const noSnapshot = { reports: [], k3Rows: [], k3HistoricalHeaders: [], links: [], snapshots: [], corrections: [], deliveries: [], mockEnabled: false, k3Sync: null }
  database.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(noSnapshot), key)
  const missing = await (await call('/api/daily-reports/monthly?month=2025-01')).json(); assert.deepEqual(missing.days[30].sales.k3, { count: 0, quantity: 0, amountCny: 0 }); assert.equal(missing.k3AvailableByType.sales, false); assert.equal(missing.days[30].sales.difference, null); assert.match(missing.notice, /未导入或无ERP快照/);
  const orderOnly = { ...noSnapshot, k3Rows: [{ ...row('sales-order-only', 9, 1), kind: 'sales-order' }] };
  database.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(orderOnly), key)
  const orderOnlyResult = await (await call('/api/daily-reports/monthly?month=2025-01')).json(); assert.equal(orderOnlyResult.k3AvailableByType.sales, false); assert.equal(orderOnlyResult.k3Available, false);
  const workbookNoSnapshot = await call('/api/daily-reports/monthly/export.xlsx?month=2025-01'); const emptyBook = new ExcelJS.Workbook(); await emptyBook.xlsx.load(Buffer.from(await workbookNoSnapshot.arrayBuffer())); assert.equal(emptyBook.getWorksheet('销售逐日核对').getRow(32).getCell(7).value, null)
})

test('monthly JSON and Excel omit unauthorized business data and snapshot metadata', async () => {
  const adminKey = `daily-reporting-admin:${user.tenantId}:${user.organizationId}:${user.accountId}`
  database.prepare("UPDATE users SET role='member',is_platform_admin=0 WHERE id=?").run(user.id)
  database.prepare("UPDATE tenant_memberships SET role='member' WHERE user_id=? AND account_id=?").run(user.id, user.accountId)
  const saveAccess = kind => {
    const value = { masterDataConfigured: true, parties: [{ id: 'party', name: '授权客商', kind, active: true, aliases: [] }], assignments: [{ kind, partyId: 'party', userId: user.id, status: 'mapped' }], exchangeRates: [], partyMappings: [], legacyMemberships: [], importBatches: [] }
    database.prepare('INSERT INTO app_state(key,value,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=app_state.revision+1,updated_at=excluded.updated_at').run(adminKey, JSON.stringify(value), new Date().toISOString())
  }
  for (const [kind, allowed, denied] of [['customer', 'sales', 'purchase'], ['supplier', 'purchase', 'sales']]) {
    saveAccess(kind)
    const response = await call('/api/daily-reports/monthly?month=2025-01')
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.access[allowed], true); assert.equal(data.access[denied], false)
    assert.ok(data.days.every(day => allowed in day && !(denied in day)))
    assert.equal(denied in data.totals, false)
    assert.equal(denied in data.k3AvailableByType, false)
    const file = await call('/api/daily-reports/monthly/export.xlsx?month=2025-01')
    assert.equal(file.status, 200)
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await file.arrayBuffer()))
    assert.equal(book.worksheets.length, 2)
    assert.equal(book.getWorksheet(denied === 'sales' ? '销售逐日核对' : '采购逐日核对'), undefined)
    assert.equal(book.getWorksheet('采销逐日汇总').getRow(1).cellCount, 4)
  }
  database.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify({ masterDataConfigured: true, parties: [], assignments: [] }), adminKey)
  assert.equal((await call('/api/daily-reports/monthly?month=2025-01')).status, 403)
  assert.equal((await call('/api/daily-reports/monthly/export.xlsx?month=2025-01')).status, 403)
})
