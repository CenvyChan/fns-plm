import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir, child, origin, database, admin, home, sibling, otherOrg, otherTenant, manager
const password = 'isolated-test-password-123'
async function api(path, { method = 'GET', body, session = admin, scope = session?.user } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const isFormData = body instanceof FormData
  if (isFormData) delete headers['Content-Type']
  if (session) {
    headers.Authorization = `Bearer ${session.accessToken}`
    headers['X-Tenant-ID'] = scope.tenantId
    headers['X-Organization-ID'] = scope.organizationId
    headers['X-Account-ID'] = scope.accountId
  }
  const response = await fetch(`${origin}/api${path}`, { method, headers, body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
  return { status: response.status, data: await response.json().catch(() => null) }
}
async function switchTo(scope) {
  const result = await api('/auth/switch-scope', { method: 'POST', body: { accountId: scope.accountId } })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  admin.user = result.data.user
}
function stateKey(scope) { return `workspace:${scope.tenantId}:${scope.organizationId}:${scope.accountId}` }
before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'plm-tenant-performance-'))
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  origin = `http://127.0.0.1:${port}`
  // Explicitly isolated DB and blank real-business connectors; never inherit connector credentials.
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: join(tempDir, 'test.sqlite'), APP_ENCRYPTION_KEY: '8f'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'key'), DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir, REDIS_URL: '', CORS_ORIGIN: '' }
  for (const key of Object.keys(env)) if (/^(FLOWABLE_|K3CLOUD_|DINGTALK_|CONNECTOR_DEFAULT_)/.test(key)) env[key] = ''
  for (const key of ['FLOWABLE_BASE_URL', 'K3CLOUD_BASE_URL', 'DINGTALK_WEBHOOK_URL', 'DINGTALK_ROBOT_WEBHOOK']) env[key] = ''
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk })
  let healthy = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`API exited: ${stderr}`)
    try { if ((await fetch(`${origin}/api/health`)).ok) { healthy = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(healthy, stderr)
  const setup = await api('/auth/mobile/setup', { method: 'POST', session: null, body: { displayName: 'Local QA', email: 'local-qa@example.test', password } })
  assert.equal(setup.status, 201)
  admin = setup.data; home = admin.user
  const account = await api('/auth/accounts', { method: 'POST', body: { accountName: 'Sibling account' } })
  assert.equal(account.status, 201, JSON.stringify(account.data))
  sibling = { ...home, accountId: account.data.account.id }
  const organization = await api('/auth/organizations', { method: 'POST', body: { organizationName: 'Sibling organization', accountName: 'Organization account' } })
  assert.equal(organization.status, 201)
  otherOrg = { ...home, organizationId: organization.data.organization.id, accountId: organization.data.account.id }
  const tenant = await api('/auth/tenants', { method: 'POST', body: { tenantName: 'Other tenant', organizationName: 'Other org', accountName: 'Other account' } })
  assert.equal(tenant.status, 201)
  otherTenant = tenant.data.scope
  database = new Database(join(tempDir, 'test.sqlite'))
  const workspace = JSON.parse(database.prepare('SELECT value FROM app_state WHERE key=?').get(stateKey(home)).value)
  workspace.tasks = Array.from({ length: 10_000 }, (_, i) => ({ id: `load-${i}`, title: i % 100 === 0 ? `Needle ${i}` : `Task ${i}`, dueDate: '2026-12-31', status: 'todo', priority: 'medium', createdAt: '2026-10-21T00:00:00Z' }))
  database.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify(workspace), stateKey(home))
  const created = await api('/auth/users', { method: 'POST', body: { displayName: 'Scoped manager', email: 'manager@example.test', role: 'plm_manager' } })
  assert.equal(created.status, 201)
  assert.equal((await api('/auth/activate', { method: 'POST', session: null, body: { token: created.data.activationToken, password } })).status, 200)
  const login = await api('/auth/mobile/login', { method: 'POST', session: null, body: { email: 'manager@example.test', password, accountId: home.accountId } })
  assert.equal(login.status, 200)
  manager = login.data
})
after(async () => {
  database?.close()
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 4000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

test('legacy arrays remain compatible; explicit pagination bounds the response', async () => {
  const legacy = await api('/tasks')
  assert.ok(Array.isArray(legacy.data)); assert.equal(legacy.data.length, 10_000)
  const page = await api('/tasks?page=2&pageSize=25')
  assert.equal(page.status, 200); assert.equal(page.data.total, 10_000)
  assert.equal(page.data.items.length, 25); assert.equal(page.data.items[0].id, 'load-25')
  assert.equal(page.data.page, 2); assert.equal(page.data.pageSize, 25); assert.equal(page.data.totalPages, 400)
})
test('search is case-insensitive, filtered before pagination, and returns exact totals', async () => {
  const result = await api('/tasks?q=NEEDLE&page=2&pageSize=10')
  assert.equal(result.status, 200); assert.equal(result.data.total, 100)
  assert.equal(result.data.items.length, 10); assert.equal(result.data.items[0].id, 'load-1000')
  const empty = await api('/tasks?q=not-present')
  assert.deepEqual(empty.data.items, []); assert.equal(empty.data.total, 0)
  assert.equal((await api('/tasks?page=9999&pageSize=50')).data.items.length, 0)
})
test('malformed, repeated, nested and excessive list input is rejected', async () => {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1e2', 'pageSize=201', 'pageSize=0', 'page=', 'page=1&page=2', 'q[a]=x', 'q=a&q=b', `q=${'a'.repeat(201)}`, 'page=9007199254740991&pageSize=200']) {
    assert.equal((await api(`/tasks?${query}`)).status, 400, query)
  }
})
test('all common workspace list endpoints support the same opt-in contract', async () => {
  for (const path of ['projects', 'materials', 'boms', 'documents', 'reviews', 'kpi-rules', 'sales-bom-snapshots', 'project-phases', 'project-milestones', 'project-events', 'project-reports', 'project-templates', 'project-event-reviews', 'project-template-library']) {
    const result = await api(`/${path}?page=1&pageSize=5`)
    assert.equal(result.status, 200, path); assert.ok(Array.isArray(result.data.items), path)
    assert.ok(result.data.items.length <= 5, path); assert.equal(typeof result.data.total, 'number', path)
  }
})
test('tenant, organization and sibling-account searches cannot leak home data', async () => {
  try {
    for (const scope of [sibling, otherOrg, otherTenant]) {
      await switchTo(scope)
      const found = await api('/tasks?q=Needle&pageSize=20')
      assert.equal(found.status, 200); assert.equal(found.data.total, 0)
      assert.equal((await api('/tasks/load-0', { method: 'PATCH', body: { title: 'cross-scope' } })).status, 404)
      assert.equal((await api('/tasks?page=1', { scope: home })).status, 403)
    }
  } finally { await switchTo(home) }
})
test('an explicitly unauthorized login account is denied rather than silently replaced', async () => {
  const before = database.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
  const result = await api('/auth/mobile/login', { method: 'POST', session: null, body: { email: 'manager@example.test', password, accountId: sibling.accountId } })
  assert.equal(result.status, 403); assert.equal(result.data.error, 'scope_not_allowed')
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, before, 'denial must not issue a session')
  const event = database.prepare("SELECT * FROM security_events WHERE event='login_denied_scope_mismatch' ORDER BY id DESC LIMIT 1").get()
  assert.equal(event.user_id, manager.user.id); assert.equal(event.subject, sibling.accountId)
})
test('a role downgrade takes effect on the next request with the existing token', async () => {
  assert.equal((await api('/materials', { method: 'POST', session: manager, body: { id: 'manager-material', partNo: 'QA-001', name: 'QA material', unit: 'pcs', lifecycle: 'draft' } })).status, 201)
  assert.equal((await api(`/auth/users/${manager.user.id}`, { method: 'PATCH', body: { role: 'member' } })).status, 200)
  assert.equal((await api('/materials/manager-material', { method: 'PATCH', session: manager, body: { name: 'not allowed' } })).status, 403)
  assert.equal((await api('/tasks?page=1', { session: manager })).status, 200)
})
test('membership, activation-reset and scope creation roll back when mandatory audit fails', async () => {
  const pending = await api('/auth/users', { method: 'POST', body: { displayName: 'Pending activation', email: 'pending@example.test', role: 'member' } })
  assert.equal(pending.status, 201)
  const snapshot = () => JSON.stringify(Object.fromEntries(['users', 'tenant_memberships', 'sessions', 'password_activation_tokens', 'tenants', 'organizations', 'accounts'].map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
  const cases = [
    ['account_membership_updated', `/auth/users/${manager.user.id}`, 'PATCH', { role: 'plm_manager', disabled: true }],
    ['account_membership_created', '/auth/users', 'POST', { displayName: 'Rollback user', email: 'rollback@example.test', role: 'member' }],
    ['password_activation_link_reset', `/auth/users/${manager.user.id}/activation`, 'POST', {}],
    ['tenant_created', '/auth/tenants', 'POST', { tenantName: 'Rollback tenant', organizationName: 'Rollback org', accountName: 'Rollback account' }],
    ['organization_account_created', '/auth/organizations', 'POST', { organizationName: 'Rollback org', accountName: 'Rollback account' }],
    ['account_created', '/auth/accounts', 'POST', { accountName: 'Rollback account' }],
    ['workspace_scope_switched', '/auth/switch-scope', 'POST', { accountId: sibling.accountId }],
    ['password_activated', '/auth/activate', 'POST', { token: pending.data.activationToken, password }],
  ]
  for (const [event, path, method, body] of cases) {
    const before = snapshot()
    database.exec(`CREATE TRIGGER qa_reject_auth_audit BEFORE INSERT ON security_events WHEN NEW.event='${event}' BEGIN SELECT RAISE(ABORT, 'qa-audit-rejected'); END`)
    try {
      assert.equal((await api(path, { method, body })).status, 500, event)
      assert.equal(snapshot(), before, `${event}: all business rows and sessions must roll back`)
    } finally { database.exec('DROP TRIGGER qa_reject_auth_audit') }
  }
  assert.equal((await api('/tasks?page=1', { session: manager })).status, 200, 'failed disable/reset must preserve existing session')
  assert.equal((await api('/auth/activate', { method: 'POST', session: null, body: { token: pending.data.activationToken, password } })).status, 200, 'failed audited activation must leave the one-time token reusable')
})
test('membership and scope audit records contain correct actor and affected workspace', () => {
  const changed = database.prepare("SELECT * FROM security_events WHERE event='account_membership_updated' ORDER BY id DESC LIMIT 1").get()
  assert.equal(changed.user_id, home.id); assert.equal(changed.subject, 'manager@example.test')
  assert.equal(changed.tenant_id, home.tenantId); assert.equal(changed.organization_id, home.organizationId); assert.equal(changed.account_id, home.accountId)
  const tenant = database.prepare("SELECT * FROM security_events WHERE event='tenant_created' ORDER BY id DESC LIMIT 1").get()
  assert.equal(tenant.user_id, home.id); assert.equal(tenant.tenant_id, otherTenant.tenantId); assert.equal(tenant.organization_id, otherTenant.organizationId); assert.equal(tenant.account_id, otherTenant.accountId)
})
test('membership disable invalidates this account without logging out unrelated accounts', async () => {
  await switchTo(sibling)
  const invited = await api('/auth/users', { method: 'POST', body: { displayName: 'Scoped manager', email: 'manager@example.test', role: 'member' } })
  assert.equal(invited.status, 201)
  await switchTo(home)
  const otherLogin = await api('/auth/mobile/login', { method: 'POST', session: null, body: { email: 'manager@example.test', password, accountId: sibling.accountId } })
  assert.equal(otherLogin.status, 200)
  assert.equal((await api(`/auth/users/${manager.user.id}`, { method: 'PATCH', body: { disabled: true } })).status, 200)
  assert.equal((await api('/tasks?page=1', { session: manager })).status, 401)
  assert.equal((await api('/tasks?page=1', { session: otherLogin.data })).status, 200)
})
test('tenant, organization and account status changes reject existing sessions immediately', async () => {
  for (const [table, id] of [['tenants', home.tenantId], ['organizations', home.organizationId], ['accounts', home.accountId]]) {
    try {
      database.prepare(`UPDATE ${table} SET status='disabled' WHERE id=?`).run(id)
      assert.equal((await api('/tasks?page=1')).status, 401, table)
    } finally { database.prepare(`UPDATE ${table} SET status='active' WHERE id=?`).run(id) }
  }
})
test('global user disable and membership disable deny the next request without a server restart', async () => {
  for (const [table, column, id] of [['users', 'id', home.id], ['tenant_memberships', 'id', home.membershipId]]) {
    try {
      database.prepare(`UPDATE ${table} SET disabled=1 WHERE ${column}=?`).run(id)
      assert.equal((await api('/tasks?page=1')).status, 401, table)
    } finally { database.prepare(`UPDATE ${table} SET disabled=0 WHERE ${column}=?`).run(id) }
  }
})
test('successful workspace mutations have actor/scope audit; rejected mutations do not', async () => {
  const before = database.prepare("SELECT COUNT(*) AS n FROM security_events WHERE event LIKE 'workspace.%'").get().n
  const result = await api('/tasks', { method: 'POST', body: { id: 'audited-task', title: 'Audit without body secrets', ignoredSecret: 'must-not-log' } })
  assert.equal(result.status, 201)
  const event = database.prepare("SELECT * FROM security_events WHERE event='workspace.post' ORDER BY id DESC LIMIT 1").get()
  assert.ok(event); assert.equal(event.user_id, home.id); assert.equal(event.tenant_id, home.tenantId)
  assert.equal(event.organization_id, home.organizationId); assert.equal(event.account_id, home.accountId)
  assert.equal(event.subject, '/api/tasks'); assert.ok(event.created_at)
  const failed = await api('/tasks', { method: 'POST', body: { id: 'audited-task', title: 'duplicate' } })
  assert.equal(failed.status, 409)
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM security_events WHERE event LIKE 'workspace.%'").get().n, before + 1)
  assert.equal(JSON.stringify(event).includes('must-not-log'), false)
})
test('workspace mutation rolls back if its audit insertion fails', async () => {
  database.exec("CREATE TRIGGER qa_reject_workspace_audit BEFORE INSERT ON security_events WHEN NEW.event LIKE 'workspace.%' BEGIN SELECT RAISE(ABORT, 'qa-audit-rejected'); END")
  try {
    assert.equal((await api('/tasks', { method: 'POST', body: { id: 'must-rollback', title: 'Rollback' } })).status, 500)
    const workspace = JSON.parse(database.prepare('SELECT value FROM app_state WHERE key=?').get(stateKey(home)).value)
    assert.equal(workspace.tasks.some(task => task.id === 'must-rollback'), false)
  } finally { database.exec('DROP TRIGGER qa_reject_workspace_audit') }
})
test('project attachment deletion is audited; audit failure preserves metadata and bytes', async () => {
  assert.equal((await api('/projects', { method: 'POST', body: { id: 'audit-project', name: 'Audit project' } })).status, 201)
  const form = new FormData()
  form.append('file', new Blob(['isolated audit fixture'], { type: 'text/plain' }), 'audit.txt')
  const upload = await api('/projects/audit-project/files', { method: 'POST', body: form })
  assert.equal(upload.status, 201, JSON.stringify(upload.data))
  const id = upload.data.file.id
  const row = database.prepare('SELECT stored_name FROM project_files WHERE id=?').get(id)
  const filePath = join(tempDir, 'documents', row.stored_name)
  database.exec("CREATE TRIGGER qa_reject_file_audit BEFORE INSERT ON security_events WHEN NEW.event='workspace.delete' BEGIN SELECT RAISE(ABORT, 'qa-audit-rejected'); END")
  try {
    assert.equal((await api(`/projects/audit-project/files/${id}`, { method: 'DELETE' })).status, 500)
    assert.ok(database.prepare('SELECT 1 FROM project_files WHERE id=?').get(id))
    assert.equal(readFileSync(filePath, 'utf8'), 'isolated audit fixture')
    assert.equal((await api(`/projects/audit-project/files/${id}/content`)).status, 200)
  } finally { database.exec('DROP TRIGGER qa_reject_file_audit') }
  assert.equal((await api(`/projects/audit-project/files/${id}`, { method: 'DELETE' })).status, 204)
  assert.equal(database.prepare('SELECT 1 FROM project_files WHERE id=?').get(id), undefined)
  assert.equal(existsSync(filePath), false)
  const audit = database.prepare("SELECT * FROM security_events WHERE event='workspace.delete' ORDER BY id DESC LIMIT 1").get()
  assert.equal(audit.subject, `/api/projects/:id/files/:fileId#audit-project/${id}`)
  assert.equal(audit.user_id, home.id); assert.equal(audit.account_id, home.accountId)
})
test('10k-row scoped search records local latency and bounded response bytes', async t => {
  const samples = []
  let bytes = 0
  for (let i = 0; i < 10; i++) {
    const start = performance.now()
    const result = await api('/tasks?q=Needle&pageSize=20')
    samples.push(performance.now() - start)
    assert.equal(result.status, 200); assert.equal(result.data.items.length, 20)
    bytes = Buffer.byteLength(JSON.stringify(result.data))
  }
  samples.sort((a, b) => a - b)
  t.diagnostic(`LOCAL_ONLY rows=10000 samples=10 p50_ms=${samples[4].toFixed(2)} max_ms=${samples[9].toFixed(2)} response_bytes=${bytes}; not a production SLA`)
  assert.ok(bytes < 10_000)
})
