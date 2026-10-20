import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import express from 'express'
import Database from 'better-sqlite3'

const dir = mkdtempSync(join(tmpdir(), 'plm-forms-http-'))
process.env.DATABASE_FILE = join(dir, 'forms.sqlite')
process.env.APP_ENCRYPTION_KEY = 'ab'.repeat(32)
process.env.NODE_ENV = 'test'
const { db, setAppState } = await import('../dist/database.js')
const { createAuthRouter, sameOriginGuard } = await import('../dist/auth.js')
const { createFormsRouter } = await import('../dist/forms.js')
const contexts = new Map()
const app = express()
app.use(express.json({ limit: '2mb' }))
app.use('/api/auth', createAuthRouter())
app.use('/api', sameOriginGuard, createFormsRouter({ taskAdapter: { async resolve(input) { return contexts.get(input.taskId) ?? null } } }))
app.use('/closed', createFormsRouter())
const server = createServer(app)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

async function request(path, { method = 'GET', body, identity, headers = {} } = {}) {
  const scoped = identity ? {
    Authorization: `Bearer ${identity.token}`,
    'X-Tenant-ID': identity.tenantId,
    'X-Organization-ID': identity.organizationId,
    'X-Account-ID': identity.accountId,
  } : {}
  const res = await fetch(`${origin}${path}`, {
    method, headers: { ...scoped, ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  })
  const data = await res.json()
  return { status: res.status, data, headers: res.headers }
}
const api = (path, options = {}) => request(`/api/forms${path}`, options)
const now = new Date().toISOString()
function fixture(scope, actor, role = 'admin') {
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,code,created_at,updated_at) VALUES(?,?,?,?,?)').run(scope.tenantId, scope.tenantId, scope.tenantId, now, now)
  db.prepare('INSERT OR IGNORE INTO organizations(id,tenant_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(scope.organizationId, scope.tenantId, scope.organizationId, scope.organizationId, now, now)
  db.prepare('INSERT OR IGNORE INTO accounts(id,tenant_id,organization_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(scope.accountId, scope.tenantId, scope.organizationId, scope.accountId, scope.accountId, now, now)
  db.prepare('INSERT OR IGNORE INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(actor, `${actor}@example.test`, actor, 'fixture-no-password-login', now, now)
  db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,created_at) VALUES(?,?,?,?,?,?,?)').run(`${actor}-${scope.accountId}`, actor, scope.tenantId, scope.organizationId, scope.accountId, role, now)
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sessions(token_hash,user_id,active_account_id,created_at,expires_at) VALUES(?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), actor, scope.accountId, now, new Date(Date.now() + 3600000).toISOString())
  return { ...scope, id: actor, token }
}
function customerSnapshot(scope, id) {
  setAppState(`k3cloud-master-data:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`, {
    configuredKinds: ['customer', 'supplier'], rowCounts: { customer: 1, supplier: 1 }, lastSyncedAt: now,
    records: { customer: [{ id, kind: 'customer', name: `Customer ${id}` }], supplier: [{ id: `${id}-supplier`, kind: 'supplier', name: `Supplier ${id}` }] },
  })
}

await test('forms end-to-end with verified sessions, immutable versions, authorization and tenant/org/account isolation', async t => {
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true }) })
  const setup = await request('/api/auth/mobile/setup', { method: 'POST', body: { displayName: 'Forms admin', email: 'forms-admin@example.test', password: 'Isolated-Forms-Setup-2026!' } })
  assert.equal(setup.status, 201, JSON.stringify(setup.data))
  const admin = { ...setup.data.user, token: setup.data.accessToken }
  const member = fixture(admin, 'forms-member', 'member')
  const manager = fixture(admin, 'forms-manager', 'plm_manager')
  const reviewer = fixture(admin, 'forms-reviewer', 'reviewer')
  const accountB = fixture({ tenantId: admin.tenantId, organizationId: admin.organizationId, accountId: 'forms-account-b' }, 'account-b-admin')
  const orgB = fixture({ tenantId: admin.tenantId, organizationId: 'forms-org-b', accountId: 'forms-org-b-account' }, 'org-b-admin')
  const tenantB = fixture({ tenantId: 'forms-tenant-b', organizationId: 'forms-tenant-b-org', accountId: 'forms-tenant-b-account' }, 'tenant-b-admin')
  customerSnapshot(admin, 'customer-a')
  customerSnapshot(accountB, 'customer-b')
  const definition = {
    dslVersion: 1,
    fields: [
      { id: 'code', label: 'Code', type: 'text', required: true, min: 2, max: 8, pattern: '^[A-Z][A-Z0-9]{1,7}$' },
      { id: 'notes', label: 'Notes', type: 'textarea', max: 100 },
      { id: 'amount', label: 'Amount', type: 'number', required: true, min: 0, max: 10 },
      { id: 'day', label: 'Day', type: 'date', required: true },
      { id: 'mode', label: 'Mode', type: 'select', required: true, options: [{ value: 'normal', label: 'Normal' }, { value: 'special', label: 'Special' }] },
      { id: 'tags', label: 'Tags', type: 'multiselect', required: true, min: 1, max: 2, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] },
      { id: 'customer', label: 'Customer', type: 'customer', required: true },
      { id: 'owner', label: 'Owner', type: 'user', required: true },
      { id: 'reason', label: 'Reason', type: 'text', requiredWhen: { field: 'mode', op: 'eq', value: 'special' }, visibleWhen: { field: 'mode', op: 'eq', value: 'special' } },
      { id: 'limited', label: 'Limited', type: 'text', enabledWhen: { field: 'mode', op: 'eq', value: 'special' } },
      { id: 'derived', label: 'Derived', type: 'text' },
    ],
    events: [{ on: 'change', field: 'mode', actions: [{ type: 'set', target: 'derived', value: 'normalized' }] }],
  }
  const create = identity => api('', { method: 'POST', identity, body: { key: 'inspection', name: 'Inspection', definition } })
  const values = { code: 'AB12', amount: 0, day: '2026-10-20', mode: 'normal', tags: ['a'], customer: 'customer-a', owner: member.id }
  let created, submission

  await t.test('real authentication, scope headers, role checks and same-origin guard', async () => {
    assert.equal((await api('')).status, 401)
    assert.equal((await api('', { identity: admin, headers: { 'X-Account-ID': '' } })).status, 400)
    for (const header of ['X-Tenant-ID', 'X-Organization-ID', 'X-Account-ID']) assert.equal((await api('', { identity: admin, headers: { [header]: 'forged' } })).status, 403)
    for (const identity of [member, reviewer]) assert.equal((await create(identity)).status, 403)
    assert.equal((await api('', { method: 'POST', identity: admin, headers: { origin: 'https://attacker.invalid' }, body: {} })).status, 403)
    created = await create(admin)
    assert.equal(created.status, 201, JSON.stringify(created.data))
    assert.equal(created.data.revision, 1)
    assert.equal((await create(admin)).status, 409)
    assert.match(created.headers.get('cache-control'), /no-store/)
  })
  await t.test('save, refresh and publish immutable version one, then edit and publish version two', async () => {
    assert.deepEqual((await api('/inspection', { identity: admin })).data.definition, definition)
    const first = await api('/inspection/publish', { method: 'POST', identity: admin, body: { revision: 1 } })
    assert.equal(first.status, 201)
    assert.equal(first.data.version, 1)
    const next = structuredClone(definition)
    next.fields[0].label = 'Code version two'
    const edit = await api('/inspection', { method: 'PUT', identity: manager, body: { name: 'Inspection edited', definition: next, revision: 1 } })
    assert.equal(edit.status, 200)
    assert.equal(edit.data.revision, 2)
    assert.equal((await api('/inspection', { method: 'PUT', identity: admin, body: { name: 'stale', definition, revision: 1 } })).status, 409)
    assert.equal((await api('/inspection/publish', { method: 'POST', identity: admin, body: { revision: 1 } })).status, 409)
    assert.equal((await api('/inspection/publish', { method: 'POST', identity: admin, body: { revision: 2, javascript: 'evil' } })).status, 400)
    const second = await api('/inspection/publish', { method: 'POST', identity: admin, body: { revision: 2 } })
    assert.equal(second.status, 201)
    assert.equal(second.data.version, 2)
    assert.deepEqual((await api('/inspection/versions/1', { identity: member })).data.definition, definition)
    assert.deepEqual((await api('/inspection/versions/2', { identity: member })).data.definition, next)
    assert.deepEqual((await api('/inspection/versions', { identity: admin })).data.versions.map(v => v.version), [2, 1])
    assert.equal((await api('/inspection', { identity: admin })).data.definition.fields[0].label, 'Code version two')
    assert.equal((await api('/inspection', { identity: admin })).data.activeVersion, null)
    assert.equal((await api('/inspection/activate', { method: 'POST', identity: member, body: { version: 1 } })).status, 403)
    assert.equal((await api('/inspection/activate', { method: 'POST', identity: admin, body: { version: 99 } })).status, 404)
    assert.equal((await api('/inspection', { identity: admin })).data.activeVersion, null, 'missing version activation leaves historical active pointer unchanged')
    assert.equal((await api('/inspection/activate', { method: 'POST', identity: reviewer, body: { version: 1 } })).status, 403)
    assert.equal((await api('/inspection/activate', { method: 'POST', identity: admin, body: { version: 1, extra: true } })).status, 400)
    const activated = await api('/inspection/activate', { method: 'POST', identity: manager, body: { version: 1 } })
    assert.deepEqual({ activeVersion: activated.data.activeVersion, latestVersion: activated.data.latestVersion }, { activeVersion: 1, latestVersion: 2 })
    assert.equal((await api('/inspection', { identity: admin })).data.latestVersion, 2, 'active pointer never changes latest published version')
    for (const identity of [member, reviewer]) assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity, body: { version: 2, processKey: 'procA' } })).status, 403)
    assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity: admin, body: { version: 999, processKey: 'procA' } })).status, 404)
    assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity: manager, body: { version: 2, processKey: 'procA' } })).data.bindingKey, 'plm-form:inspection:v2')
    assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity: admin, body: { version: 2, processKey: 'procA', html: '<script>' } })).status, 400)
    assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity: admin, body: { version: 1, processKey: 'procB' } })).status, 200)
    const bindings = (await api('/inspection/bindings', { identity: admin })).data.bindings
    assert.equal(bindings.length, 2, 'same node key coexists independently in distinct processes')
    assert.deepEqual(bindings.map(({ processKey, nodeKey, version }) => ({ processKey, nodeKey, version })), [
      { processKey: 'procA', nodeKey: 'node-A', version: 2 }, { processKey: 'procB', nodeKey: 'node-A', version: 1 },
    ])
    assert.equal(bindings[0].bindingKey, 'plm-form:inspection:v2')

    assert.throws(() => db.prepare('UPDATE form_versions SET definition=? WHERE form_key=?').run('{}', 'inspection'), /immutable/)
    assert.throws(() => db.prepare('DELETE FROM form_versions WHERE form_key=?').run('inspection'), /immutable/)
    const reopened = new Database(process.env.DATABASE_FILE, { readonly: true })
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM form_versions WHERE form_key=?').get('inspection').n, 2)
    reopened.close()
  })
  await t.test('tenant, organization and account isolation, including scoped real user and customer lookups', async () => {
    const users = (await api('/lookups/users', { identity: admin })).data.options.map(x => x.value)
    assert.ok(users.includes(member.id))
    assert.ok(!users.includes(accountB.id))
    const customers = (await api('/lookups/customers', { identity: admin })).data.options.map(x => x.value)
    assert.deepEqual(customers, ['customer-a', 'customer-a-supplier'])
    for (const other of [accountB, orgB, tenantB]) {
      assert.deepEqual((await api('', { identity: other })).data.forms, [])
      assert.equal((await api('/inspection', { identity: other })).status, 404)
      assert.equal((await api('/inspection/versions/1', { identity: other })).status, 404)
      assert.equal((await api('/inspection/bindings', { identity: other })).status, 404)
      assert.equal((await api('/inspection/bindings/node-A', { method: 'PUT', identity: other, body: { version: 1, processKey: 'procA' } })).status, 404)
      assert.equal((await api('/inspection/activate', { method: 'POST', identity: other, body: { version: 1 } })).status, 404)
      assert.equal((await create(other)).status, 201, 'same form key is independent per exact scope')
      assert.ok(!(await api('/lookups/users', { identity: other })).data.options.some(x => x.value === member.id))
    }
    assert.deepEqual((await api('/lookups/customers', { identity: accountB })).data.options.map(x => x.value), ['customer-b', 'customer-b-supplier'])
  })
  const context = { tenantId: admin.tenantId, organizationId: admin.organizationId, accountId: admin.accountId, actorId: admin.id, formKey: 'inspection', formVersion: 1, processInstanceId: 'local-verified-process-001', taskId: 'local-task-001' }
  contexts.set(context.taskId, context)
  const submit = (patch = {}, identity = admin, taskId = context.taskId, version = 1) => api(`/inspection/versions/${version}/submissions`, { method: 'POST', identity, body: { values: { ...values, ...patch }, taskId } })
  await t.test('server rejects forged execution contexts, process/actor/scope properties and version drift', async () => {
    assert.equal((await api('/inspection/versions/1/submissions', { method: 'POST', identity: admin, body: { values } })).status, 400)
    assert.equal((await api('/inspection/versions/1/submissions', { method: 'POST', identity: admin, body: { values, taskId: context.taskId, processInstanceId: 'client-forged' } })).status, 400)
    assert.equal((await api('/inspection/versions/1/submissions', { method: 'POST', identity: admin, body: { values, taskId: context.taskId, actorId: member.id } })).status, 400)
    assert.equal((await submit({}, member)).status, 403)
    assert.equal((await submit({}, admin, 'untrusted-task')).status, 403)
    assert.equal((await submit({}, admin, context.taskId, 2)).status, 403)
    assert.equal((await submit({}, admin, context.taskId, 999)).status, 404)
    for (const property of ['tenantId', 'organizationId', 'accountId', 'actorId', 'formKey', 'formVersion', 'taskId', 'processInstanceId']) {
      const id = `forged-${property}`
      const forged = { ...context, taskId: id, [property]: property === 'formVersion' ? 2 : property === 'processInstanceId' ? '' : 'wrong' }
      contexts.set(id, forged)
      assert.equal((await submit({}, admin, id)).status, 403, property)
    }
    assert.equal((await request('/closed/forms/inspection/versions/1/submissions', { method: 'POST', identity: admin, body: { values, taskId: context.taskId } })).status, 501)
  })
  await t.test('server revalidates all field types, rules, scoped selections and canonical events', async () => {
    for (const [patch, message] of [
      [{ code: '' }, 'required'], [{ code: 'lower' }, 'pattern'], [{ code: 'A' }, 'text minimum'],
      [{ code: [] }, 'type confusion'], [{ amount: -1 }, 'minimum'], [{ amount: 11 }, 'maximum'], [{ amount: '1' }, 'number type'],
      [{ day: '2026-02-30' }, 'calendar date'], [{ mode: 'injected' }, 'option'], [{ tags: [] }, 'required multi-select'],
      [{ tags: ['a', 'b', 'c'] }, 'multi-select maximum'], [{ tags: ['a', 'a'] }, 'duplicate selection'],
      [{ customer: 'customer-b' }, 'cross-scope customer'], [{ owner: accountB.id }, 'cross-scope user'],
      [{ mode: 'special' }, 'conditional required'], [{ reason: 'hidden payload' }, 'conditional visible'],
      [{ limited: 'disabled payload' }, 'conditional enabled'], [{ unexpected: 'payload' }, 'unknown field'],
    ]) {
      const result = await submit(patch)
      assert.equal(result.status, 400, `${message}: ${JSON.stringify(result.data)}`)
    }
    const valid = await submit({ derived: 'client-tampered' })
    assert.equal(valid.status, 201, JSON.stringify(valid.data))
    assert.equal(valid.data.values.derived, 'normalized')
    assert.equal(valid.data.values.amount, 0)
    assert.equal(valid.data.actorId, admin.id)
    assert.equal(valid.data.formVersion, 1)
    assert.equal(valid.data.processInstanceId, context.processInstanceId)
    submission = valid.data
    assert.equal((await submit({ mode: 'special', reason: 'Approved reason', limited: 'enabled payload' })).status, 409, 'an accepted task form is immutable')
    assert.equal((await submit({ derived: 'another client value' })).data.id, submission.id, 'canonical identical retries reuse the existing submission')
    contexts.set('conditional-task', { ...context, taskId: 'conditional-task' })
    const conditional = await submit({ mode: 'special', reason: 'Approved reason', limited: 'enabled payload' }, admin, 'conditional-task')
    assert.equal(conditional.status, 201)
    const memberTask = { ...context, taskId: 'member-task', actorId: member.id }
    contexts.set(memberTask.taskId, memberTask)
    assert.equal((await submit({}, member, memberTask.taskId)).status, 201, 'assigned member may run but not design')
  })
  await t.test('submission persists exact scope, PLM actor, process and immutable version and is access controlled', async () => {
    assert.deepEqual((await api(`/inspection/submissions/${submission.id}`, { identity: admin })).data, submission)
    assert.equal((await api(`/inspection/submissions/${submission.id}`, { identity: member })).status, 404)
    assert.equal((await api(`/inspection/submissions/${submission.id}`, { identity: manager })).status, 200)
    for (const identity of [accountB, orgB, tenantB]) assert.equal((await api(`/inspection/submissions/${submission.id}`, { identity })).status, 404)
    const reopened = new Database(process.env.DATABASE_FILE, { readonly: true })
    const row = reopened.prepare('SELECT * FROM form_submissions WHERE id=?').get(submission.id)
    assert.equal(row.tenant_id, admin.tenantId)
    assert.equal(row.organization_id, admin.organizationId)
    assert.equal(row.account_id, admin.accountId)
    assert.equal(row.actor_id, admin.id)
    assert.equal(row.form_version, 1)
    assert.equal(row.process_instance_id, context.processInstanceId)
    assert.deepEqual(JSON.parse(row.values_json), submission.values)
    reopened.close()
  })
  await t.test('malicious DSL configuration and arbitrary actions cannot be persisted', async () => {
    for (const d of [
      { ...definition, html: '<script>alert(1)</script>' },
      { ...definition, fields: [{ id: 'bad', label: 'Bad', type: 'text', requiredWhen: null }] },
      { ...definition, fields: [{ id: 'constructor', label: 'Bad', type: 'text' }] },
      { ...definition, fields: [{ id: 'bad', label: 'Bad', type: 'text', pattern: '(a+)+' }] },
      { ...definition, events: [{ on: 'change', field: 'code', actions: [{ type: 'fetch', target: 'notes', url: 'https://attacker.invalid' }] }] },
    ]) assert.equal((await api('', { method: 'POST', identity: admin, body: { key: 'malicious', name: 'Malicious', definition: d } })).status, 400)
  })
})
