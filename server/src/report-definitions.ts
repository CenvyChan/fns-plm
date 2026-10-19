import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { requireRole } from './auth.js'
import { db, getAppStateVersioned, setAppStateIfRevision, StateConflictError } from './database.js'
import { getDailyReportingAccess } from './daily-reporting-admin.js'
import { readDailyReportState } from './daily-reporting.js'
import type { WorkspaceScope } from './scope.js'

export type ReportDefinition = {
  id: string; name: string; template: 'daily-sales' | 'daily-purchase'
  filters: { from?: string; to?: string; partyName?: string }
  version: number; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string
}
type DefinitionState = { definitions: ReportDefinition[]; audit: Array<{ definitionId: string; version: number; actorId: string; at: string; definition: ReportDefinition }> }
const stateKey = (scope: WorkspaceScope) => `report-definitions:${JSON.stringify([scope.tenantId, scope.organizationId, scope.accountId])}`
const read = (scope: WorkspaceScope) => getAppStateVersioned<DefinitionState>(stateKey(scope), { definitions: [], audit: [] })
function scopeFor(req: Request): WorkspaceScope {
  if (!req.authUser) throw new Error('Verified workspace scope is missing')
  return req.authUser
}
function allowed(req: Request, definition: ReportDefinition): boolean {
  const access = getDailyReportingAccess(scopeFor(req), req.authUser!.id, req.authUser!.role)
  return definition.template === 'daily-sales' ? access.sales : access.purchase
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('必须提交 JSON 对象。')
  return value as Record<string, unknown>
}
function day(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
function validate(body: Record<string, unknown>): Pick<ReportDefinition, 'name' | 'template' | 'filters'> {
  if (Object.keys(body).some(key => !['name', 'template', 'filters', 'expectedVersion'].includes(key))) throw new TypeError('包含不支持的定义字段。')
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) throw new TypeError('报表名称须为 1–120 字。')
  if (body.template !== 'daily-sales' && body.template !== 'daily-purchase') throw new TypeError('仅支持固定销售日报、采购日报模板。')
  const input = object(body.filters), filters: ReportDefinition['filters'] = {}
  if (Object.keys(input).some(key => !['from', 'to', 'partyName'].includes(key))) throw new TypeError('仅支持起止日期和客商名称筛选，不接受公式、查询或跨账套配置。')
  for (const key of ['from', 'to'] as const) {
    if (input[key] === undefined || input[key] === '') continue
    if (!day(input[key])) throw new TypeError('日期必须为有效的 YYYY-MM-DD。')
    filters[key] = input[key]
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new TypeError('开始日期不能晚于结束日期。')
  if (input.partyName !== undefined) {
    if (typeof input.partyName !== 'string' || input.partyName.trim().length > 200) throw new TypeError('客商名称最长 200 字。')
    if (input.partyName.trim()) filters.partyName = input.partyName.trim()
  }
  return { name: body.name.trim(), template: body.template, filters }
}

export function createReportDefinitionsRouter(): Router {
  const router = Router()
  router.use('/report-definitions', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  router.get('/report-definitions', (req, res) => {
    const definitions = read(scopeFor(req)).value.definitions.filter(item => allowed(req, item))
    return res.json({ definitions })
  })
  router.get('/report-definitions/:id', (req, res) => {
    const definition = read(scopeFor(req)).value.definitions.find(item => item.id === req.params.id)
    if (!definition || !allowed(req, definition)) return res.status(404).json({ error: '报表定义不存在或无权查看。' })
    return res.json(definition)
  })
  router.post('/report-definitions', requireRole('admin'), (req, res) => {
    try {
      const body = object(req.body)
      if (body.expectedVersion !== undefined) throw new TypeError('新增定义不接受 expectedVersion。')
      const input = validate(body), scope = scopeFor(req), current = read(scope)
      const now = new Date().toISOString(), actorId = req.authUser!.id
      const definition: ReportDefinition = { ...input, id: randomUUID(), version: 1, createdAt: now, updatedAt: now, createdBy: actorId, updatedBy: actorId }
      if (current.value.definitions.some(item => item.name.toLocaleLowerCase() === definition.name.toLocaleLowerCase())) return res.status(409).json({ error: '当前账套已存在同名报表定义。' })
      current.value.definitions.unshift(definition)
      current.value.audit.push({ definitionId: definition.id, version: 1, actorId, at: now, definition: structuredClone(definition) })
      db.transaction(() => setAppStateIfRevision(stateKey(scope), current.value, current.revision))()
      return res.status(201).json(definition)
    } catch (error) {
      if (error instanceof TypeError || error instanceof StateConflictError) return res.status(error instanceof StateConflictError ? 409 : 400).json({ error: error.message })
      throw error
    }
  })
  router.patch('/report-definitions/:id', requireRole('admin'), (req, res) => {
    try {
      const scope = scopeFor(req), current = read(scope), index = current.value.definitions.findIndex(item => item.id === req.params.id)
      if (index < 0) return res.status(404).json({ error: '报表定义不存在或不属于当前账套。' })
      const body = object(req.body), old = current.value.definitions[index]
      if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new TypeError('编辑必须携带有效 expectedVersion。')
      if (body.expectedVersion !== old.version) return res.status(409).json({ error: '定义已被其他人修改，请重新加载后再编辑。' })
      const input = validate(body)
      if (current.value.definitions.some(item => item.id !== old.id && item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) return res.status(409).json({ error: '当前账套已存在同名报表定义。' })
      const now = new Date().toISOString(), actorId = req.authUser!.id
      const definition: ReportDefinition = { ...old, ...input, version: old.version + 1, updatedAt: now, updatedBy: actorId }
      current.value.definitions[index] = definition
      current.value.audit.push({ definitionId: definition.id, version: definition.version, actorId, at: now, definition: structuredClone(definition) })
      db.transaction(() => setAppStateIfRevision(stateKey(scope), current.value, current.revision))()
      return res.json(definition)
    } catch (error) {
      if (error instanceof TypeError || error instanceof StateConflictError) return res.status(error instanceof StateConflictError ? 409 : 400).json({ error: error.message })
      throw error
    }
  })
  router.get('/report-definitions/:id/preview', (req, res) => {
    const scope = scopeFor(req), definition = read(scope).value.definitions.find(item => item.id === req.params.id)
    if (!definition || !allowed(req, definition)) return res.status(404).json({ error: '报表定义不存在或无权查看。' })
    const state = readDailyReportState(scope), type = definition.template === 'daily-sales' ? 'sales' : 'purchase', filters = definition.filters
    const rows = state.reports.filter(row => !row.deletedAt && row.type === type && (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to) && (!filters.partyName || row.partyName === filters.partyName))
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
      .map(({ id, date, partyName, documentNo, quantity, amountCny, currency, originalAmount }) => ({ id, date, partyName, documentNo, quantity, amountCny, currency, originalAmount }))
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
    return res.json({ definition, rows, summary: { count: rows.length, quantity: rows.reduce((total, row) => total + row.quantity, 0), amountCny: round(rows.reduce((total, row) => total + row.amountCny, 0)) }, generatedAt: new Date().toISOString(), source: state.mockEnabled ? 'local-mock' : 'workspace', notice: state.mockEnabled ? '隔离演示数据，非真实业务数据。' : '读取当前已保存日报；不触发 ERP 同步。', amountBasis: '按日报行内人民币金额汇总；历史汇率不重算。数量可能包含不同单位，不作为统一计量。' })
  })
  return router
}
