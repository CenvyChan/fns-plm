import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { db } from './database.js'
import { requireAuthenticated, requireRole } from './auth.js'
import { validateDefinition, validateValues, type FormDefinition } from './forms-dsl.js'
import { readK3CloudMasterData } from './k3cloud-master-data.js'
import type { WorkspaceScope } from './scope.js'
import { flowableFormKey } from './form-binding.js'

db.exec(`CREATE TABLE IF NOT EXISTS forms(tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,form_key TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL,latest_version INTEGER NOT NULL DEFAULT 0,definition TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,organization_id,account_id,form_key));
CREATE TABLE IF NOT EXISTS form_versions(tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,form_key TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,PRIMARY KEY(tenant_id,organization_id,account_id,form_key,version));
CREATE TRIGGER IF NOT EXISTS form_versions_immutable_update BEFORE UPDATE ON form_versions BEGIN SELECT RAISE(ABORT,'immutable form version'); END;
CREATE TRIGGER IF NOT EXISTS form_versions_immutable_delete BEFORE DELETE ON form_versions BEGIN SELECT RAISE(ABORT,'immutable form version'); END;
CREATE TABLE IF NOT EXISTS form_submissions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,form_key TEXT NOT NULL,form_version INTEGER NOT NULL,actor_id TEXT NOT NULL,process_instance_id TEXT NOT NULL,task_id TEXT NOT NULL,values_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS form_submission_scope ON form_submissions(tenant_id,organization_id,account_id,actor_id);`)

export type FormTaskContext = {
  tenantId: string; organizationId: string; accountId: string; actorId: string
  formKey: string; formVersion: number; processInstanceId: string; taskId: string
}
export interface FormTaskAdapter {
  resolve(input: { scope: WorkspaceScope; actorId: string; taskId: string; formKey: string; formVersion: number }): Promise<FormTaskContext | null>
}
const userScope = (req: Request): WorkspaceScope => req.authUser as unknown as WorkspaceScope
const routeKey = (req: Request): string => String(req.params.key)
const formRow = (scope: WorkspaceScope, key: string) => db.prepare('SELECT * FROM forms WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=?').get(scope.tenantId, scope.organizationId, scope.accountId, key) as Record<string, any> | undefined
const error = (res: Response, e: unknown) => res.status(400).json({ error: e instanceof Error ? e.message : 'invalid request' })
function lookup(type: 'user' | 'customer', id: string, scope: import('./forms-dsl.js').ScopeIds): boolean {
  if (type === 'user') return !!db.prepare(`SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0 AND a.status='active'`).get(id, scope.tenantId, scope.organizationId, scope.accountId)
  return [...(readK3CloudMasterData(scope as WorkspaceScope).records.customer ?? []), ...(readK3CloudMasterData(scope as WorkspaceScope).records.supplier ?? [])].some(record => record.id === id)
}

