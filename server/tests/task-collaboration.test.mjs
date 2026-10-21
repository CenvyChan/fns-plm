import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir, dbFile, child, origin, adminToken, ownerToken, otherToken, foreignToken
const scopes = new Map()

async function waitReady() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${child.stderrText}`)
    try { const r = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); if (r.ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`server not ready: ${child.stderrText}`)
}
async function api(path, { method = 'GET', body, token = adminToken, headers = {}, scope = true } = {}) {
  const h = { ...headers }
  const s = scope && token ? scopes.get(token) : null
  if (token) h.Authorization = `Bearer ${token}`
  if (s) { h['X-Tenant-ID'] = s.tenantId; h['X-Organization-ID'] = s.organizationId; h['X-Account-ID'] = s.accountId }
  const form = body instanceof FormData
  if (body !== undefined && !form) h['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers: h, body: body === undefined ? undefined : form ? body : JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
  const text = await response.text(); let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}
async function login(email, password) {
  const r = await api('/api/auth/mobile/login', { method: 'POST', token: '', body: { email, password } })
  assert.equal(r.response.status, 200, JSON.stringify(r.data)); scopes.set(r.data.accessToken, r.data.user); return r.data.accessToken
}
async function createUser(name, email, role, password) {
  const r = await api('/api/auth/users', { method: 'POST', body: { displayName: name, email, role } })
  assert.equal(r.response.status, 201, JSON.stringify(r.data))
  const a = await api('/api/auth/activate', { method: 'POST', token: '', body: { token: r.data.activationToken, password } })
  assert.equal(a.response.status, 200, JSON.stringify(a.data))
  return login(email, password)
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'task-collaboration-'))
  dbFile = join(tempDir, 'test.sqlite')
  const net = await import('node:net'); const s = net.createServer()
  const port = await new Promise((resolve, reject) => s.listen(0, '127.0.0.1', () => resolve(s.address().port)).once('error', reject))
  await new Promise(resolve => s.close(resolve)); origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, NODE_ENV: 'test', TASK_SWEEP_INTERVAL_MS: '50', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: dbFile,
    APP_ENCRYPTION_KEY: '7f'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'key'), DATA_FILE: join(tempDir, 'none.json'), LEGACY_DATA_FILE: join(tempDir, 'none-legacy.json'),
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), TASK_ATTACHMENT_STORAGE_DIR: join(tempDir, 'task-attachments'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', FLOWABLE_USER_MAP_JSON: '{}', FLOWABLE_GROUP_MAP_JSON: '{}',
    K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderrText = ''
  child.stderr.on('data', x => { child.stderrText += x.toString() }); await waitReady()
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', token: '', body: { displayName: 'Collab Admin', email: 'collab-admin@example.test', password: 'admin-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data)); adminToken = setup.data.accessToken; scopes.set(adminToken, setup.data.user)
  ownerToken = await createUser('Task Owner', 'task-owner@example.test', 'member', 'owner-password-12345')
  otherToken = await createUser('Other User', 'task-other@example.test', 'member', 'other-password-12345')
  const tenant = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: 'Other Tenant', organizationName: 'Other Org', accountName: 'Other Account' } })
  assert.equal(tenant.response.status, 201, JSON.stringify(tenant.data))
  const switched = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: tenant.data.scope.accountId } })
  assert.equal(switched.response.status, 200, JSON.stringify(switched.data)); scopes.set(adminToken, switched.data.user)
  foreignToken = await createUser('Foreign User', 'task-foreign@example.test', 'member', 'foreign-password-12345')
  const back = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: setup.data.user.accountId } })
  assert.equal(back.response.status, 200, JSON.stringify(back.data)); scopes.set(adminToken, back.data.user)
})
after(async () => {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 4000))]); if (child.exitCode === null) child.kill('SIGKILL') }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

const ownerId = () => scopes.get(ownerToken).id
const adminId = () => scopes.get(adminToken).id
const otherId = () => scopes.get(otherToken).id
const assignment = (extra = {}) => ({ title: '指派任务', dueDate: '2026-12-31', collaborationMode: 'assignment', assigneeId: ownerId(), receiverId: adminId(), recurrence: 'none', ...extra })
const reportForm = (content = '已完成本期工作', attachments = []) => {
  const form = new FormData(); form.set('content', content); form.set('progress', '100')
  for (const [name, data] of attachments) form.append('attachments', new Blob([data]), name)
  return form
}
function stored(update) {
  const db = new Database(dbFile), scope = scopes.get(adminToken)
  const key = `workspace:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
  try {
    const row = db.prepare('SELECT value FROM app_state WHERE key=?').get(key), value = JSON.parse(row.value)
    if (update) { update(value); db.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(value), key) }
    return value
  } finally { db.close() }
}
function fileCount() {
  const root = join(tempDir, 'task-attachments')
  try { return readdirSync(root, { recursive: true }).filter(path => statSync(join(root, path)).isFile()).length } catch { return 0 }
}

