import { createHash, randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { requireAuthenticated, requireRole } from './auth.js'
import { db, getAppStateVersioned, recordSecurityEvent, setAppStateIfRevision, StateConflictError } from './database.js'
import { readK3CloudMasterData } from './k3cloud-master-data.js'
import type { WorkspaceScope } from './scope.js'

export type DailyPartyKind = 'customer' | 'supplier'
export type DailyBusinessKind = 'sales' | 'purchase'
export type DailyMappingStatus = 'PENDING' | 'MANUAL' | 'UNMATCHED'

export interface DailyParty {
  id: string; kind: DailyPartyKind; name: string; aliases: string[]; active: boolean
  k3Number: string; legacyCompanyCode: string; legacyId: string; source: 'manual' | 'legacy-import'
  createdAt: string; updatedAt: string
}
export interface DailyExchangeRate {
  id: string; month: string; currency: 'USD'; targetCurrency: 'CNY'; rate: string
  source: 'manual' | 'legacy-import'; legacyCompanyCode?: string; updatedAt: string
}
export interface DailyAssignment {
  id: string; kind: DailyPartyKind; partyId: string | null; userId: string | null
  legacyCompanyCode: string; legacyPartyId: string; legacyUserId: string; legacyUsername: string; legacyUserName: string
  status: 'unmapped' | 'party-unmapped' | 'member-unmapped' | 'mapped'; updatedAt: string
}
export interface DailyPartyMapping {
  id: string; kind: DailyPartyKind; k3Number: string; k3Name: string; partyId: string | null
  status: DailyMappingStatus; legacyStatus: string; legacyPartyId: string; legacyCompanyCode: string
  candidates: Array<{ legacyId?: string; name: string; score?: number }>; updatedAt: string; updatedBy: string
}
export interface DailyLegacyMembership {
  id: string; legacyCompanyCode: string; legacyUserId: string; legacyUsername: string; legacyUserName: string
  legacyGroups: string[]; legacyActive: boolean; legacyMustChangePassword: boolean
  status: 'member-unmapped'; updatedAt: string
}
export interface DailyManagementImportBatch {
  id: string; category: string; sourceCompanyCode: string; rowCount: number; inserted: number; skipped: number
  conflicts: number; digest: string; createdAt: string; createdBy: string
}
export interface DailyReportingAdminState {
  masterDataConfigured: boolean; parties: DailyParty[]; exchangeRates: DailyExchangeRate[]
  assignments: DailyAssignment[]; partyMappings: DailyPartyMapping[]; legacyMemberships: DailyLegacyMembership[]
  importBatches: DailyManagementImportBatch[]
}

const PREFIX = 'daily-reporting-admin'
const MANAGERS = ['admin', 'plm_manager'] as const
function emptyState(): DailyReportingAdminState {
  return { masterDataConfigured: false, parties: [], exchangeRates: [], assignments: [], partyMappings: [], legacyMemberships: [], importBatches: [] }
}
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
const validDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const decimalText = (value: unknown, maxPlaces = 8): string | undefined => {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!candidate || candidate.length > 40 || !new RegExp(`^-?(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,${maxPlaces}})?$`).test(candidate)) return undefined
  return candidate
}
function stateKey(scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>): string {
  return `${PREFIX}:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}
function normalized(value: unknown): DailyReportingAdminState {
  const state = { ...emptyState(), ...asRecord(value) } as DailyReportingAdminState
  for (const key of ['parties', 'exchangeRates', 'assignments', 'partyMappings', 'legacyMemberships', 'importBatches'] as const) {
    if (!Array.isArray(state[key])) state[key] = [] as never
  }
  state.masterDataConfigured = Boolean(state.masterDataConfigured || state.parties.length)
  return state
}
function versioned(scope: WorkspaceScope): { key: string; value: DailyReportingAdminState; revision: number } {
  const key = stateKey(scope), current = getAppStateVersioned<unknown>(key, null)
  return { key, value: normalized(current.value), revision: current.revision }
}
export function readDailyReportingAdminState(scope: WorkspaceScope): DailyReportingAdminState {
  return versioned(scope).value
}
function mutate<T>(scope: WorkspaceScope, change: (state: DailyReportingAdminState) => T): T {
  const current = versioned(scope)
  const result = change(current.value)
  setAppStateIfRevision(current.key, current.value, current.revision)
  return result
}
function scopeFromRequest(req: Request): WorkspaceScope {
  const user = req.authUser
  if (!user) throw new Error('A verified tenant, organization and account scope is required.')
  return { tenantId: user.tenantId, tenantName: user.tenantName, organizationId: user.organizationId, organizationName: user.organizationName, accountId: user.accountId, accountName: user.accountName, role: user.role, isPlatformAdmin: user.isPlatformAdmin }
}
function actorId(req: Request): string { return req.authUser?.id ?? 'unknown' }
function actorName(req: Request): string { return req.authUser?.displayName ?? '工作区成员' }
function audit(req: Request, scope: WorkspaceScope, action: string, subject: string, summary: Record<string, unknown>): void {
  const compactSummary = JSON.stringify(summary).slice(0, 400)
  recordSecurityEvent({ userId: actorId(req), tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId, event: action, subject: `${subject} ${compactSummary}`, ip: req.ip, userAgent: req.get('user-agent') })
  // Business values stay in scoped app_state; the security audit receives only a compact count/operation summary.
}
function partyNameKey(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') }
function partyKind(value: unknown): value is DailyPartyKind { return value === 'customer' || value === 'supplier' }
function businessKind(value: unknown): value is DailyBusinessKind { return value === 'sales' || value === 'purchase' }
function kindForBusiness(value: DailyBusinessKind): DailyPartyKind { return value === 'sales' ? 'customer' : 'supplier' }
function safeCandidates(value: unknown): Array<{ legacyId?: string; name: string; score?: number }> {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap(item => {
    const candidate = asRecord(item), name = text(candidate.name, 200), legacyId = text(candidate.id ?? candidate.legacyId, 128)
    const score = typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? Math.max(0, Math.min(1, candidate.score)) : undefined
    return name ? [{ ...(legacyId ? { legacyId } : {}), name, ...(score === undefined ? {} : { score }) }] : []
  })
}
function masterMemberList(scope: WorkspaceScope) {
  return db.prepare(`SELECT u.id,u.display_name AS displayName,m.role,
    CASE WHEN u.disabled=1 OR m.disabled=1 THEN 1 ELSE 0 END AS disabled
    FROM tenant_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? ORDER BY u.display_name COLLATE NOCASE,u.id`)
    .all(scope.tenantId, scope.organizationId, scope.accountId) as Array<{ id: string; displayName: string; role: string; disabled: number }>
}
function isMemberInScope(scope: WorkspaceScope, userId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id
    JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id
    JOIN organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?
      AND m.disabled=0 AND u.disabled=0 AND a.status='active' AND o.status='active' AND t.status='active'`)
    .get(userId, scope.tenantId, scope.organizationId, scope.accountId))
}
export function findDailyParty(scope: WorkspaceScope, id: string, kind?: DailyPartyKind): DailyParty | undefined {
  return readDailyReportingAdminState(scope).parties.find(item => item.id === id && item.active && (!kind || item.kind === kind))
}
export function findLegacyDailyParty(scope: WorkspaceScope, kind: DailyPartyKind, companyCode: string, legacyId: string): DailyParty | undefined {
  return readDailyReportingAdminState(scope).parties.find(item => item.kind === kind && item.legacyCompanyCode === companyCode && item.legacyId === legacyId)
}
export function hasDailyPartyAssignment(scope: WorkspaceScope, userId: string, kind: DailyPartyKind, partyId: string): boolean {
  return readDailyReportingAdminState(scope).assignments.some(item => item.kind === kind && item.partyId === partyId && item.userId === userId && item.status === 'mapped')
}
export function isDailyReportingMember(scope: WorkspaceScope, userId: string): boolean { return isMemberInScope(scope, userId) }
export function getDailyReportingAccess(scope: WorkspaceScope, userId: string, role: string) {
  const state = readDailyReportingAdminState(scope), manager = role === 'admin' || role === 'plm_manager'
  if (manager) return { sales: true, purchase: true, canManage: true, canWrite: true }
  if (role === 'reviewer') return { sales: true, purchase: true, canManage: false, canWrite: false }
  const assigned = (kind: DailyPartyKind) => state.assignments.some(item => item.kind === kind && item.userId === userId && item.status === 'mapped' && state.parties.some(party => party.id === item.partyId && party.kind === kind && party.active))
  return { sales: assigned('customer'), purchase: assigned('supplier'), canManage: false, canWrite: role === 'member' }
}
export function listDailyPartyOptions(scope: WorkspaceScope, userId: string, role: string, kind: DailyPartyKind): DailyParty[] {
  const state = readDailyReportingAdminState(scope), manager = role === 'admin' || role === 'plm_manager'
  return state.parties.filter(item => item.kind === kind && item.active && (manager || hasDailyPartyAssignment(scope, userId, kind, item.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
export function recordDailyReportingMigrationBatch(scope: WorkspaceScope, req: Request, category: string, companyCode: string, rowCount: number, digest: string, counters: { inserted: number; skipped: number; conflicts: number }): DailyManagementImportBatch {
  const batch = { id: randomUUID(), category, sourceCompanyCode: companyCode, rowCount, ...counters, digest, createdAt: new Date().toISOString(), createdBy: actorId(req) }
  mutate(scope, current => { current.importBatches.unshift(batch); current.importBatches = current.importBatches.slice(0, 500) })
  audit(req, scope, 'daily_reporting_migration_import', `${category}:${companyCode}`, { rowCount, ...counters })
  return batch
}
function importBatch(scope: WorkspaceScope, req: Request, category: string, companyCode: string, rows: unknown[], digest: string, counters: { inserted: number; skipped: number; conflicts: number }): DailyManagementImportBatch {
  return recordDailyReportingMigrationBatch(scope, req, category, companyCode, rows.length, digest, counters)
}
function rowsDigest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function validatePartyInput(body: Record<string, unknown>, kind: DailyPartyKind): Omit<DailyParty, 'id' | 'createdAt' | 'updatedAt' | 'source'> | undefined {
  const name = text(body.name, 120), k3Number = text(body.k3Number, 128), legacyCompanyCode = text(body.legacyCompanyCode, 32).toUpperCase(), legacyId = text(body.legacyId, 128)
  const aliases = Array.isArray(body.aliases) ? [...new Set(body.aliases.map(value => text(value, 120)).filter(Boolean))].slice(0, 50) : []
  if (!name || (body.aliases !== undefined && !Array.isArray(body.aliases)) || aliases.some(value => value.length > 120)) return undefined
  return { kind, name, aliases, active: body.active === undefined ? true : body.active === true, k3Number, legacyCompanyCode, legacyId }
}
function duplicateParty(state: DailyReportingAdminState, input: Pick<DailyParty, 'kind' | 'name' | 'aliases' | 'k3Number' | 'legacyCompanyCode' | 'legacyId'>, exceptId = ''): string | undefined {
  const labels = new Set([input.name, ...input.aliases].map(partyNameKey))
  const duplicate = state.parties.find(item => item.id !== exceptId && item.kind === input.kind && (
    [item.name, ...item.aliases].some(value => labels.has(partyNameKey(value))) ||
    Boolean(input.k3Number && item.k3Number === input.k3Number) ||
    Boolean(input.legacyId && input.legacyCompanyCode && item.legacyId === input.legacyId && item.legacyCompanyCode === input.legacyCompanyCode)
  ))
  return duplicate ? `名称/别名、K3 编码或旧系统主键与「${duplicate.name}」重复。` : undefined
}

export function createDailyReportingAdminRouter(): Router {
  const router = Router()

  router.get('/daily-reporting/party-options', requireAuthenticated, (req, res) => {
    const kind = req.query.kind
    if (!partyKind(kind)) return res.status(400).json({ error: 'kind 必须为 customer 或 supplier。' })
    const scope = scopeFromRequest(req), user = req.authUser!
    return res.json({ parties: listDailyPartyOptions(scope, user.id, user.role, kind), masterDataConfigured: readDailyReportingAdminState(scope).masterDataConfigured })
  })

  router.get('/daily-reporting/access', requireAuthenticated, (req, res) => {
    const scope = scopeFromRequest(req), user = req.authUser!
    return res.json(getDailyReportingAccess(scope, user.id, user.role))
  })

  router.get('/daily-reporting/k3-party-mirror', requireRole(...MANAGERS), (req, res) => {
    const kind = req.query.kind
    if (!partyKind(kind)) return res.status(400).json({ error: 'kind 必须为 customer 或 supplier。' })
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120).toLocaleLowerCase() : ''
    const mirror = readK3CloudMasterData(scopeFromRequest(req)), records = mirror.records[kind] ?? []
    const matched = records.filter(item => !query || item.number.toLocaleLowerCase().includes(query) || item.name.toLocaleLowerCase().includes(query)).slice(0, 200)
    return res.json({ kind, count: matched.length, total: records.length, records: matched.map(item => ({ number: item.number, name: item.name, status: item.status })), lastSyncedAt: mirror.lastSyncedAt })
  })

  router.get('/daily-reporting/management', requireRole(...MANAGERS), (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportingAdminState(scope)
    const members = masterMemberList(scope).map(item => ({ id: item.id, displayName: item.displayName, role: item.role, disabled: Boolean(item.disabled) }))
    const mirror = readK3CloudMasterData(scope)
    const k3Parties = { customerCount: mirror.rowCounts.customer ?? 0, supplierCount: mirror.rowCounts.supplier ?? 0, lastSyncedAt: mirror.lastSyncedAt }
    const account = db.prepare('SELECT code FROM accounts WHERE id=? AND tenant_id=? AND organization_id=?').get(scope.accountId, scope.tenantId, scope.organizationId) as { code: string } | undefined
    const migrationScope = { tenantId: scope.tenantId, tenantName: scope.tenantName, organizationId: scope.organizationId, organizationName: scope.organizationName, accountId: scope.accountId, accountName: scope.accountName, accountCode: account?.code ?? '' }
    return res.json({ ...state, members, k3Parties, migrationScope })
  })

  router.post('/daily-reporting/masters', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), kind = body.kind
    if (!partyKind(kind)) return res.status(400).json({ error: 'kind 必须为 customer 或 supplier。' })
    const input = validatePartyInput(body, kind)
    if (!input) return res.status(400).json({ error: 'invalid_party', message: '名称必填，别名必须为文本数组。' })
    const scope = scopeFromRequest(req)
    try {
      const created = mutate(scope, state => {
        const duplicate = duplicateParty(state, input)
        if (duplicate) throw new TypeError(duplicate)
        const now = new Date().toISOString(), party: DailyParty = { ...input, id: randomUUID(), source: 'manual', createdAt: now, updatedAt: now }
        state.parties.unshift(party); state.masterDataConfigured = true
        return party
      })
      audit(req, scope, 'daily_reporting_party_created', `${kind}:${created.id}`, { kind })
      return res.status(201).json(created)
    } catch (error) { const status = error instanceof StateConflictError ? 409 : error instanceof TypeError ? 409 : 500; return res.status(status).json({ error: status === 409 ? 'party_conflict' : 'party_save_failed', message: error instanceof Error ? error.message : '主数据保存失败。' }) }
  })

  router.patch('/daily-reporting/masters/:id', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), kind = body.kind
    if (!partyKind(kind)) return res.status(400).json({ error: 'kind 必须为 customer 或 supplier。' })
    const input = validatePartyInput(body, kind)
    if (!input) return res.status(400).json({ error: 'invalid_party', message: '名称必填，别名必须为文本数组。' })
    const scope = scopeFromRequest(req)
    try {
      const result = mutate(scope, state => {
        const party = state.parties.find(item => item.id === String(req.params.id) && item.kind === kind)
        if (!party) return undefined
        const duplicate = duplicateParty(state, input, party.id)
        if (duplicate) throw new TypeError(duplicate)
        Object.assign(party, input, { updatedAt: new Date().toISOString() })
        return party
      })
      if (!result) return res.status(404).json({ error: 'party_not_found' })
      audit(req, scope, 'daily_reporting_party_updated', `${kind}:${result.id}`, { kind, active: result.active })
      return res.json(result)
    } catch (error) { const status = error instanceof StateConflictError ? 409 : error instanceof TypeError ? 409 : 500; return res.status(status).json({ error: status === 409 ? 'party_conflict' : 'party_save_failed', message: error instanceof Error ? error.message : '主数据保存失败。' }) }
  })

  router.get('/daily-reporting/exchange-rates', requireAuthenticated, (req, res) => {
    const scope = scopeFromRequest(req), rates = readDailyReportingAdminState(scope).exchangeRates.sort((a, b) => b.month.localeCompare(a.month))
    return res.json({ rates })
  })

  router.put('/daily-reporting/exchange-rates', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), month = text(body.month, 7), rate = decimalText(body.rate, 4)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !rate || Number(rate) <= 0) return res.status(400).json({ error: '汇率月份必须为 YYYY-MM，USD→CNY 汇率须大于 0 且最多 4 位小数。' })
    const scope = scopeFromRequest(req)
    try {
      const saved = mutate(scope, state => {
        const existing = state.exchangeRates.find(item => item.month === month)
        if (existing) Object.assign(existing, { rate, source: 'manual' as const, updatedAt: new Date().toISOString() })
        else state.exchangeRates.unshift({ id: randomUUID(), month, currency: 'USD', targetCurrency: 'CNY', rate, source: 'manual', updatedAt: new Date().toISOString() })
        return state.exchangeRates.find(item => item.month === month)!
      })
      audit(req, scope, 'daily_reporting_exchange_rate_saved', month, { currency: 'USD', targetCurrency: 'CNY' })
      return res.json(saved)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'exchange_rate_save_failed', message: error instanceof Error ? error.message : '汇率保存失败。' }) }
  })

  router.put('/daily-reporting/assignments/:id', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), partyId = text(body.partyId, 100), userId = text(body.userId, 100)
    if (!partyId || !userId) return res.status(400).json({ error: 'partyId 和 userId 必填。' })
    const scope = scopeFromRequest(req)
    if (!isMemberInScope(scope, userId)) return res.status(403).json({ error: 'member_out_of_scope', message: '只能分配给当前账套中已启用的成员，不会自动邀请或提权。' })
    try {
      const result = mutate(scope, state => {
        const assignment = state.assignments.find(item => item.id === String(req.params.id))
        const party = state.parties.find(item => item.id === partyId && item.kind === assignment?.kind && item.active)
        if (!assignment || !party) return undefined
        assignment.partyId = party.id; assignment.userId = userId; assignment.status = 'mapped'; assignment.updatedAt = new Date().toISOString()
        return assignment
      })
      if (!result) return res.status(404).json({ error: 'assignment_not_found', message: '归属记录或客商不存在。' })
      audit(req, scope, 'daily_reporting_assignment_mapped', result.id, { kind: result.kind })
      return res.json(result)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'assignment_update_failed', message: error instanceof Error ? error.message : '归属更新失败。' }) }
  })

  router.post('/daily-reporting/assignments', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), kind = body.kind, partyId = text(body.partyId, 100), userIds = Array.isArray(body.userIds) ? [...new Set(body.userIds.map(value => text(value, 100)).filter(Boolean))] : []
    if (!partyKind(kind) || !partyId || userIds.length > 100) return res.status(400).json({ error: '归属类型、客商或用户列表无效。' })
    if (body.expectedUserIds !== undefined && (!Array.isArray(body.expectedUserIds) || body.expectedUserIds.length > 100 || body.expectedUserIds.some(value => typeof value !== 'string' || !value.trim() || value.length > 100))) return res.status(400).json({ error: 'invalid_assignment_snapshot', message: '预期成员列表无效，请刷新后重新选择客商。' })
    const expectedUserIds = Array.isArray(body.expectedUserIds) ? [...new Set(body.expectedUserIds.map(value => text(value, 100)))].sort() : undefined
    const scope = scopeFromRequest(req)
    if (!readDailyReportingAdminState(scope).parties.some(item => item.id === partyId && item.kind === kind && item.active)) return res.status(404).json({ error: 'party_not_found' })
    if (userIds.some(id => !isMemberInScope(scope, id))) return res.status(403).json({ error: 'member_out_of_scope', message: '只能分配给当前账套中已启用的成员。' })
    try {
      const state = mutate(scope, current => {
        const actualUserIds = [...new Set(current.assignments.filter(item => item.kind === kind && item.partyId === partyId && item.userId).map(item => item.userId!))].sort()
        if (expectedUserIds && JSON.stringify(expectedUserIds) !== JSON.stringify(actualUserIds)) throw new TypeError('该客商归属已被其他操作更新，本次未保存或移除任何成员。请刷新并重新选择客商后核对成员列表。')
        current.assignments = current.assignments.filter(item => !(item.kind === kind && item.partyId === partyId && item.userId && !userIds.includes(item.userId)))
        for (const userId of userIds) {
          const prior = current.assignments.find(item => item.kind === kind && item.partyId === partyId && item.userId === userId)
          if (prior) continue
          current.assignments.push({ id: randomUUID(), kind, partyId, userId, legacyCompanyCode: '', legacyPartyId: '', legacyUserId: '', legacyUsername: '', legacyUserName: '', status: 'mapped', updatedAt: new Date().toISOString() })
        }
        return current
      })
      audit(req, scope, 'daily_reporting_assignments_saved', `${kind}:${partyId}`, { memberCount: userIds.length })
      return res.json({ assignments: state.assignments.filter(item => item.kind === kind && item.partyId === partyId) })
    } catch (error) { return res.status(error instanceof StateConflictError || error instanceof TypeError ? 409 : 500).json({ error: error instanceof TypeError ? 'assignment_snapshot_conflict' : 'assignment_save_failed', message: error instanceof Error ? error.message : '归属保存失败。' }) }
  })

  router.put('/daily-reporting/party-mappings/:id', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), partyId = text(body.partyId, 100)
    if (!partyId) return res.status(400).json({ error: 'partyId 必填。' })
    const scope = scopeFromRequest(req)
    try {
      const result = mutate(scope, state => {
        const mapping = state.partyMappings.find(item => item.id === String(req.params.id))
        if (!mapping) return undefined
        const party = state.parties.find(item => item.id === partyId && item.kind === mapping.kind && item.active)
        if (!party) throw new TypeError('只能映射到当前账套同类型且启用的客户/供应商。')
        mapping.partyId = party.id; mapping.status = 'MANUAL'; mapping.updatedAt = new Date().toISOString(); mapping.updatedBy = actorId(req)
        return mapping
      })
      if (!result) return res.status(404).json({ error: 'party_mapping_not_found' })
      audit(req, scope, 'daily_reporting_party_mapping_confirmed', result.id, { kind: result.kind })
      return res.json(result)
    } catch (error) { const status = error instanceof StateConflictError ? 409 : error instanceof TypeError ? 400 : 500; return res.status(status).json({ error: status === 409 ? 'workspace_conflict' : status === 400 ? 'invalid_party_mapping' : 'party_mapping_save_failed', message: error instanceof Error ? error.message : '客商映射保存失败。' }) }
  })

  router.delete('/daily-reporting/party-mappings/:id', requireRole('admin'), (req, res) => {
    const scope = scopeFromRequest(req)
    try {
      const result = mutate(scope, state => {
        const mapping = state.partyMappings.find(item => item.id === String(req.params.id))
        if (!mapping) return false
        mapping.partyId = null; mapping.status = 'UNMATCHED'; mapping.updatedAt = new Date().toISOString(); mapping.updatedBy = actorId(req)
        return true
      })
      if (!result) return res.status(404).json({ error: 'party_mapping_not_found' })
      audit(req, scope, 'daily_reporting_party_mapping_cleared', String(req.params.id), {})
      return res.status(204).end()
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'party_mapping_clear_failed', message: error instanceof Error ? error.message : '客商映射清除失败。' }) }
  })

  router.post('/daily-reporting/migration/parties', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), rows = body.rows
    if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: '一次最多导入 500 条主数据。' })
    const parsed = rows.map(value => {
      const row = asRecord(value), kind = row.kind
      if (!partyKind(kind)) return undefined
      const input = validatePartyInput(row, kind)
      return input && input.legacyCompanyCode && input.legacyId ? input : undefined
    })
    if (parsed.some(item => !item)) return res.status(400).json({ error: '主数据导入行必须含有效 kind、name、legacyCompanyCode 与 legacyId。' })
    const scope = scopeFromRequest(req), digest = rowsDigest(rows), counters = { inserted: 0, skipped: 0, conflicts: 0 }
    try {
      mutate(scope, state => {
        for (const input of parsed as Array<ReturnType<typeof validatePartyInput>>) {
          const item = input!
          const existing = state.parties.find(party => party.kind === item.kind && party.legacyCompanyCode === item.legacyCompanyCode && party.legacyId === item.legacyId)
          if (existing) {
            if (existing.name === item.name && existing.active === item.active && JSON.stringify([...existing.aliases].sort()) === JSON.stringify([...item.aliases].sort())) counters.skipped += 1
            else counters.conflicts += 1
            continue
          }
          const duplicate = duplicateParty(state, item)
          if (duplicate) { counters.conflicts += 1; continue }
          const now = new Date().toISOString()
          state.parties.push({ ...item, id: randomUUID(), source: 'legacy-import', createdAt: now, updatedAt: now })
          counters.inserted += 1
        }
        state.masterDataConfigured = Boolean(state.parties.length)
      })
      const batch = importBatch(scope, req, 'M03-parties', text(body.companyCode, 32).toUpperCase(), rows, digest, counters)
      return res.status(counters.conflicts ? 207 : 201).json({ batch, ...counters, rowCount: rows.length, conflictNote: counters.conflicts ? '同旧主键内容不同或与现有名称/K3 编码冲突；冲突项未覆盖。' : undefined })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'party_import_failed', message: error instanceof Error ? error.message : '主数据迁移失败。' }) }
  })

  router.post('/daily-reporting/migration/rates', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), rows = body.rows
    if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: '一次最多导入 500 条汇率。' })
    const parsed = rows.map(value => {
      const row = asRecord(value), month = text(row.month, 7), rate = decimalText(row.rate, 4)
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && rate && Number(rate) > 0 ? { month, rate, legacyCompanyCode: text(row.legacyCompanyCode ?? body.companyCode, 32).toUpperCase() } : undefined
    })
    if (parsed.some(item => !item)) return res.status(400).json({ error: '汇率导入行必须含有效月份和正数 USD/CNY 汇率（最多 4 位小数）。' })
    const scope = scopeFromRequest(req), counters = { inserted: 0, skipped: 0, conflicts: 0 }, digest = rowsDigest(rows)
    try {
      mutate(scope, state => {
        for (const item of parsed as Array<NonNullable<(typeof parsed)[number]>>) {
          const existing = state.exchangeRates.find(rate => rate.month === item.month)
          if (existing) { if (existing.rate === item.rate) counters.skipped += 1; else counters.conflicts += 1; continue }
          state.exchangeRates.push({ id: randomUUID(), month: item.month, currency: 'USD', targetCurrency: 'CNY', rate: item.rate, source: 'legacy-import', legacyCompanyCode: item.legacyCompanyCode, updatedAt: new Date().toISOString() })
          counters.inserted += 1
        }
        state.exchangeRates.sort((a, b) => b.month.localeCompare(a.month))
      })
      const batch = importBatch(scope, req, 'M04-rates', text(body.companyCode, 32).toUpperCase(), rows, digest, counters)
      return res.status(counters.conflicts ? 207 : 201).json({ batch, ...counters, rowCount: rows.length })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'rate_import_failed', message: error instanceof Error ? error.message : '历史汇率迁移失败。' }) }
  })

  router.post('/daily-reporting/migration/assignments', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), rows = body.rows
    if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: '一次最多导入 500 条归属关系。' })
    const parsed = rows.map(value => {
      const row = asRecord(value), kind = row.kind
      const legacyCompanyCode = text(row.legacyCompanyCode ?? body.companyCode, 32).toUpperCase(), legacyPartyId = text(row.legacyPartyId, 128), legacyUserId = text(row.legacyUserId, 128)
      if (!partyKind(kind) || !legacyCompanyCode || !legacyPartyId || !legacyUserId) return undefined
      return { kind, legacyCompanyCode, legacyPartyId, legacyUserId, legacyUsername: text(row.legacyUsername, 128), legacyUserName: text(row.legacyUserName, 160) }
    })
    if (parsed.some(item => !item)) return res.status(400).json({ error: '归属导入行必须含 kind、legacyCompanyCode、legacyPartyId 与 legacyUserId。' })
    const scope = scopeFromRequest(req), counters = { inserted: 0, skipped: 0, conflicts: 0 }, digest = rowsDigest(rows)
    try {
      mutate(scope, state => {
        for (const item of parsed as Array<NonNullable<(typeof parsed)[number]>>) {
          const prior = state.assignments.find(value => value.kind === item.kind && value.legacyCompanyCode === item.legacyCompanyCode && value.legacyPartyId === item.legacyPartyId && value.legacyUserId === item.legacyUserId)
          if (prior) { counters.skipped += 1; continue }
          const party = state.parties.find(value => value.kind === item.kind && value.legacyCompanyCode === item.legacyCompanyCode && value.legacyId === item.legacyPartyId)
          state.assignments.push({ id: randomUUID(), kind: item.kind, partyId: party?.id ?? null, userId: null, legacyCompanyCode: item.legacyCompanyCode, legacyPartyId: item.legacyPartyId, legacyUserId: item.legacyUserId, legacyUsername: item.legacyUsername, legacyUserName: item.legacyUserName, status: party ? 'member-unmapped' : 'party-unmapped', updatedAt: new Date().toISOString() })
          counters.inserted += 1
        }
      })
      const batch = importBatch(scope, req, 'M05-assignments', text(body.companyCode, 32).toUpperCase(), rows, digest, counters)
      return res.status(201).json({ batch, ...counters, rowCount: rows.length, note: '只保留旧系统归属事实；未创建用户、未分配 PLM 权限，需管理员将其映射到当前账套既有成员。' })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'assignment_import_failed', message: error instanceof Error ? error.message : '归属迁移失败。' }) }
  })

  router.post('/daily-reporting/migration/memberships', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), rows = body.rows, companyCode = text(body.companyCode, 32).toUpperCase()
    if (!companyCode || !Array.isArray(rows) || rows.length < 1 || rows.length > 500) return res.status(400).json({ error: '一次需导入 1–500 条、含公司代码的旧公司成员关系。' })
    const parsed = rows.map(value => {
      const row = asRecord(value), legacyUserId = text(row.legacyUserId, 128), legacyUsername = text(row.legacyUsername, 128), legacyUserName = text(row.legacyUserName, 160)
      if (!legacyUserId || !legacyUsername || typeof row.active !== 'boolean' || (row.groups !== undefined && !Array.isArray(row.groups)) || (row.mustChangePassword !== undefined && typeof row.mustChangePassword !== 'boolean')) return undefined
      const legacyGroups = Array.isArray(row.groups) ? [...new Set(row.groups.map(value => text(value, 100)).filter(Boolean))].sort().slice(0, 50) : []
      return { legacyCompanyCode: companyCode, legacyUserId, legacyUsername, legacyUserName, legacyGroups, legacyActive: row.active, legacyMustChangePassword: row.mustChangePassword === true }
    })
    if (parsed.some(item => !item)) return res.status(400).json({ error: '成员关系必须含 legacyUserId、legacyUsername、active，且 groups 为文本数组。' })
    const scope = scopeFromRequest(req), digest = rowsDigest(rows), counters = { inserted: 0, skipped: 0, conflicts: 0 }
    try {
      mutate(scope, state => {
        for (const item of parsed as Array<NonNullable<(typeof parsed)[number]>>) {
          const prior = state.legacyMemberships.find(value => value.legacyCompanyCode === item.legacyCompanyCode && value.legacyUserId === item.legacyUserId)
          if (prior) {
            if (prior.legacyUsername === item.legacyUsername && prior.legacyUserName === item.legacyUserName && prior.legacyActive === item.legacyActive && prior.legacyMustChangePassword === item.legacyMustChangePassword && JSON.stringify(prior.legacyGroups) === JSON.stringify(item.legacyGroups)) counters.skipped += 1
            else counters.conflicts += 1
            continue
          }
          state.legacyMemberships.push({ id: randomUUID(), ...item, status: 'member-unmapped', updatedAt: new Date().toISOString() })
          counters.inserted += 1
        }
      })
      const batch = importBatch(scope, req, 'M08-memberships', companyCode, rows, digest, counters)
      return res.status(counters.conflicts ? 207 : 201).json({ batch, ...counters, rowCount: rows.length, note: '仅保留旧成员、群组与密码策略为待核验元数据；未读取凭据、未创建 PLM 用户、未分配成员关系或角色。' })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'membership_import_failed', message: error instanceof Error ? error.message : '旧公司成员关系迁移失败。' }) }
  })

  router.post('/daily-reporting/migration/party-mappings', requireRole(...MANAGERS), (req, res) => {
    const body = asRecord(req.body), rows = body.rows
    if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: '一次最多导入 500 条客商映射。' })
    const parsed = rows.map(value => {
      const row = asRecord(value), kind = row.kind, k3Number = text(row.k3Number, 128), k3Name = text(row.k3Name, 200), legacyCompanyCode = text(row.legacyCompanyCode ?? body.companyCode, 32).toUpperCase()
      if (!partyKind(kind) || !k3Number || !k3Name || !legacyCompanyCode) return undefined
      return { kind, k3Number, k3Name, legacyCompanyCode, legacyPartyId: text(row.legacyPartyId, 128), legacyStatus: text(row.status, 24).toUpperCase(), candidates: safeCandidates(row.candidates) }
    })
    if (parsed.some(item => !item)) return res.status(400).json({ error: '客商映射行必须含 kind、K3 编码、K3 名称和旧公司代码。' })
    const scope = scopeFromRequest(req), counters = { inserted: 0, skipped: 0, conflicts: 0 }, digest = rowsDigest(rows)
    try {
      mutate(scope, state => {
        for (const item of parsed as Array<NonNullable<(typeof parsed)[number]>>) {
          const existing = state.partyMappings.find(value => value.kind === item.kind && value.legacyCompanyCode === item.legacyCompanyCode && value.k3Number === item.k3Number)
          if (existing) { counters.skipped += 1; continue }
          // Never promote an imported AUTO/MANUAL decision. Re-check the ERP code in PLM and require an explicit confirmation.
          const status: DailyMappingStatus = item.legacyStatus === 'UNMATCHED' ? 'UNMATCHED' : 'PENDING'
          state.partyMappings.push({ id: randomUUID(), kind: item.kind, k3Number: item.k3Number, k3Name: item.k3Name, partyId: null, status, legacyStatus: item.legacyStatus || 'UNKNOWN', legacyPartyId: item.legacyPartyId, legacyCompanyCode: item.legacyCompanyCode, candidates: item.candidates, updatedAt: new Date().toISOString(), updatedBy: actorId(req) })
          counters.inserted += 1
        }
      })
      const batch = importBatch(scope, req, 'M13-party-mappings', text(body.companyCode, 32).toUpperCase(), rows, digest, counters)
      return res.status(201).json({ batch, ...counters, rowCount: rows.length, note: '旧状态保留在 legacyStatus；所有已匹配/待审记录在 PLM 中均需重新核验，不会自动变成 MANUAL。' })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'party_mapping_import_failed', message: error instanceof Error ? error.message : '客商映射迁移失败。' }) }
  })

  router.get('/daily-reporting/migration/batches', requireRole(...MANAGERS), (req, res) => {
    return res.json({ batches: readDailyReportingAdminState(scopeFromRequest(req)).importBatches })
  })

  return router
}