export function createFormsRouter(options: { taskAdapter?: FormTaskAdapter } = {}) {
  const router = Router()
  const adapter = options.taskAdapter
  router.use('/forms', requireAuthenticated)
  router.use('/forms', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  router.get('/forms/lookups/users', (req, res) => {
    const s = userScope(req)
    const options = db.prepare(`SELECT u.id AS value,u.display_name AS label FROM tenant_memberships m JOIN users u ON u.id=m.user_id JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0 AND a.status='active' ORDER BY u.display_name`).all(s.tenantId, s.organizationId, s.accountId)
    res.json({ options })
  })
  router.get('/forms/lookups/customers', (req, res) => {
    const s = userScope(req), data = readK3CloudMasterData(s)
    const options = [...(data.records.customer ?? []), ...(data.records.supplier ?? [])].map(record => ({ value: record.id, label: record.name }))
    res.json({ options })
  })
  router.get('/forms', (req, res) => { const s = userScope(req); res.json({ forms: db.prepare('SELECT form_key AS key,name,revision,latest_version AS latestVersion FROM forms WHERE tenant_id=? AND organization_id=? AND account_id=? ORDER BY form_key').all(s.tenantId, s.organizationId, s.accountId) }) })
  router.post('/forms', requireRole('admin', 'plm_manager'), (req, res) => {
    try {
      const b = req.body
      if (!b || Object.keys(b).some(k => !['key', 'name', 'definition'].includes(k)) || typeof b.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(b.key) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120) throw Error('invalid form metadata')
      const d = validateDefinition(b.definition), s = userScope(req)
      try { db.prepare('INSERT INTO forms VALUES(?,?,?,?,?,1,0,?,?)').run(s.tenantId, s.organizationId, s.accountId, b.key, b.name.trim(), JSON.stringify(d), new Date().toISOString()) }
      catch { return res.status(409).json({ error: 'form key already exists' }) }
      return res.status(201).json({ key: b.key, name: b.name.trim(), revision: 1, latestVersion: 0, definition: d })
    } catch (e) { return error(res, e) }
  })
  router.get('/forms/:key/versions/:version', (req, res) => {
    const s = userScope(req), n = Number(req.params.version), v = db.prepare('SELECT definition FROM form_versions WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? AND version=?').get(s.tenantId, s.organizationId, s.accountId, req.params.key, n) as { definition: string } | undefined
    if (!v) return res.status(404).json({ error: 'not found' })
    return res.json({ key: req.params.key, version: n, bindingKey: flowableFormKey({ formKey: routeKey(req), formVersion: n }), definition: JSON.parse(v.definition) })
  })
  router.get('/forms/:key/versions', (req, res) => { const s = userScope(req); res.json({ versions: db.prepare('SELECT version,created_at AS createdAt,created_by AS createdBy FROM form_versions WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? ORDER BY version DESC').all(s.tenantId, s.organizationId, s.accountId, req.params.key) }) })
  router.get('/forms/:key', (req, res) => {
    const f = formRow(userScope(req), req.params.key)
    if (!f) return res.status(404).json({ error: 'not found' })
    return res.json({ key: f.form_key, name: f.name, revision: f.revision, latestVersion: f.latest_version, definition: JSON.parse(f.definition) })
  })
  router.put('/forms/:key', requireRole('admin', 'plm_manager'), (req, res) => {
    try {
      const b = req.body
      if (!b || Object.keys(b).some(k => !['name', 'definition', 'revision'].includes(k)) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120 || !Number.isSafeInteger(b.revision)) throw Error('invalid update')
      const d = validateDefinition(b.definition), s = userScope(req), f = formRow(s, routeKey(req))
      if (!f) return res.status(404).json({ error: 'not found' })
      const z = db.prepare('UPDATE forms SET name=?,definition=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? AND revision=?').run(b.name.trim(), JSON.stringify(d), new Date().toISOString(), s.tenantId, s.organizationId, s.accountId, req.params.key, b.revision)
      if (!z.changes) return res.status(409).json({ error: 'revision conflict' })
      return res.json({ key: req.params.key, name: b.name.trim(), revision: b.revision + 1, latestVersion: f.latest_version, definition: d })
    } catch (e) { return error(res, e) }
  })
  router.post('/forms/:key/publish', requireRole('admin', 'plm_manager'), (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some(k => k !== 'revision') || !Number.isSafeInteger(req.body.revision)) return res.status(400).json({ error: 'invalid publish payload' })
      const s = userScope(req), f = formRow(s, routeKey(req))
      if (!f) return res.status(404).json({ error: 'not found' })
      const publish = db.transaction(() => {
        const current = db.prepare('SELECT revision,latest_version,definition FROM forms WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=?').get(s.tenantId, s.organizationId, s.accountId, req.params.key) as { revision: number; latest_version: number; definition: string } | undefined
        if (!current || current.revision !== req.body.revision) return null
        const d = validateDefinition(JSON.parse(current.definition))
        const version = current.latest_version + 1
        db.prepare('INSERT INTO form_versions VALUES(?,?,?,?,?,?,?,?)').run(s.tenantId, s.organizationId, s.accountId, req.params.key, version, JSON.stringify(d), new Date().toISOString(), req.authUser!.id)
        const changed = db.prepare('UPDATE forms SET latest_version=? WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? AND revision=? AND latest_version=?').run(version, s.tenantId, s.organizationId, s.accountId, req.params.key, current.revision, current.latest_version)
        if (!changed.changes) throw Error('publish compare-and-swap failed')
        return { version, definition: d }
      }).immediate()
      if (!publish) return res.status(409).json({ error: 'revision conflict' })
      return res.status(201).json({ key: req.params.key, bindingKey: flowableFormKey({ formKey: routeKey(req), formVersion: publish.version }), ...publish })
    } catch (e) { return error(res, e) }
  })
  router.post('/forms/:key/versions/:version/submissions', async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some(k => !['values', 'taskId', 'processInstanceId'].includes(k))) return res.status(400).json({ error: 'unknown submission property' })
      if (req.body.processInstanceId !== undefined) return res.status(400).json({ error: 'processInstanceId is server-derived' })
      if (typeof req.body.taskId !== 'string' || !req.body.taskId) return res.status(400).json({ error: 'taskId is required' })
      if (!adapter) return res.status(501).json({ error: 'verified task adapter unavailable' })
      const s = userScope(req), version = Number(req.params.version), vr = db.prepare('SELECT definition FROM form_versions WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? AND version=?').get(s.tenantId, s.organizationId, s.accountId, req.params.key, version) as { definition: string } | undefined
      if (!vr) return res.status(404).json({ error: 'version not found' })
      const context = await adapter.resolve({ scope: s, actorId: req.authUser!.id, taskId: req.body.taskId, formKey: req.params.key, formVersion: version })
      if (!context || context.tenantId !== s.tenantId || context.organizationId !== s.organizationId || context.accountId !== s.accountId || context.actorId !== req.authUser!.id || context.formKey !== req.params.key || context.formVersion !== version || context.taskId !== req.body.taskId || typeof context.processInstanceId !== 'string' || !context.processInstanceId) return res.status(403).json({ error: 'task context not authorized' })
      const values = validateValues(JSON.parse(vr.definition) as FormDefinition, req.body.values, s, lookup), id = randomUUID(), createdAt = new Date().toISOString()
      db.prepare('INSERT INTO form_submissions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, s.tenantId, s.organizationId, s.accountId, req.params.key, version, req.authUser!.id, context.processInstanceId, context.taskId, JSON.stringify(values), createdAt)
      return res.status(201).json({ id, formKey: req.params.key, formVersion: version, actorId: req.authUser!.id, processInstanceId: context.processInstanceId, taskId: context.taskId, values, createdAt })
    } catch (e) { return error(res, e) }
  })
  router.get('/forms/:key/submissions/:id', (req, res) => {
    const s = userScope(req), user = req.authUser!, sub = db.prepare('SELECT * FROM form_submissions WHERE id=? AND tenant_id=? AND organization_id=? AND account_id=? AND form_key=?').get(req.params.id, s.tenantId, s.organizationId, s.accountId, req.params.key) as Record<string, any> | undefined
    if (!sub || (sub.actor_id !== user.id && !['admin', 'plm_manager'].includes(user.role))) return res.status(404).json({ error: 'not found' })
    return res.json({ id: sub.id, formKey: sub.form_key, formVersion: sub.form_version, actorId: sub.actor_id, processInstanceId: sub.process_instance_id, taskId: sub.task_id, values: JSON.parse(sub.values_json), createdAt: sub.created_at })
  })
  return router
}
