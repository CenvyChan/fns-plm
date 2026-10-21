import { Router, type Request } from 'express'
import { randomUUID } from 'node:crypto'
import { requireRole } from './auth.js'
import { db, getAppState, getAppStateVersioned, setAppState, setAppStateIfRevision, StateConflictError } from './database.js'
import { currentWorkspaceScope, scopedStateKey, type WorkspaceScope } from './scope.js'
import { loadScopedWorkspace, persistScopedWorkspace } from './workspace-store.js'
import { connectorCredentialConfig } from './integrations/configuration.js'
import { queryK3Cloud, type K3CloudConfig } from './integrations/k3cloud.js'
import { resolveMaterialRule, nextMaterialCode, MaterialRuleError } from './material-rules.js'

type Scope = WorkspaceScope
type SourceRow = { id: string; number: string; name: string; specification: string; unit: string; groupNumber: string; groupId: string }
type Snapshot = { id: string; source: 'k3cloud'; syncedAt: string; connectorRevision: number; rows: SourceRow[] }
const notice = '编码仅在当前 PLM 账套原子保留，不写回 ERP，不表示 K3Cloud 已建料；预览不占号。ERP 独立并发建料仍须正式写入阶段重新核验。'
const scope = (): Scope => { const value = currentWorkspaceScope(); if (!value) throw new Error('verified_scope_required'); return value }
const args = (s: Scope) => [s.tenantId, s.organizationId, s.accountId]
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const snapshot = (s: Scope) => getAppState<Snapshot | null>(scopedStateKey('material-source', s), null)
class MaterialError extends Error { constructor(public status: number, message: string) { super(message) } }
function fail(status: number, message: string): never { throw new MaterialError(status, message) }
function audit(s: Scope, actor: string, materialId: string, event: string, payload: unknown) {
  db.prepare('INSERT INTO material_closure_audit(tenant_id,organization_id,account_id,material_id,actor,event,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(...args(s), materialId, actor, event, JSON.stringify(payload), new Date().toISOString())
}
function findDraft(s: Scope, id: string) {
  const workspace = loadScopedWorkspace(s), material = workspace.value.materials.find(item => item.id === id)
  if (!material || !material.templateSourceId) return fail(404, '当前账套中不存在此来源草稿。')
  return { workspace, material }
}
function sourceEvidence(s: Scope, materialId: string): { source: SourceRow; snapshotId: string } {
  const row = db.prepare("SELECT payload FROM material_closure_audit WHERE tenant_id=? AND organization_id=? AND account_id=? AND material_id=? AND event='copied' ORDER BY id LIMIT 1").get(...args(s), materialId) as { payload: string } | undefined
  if (!row) return fail(409, '缺少可信复制来源审计，禁止分配。')
  return JSON.parse(row.payload)
}
function ruleAndNext(s: Scope, materialId: string, body: Record<string, unknown>) {
  const source = sourceEvidence(s, materialId), current = snapshot(s)
  if (!current || Date.now() - Date.parse(current.syncedAt) > 5 * 60_000) return fail(409, '完整 K3 物料快照缺失或超过五分钟，请先只读刷新再分配。')
  const connector = db.prepare("SELECT revision FROM connector_configs WHERE tenant_id=? AND organization_id=? AND account_id=? AND provider='k3cloud'").get(...args(s)) as { revision: number } | undefined
  if (!connector || connector.revision !== current.connectorRevision) return fail(409, '连接器版本已变化或缺失，须重新刷新完整物料快照。')
  const liveSource = current.rows.find(row => row.id === source.source.id)
  if (!liveSource || liveSource.groupNumber !== source.source.groupNumber) return fail(409, '来源已移除或分组变化，请重新查询并复制草稿。')
  const rule = resolveMaterialRule(String(body.kind ?? ''), String(body.prefix ?? ''), liveSource.groupNumber)
  const sourceSuffix = liveSource.number.slice(rule.prefix.length)
  if (!liveSource.number.startsWith(rule.prefix) || !/^\d+$/.test(sourceSuffix) || sourceSuffix.length !== rule.width) return fail(409, '来源物料不属于所选已确认编码池；不可跨分类猜前缀，须重新选相似物料。')
  const workspace = loadScopedWorkspace(s)
  const reservations = db.prepare('SELECT code FROM material_code_reservations WHERE tenant_id=? AND organization_id=? AND account_id=?').all(...args(s)) as Array<{ code: string }>
  const codes = [...current.rows.map(row => row.number), ...workspace.value.materials.map(row => String(row.partNo ?? '')), ...reservations.map(row => row.code)]
  return { ...nextMaterialCode(rule, codes), rule, snapshotId: current.id, source }
}
export function isReservedMaterial(s: Scope, id: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM material_code_reservations WHERE tenant_id=? AND organization_id=? AND account_id=? AND material_id=?').get(...args(s), id))
}
export function isReservedCode(s: Scope, code: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM material_code_reservations WHERE tenant_id=? AND organization_id=? AND account_id=? AND code=?').get(...args(s), code))
}
export function createMaterialClosureRouter() {
  db.exec(`CREATE TABLE IF NOT EXISTS material_code_reservations (
    tenant_id TEXT NOT NULL, organization_id TEXT NOT NULL, account_id TEXT NOT NULL,
    material_id TEXT NOT NULL, code TEXT NOT NULL, rule_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,organization_id,account_id,code), UNIQUE(tenant_id,organization_id,account_id,material_id));
    CREATE TABLE IF NOT EXISTS material_closure_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, organization_id TEXT NOT NULL, account_id TEXT NOT NULL,
    material_id TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS material_closure_audit_scope ON material_closure_audit(tenant_id,organization_id,account_id,material_id,id);
    CREATE TRIGGER IF NOT EXISTS material_closure_audit_no_update BEFORE UPDATE ON material_closure_audit BEGIN SELECT RAISE(ABORT,'immutable material audit'); END;
    CREATE TRIGGER IF NOT EXISTS material_closure_audit_no_delete BEFORE DELETE ON material_closure_audit BEGIN SELECT RAISE(ABORT,'immutable material audit'); END;`)
  const router = Router()
  router.use(requireRole('admin', 'plm_manager'))
  router.get('/source', (req, res) => {
    const current = snapshot(scope()), q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 160)
    return res.json({ snapshot: current ? { id: current.id, source: current.source, syncedAt: current.syncedAt } : null, rows: (current?.rows ?? []).filter(row => `${row.number} ${row.name} ${row.specification}`.toLowerCase().includes(q)).slice(0, 200), notice })
  })
  router.post('/source/refresh', async (req, res, next) => {
    try {
      const s = scope(), config = connectorCredentialConfig(s, 'k3cloud'), mapping = record(config.materialSource), fields = record(mapping.fields)
      const previousSnapshotRevision = getAppStateVersioned(scopedStateKey('material-source', s), null).revision
      const canonical = ['id','number','name','specification','unit','groupNumber','groupId','organization'] as const
      const allowlist = record(config.formAllowlist), allowed = allowlist[String(mapping.formId)]
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(String(mapping.formId)) || !Array.isArray(allowed) || canonical.some(key => typeof fields[key] !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(String(fields[key])) || !allowed.includes(fields[key]))) return fail(409, '须配置 materialSource 的八个规范字段及当前账套只读 allowlist，禁止使用通用字段猜测。')
      const organization = String(config.organization ?? '')
      if (!/^[A-Za-z0-9_.-]{1,100}$/.test(organization)) return fail(409, '外部组织编号缺失或不可安全过滤。')
      const rows: SourceRow[] = [], ids = new Set<string>(), numbers = new Set<string>()
      const groupIds = new Map<string, string>(), groupNumbers = new Map<string, string>()
      for (let startRow = 0; ; startRow += 200) {
        const result = await queryK3Cloud({ formId: String(mapping.formId), fieldKeys: canonical.map(key => fields[key]).join(','), filterString: `${fields.organization} = '${organization}'`, orderString: `${fields.id} ASC`, startRow, limit: 200 }, config as Partial<K3CloudConfig>, scopedStateKey('material-query', s), { fresh: true })
        for (const raw of result.rows) {
          const row = Object.fromEntries(canonical.map(key => [key, String(raw[String(fields[key])] ?? '').trim()])) as unknown as SourceRow & { organization: string }
          if (!row.id || !row.number || !row.name || !row.groupNumber || !row.groupId || !row.unit || row.organization !== organization || ids.has(row.id) || numbers.has(row.number)) return fail(502, 'K3 物料来源缺必填、重复编码/ID 或越组织；旧快照保留。')
          if (groupIds.has(row.groupId) && groupIds.get(row.groupId) !== row.groupNumber || groupNumbers.has(row.groupNumber) && groupNumbers.get(row.groupNumber) !== row.groupId) return fail(502, '本地 K3 目录的分组 ID 与完整编码不唯一，禁止猜测前缀；旧快照保留。')
          groupIds.set(row.groupId, row.groupNumber); groupNumbers.set(row.groupNumber, row.groupId)
          ids.add(row.id); numbers.add(row.number)
          const { organization: _organization, ...safe } = row; rows.push(safe)
          if (rows.length > 10000) return fail(409, '物料超过完整扫描安全上限；禁止用截断结果计算最大号。')
        }
        if (result.rows.length < 200) break
      }
      // No asynchronous gap between revision verification and snapshot commit.
      const revisionRow = db.prepare("SELECT revision FROM connector_configs WHERE tenant_id=? AND organization_id=? AND account_id=? AND provider='k3cloud'").get(...args(s)) as { revision: number } | undefined
      const freshConfig = connectorCredentialConfig(s, 'k3cloud')
      if (JSON.stringify(freshConfig) !== JSON.stringify(config)) return fail(409, '扫描期间连接器配置变化，请重新刷新。')
      const current: Snapshot = { id: randomUUID(), source: 'k3cloud', syncedAt: new Date().toISOString(), connectorRevision: revisionRow?.revision ?? 0, rows }
      db.transaction(() => { setAppStateIfRevision(scopedStateKey('material-source', s), current, previousSnapshotRevision); audit(s, req.authUser!.id, '', 'source-refreshed', { snapshotId: current.id, rowCount: rows.length }) }).immediate()
      return res.json({ snapshot: { id: current.id, source: current.source, syncedAt: current.syncedAt }, rows: rows.slice(0, 200), notice })
    } catch (error) { next(error) }
  })
  router.post('/drafts', (req, res, next) => {
    try {
      const s = scope(), sourceId = String(req.body?.sourceId ?? '')
      const material = db.transaction(() => {
        const current = snapshot(s), source = current?.rows.find(row => row.id === sourceId)
        if (!current || !source) return fail(404, '当前账套完整快照中没有该物料。')
        const id = randomUUID(), now = new Date().toISOString()
        const value = { id, partNo: `DRAFT-${id}`, name: source.name, specification: source.specification, unit: source.unit, category: '待确认分类', family: source.number.startsWith('1.') ? '产成品' : source.number.startsWith('2.') ? '半成品' : source.number.startsWith('3.') ? '原材料' : '待确认', erpGroupId: source.groupId, erpGroupNumber: source.groupNumber, templateSourceId: source.id, lifecycle: 'draft', revision: 'A', codeState: 'blocked', erpSyncState: 'unverified', owner: req.authUser!.displayName, createdAt: now, updatedAt: now }
        const workspace = loadScopedWorkspace(s); workspace.value.materials.unshift(value); persistScopedWorkspace(workspace)
        audit(s, req.authUser!.id, id, 'copied', { source, snapshotId: current.id, excluded: ['source number','ERP identity','approval','organization','unique barcode'], notice })
        return value
      }).immediate()
      return res.status(201).json(material)
    } catch (error) { next(error) }
  })
  router.patch('/drafts/:id', (req, res, next) => {
    try {
      const s = scope(), body = record(req.body)
      if (!Object.keys(body).length || Object.keys(body).some(key => !['name','specification','unit'].includes(key)) || Object.entries(body).some(([key,value]) => typeof value !== 'string' || value.length > (key === 'specification' ? 2000 : 160) || (key !== 'specification' && !value.trim()))) return fail(400, '仅可编辑名称、规格、单位差异；来源/分组/编码不可由客户端覆盖。')
      const result = db.transaction(() => { const { workspace, material } = findDraft(s, String(req.params.id)); if (isReservedMaterial(s, material.id) || material.lifecycle !== 'draft') return fail(409, '已保留编码或非草稿物料禁止改身份，请另建草稿。'); const before = structuredClone(material); Object.assign(material, body, { updatedAt: new Date().toISOString() }); persistScopedWorkspace(workspace); audit(s, req.authUser!.id, material.id, 'edited', { before, changes: body }); return material }).immediate()
      return res.json(result)
    } catch (error) { next(error) }
  })
  router.post('/drafts/:id/preview', (req, res, next) => {
    try { const s = scope(), { material } = findDraft(s, String(req.params.id)); if (isReservedMaterial(s, material.id)) return res.json({ blocked: true, reasons: [`该草稿已保留编码 ${material.partNo}，不再预览新号。`], notice }); const result = ruleAndNext(s, String(req.params.id), record(req.body)); return res.json({ blocked: false, reasons: [], code: result.code, serialWidth: result.rule.width, maximum: result.maximum, rule: result.rule, snapshotId: result.snapshotId, notice }) }
    catch (error) { if (error instanceof MaterialError && error.status === 404) return res.status(404).json({ error: error.message }); if (error instanceof MaterialRuleError || error instanceof MaterialError && error.status === 409) return res.json({ blocked: true, reasons: [error.message], notice }); return next(error) }
  })
  router.post('/drafts/:id/allocate', (req, res, next) => {
    try {
      const s = scope(), body = record(req.body), id = String(req.params.id)
      const material = db.transaction(() => {
        const { workspace, material } = findDraft(s, id)
        const existing = db.prepare('SELECT code,rule_json FROM material_code_reservations WHERE tenant_id=? AND organization_id=? AND account_id=? AND material_id=?').get(...args(s), id) as { code: string; rule_json: string } | undefined
        if (existing) { const rule = JSON.parse(existing.rule_json); if (rule.kind !== body.kind || rule.prefix !== body.prefix) return fail(409, '同一草稿已分配不同规则，禁止重试改号。'); if (material.partNo !== existing.code || material.codeState !== 'reserved') return fail(409, '保留回执与物料状态不一致，须审计复核，禁止重新授号。'); return material }
        if (material.lifecycle !== 'draft' || !String(material.name ?? '').trim() || !String(material.unit ?? '').trim()) return fail(409, '仅完整有效草稿可分配。')
        const result = ruleAndNext(s, id, body)
        db.prepare('INSERT INTO material_code_reservations(tenant_id,organization_id,account_id,material_id,code,rule_json,created_at) VALUES(?,?,?,?,?,?,?)').run(...args(s), id, result.code, JSON.stringify(result.rule), new Date().toISOString())
        Object.assign(material, { partNo: result.code, codePreview: result.code, codeState: 'reserved', updatedAt: new Date().toISOString() })
        persistScopedWorkspace(workspace)
        audit(s, req.authUser!.id, id, 'allocated', { code: result.code, previousMaximum: result.maximum, rule: result.rule, snapshotId: result.snapshotId, source: result.source.source, copiedFromSnapshotId: result.source.snapshotId, notice })
        return material
      }).immediate()
      return res.json(material)
    } catch (error) { next(error) }
  })
  router.get('/drafts/:id/audit', (req, res, next) => {
    try { const s = scope(); findDraft(s, String(req.params.id)); const events = db.prepare('SELECT id,actor,event,payload,created_at AS createdAt FROM material_closure_audit WHERE tenant_id=? AND organization_id=? AND account_id=? AND material_id=? ORDER BY id').all(...args(s), String(req.params.id)) as Array<{ payload: string }>; return res.json({ events: events.map(event => ({ ...event, payload: JSON.parse(event.payload) })), notice }) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: Request, res: import('express').Response, _next: import('express').NextFunction) => res.status(error instanceof MaterialError ? error.status : error instanceof StateConflictError || error instanceof MaterialRuleError ? 409 : 502).json({ error: error instanceof Error ? error.message : '物料闭环失败；未写回 ERP。' }))
  return router
}