test('same-account members, role-bound handoff, report history and authorized attachment download', async () => {
  const members = await api('/api/task-members')
  assert.equal(members.response.status, 200); assert.ok(members.data.members.some(m => m.id === ownerId()))
  assert.ok(!members.data.members.some(m => m.id === scopes.get(foreignToken).id))
  const invalidMember = await api('/api/tasks', { method: 'POST', body: assignment({ assigneeId: scopes.get(foreignToken).id }) })
  assert.equal(invalidMember.response.status, 400)
  const created = await api('/api/tasks', { method: 'POST', body: assignment() })
  assert.equal(created.response.status, 201, JSON.stringify(created.data)); const task = created.data
  assert.equal(task.creatorId, adminId()); assert.equal(task.acceptanceStatus, 'pending')
  assert.equal(Date.parse(task.acceptBy) - Date.parse(task.createdAt), 7200000)
  for (const patch of [{ status: 'done' }, { progress: 100 }, { assigneeId: otherId() }, { receiverId: otherId() }, { acceptanceStatus: 'accepted' }, { reports: [] }]) {
    assert.equal((await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: patch })).response.status, 400)
  }
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'PATCH', token: ownerToken, body: { title: '越权修改' } })).response.status, 403)
  assert.equal((await api(`/api/tasks/${task.id}`, { method: 'DELETE', token: ownerToken })).response.status, 403)
  assert.equal((await api(`/api/tasks/${task.id}/accept`, { method: 'POST', body: { committedDueDate: '2026-12-30' } })).response.status, 403)
  assert.equal((await api(`/api/tasks/${task.id}/commit-deadline`, { method: 'POST', token: ownerToken, body: { committedDueDate: '2026-12-30' } })).response.status, 409)
  for (const committedDueDate of [undefined, '', '2026-02-30', 'invalid']) {
    assert.equal((await api(`/api/tasks/${task.id}/accept`, { method: 'POST', token: ownerToken, body: { committedDueDate } })).response.status, 400)
  }
  const accepted = await api(`/api/tasks/${task.id}/accept`, { method: 'POST', token: ownerToken, body: { committedDueDate: '2026-12-30' } })
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data)); assert.equal(accepted.data.acceptanceStatus, 'accepted')
  const filesBefore = fileCount()
  const denied = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: otherToken, body: reportForm('越权附件', [['bad.txt', 'bad']]) })
  assert.equal(denied.response.status, 403); assert.equal(fileCount(), filesBefore)
  const submitted = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm('第一版汇报', [['验收依据.txt', 'proof-bytes']]) })
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data))
  const firstReport = submitted.data.reports[0], attachment = firstReport.attachments[0]
  assert.equal(attachment.name, '验收依据.txt'); assert.equal(attachment.path, undefined); assert.equal(fileCount(), filesBefore + 1)
  const download = `/api/tasks/${task.id}/reports/${firstReport.id}/attachments/${attachment.id}`
  assert.equal((await api(download, { token: ownerToken })).data, 'proof-bytes')
  assert.equal((await api(download)).response.status, 200)
  assert.equal((await api(download, { token: otherToken })).response.status, 403)
  assert.equal((await api(download, { token: foreignToken })).response.status, 404)
  assert.equal((await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm() })).response.status, 409)
  assert.equal((await api(`/api/tasks/${task.id}/review`, { method: 'POST', token: ownerToken, body: { decision: 'approve' } })).response.status, 403)
  const returned = await api(`/api/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'return', comment: '补充验收依据' } })
  assert.equal(returned.response.status, 200); assert.equal(returned.data.reports[0].review.comment, '补充验收依据')
  const revised = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm('已补充依据') })
  assert.equal(revised.response.status, 201); assert.equal(revised.data.reports.length, 2)
  const approved = await api(`/api/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'approve', comment: '确认完成' } })
  assert.equal(approved.response.status, 200); assert.equal(approved.data.status, 'done')
  assert.equal(approved.data.reports[0].review.decision, 'return'); assert.equal(approved.data.reports[1].review.decision, 'approve')
  assert.equal((await api(`/api/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'approve' } })).response.status, 409)
  const workspace = await api('/api/workspace'); assert.equal(workspace.response.status, 200, JSON.stringify(workspace.data))
  assert.equal(workspace.data.tasks.find(t => t.id === task.id).reports[0].attachments[0].path, undefined)
  // A legacy internal path is stripped from both list and edit responses as well.
  stored(w => { w.tasks.find(t => t.id === task.id).reports[0].attachments[0].path = '/private/legacy' })
  assert.ok(!JSON.stringify((await api('/api/tasks')).data).includes('/private/legacy'))
  assert.ok(!JSON.stringify((await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { title: '确认后的标题' } })).data).includes('/private/legacy'))
})

test('self-initiated weekly reports, idempotent next period, attachment validation and legacy progress', async () => {
  const created = await api('/api/tasks', { method: 'POST', token: ownerToken, body: { title: '主动周报', dueDate: '2026-12-31', collaborationMode: 'report', assigneeId: ownerId(), receiverId: adminId(), recurrence: 'weekly' } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data)); const task = created.data
  assert.equal(task.acceptanceStatus, 'accepted'); assert.equal(task.committedDueDate, '2026-12-31')
  const beforeFiles = fileCount()
  const tooMany = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm('超出附件数量', Array.from({ length: 6 }, (_, i) => [`${i}.txt`, 'x'])) })
  assert.equal(tooMany.response.status, 400)
  const tooLarge = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm('超出附件大小', [['large.bin', new Uint8Array(10 * 1024 * 1024 + 1)]]) })
  assert.equal(tooLarge.response.status, 413)
  const invalid = reportForm('', [['invalid.txt', 'invalid']])
  assert.equal((await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: invalid })).response.status, 400)
  assert.equal(fileCount(), beforeFiles)
  // Inject a failure after file creation but before metadata commit: uploaded binaries must be removed.
  const failingDb = new Database(dbFile)
  try {
    failingDb.exec(`CREATE TRIGGER fail_test_report BEFORE UPDATE ON app_state WHEN instr(NEW.value,'rollback-proof') > 0 BEGIN SELECT RAISE(ABORT,'test metadata failure'); END`)
    const failed = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm('rollback-proof', [['rollback.txt', 'cleanup-required']]) })
    assert.equal(failed.response.status, 500)
    assert.equal(fileCount(), beforeFiles)
    assert.equal(stored().tasks.find(t => t.id === task.id).reports.length, 0)
  } finally { failingDb.exec('DROP TRIGGER IF EXISTS fail_test_report'); failingDb.close() }
  const submitted = await api(`/api/tasks/${task.id}/reports`, { method: 'POST', token: ownerToken, body: reportForm() })
  assert.equal(submitted.response.status, 201)
  const approved = await api(`/api/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'approve' } })
  assert.equal(approved.response.status, 200)
  const periods = (await api('/api/workspace')).data.tasks.filter(t => t.seriesId === task.id)
  assert.equal(periods.length, 2); assert.ok(periods.some(t => t.dueDate === '2027-01-07' && t.reports.length === 0))
  assert.equal((await api(`/api/tasks/${task.id}/review`, { method: 'POST', body: { decision: 'approve' } })).response.status, 409)
  assert.equal((await api('/api/workspace')).data.tasks.filter(t => t.seriesId === task.id).length, 2)
  const legacy = await api('/api/tasks', { method: 'POST', body: { title: '个人任务', dueDate: '2026-12-31' } })
  const progress = await api(`/api/tasks/${legacy.data.id}`, { method: 'PATCH', body: { progress: 35 } })
  assert.equal(progress.response.status, 200); assert.equal(progress.data.progress, 35)
})

