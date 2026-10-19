import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import express from 'express'

const dir = mkdtempSync(join(tmpdir(), 'exact-nbhh-repair-'))
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_FILE: join(dir, 'test.sqlite'), APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(dir, 'key'), DATA_FILE: join(dir, 'missing.json'), LEGACY_DATA_FILE: join(dir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(dir, 'documents'), INTEGRATION_DATA_DIR: dir, FLOWABLE_BASE_URL: '', K3CLOUD_BASE_URL: '', DINGTALK_SSO_CLIENT_ID: '' })
const { db, setAppState, recordSecurityEvent } = await import('../dist/database.js')
const { createAuthRouter } = await import('../dist/auth.js')
const { createDailyReportingIsolationRepairRouter } = await import('../dist/daily-reporting-isolation-repair.js')
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v)
const hash = v => createHash('sha256').update(canonical(v)).digest('hex')
const key = (prefix, s) => `${prefix}:${s.tenantId}:${s.organizationId}:${s.accountId}`
let router, server, origin, adminToken, policy, source, target, clock = Date.now(), member, secondAdmin, ordinaryAdmin
let sourceState, targetState, businessState, sourceBusiness, sourceKey, targetKey, businessKey, sourceBusinessKey
const sessions = new Map(), password = 'Isolated-fixture-password-12345!'
const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/auth', createAuthRouter()); app.use('/api', (req, res, next) => router ? router(req, res, next) : next())
server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) }); origin = `http://127.0.0.1:${server.address().port}`
after(async () => { await new Promise(r => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }) })
async function api(path, body, token = adminToken, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders }, s = sessions.get(token)
  if (token) { headers.Authorization = `Bearer ${token}`; if (s) { headers['X-Tenant-ID'] = s.tenantId; headers['X-Organization-ID'] = s.organizationId; headers['X-Account-ID'] = s.accountId } }
  Object.assign(headers, extraHeaders)
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  return { status: response.status, data: await response.json() }
}
const endpoint = action => `/api/daily-reporting/isolation-repair/${action}`
function state(k) { const x = db.prepare('SELECT value,revision FROM app_state WHERE key=?').get(k); return { value: JSON.parse(x.value), revision: x.revision } }
function put(k, value, revision) { db.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at').run(k, JSON.stringify(value), new Date().toISOString(), revision) }
function payload() { return { scope: 'NBHH', count: policy.count, ids: [...policy.ids], idsHash: policy.idsSha256, rowsHash: policy.rowsSha256, expectedAdminRevision: state(targetKey).revision, expectedBusinessRevision: state(businessKey).revision } }
function mount() { router = createDailyReportingIsolationRepairRouter({ policy, now: () => clock }) }
async function switchTo(s) { const x = await api('/api/auth/switch-scope', { accountId: s.accountId }); assert.equal(x.status, 200, JSON.stringify(x.data)); sessions.set(adminToken, x.data.user) }
async function reset() {
  if (sessions.get(adminToken).accountId !== target.accountId) await switchTo(target)
  db.exec("DROP TRIGGER IF EXISTS repair_audit_fail")
  db.prepare("DELETE FROM app_state WHERE key LIKE 'daily-reporting-isolation-repair-journal:%'").run()
  put(sourceKey, sourceState, 297); put(targetKey, targetState, 4); put(businessKey, businessState, 1); put(sourceBusinessKey, sourceBusiness, 8)
  clock = Date.now(); mount()
}
async function preview() { const body = payload(), x = await api(endpoint('preview'), body); assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.candidateCount, 240); assert.ok(x.data.previewToken); return { body: { ...body, previewToken: x.data.previewToken }, data: x.data } }
async function committed() { const p = await preview(), x = await api(endpoint('commit'), p.body); assert.equal(x.status, 200, JSON.stringify(x.data)); return { ...x.data, previewBody: p.body } }
async function invited(email, role) {
  const i = await api('/api/auth/users', { displayName: email, email, role }); assert.equal(i.status, 201, JSON.stringify(i.data))
  const a = await api('/api/auth/activate', { token: i.data.activationToken, password }, ''); assert.equal(a.status, 200, JSON.stringify(a.data))
  const l = await api('/api/auth/mobile/login', { email, password, accountId: target.accountId }, ''); assert.equal(l.status, 200, JSON.stringify(l.data)); sessions.set(l.data.accessToken, l.data.user); return l.data
}
function preservedSource() { assert.deepEqual(state(sourceKey), { value: sourceState, revision: 297 }); assert.deepEqual(state(sourceBusinessKey), { value: sourceBusiness, revision: 8 }) }
function unchangedTarget() { assert.deepEqual(state(targetKey), { value: targetState, revision: 4 }); preservedSource() }
function auditCount() { return db.prepare('SELECT COUNT(*) AS n FROM security_events').get().n }
function journalCount() { return db.prepare("SELECT COUNT(*) AS n FROM app_state WHERE key LIKE 'daily-reporting-isolation-repair-journal:%'").get().n }

