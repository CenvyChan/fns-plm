import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as netServer } from 'node:net'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir, databaseFile, origin, child, token, user, db
const api = async (path, { bearer = token, scope = user } = {}) => {
  const headers = {}
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  if (scope) {
    headers['X-Tenant-ID'] = scope.tenantId
    headers['X-Organization-ID'] = scope.organizationId
    headers['X-Account-ID'] = scope.accountId
  }
  const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(8000) })
  const type = response.headers.get('content-type') || ''
  return type.includes('spreadsheetml') ? { response, bytes: Buffer.from(await response.arrayBuffer()) } : { response, data: await response.json() }
}
async function allocatePort() {
  const server = netServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve)); return port
}
before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'daily-analysis-'))
  databaseFile = join(tempDir, 'analysis.sqlite')
  const port = await allocatePort(); origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'), DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'docs'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}', DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}', DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', x => stderr += x.toString())
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${origin}/api/health`)).ok) break } catch {} await new Promise(r => setTimeout(r, 100)); if (i === 199) throw Error(`server startup: ${stderr}`) }
  const setupResponse = await fetch(`${origin}/api/auth/mobile/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: '分析测试管理员', email: 'analysis-admin@example.test', password: 'test-password-12345' }) })
  assert.equal(setupResponse.status, 201)
  const setup = await setupResponse.json(); token = setup.accessToken; user = setup.user
  db = new Database(databaseFile)
  const key = `daily-reporting-admin:${user.tenantId}:${user.organizationId}:${user.accountId}`
  const admin = { masterDataConfigured: true, parties: [
    { id: 'p-active', kind: 'customer', name: '客户甲', aliases: [], active: true },
    { id: 'p-inactive', kind: 'customer', name: '已删客户', aliases: [], active: false },
    { id: 's-active', kind: 'supplier', name: '供应商乙', aliases: [], active: true },
  ], exchangeRates: [], assignments: [], partyMappings: [], legacyMemberships: [], importBatches: [] }
  putState(db, key, admin)
  const rkey = `daily-reporting:${user.tenantId}:${user.organizationId}:${user.accountId}`
  const rows = [
    report('1','sales','2026-01-02','客户甲-北区', 'alice','CNY',100,1,100,'manual',1.125),
    { ...report('2','sales','2026-01-02','客户甲-南区', 'alice','USD',10,7.2,72,'history-import',0.001), documentNo: 'MiXeD-Inv-42', note: 'Urgent memo' },
    report('3','sales','2026-02-03','客户甲-北区', 'bob','CNY',50,1,777,'manual',2),
    { ...report('4','sales','2026-02-03','=SUM(1,2)', 'alice','USD',5,8,40,'manual',3), documentNo: '@cmd' },
    report('5','purchase','2026-01-02','供应商乙-部件', 'bob','CNY',20,1,20,'manual',4),
    ...Array.from({ length: 12 }, (_, i) => report(`r${i}`, 'sales', '2026-03-01', `排名${i}`, 'alice', 'CNY', i+1, 1, i+100, 'manual', 1)),
    { ...report('gone','sales','2026-01-02','已删除客户','alice','CNY',999,1,999,'manual',99), deletedAt: '2026-05-01T00:00:00.000Z' },
  ]
  putState(db, rkey, { reports: rows, k3Rows: [], links: [], snapshots: [], corrections: [], deliveries: [], mockSnapshotAt: null, mockEnabled: false, k3Sync: null, k3HistoricalHeaders: [], importPreviews: [], importBatches: [] })
})
after(async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) }; db?.close(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })
function putState(conn, key, value) { conn.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,revision=app_state.revision+1').run(key, JSON.stringify(value), new Date().toISOString()) }
function report(id,type,date,partyName,createdBy,currency,originalAmount,exchangeRate,amountCny,source,quantity) { return { id,type,date,partyName,documentNo:`DOC-${id}`,quantity,currency,originalAmount,exchangeRate,amountCny,note:'',source,createdAt:`${date}T10:00:00.000Z`,updatedAt:`${date}T10:00:00.000Z`,createdBy,createdByName:createdBy,updatedBy:createdBy } }

test('analysis API filters, saved historical values, trends, options and XLSX stay consistent', { concurrency: false }, async () => {
  const path = '/api/daily-reports/analysis?type=sales'
  const foreignScope = { ...user, accountId: 'foreign-account-id' }
  assert.equal((await api(path, { scope: foreignScope })).response.status, 403, 'cross-scope analysis requests are rejected')
  const all = await api(path); assert.equal(all.response.status, 200)
  assert.equal(all.data.reports.length, 16); assert.ok(!all.data.reports.some(r => r.id === 'gone'))
  assert.equal(all.data.summary.quantity, 18.126); assert.equal(all.data.summary.cnyAmount, 228); assert.equal(all.data.summary.usdAmount, 15); assert.equal(all.data.summary.amountCny, 2255)
  assert.equal(all.data.dailyTrend.find(x => x.period === '2026-01-02').quantity, 1.126)
  assert.equal(all.data.monthlyTrend.find(x => x.period === '2026-02').amountCny, 817)
  assert.equal(all.data.counterpartRank.length, 10)
  assert.deepEqual(all.data.options.people.map(x => x.id).sort(), ['alice','bob'])
  const filtered = await api(`${path}&from=2026-01-01&to=2026-01-31&partyName=${encodeURIComponent('客户甲')}&createdBy=alice&currency=USD&source=history-import`)
  assert.equal(filtered.response.status, 200); assert.deepEqual(filtered.data.reports.map(r => r.id), ['2'])
  assert.equal(filtered.data.summary.usdAmount, 10); assert.equal(filtered.data.summary.amountCny, 72)
  const keyword = await api(`${path}&q=mIxEd-inv`); assert.deepEqual(keyword.data.reports.map(r => r.id), ['2']); assert.equal(keyword.data.filters.q, 'mIxEd-inv')
  const noteSearch = await api(`${path}&q=URGENT%20MEMO`); assert.deepEqual(noteSearch.data.reports.map(r => r.id), ['2'])
  assert.deepEqual(filtered.data.options.people.map(x => x.id).sort(), ['alice','bob'], 'options come from permitted non-deleted records, ignoring filters')
  assert.equal((await api(`${path}&from=2026-02-30`)).response.status, 400)
  assert.equal((await api(`${path}&from=2026-02-01&to=2026-01-31`)).response.status, 400)
  const purchase = await api('/api/daily-reports/analysis?type=purchase'); assert.equal(purchase.response.status, 200); assert.equal(purchase.data.reports.length, 1)
  const xlsx = await api('/api/daily-reports/analysis/export.xlsx?type=sales&from=2026-01-01&to=2026-01-31&partyName=客户甲&createdBy=alice&currency=USD&source=history-import')
  assert.equal(xlsx.response.status, 200)
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.bytes)
  assert.deepEqual(workbook.worksheets.map(s => s.name), ['摘要','日报明细'])
  const detail = workbook.getWorksheet('日报明细'); assert.equal(detail.getRow(2).getCell(11).value, '2'); assert.equal(detail.getRow(2).getCell(8).value, 72)
  const sheet = workbook.getWorksheet('摘要')
  const metrics = new Map(); sheet.eachRow(row => metrics.set(row.getCell(1).value, row.getCell(2).value))
  for (const [key, value] of Object.entries(filtered.data.summary)) assert.equal(metrics.get(key), value)
  assert.equal(metrics.get('币种'), 'USD'); assert.equal(metrics.get('客商名称包含'), '客户甲')
  assert.match(metrics.get('金额与数量口径'), /不重算历史汇率/)
  assert.equal(detail.rowCount, filtered.data.reports.length + 1)
  const empty = await api(`${path}&q=NO-MATCH-AT-ALL`)
  assert.equal(empty.data.summary.count, 0); assert.deepEqual(empty.data.dailyTrend, [])
  assert.equal((await api(`${path}&currency=EUR`)).response.status, 400)
  assert.equal((await api(`${path}&source=forged`)).response.status, 400)
  assert.equal((await api(`${path}&from=2026-01-01&from=2026-02-01`)).response.status, 400)
  assert.equal((await api('/api/daily-reports/analysis')).response.status, 400)
  assert.equal((await api(path, { bearer: '', scope: null })).response.status, 401)
  assert.equal((await api('/api/daily-reports/analysis/export.xlsx?type=sales', { scope: foreignScope })).response.status, 403)
  const formulaExport = await api('/api/daily-reports/analysis/export.xlsx?type=sales&q=%40cmd')
  const formulaBook = new ExcelJS.Workbook(); await formulaBook.xlsx.load(formulaExport.bytes)
  assert.equal(formulaBook.getWorksheet('日报明细').getRow(2).getCell(2).value, "'=SUM(1,2)")
  assert.equal(formulaBook.getWorksheet('日报明细').getRow(2).getCell(3).value, "'@cmd")
  const qRow = formulaBook.getWorksheet('摘要').getSheetValues().find(row => row && row[1] === '关键词')
  assert.equal(qRow[2], "'@cmd")


})