test('background acceptance persists without any workspace/task GET and still requires owner deadline', async () => {
  const created = await api('/api/tasks', { method: 'POST', body: assignment({ title: '后台自动接收' }) })
  assert.equal(created.response.status, 201); const id = created.data.id
  stored(w => { w.tasks.find(t => t.id === id).acceptBy = new Date(Date.now() + 10000).toISOString() })
  await new Promise(r => setTimeout(r, 120)); assert.equal(stored().tasks.find(t => t.id === id).acceptanceStatus, 'pending')
  stored(w => { w.tasks.find(t => t.id === id).acceptBy = new Date(Date.now() - 100).toISOString() })
  const until = Date.now() + 3000
  while (Date.now() < until && stored().tasks.find(t => t.id === id).acceptanceStatus !== 'auto-accepted') await new Promise(r => setTimeout(r, 25))
  assert.equal(stored().tasks.find(t => t.id === id).acceptanceStatus, 'auto-accepted')
  assert.equal(stored().tasks.find(t => t.id === id).committedDueDate, undefined)
  assert.equal((await api(`/api/tasks/${id}/reports`, { method: 'POST', token: ownerToken, body: reportForm() })).response.status, 409)
  assert.equal((await api(`/api/tasks/${id}/commit-deadline`, { method: 'POST', token: ownerToken, body: { committedDueDate: '2026-02-30' } })).response.status, 400)
  assert.equal((await api(`/api/tasks/${id}/commit-deadline`, { method: 'POST', token: ownerToken, body: { committedDueDate: '2026-12-29' } })).response.status, 200)
})