test('exact repair HTTP safety and durable scoped rollback', { concurrency: false }, async t => {
  const setup = await api('/api/auth/mobile/setup', { displayName: 'Isolated admin', email: 'repair-owner@example.test', password }, '')
  assert.equal(setup.status, 201, JSON.stringify(setup.data)); adminToken = setup.data.accessToken; sessions.set(adminToken, setup.data.user); source = setup.data.user
  const created = await api('/api/auth/tenants', { tenantName: 'Isolated NBHH', organizationName: 'Isolated NBHH org', accountName: 'Isolated NBHH' }); assert.equal(created.status, 201, JSON.stringify(created.data)); target = created.data.scope
  await switchTo(target)
  member = await invited('repair-member@example.test', 'member'); secondAdmin = await invited('repair-second@example.test', 'admin'); ordinaryAdmin = await invited('repair-ordinary-admin@example.test', 'admin')
  db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(secondAdmin.user.id) // Isolated fixture only; requests still use normal authenticated sessions.
  const rows = Array.from({ length: 240 }, (_, n) => ({ id: `candidate-${String(n).padStart(3, '0')}`, kind: n < 118 ? 'customer' : 'supplier', name: `Anonymous party ${n}`, aliases: [], active: true, k3Number: `K${n}`, legacyCompanyCode: 'FNS', legacyId: String(n), source: 'legacy-import', createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' }))
  policy = { target, source, count: 240, ids: rows.map(r => r.id).sort(), idsSha256: hash(rows.map(r => r.id).sort()), rowsSha256: hash(rows) }
  targetState = { masterDataConfigured: true, parties: rows, exchangeRates: [], assignments: [], partyMappings: [], legacyMemberships: Array.from({ length: 6 }, (_, n) => ({ id: `legacy-member-${n}`, status: 'member-unmapped', legacyCompanyCode: 'NBHH' })), importBatches: [{ id: 'existing-m08-first' }, { id: 'existing-m08-repeat' }], untouched: { note: 'preserve all unknown fields' } }
  sourceState = { ...structuredClone(targetState), exchangeRates: [{ id: 'existing-rate' }], assignments: [{ id: 'existing-assignment' }], partyMappings: [{ id: 'existing-mapping' }], legacyMemberships: [{ id: 'source-member' }] }
  businessState = { reports: [], k3Rows: [], k3HistoricalHeaders: [], links: [], snapshots: [], corrections: [], deliveries: [], mockSnapshotAt: null, mockEnabled: false, k3Sync: null, untouched: { source: 'NBHH preserved' } }
  sourceBusiness = { reports: [{ id: 'source-report' }], k3Rows: [{ id: 'source-line' }], historicalDigest: 'unchanged' }
  sourceKey = key('daily-reporting-admin', source); targetKey = key('daily-reporting-admin', target); businessKey = key('daily-reporting', target); sourceBusinessKey = key('daily-reporting', source)
  recordSecurityEvent({ userId: setup.data.user.id, event: 'existing_audit_to_preserve', subject: 'existing record' })

  await t.test('successful exact removal preserves all FNS, other NBHH state, users/memberships and existing audit; clean preview and durable rollback', async () => {
    await reset(); const users = db.prepare('SELECT * FROM users ORDER BY id').all(), memberships = db.prepare('SELECT * FROM tenant_memberships ORDER BY id').all(), audits = auditCount()
    const c = await committed(); assert.equal(c.removedCount, 240); assert.equal(c.idsHash, policy.idsSha256); assert.equal(c.rowsHash, policy.rowsSha256)
    assert.deepEqual(state(targetKey), { value: { ...targetState, parties: [], masterDataConfigured: false }, revision: 5 }); assert.deepEqual(state(businessKey), { value: businessState, revision: 1 }); preservedSource()
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), users); assert.deepEqual(db.prepare('SELECT * FROM tenant_memberships ORDER BY id').all(), memberships); assert.equal(auditCount(), audits + 1); assert.equal(journalCount(), 1)
    const clean = await api(endpoint('preview'), payload()); assert.equal(clean.status, 200); assert.equal(clean.data.candidateCount, 0); assert.equal(clean.data.alreadyRepaired, true); assert.equal(clean.data.previewToken, undefined)
    assert.equal((await api(endpoint('commit'), c.previewBody)).status, 409)
    mount() // New router instance: preview memory lost, persisted rollback remains valid.
    const r = await api(endpoint('rollback'), { rollbackToken: c.rollbackToken }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual(state(targetKey), { value: targetState, revision: 6 }); preservedSource(); assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken })).status, 409)
  })
  await t.test('audit insertion failure atomically rolls back deletion and journal; failed preview cannot be replayed', async () => {
    await reset(); const p = await preview(), n = auditCount(); db.exec("CREATE TRIGGER repair_audit_fail BEFORE INSERT ON security_events WHEN NEW.event='daily_reporting_isolation_repair_commit' BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END")
    assert.equal((await api(endpoint('commit'), p.body)).status, 409); unchangedTarget(); assert.equal(journalCount(), 0); assert.equal(auditCount(), n); db.exec('DROP TRIGGER repair_audit_fail'); assert.equal((await api(endpoint('commit'), p.body)).status, 409)
  })
  await t.test('unauthenticated, wrong headers, member and non-platform admin are rejected', async () => {
    await reset(); const b = payload(); assert.equal((await api(endpoint('preview'), b, '')).status, 401); assert.equal((await api(endpoint('preview'), b, adminToken, { 'X-Account-ID': source.accountId })).status, 403)
    assert.equal((await api(endpoint('preview'), b, member.accessToken)).status, 403); assert.equal((await api(endpoint('preview'), b, ordinaryAdmin.accessToken)).status, 403); unchangedTarget()
  })
  await t.test('wrong actual scope cannot preview or commit and never writes FNS', async () => {
    await reset(); const p = await preview(); await switchTo(source); assert.equal((await api(endpoint('preview'), p.body)).status, 409); assert.equal((await api(endpoint('commit'), p.body)).status, 409); unchangedTarget(); await switchTo(target)
  })
  for (const [name, change] of [ ['scope label', b => b.scope = 'FNS'], ['count', b => b.count--], ['wrong IDs', b => b.ids[0] = 'not-approved'], ['duplicate IDs', b => b.ids[0] = b.ids[1]], ['IDs hash', b => b.idsHash = '0'.repeat(64)], ['rows hash', b => b.rowsHash = '0'.repeat(64)], ['expected revision', b => b.expectedAdminRevision++] ]) {
    await t.test(`rejects ${name}`, async () => { await reset(); const b = payload(); change(b); assert.equal((await api(endpoint('preview'), b)).status, 409); unchangedTarget() })
  }
  await t.test('additional NBHH row cannot be deleted outside the approved set', async () => {
    await reset(); const v = structuredClone(targetState); v.parties.push({ ...v.parties[0], id: 'unapproved-NBHH-party' }); put(targetKey, v, 4); assert.equal((await api(endpoint('preview'), payload())).status, 409); assert.deepEqual(state(targetKey).value, v); preservedSource()
  })
  await t.test('expired preview is rejected', async () => { await reset(); const p = await preview(); clock += 300001; assert.equal((await api(endpoint('commit'), p.body)).status, 409); unchangedTarget() })
  await t.test('another privileged actor cannot use preview and failed attempt consumes it', async () => { await reset(); const p = await preview(); assert.equal((await api(endpoint('commit'), p.body, secondAdmin.accessToken)).status, 409); assert.equal((await api(endpoint('commit'), p.body)).status, 409); unchangedTarget() })
  await t.test('same actor different normal session cannot use preview', async () => {
    await reset(); const p = await preview(), login = await api('/api/auth/mobile/login', { email: 'repair-owner@example.test', password, accountId: target.accountId }, ''); assert.equal(login.status, 200); sessions.set(login.data.accessToken, login.data.user)
    assert.equal((await api(endpoint('commit'), p.body, login.data.accessToken)).status, 409); unchangedTarget()
  })
  for (const [name, mutate] of [
    ['target revision change', () => put(targetKey, targetState, 5)],
    ['source revision change', () => put(sourceKey, sourceState, 298)],
    ['business revision change', () => put(businessKey, businessState, 2)],
    ['source row change', () => { const v = structuredClone(sourceState); v.parties[0].name = 'changed'; put(sourceKey, v, 297) }],
    ['target row change', () => { const v = structuredClone(targetState); v.parties[0].name = 'changed'; put(targetKey, v, 4) }],
    ['unknown-field logical reference', () => { const v = structuredClone(targetState); v.untouched.nested = { anyField: [policy.ids[0]] }; put(targetKey, v, 4) }],
    ['new assignment', () => { const v = structuredClone(targetState); v.assignments.push({ partyId: policy.ids[0] }); put(targetKey, v, 4) }],
    ['business row/reference', () => { const v = structuredClone(businessState); v.reports.push({ partyId: policy.ids[0] }); put(businessKey, v, 1) }],
    ['other target field change without revision', () => { const v = structuredClone(targetState); v.legacyMemberships[0].note = 'new'; put(targetKey, v, 4) }],
  ]) {
    await t.test(`commit aborts on ${name}`, async () => { await reset(); const p = await preview(); mutate(); const before = state(targetKey); assert.equal((await api(endpoint('commit'), p.body)).status, 409); assert.deepEqual(state(targetKey), before); assert.equal(journalCount(), 0) })
  }
  await t.test('commit wrong manifest consumes preview without deletion', async () => { await reset(); const p = await preview(); assert.equal((await api(endpoint('commit'), { ...p.body, rowsHash: 'bad' })).status, 409); unchangedTarget(); assert.equal((await api(endpoint('commit'), p.body)).status, 409) })
  for (const [name, mutate] of [ ['target change', () => put(targetKey, { ...targetState, parties: [], masterDataConfigured: false, changed: true }, 6)], ['source change', () => put(sourceKey, sourceState, 298)], ['business change', () => put(businessKey, businessState, 2)], ['expiry', () => clock += 1800001] ]) {
    await t.test(`rollback rejects ${name}`, async () => { await reset(); const c = await committed(); mutate(); const before = state(targetKey); assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken })).status, 409); assert.deepEqual(state(targetKey), before) })
  }
  await t.test('rollback rejects other actor/scope and malformed token', async () => {
    await reset(); const c = await committed(); assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken }, secondAdmin.accessToken)).status, 409); assert.equal((await api(endpoint('rollback'), { rollbackToken: 'wrong' })).status, 409)
    await switchTo(source); assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken })).status, 409); await switchTo(target); assert.equal(state(targetKey).value.parties.length, 0); preservedSource()
  })
  await t.test('rollback audit failure atomically preserves clean state and pending recovery journal', async () => {
    await reset(); const c = await committed(), n = auditCount(); db.exec("CREATE TRIGGER repair_audit_fail BEFORE INSERT ON security_events WHEN NEW.event='daily_reporting_isolation_repair_rollback' BEGIN SELECT RAISE(ABORT,'isolated rollback audit failure'); END")
    assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken })).status, 409); assert.equal(state(targetKey).revision, 5); assert.equal(state(targetKey).value.parties.length, 0); assert.equal(auditCount(), n)
    db.exec('DROP TRIGGER repair_audit_fail'); assert.equal((await api(endpoint('rollback'), { rollbackToken: c.rollbackToken })).status, 200); assert.deepEqual(state(targetKey).value, targetState); preservedSource()
  })
})