test('two-hour exact boundary and fixed calendar recurrence retain month-end anchors without approval', async () => {
  const { nextRecurringDate, sweepTaskWorkspace } = await import('../dist/task-collaboration.js')
  assert.equal(nextRecurringDate('2026-01-31', 'monthly', 31), '2026-02-28')
  assert.equal(nextRecurringDate('2026-02-28', 'monthly', 31), '2026-03-31')
  assert.equal(nextRecurringDate('2026-03-31', 'monthly', 31), '2026-04-30')
  assert.equal(nextRecurringDate('2026-01-01', 'daily'), '2026-01-02')
  assert.equal(nextRecurringDate('2026-01-04', 'weekly'), '2026-01-11')
  const now = Date.parse('2026-01-31T04:00:00Z'), boundary = now + 7200000
  const task = { id: 'boundary-task', title: '月末例行汇报', dueDate: '2026-01-31', scheduledDueDate: '2026-01-31', priority: 'medium', status: 'todo', collaborationMode: 'assignment', acceptanceStatus: 'pending', acceptBy: new Date(boundary).toISOString(), recurrence: 'monthly', seriesId: 'boundary-task', recurrenceAnchorDay: 31, reports: [] }
  const workspace = { tasks: [task] }
  assert.equal(sweepTaskWorkspace(workspace, boundary - 1), false)
  assert.equal(sweepTaskWorkspace(workspace, boundary), true); assert.equal(task.acceptanceStatus, 'auto-accepted')
  assert.equal(sweepTaskWorkspace(workspace, Date.parse('2026-02-28T04:00:00Z')), true)
  assert.equal(workspace.tasks.length, 2); assert.equal(workspace.tasks[0].dueDate, '2026-02-28')
  sweepTaskWorkspace(workspace, Date.parse('2026-03-31T04:00:00Z'))
  assert.equal(workspace.tasks[0].dueDate, '2026-03-31'); assert.equal(workspace.tasks.length, 3)
  sweepTaskWorkspace(workspace, Date.parse('2026-03-31T04:00:00Z'))
  assert.equal(workspace.tasks.length, 3)
})
