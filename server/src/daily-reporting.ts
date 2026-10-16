import { createHash, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { Router, type Request } from 'express'
import { requireRole } from './auth.js'
import { getAppStateVersioned, setAppStateIfRevision, StateConflictError } from './database.js'
import type { WorkspaceScope } from './scope.js'

export type DailyKind = 'sales' | 'purchase'
export type K3DocumentKind = 'shipment' | 'purchase-receipt' | 'sales-order' | 'purchase-order' | 'receivable' | 'payable' | 'sales-invoice' | 'purchase-invoice'
export const DAILY_K3_SOURCE_KINDS: K3DocumentKind[] = ['shipment', 'purchase-receipt', 'sales-order', 'purchase-order', 'receivable', 'payable', 'sales-invoice', 'purchase-invoice']
export const DAILY_K3_REQUIRED_FIELDS = ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] as const
export type DailyK3Field = 'id' | 'billNo' | 'date' | 'modifiedAt' | 'partyNumber' | 'partyName' | 'materialName' | 'quantity' | 'unit' | 'unitPrice' | 'currency' | 'originalAmount' | 'amountCny' | 'settledAmountCny' | 'status' | 'upstreamId' | 'upstreamBillNo' | 'upstreamLineId' | 'taxAmount' | 'taxAmountCny'
export type DailyK3SourceMapping = { formId: string; fields: Partial<Record<DailyK3Field, string>> }
export type DailyK3SyncMetadata = { source: 'k3cloud'; lastSyncedAt: string; rowCounts: Partial<Record<K3DocumentKind, number>>; changedRowCounts?: Partial<Record<K3DocumentKind, number>>; mode?: 'full' | 'incremental' | 'mixed'; incrementalFrom?: string | null; fullScanKinds?: K3DocumentKind[] }
export type DailySource = 'manual' | 'history-import'

export interface DailyReport {
  id: string; type: DailyKind; date: string; partyName: string; documentNo: string; quantity: number; currency: string
  originalAmount: number; exchangeRate: number; amountCny: number; note: string; source: DailySource
  createdAt: string; updatedAt: string; createdBy: string; createdByName: string; updatedBy: string; deletedAt?: string; deletedBy?: string
}
export interface K3SnapshotRow {
  id: string; kind: K3DocumentKind; type: DailyKind; billNo: string; date: string; partyNumber: string; partyName: string
  materialName: string; quantity: number; unit: string; currency: string; originalAmount: number; amountCny: number
  settledAmountCny: number; status: string; source: 'local-mock' | 'k3cloud'; snapshotAt: string; active: boolean
  erpId?: string; modifiedAt?: string; unitPrice?: number; upstreamId?: string; upstreamBillNo?: string; upstreamLineId?: string; taxAmount?: number; taxAmountCny?: number
  linkedDocuments?: Array<Pick<K3SnapshotRow, 'id' | 'kind' | 'billNo' | 'date' | 'partyName' | 'materialName' | 'quantity' | 'unit' | 'unitPrice' | 'currency' | 'amountCny' | 'status'>>
}
export interface DailyReportLink {
  id: string; reportId: string; k3RowId: string; allocatedAmount: number; allocatedQuantity: number; linkedAt: string
  linkedBy: string; referenceK3Amount: number; referenceDailyAmount: number
}
export interface DailyCorrection {
  id: string; originalDate: string; type: string; affectedReport: DailyKind; referenceId: string
  originalValue: number | null; newValue: number | null; diffAmount: number; reason: string; detectedAt: string
  reportedInSnapshotId: string | null
}
export interface DailySnapshot {
  id: string; reportDate: string; scope: 'sales' | 'purchase' | 'both'; version: number; createdAt: string
  createdBy: string; source: 'local-mock' | 'k3cloud' | 'workspace'; calculationVersion: string; isComplete: boolean
  warnings: string[]; data: Record<string, unknown>
}
export interface DailyDelivery {
  id: string; snapshotId: string; channel: 'email' | 'dingtalk'; targetDisplay: string; status: 'simulated'
  message: string; createdAt: string; createdBy: string
}
export interface DailyReportState {
  reports: DailyReport[]; k3Rows: K3SnapshotRow[]; links: DailyReportLink[]; snapshots: DailySnapshot[]
  corrections: DailyCorrection[]; deliveries: DailyDelivery[]; mockSnapshotAt: string | null; mockEnabled: boolean; k3Sync: DailyK3SyncMetadata | null
}

const STATE_PREFIX = 'daily-reporting'
const WRITERS = ['admin', 'plm_manager', 'member'] as const
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const validKind = (value: unknown): value is DailyKind => value === 'sales' || value === 'purchase'
const finite = (value: unknown): number | undefined => {
  if (value === '' || value === null || value === undefined) return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}
const deepClone = <T>(value: T): T => structuredClone(value)
function stateKey(scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>): string {
  return `${STATE_PREFIX}:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}
function emptyState(): DailyReportState {
  return { reports: [], k3Rows: [], links: [], snapshots: [], corrections: [], deliveries: [], mockSnapshotAt: null, mockEnabled: false, k3Sync: null }
}
function normalizedState(value: unknown): DailyReportState {
  const state = { ...emptyState(), ...asRecord(value) } as DailyReportState
  for (const key of ['reports', 'k3Rows', 'links', 'snapshots', 'corrections', 'deliveries'] as const) if (!Array.isArray(state[key])) state[key] = [] as never
  state.mockEnabled = Boolean(state.mockEnabled)
  state.mockSnapshotAt = typeof state.mockSnapshotAt === 'string' ? state.mockSnapshotAt : null
  state.k3Sync = state.k3Sync && typeof state.k3Sync.lastSyncedAt === 'string' ? state.k3Sync : null
  return state
}
function localMockAllowed(): boolean { return process.env.NODE_ENV !== 'production' }

function makeLocalMockState(): DailyReportState {
  const now = new Date().toISOString()
  const state = emptyState()
  state.mockEnabled = true
  state.mockSnapshotAt = now
  state.k3Rows = [
    { id: 'mock-k3-sales-001', kind: 'shipment', type: 'sales', billNo: 'MOCK-SO-OUT-001', date: '2026-10-15', partyNumber: 'MOCK-C-001', partyName: '示例客户·星河制造', materialName: '智能控制模块', quantity: 50, unit: '件', unitPrice: 200, currency: 'CNY', originalAmount: 10000, amountCny: 10000, settledAmountCny: 0, status: '已审核', upstreamBillNo: 'MOCK-SO-001', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-sales-002', kind: 'shipment', type: 'sales', billNo: 'MOCK-SO-OUT-002', date: '2026-10-14', partyNumber: 'MOCK-C-002', partyName: '示例客户·远帆科技', materialName: '传感器组件', quantity: 24, unit: '件', currency: 'USD', originalAmount: 360, amountCny: 2592, settledAmountCny: 0, status: '已审核', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-purchase-001', kind: 'purchase-receipt', type: 'purchase', billNo: 'MOCK-PO-IN-001', date: '2026-10-15', partyNumber: 'MOCK-S-001', partyName: '示例供应商·宏达电子', materialName: '控制芯片', quantity: 200, unit: '片', unitPrice: 30, currency: 'CNY', originalAmount: 6000, amountCny: 6000, settledAmountCny: 0, status: '已审核', upstreamBillNo: 'MOCK-PO-001', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-sales-order-001', kind: 'sales-order', type: 'sales', billNo: 'MOCK-SO-001', date: '2026-10-15', partyNumber: 'MOCK-C-001', partyName: '示例客户·星河制造', materialName: '智能控制模块', quantity: 120, unit: '件', unitPrice: 200, currency: 'CNY', originalAmount: 24000, amountCny: 24000, settledAmountCny: 0, status: '部分发货', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-purchase-order-001', kind: 'purchase-order', type: 'purchase', billNo: 'MOCK-PO-001', date: '2026-10-15', partyNumber: 'MOCK-S-001', partyName: '示例供应商·宏达电子', materialName: '控制芯片', quantity: 500, unit: '片', unitPrice: 28, currency: 'CNY', originalAmount: 14000, amountCny: 14000, settledAmountCny: 0, status: '已审核', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-receivable-001', kind: 'receivable', type: 'sales', billNo: 'MOCK-AR-001', date: '2026-10-15', partyNumber: 'MOCK-C-001', partyName: '示例客户·星河制造', materialName: '应收账款', quantity: 0, unit: '', currency: 'CNY', originalAmount: 15000, amountCny: 15000, settledAmountCny: 9000, status: '部分收款', upstreamBillNo: 'MOCK-SI-001', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-receivable-002', kind: 'receivable', type: 'sales', billNo: 'MOCK-AR-002', date: '2026-10-13', partyNumber: 'MOCK-C-002', partyName: '示例客户·远帆科技', materialName: '应收账款', quantity: 0, unit: '', currency: 'CNY', originalAmount: 4800, amountCny: 4800, settledAmountCny: 0, status: '未收款', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-payable-001', kind: 'payable', type: 'purchase', billNo: 'MOCK-AP-001', date: '2026-10-15', partyNumber: 'MOCK-S-001', partyName: '示例供应商·宏达电子', materialName: '应付账款', quantity: 0, unit: '', currency: 'CNY', originalAmount: 11000, amountCny: 11000, settledAmountCny: 4000, status: '部分付款', upstreamBillNo: 'MOCK-PI-001', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-sales-invoice-001', kind: 'sales-invoice', type: 'sales', billNo: 'MOCK-SI-001', date: '2026-10-15', partyNumber: 'MOCK-C-001', partyName: '示例客户·星河制造', materialName: '智能控制模块', quantity: 50, unit: '件', unitPrice: 200, currency: 'CNY', originalAmount: 10000, amountCny: 10000, settledAmountCny: 0, status: '已开票', upstreamBillNo: 'MOCK-SO-OUT-001', source: 'local-mock', snapshotAt: now, active: true },
    { id: 'mock-k3-purchase-invoice-001', kind: 'purchase-invoice', type: 'purchase', billNo: 'MOCK-PI-001', date: '2026-10-15', partyNumber: 'MOCK-S-001', partyName: '示例供应商·宏达电子', materialName: '控制芯片', quantity: 200, unit: '片', unitPrice: 30, currency: 'CNY', originalAmount: 6000, amountCny: 6000, settledAmountCny: 0, status: '已收票', upstreamBillNo: 'MOCK-PO-IN-001', source: 'local-mock', snapshotAt: now, active: true },
  ]
  state.reports = [
    { id: 'mock-daily-sales-001', type: 'sales', date: '2026-10-15', partyName: '示例客户·星河制造', documentNo: 'DR-S-20261015-01', quantity: 62, currency: 'CNY', originalAmount: 12000, exchangeRate: 1, amountCny: 12000, note: '隔离演示日报；非真实业务数据。', source: 'manual', createdAt: now, updatedAt: now, createdBy: 'local-mock', createdByName: '本地演示', updatedBy: 'local-mock' },
    { id: 'mock-daily-sales-002', type: 'sales', date: '2026-10-16', partyName: '示例客户·远帆科技', documentNo: 'DR-S-20261016-01', quantity: 8, currency: 'CNY', originalAmount: 1800, exchangeRate: 1, amountCny: 1800, note: '隔离演示日报；跨日关联示例。', source: 'manual', createdAt: now, updatedAt: now, createdBy: 'local-mock', createdByName: '本地演示', updatedBy: 'local-mock' },
    { id: 'mock-daily-purchase-001', type: 'purchase', date: '2026-10-15', partyName: '示例供应商·宏达电子', documentNo: 'DR-P-20261015-01', quantity: 150, currency: 'CNY', originalAmount: 6500, exchangeRate: 1, amountCny: 6500, note: '隔离演示日报；非真实业务数据。', source: 'manual', createdAt: now, updatedAt: now, createdBy: 'local-mock', createdByName: '本地演示', updatedBy: 'local-mock' },
  ]
  state.links = [
    { id: 'mock-link-sales-001', reportId: 'mock-daily-sales-001', k3RowId: 'mock-k3-sales-001', allocatedAmount: 11000, allocatedQuantity: 50, linkedAt: now, linkedBy: 'local-mock', referenceK3Amount: 10000, referenceDailyAmount: 12000 },
    { id: 'mock-link-sales-002', reportId: 'mock-daily-sales-001', k3RowId: 'mock-k3-sales-002', allocatedAmount: 1200, allocatedQuantity: 10, linkedAt: now, linkedBy: 'local-mock', referenceK3Amount: 2592, referenceDailyAmount: 12000 },
    { id: 'mock-link-sales-003', reportId: 'mock-daily-sales-002', k3RowId: 'mock-k3-sales-001', allocatedAmount: 500, allocatedQuantity: 4, linkedAt: now, linkedBy: 'local-mock', referenceK3Amount: 10000, referenceDailyAmount: 1800 },
    { id: 'mock-link-purchase-001', reportId: 'mock-daily-purchase-001', k3RowId: 'mock-k3-purchase-001', allocatedAmount: 5000, allocatedQuantity: 150, linkedAt: now, linkedBy: 'local-mock', referenceK3Amount: 6000, referenceDailyAmount: 6500 },
  ]
  return state
}

function versionedState(scope: WorkspaceScope): { key: string; value: DailyReportState; revision: number } {
  const key = stateKey(scope)
  let current = getAppStateVersioned<DailyReportState | null>(key, null)
  if (current.revision === 0) {
    const seed = localMockAllowed() ? makeLocalMockState() : emptyState()
    try { setAppStateIfRevision(key, seed, 0) } catch (error) { if (!(error instanceof StateConflictError)) throw error }
    current = getAppStateVersioned<DailyReportState | null>(key, null)
  }
  return { key, value: normalizedState(current.value), revision: current.revision }
}
export function readDailyReportState(scope: WorkspaceScope): DailyReportState { return versionedState(scope).value }
function saveState(scope: WorkspaceScope, current: { key: string; value: DailyReportState; revision: number }): void {
  setAppStateIfRevision(current.key, current.value, current.revision)
}
function mutateState<T>(scope: WorkspaceScope, mutate: (state: DailyReportState) => T): T {
  const current = versionedState(scope)
  const result = mutate(current.value)
  saveState(scope, current)
  return result
}
function scopeFromRequest(req: Request): WorkspaceScope {
  const user = req.authUser
  if (!user) throw new Error('A verified tenant, organization and account scope is required.')
  return { tenantId: user.tenantId, tenantName: user.tenantName, organizationId: user.organizationId, organizationName: user.organizationName, accountId: user.accountId, accountName: user.accountName, role: user.role, isPlatformAdmin: user.isPlatformAdmin }
}
function actorFromRequest(req: Request): { id: string; name: string } {
  return { id: req.authUser?.id ?? 'unknown', name: req.authUser?.displayName ?? '工作区成员' }
}
function liveReports(state: DailyReportState): DailyReport[] { return state.reports.filter(report => !report.deletedAt) }
function rowAllocation(state: DailyReportState, rowId: string): number {
  return roundMoney(state.links.filter(link => link.k3RowId === rowId).reduce((total, link) => total + Math.abs(link.allocatedAmount), 0))
}
function reportAllocation(state: DailyReportState, reportId: string): number {
  return roundMoney(state.links.filter(link => link.reportId === reportId).reduce((total, link) => total + Math.abs(link.allocatedAmount), 0))
}
function startOfMonth(day: string): string { return `${day.slice(0, 7)}-01` }
function startOfYear(day: string): string { return `${day.slice(0, 4)}-01-01` }

function mappedText(row: Record<string, string | null>, mapping: DailyK3SourceMapping, key: DailyK3Field): string {
  const field = mapping.fields[key]
  return field ? String(row[field] ?? '').trim() : ''
}
function mappedNumber(row: Record<string, string | null>, mapping: DailyK3SourceMapping, key: DailyK3Field, fallback = 0): number {
  const value = mappedText(row, mapping, key).replace(/,/g, '')
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`K3Cloud 字段 ${mapping.fields[key]} 不是有效数字。`)
  return parsed
}
function mappedDay(value: string): string {
  const candidate = value.slice(0, 10).replaceAll('/', '-')
  if (validDay(candidate)) return candidate
  const parsed = new Date(value)
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  throw new Error('K3Cloud 单据日期不是有效日期。')
}
function k3FilterTimestamp(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error('K3Cloud 上次同步水位不是有效时间。')
  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}
function documentLinks(state: DailyReportState, row: K3SnapshotRow) {
  const ownKeys = new Set([row.erpId, row.billNo].filter((value): value is string => Boolean(value)))
  const references = new Set([row.upstreamId, row.upstreamBillNo, row.upstreamLineId].filter((value): value is string => Boolean(value)))
  return state.k3Rows.filter(other => other.active && other.id !== row.id && other.type === row.type && (
    [other.erpId, other.billNo].some(value => Boolean(value && references.has(value))) ||
    [other.upstreamId, other.upstreamBillNo, other.upstreamLineId].some(value => Boolean(value && ownKeys.has(value)))
  )).map(other => ({ id: other.id, kind: other.kind, billNo: other.billNo, date: other.date, partyName: other.partyName, materialName: other.materialName, quantity: other.quantity, unit: other.unit, unitPrice: other.unitPrice, currency: other.currency, amountCny: other.amountCny, status: other.status }))
}

/** Pull and validate every configured daily-report source before atomically replacing the current ERP snapshot. */
export async function syncK3DailyDocuments(
  scope: WorkspaceScope,
  mappings: Record<string, DailyK3SourceMapping>,
  queryPage: (formId: string, fieldKeys: string, startRow: number, filterString?: string, orderString?: string) => Promise<Array<Record<string, string | null>>>,
): Promise<{ source: 'k3cloud'; refreshedAt: string; rowCounts: Partial<Record<K3DocumentKind, number>>; changedRowCounts: Partial<Record<K3DocumentKind, number>>; totalRows: number; mode: 'full' | 'incremental' | 'mixed'; incrementalFrom: string | null; fullScanKinds: K3DocumentKind[] }> {
  const pageSize = 200, maximumRowsPerSource = 5_000
  const overlapMs = 5 * 60_000
  const stateVersion = versionedState(scope)
  const previousCheckpoint = stateVersion.value.k3Sync?.lastSyncedAt ?? null
  const snapshotStartedAt = new Date().toISOString()
  const collected: K3SnapshotRow[] = []
  const changedRowCounts: Partial<Record<K3DocumentKind, number>> = {}
  const incrementalKinds: K3DocumentKind[] = []
  const fullScanKinds: K3DocumentKind[] = []
  const allowedFields = new Set<DailyK3Field>(['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'settledAmountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'])
  let incrementalFrom: string | null = null
  for (const kind of DAILY_K3_SOURCE_KINDS) {
    const mapping = mappings[kind]
    if (!mapping || typeof mapping.formId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(mapping.formId) || !mapping.fields || typeof mapping.fields !== 'object') throw new TypeError(`K3Cloud 日报数据源映射缺失或无效：${kind}`)
    if (Object.keys(mapping.fields).some(key => !allowedFields.has(key as DailyK3Field))) throw new TypeError(`K3Cloud ${kind} 映射包含不支持的规范字段。`)
    if (Object.values(mapping.fields).some(field => typeof field !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(field))) throw new TypeError(`K3Cloud ${kind} 映射包含无效 ERP 字段名。`)
    const required = [...DAILY_K3_REQUIRED_FIELDS, ...(['receivable', 'payable'].includes(kind) ? ['settledAmountCny'] : [])]
    if (required.some(key => typeof mapping.fields[key as DailyK3Field] !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(mapping.fields[key as DailyK3Field]!))) throw new TypeError(`K3Cloud ${kind} 必须映射字段：${required.join(', ')}`)
    const selectedFields = [...new Set(Object.values(mapping.fields).filter((field): field is string => typeof field === 'string' && Boolean(field.trim()))) ]
    const hasPriorKindSnapshot = Object.hasOwn(stateVersion.value.k3Sync?.rowCounts ?? {}, kind)
    const isIncremental = Boolean(previousCheckpoint && hasPriorKindSnapshot && mapping.fields.modifiedAt)
    const sourceCheckpoint = isIncremental ? new Date(Date.parse(previousCheckpoint!) - overlapMs).toISOString() : null
    const filterString = isIncremental ? `${mapping.fields.modifiedAt} >= '${k3FilterTimestamp(sourceCheckpoint!)}'` : ''
    const orderString = isIncremental ? `${mapping.fields.modifiedAt} ASC` : undefined
    if (isIncremental) { incrementalKinds.push(kind); incrementalFrom ??= sourceCheckpoint }
    else fullScanKinds.push(kind)
    const seen = new Set<string>(), sourceRows: K3SnapshotRow[] = []
    for (let startRow = 0; ; startRow += pageSize) {
      if (startRow >= maximumRowsPerSource) {
        const overflow = await queryPage(mapping.formId, selectedFields.join(','), startRow, filterString, orderString)
        if (overflow.length) throw new RangeError(`K3Cloud ${kind} 超过每类 ${maximumRowsPerSource} 行的同步安全上限；未替换现有快照。`)
        break
      }
      const page = await queryPage(mapping.formId, selectedFields.join(','), startRow, filterString, orderString)
      if (!Array.isArray(page)) throw new Error(`K3Cloud ${kind} 查询响应格式无效。`)
      for (const raw of page) {
        const identity = mappedText(raw, mapping, 'id')
        const billNo = mappedText(raw, mapping, 'billNo')
        const date = mappedDay(mappedText(raw, mapping, 'date'))
        const partyName = mappedText(raw, mapping, 'partyName')
        if (!identity || !billNo || !partyName) throw new Error(`K3Cloud ${kind} 存在缺少唯一 ID、单号或客商名称的记录。`)
        if (seen.has(identity)) throw new Error(`K3Cloud ${kind} 返回重复记录 ID；请映射单据行级唯一 ID。`)
        seen.add(identity)
        const type: DailyKind = ['shipment', 'sales-order', 'receivable', 'sales-invoice'].includes(kind) ? 'sales' : 'purchase'
        const originalAmount = roundMoney(mappedNumber(raw, mapping, 'originalAmount'))
        const amountCny = roundMoney(mappedNumber(raw, mapping, 'amountCny'))
        const settledAmountCny = roundMoney(mappedNumber(raw, mapping, 'settledAmountCny'))
        const modifiedAt = mappedText(raw, mapping, 'modifiedAt')
        if (mapping.fields.modifiedAt && modifiedAt && !Number.isFinite(new Date(modifiedAt).getTime())) throw new Error(`K3Cloud ${kind} 修改时间不是有效时间。`)
        const id = `k3-${kind}-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`
        sourceRows.push({
          id, erpId: identity, kind, type, billNo, date, modifiedAt, partyNumber: mappedText(raw, mapping, 'partyNumber'), partyName,
          materialName: mappedText(raw, mapping, 'materialName') || (kind === 'receivable' ? '应收账款' : kind === 'payable' ? '应付账款' : kind === 'sales-invoice' ? '销售发票' : kind === 'purchase-invoice' ? '采购发票' : ''),
          quantity: mappedNumber(raw, mapping, 'quantity'), unit: mappedText(raw, mapping, 'unit'), unitPrice: mappedNumber(raw, mapping, 'unitPrice'), currency: mappedText(raw, mapping, 'currency') || 'CNY',
          originalAmount, amountCny, settledAmountCny, status: mappedText(raw, mapping, 'status') || 'ERP 已同步', source: 'k3cloud', snapshotAt: snapshotStartedAt, active: true,
          upstreamId: mappedText(raw, mapping, 'upstreamId'), upstreamBillNo: mappedText(raw, mapping, 'upstreamBillNo'), upstreamLineId: mappedText(raw, mapping, 'upstreamLineId'),
          taxAmount: mappedNumber(raw, mapping, 'taxAmount'), taxAmountCny: mappedNumber(raw, mapping, 'taxAmountCny'),
        })
      }
      if (page.length < pageSize) break
    }
    if (sourceRows.length > maximumRowsPerSource) throw new RangeError(`K3Cloud ${kind} 超过同步安全上限；未替换现有快照。`)
    changedRowCounts[kind] = sourceRows.length
    collected.push(...sourceRows)
  }
  const refreshedAt = new Date().toISOString()
  const incomingIds = new Set(collected.map(row => row.id))
  const previousRows = stateVersion.value.k3Rows.filter(row => row.source === 'k3cloud' && !incomingIds.has(row.id) && !fullScanKinds.includes(row.kind))
  const nextRows = [...previousRows, ...collected]
  const nextRowIds = new Set(nextRows.map(row => row.id))
  const rowCounts = Object.fromEntries(DAILY_K3_SOURCE_KINDS.map(kind => [kind, nextRows.filter(row => row.kind === kind).length])) as Partial<Record<K3DocumentKind, number>>
  const localMockReportIds = new Set(stateVersion.value.reports.filter(report => report.createdBy === 'local-mock').map(report => report.id))
  stateVersion.value.k3Rows = nextRows
  stateVersion.value.reports = stateVersion.value.reports.filter(report => !localMockReportIds.has(report.id))
  stateVersion.value.links = stateVersion.value.links.filter(link => nextRowIds.has(link.k3RowId) && !localMockReportIds.has(link.reportId))
  stateVersion.value.mockEnabled = false
  stateVersion.value.mockSnapshotAt = null
  const mode = incrementalKinds.length === 0 ? 'full' : fullScanKinds.length === 0 ? 'incremental' : 'mixed'
  stateVersion.value.k3Sync = { source: 'k3cloud', lastSyncedAt: refreshedAt, rowCounts, changedRowCounts, mode, incrementalFrom, fullScanKinds }
  saveState(scope, stateVersion)
  return { source: 'k3cloud', refreshedAt, rowCounts, changedRowCounts, totalRows: collected.length, mode, incrementalFrom, fullScanKinds }
}

function reconciliationFor(state: DailyReportState, kind: DailyKind, reportDate: string) {
  const reports = liveReports(state).filter(report => report.type === kind)
  const dailyReports = reports.filter(report => report.date === reportDate)
  const dailyBase = roundMoney(dailyReports.reduce((sum, report) => sum + Math.abs(report.amountCny), 0))
  const covered = roundMoney(dailyReports.reduce((sum, report) => sum + Math.min(Math.abs(report.amountCny), Math.abs(reportAllocation(state, report.id))), 0))
  const monthReports = reports.filter(report => report.date >= startOfMonth(reportDate) && report.date <= reportDate)
  const monthSystem = roundMoney(monthReports.reduce((sum, report) => sum + report.amountCny, 0))
  const yearReports = reports.filter(report => report.date >= startOfYear(reportDate) && report.date <= reportDate)
  const yearSystem = roundMoney(yearReports.reduce((sum, report) => sum + report.amountCny, 0))
  const transactionKinds: K3DocumentKind[] = kind === 'sales' ? ['shipment'] : ['purchase-receipt']
  const monthRows = state.k3Rows.filter(row => row.active && row.type === kind && transactionKinds.includes(row.kind) && row.date >= startOfMonth(reportDate) && row.date <= reportDate)
  const yearRows = state.k3Rows.filter(row => row.active && row.type === kind && transactionKinds.includes(row.kind) && row.date >= startOfYear(reportDate) && row.date <= reportDate)
  const monthK3 = roundMoney(monthRows.reduce((sum, row) => sum + row.amountCny, 0))
  const yearK3 = roundMoney(yearRows.reduce((sum, row) => sum + row.amountCny, 0))
  const complete = Boolean(state.mockSnapshotAt || state.k3Sync?.lastSyncedAt)
  const monthDiff = roundMoney(monthSystem - monthK3)
  const yearDiff = roundMoney(yearSystem - yearK3)
  const allocationRows = monthRows.map(row => {
    const allocated = rowAllocation(state, row.id)
    const linked = state.links.filter(link => link.k3RowId === row.id)
    const crossDate = linked.some(link => {
      const report = state.reports.find(item => item.id === link.reportId)
      return Boolean(report && report.date !== row.date)
    })
    const over = roundMoney(Math.max(0, Math.abs(allocated) - Math.abs(row.amountCny)))
    return { ...row, allocatedAmount: allocated, remainingAmount: roundMoney(Math.max(0, Math.abs(row.amountCny) - allocated)), overAllocatedAmount: over, crossDate }
  })
  return {
    dailyCoverage: { reportCount: dailyReports.length, totalAmount: dailyBase, coveredAmount: covered, coverageRate: dailyBase ? roundMoney(covered / dailyBase * 100) : null, reports: dailyReports.map(report => ({ ...report, allocatedAmount: reportAllocation(state, report.id), cappedAllocatedAmount: Math.min(Math.abs(report.amountCny), Math.abs(reportAllocation(state, report.id))) })) },
    monthDifference: { from: startOfMonth(reportDate), to: reportDate, systemAmount: monthSystem, k3Amount: monthK3, difference: monthDiff, differenceRate: complete && monthK3 !== 0 ? roundMoney(monthDiff / Math.abs(monthK3) * 100) : null, isComplete: complete },
    yearDifference: { from: startOfYear(reportDate), to: reportDate, systemAmount: yearSystem, k3Amount: yearK3, difference: yearDiff, differenceRate: complete && yearK3 !== 0 ? roundMoney(yearDiff / Math.abs(yearK3) * 100) : null, isComplete: complete },
    k3Allocation: { rowCount: allocationRows.length, originalAmount: roundMoney(monthRows.reduce((sum, row) => sum + row.amountCny, 0)), allocatedAmount: roundMoney(allocationRows.reduce((sum, row) => sum + row.allocatedAmount, 0)), remainingAmount: roundMoney(allocationRows.reduce((sum, row) => sum + Math.max(0, Math.abs(row.amountCny) - Math.abs(row.allocatedAmount)), 0)), overAllocatedAmount: roundMoney(allocationRows.reduce((sum, row) => sum + row.overAllocatedAmount, 0)), crossDateCount: allocationRows.filter(row => row.crossDate).length, rows: allocationRows },
  }
}

export function buildDailyReportSummary(state: DailyReportState, reportDate: string, scope: 'sales' | 'purchase' | 'both' = 'both') {
  const reports = liveReports(state).filter(report => report.date === reportDate && (scope === 'both' || report.type === scope))
  const sumDaily = (kind: DailyKind) => {
    const selected = reports.filter(report => report.type === kind)
    return { count: selected.length, quantity: roundMoney(selected.reduce((sum, report) => sum + report.quantity, 0)), amountCny: roundMoney(selected.reduce((sum, report) => sum + report.amountCny, 0)), reportAmountOriginal: roundMoney(selected.reduce((sum, report) => sum + report.originalAmount, 0)), currencyBreakdown: Object.fromEntries([...new Set(selected.map(report => report.currency))].map(currency => [currency, roundMoney(selected.filter(report => report.currency === currency).reduce((sum, report) => sum + report.originalAmount, 0))])) }
  }
  const salesOrders = state.k3Rows.filter(row => row.active && row.kind === 'sales-order' && row.date === reportDate && (scope === 'both' || scope === 'sales'))
  const purchaseOrders = state.k3Rows.filter(row => row.active && row.kind === 'purchase-order' && row.date === reportDate && (scope === 'both' || scope === 'purchase'))
  const shipments = state.k3Rows.filter(row => row.active && row.kind === 'shipment' && row.date === reportDate && (scope === 'both' || scope === 'sales'))
  const receipts = state.k3Rows.filter(row => row.active && row.kind === 'purchase-receipt' && row.date === reportDate && (scope === 'both' || scope === 'purchase'))
  const salesInvoices = state.k3Rows.filter(row => row.active && row.kind === 'sales-invoice' && row.date === reportDate && (scope === 'both' || scope === 'sales'))
  const purchaseInvoices = state.k3Rows.filter(row => row.active && row.kind === 'purchase-invoice' && row.date === reportDate && (scope === 'both' || scope === 'purchase'))
  const receivables = state.k3Rows.filter(row => row.active && row.kind === 'receivable' && (scope === 'both' || scope === 'sales'))
  const payables = state.k3Rows.filter(row => row.active && row.kind === 'payable' && (scope === 'both' || scope === 'purchase'))
  const linkedRow = (row: K3SnapshotRow) => ({ ...row, linkedDocuments: documentLinks(state, row) })
  const orderSummary = (rows: K3SnapshotRow[]) => ({ count: rows.length, amountCny: roundMoney(rows.reduce((sum, row) => sum + row.amountCny, 0)), rows: rows.map(linkedRow) })
  const balanceSummary = (rows: K3SnapshotRow[]) => ({ count: rows.length, documentAmountCny: roundMoney(rows.reduce((sum, row) => sum + row.amountCny, 0)), settledAmountCny: roundMoney(rows.reduce((sum, row) => sum + row.settledAmountCny, 0)), outstandingAmountCny: roundMoney(rows.reduce((sum, row) => sum + Math.max(0, row.amountCny - row.settledAmountCny), 0)), rows: rows.map(row => ({ ...linkedRow(row), outstandingAmountCny: roundMoney(Math.max(0, row.amountCny - row.settledAmountCny)) })) })
  const warningRows = ['sales', 'purchase'].flatMap(kind => {
    if (scope !== 'both' && scope !== kind) return []
    return reconciliationFor(state, kind as DailyKind, reportDate).k3Allocation.rows.filter(row => row.overAllocatedAmount > 0 || row.crossDate).map(row => ({ type: kind, billNo: row.billNo, overAllocatedAmount: row.overAllocatedAmount, crossDate: row.crossDate }))
  })
  return {
    reportDate, generatedAt: new Date().toISOString(), source: state.mockEnabled ? 'local-mock' : state.k3Sync ? 'k3cloud' : 'workspace', isMock: state.mockEnabled,
    mockSnapshotAt: state.mockSnapshotAt, k3Sync: state.k3Sync ? deepClone(state.k3Sync) : null, liveErpConnected: Boolean(state.k3Sync),
    sales: scope === 'purchase' ? undefined : { daily: sumDaily('sales'), reconciliation: reconciliationFor(state, 'sales', reportDate) },
    purchase: scope === 'sales' ? undefined : { daily: sumDaily('purchase'), reconciliation: reconciliationFor(state, 'purchase', reportDate) },
    orders: { sales: orderSummary(salesOrders), purchase: orderSummary(purchaseOrders) },
    fulfillment: { sales: orderSummary(shipments), purchase: orderSummary(receipts) },
    invoices: { sales: orderSummary(salesInvoices), purchase: orderSummary(purchaseInvoices) },
    balances: { receivables: balanceSummary(receivables), payables: balanceSummary(payables) },
    warnings: warningRows,
    notice: state.mockEnabled ? '本地隔离演示快照；非真实 K3Cloud 数据，金额仅用于功能验证。' : state.k3Sync ? `真实 K3Cloud 只读快照已同步于 ${state.k3Sync.lastSyncedAt}；应收/应付余额为该同步时点余额，并非按报表日重算。` : '尚无 K3Cloud 快照；金额对账暂不可判定，缺失数据未按零处理。',
  }
}

function noteCorrection(state: DailyReportState, input: Omit<DailyCorrection, 'id' | 'detectedAt' | 'reportedInSnapshotId'>): void {
  if (!state.snapshots.some(snapshot => snapshot.reportDate === input.originalDate)) return
  const existing = state.corrections.find(item => item.originalDate === input.originalDate && item.referenceId === input.referenceId && item.type === input.type && !item.reportedInSnapshotId)
  if (existing) {
    existing.newValue = input.newValue
    existing.diffAmount = roundMoney((input.newValue ?? 0) - (existing.originalValue ?? 0))
    existing.reason = input.reason
    existing.detectedAt = new Date().toISOString()
    return
  }
  state.corrections.unshift({ ...input, id: randomUUID(), detectedAt: new Date().toISOString(), reportedInSnapshotId: null })
}
function archivedReportAmount(state: DailyReportState, reportId: string, reportDate: string): number | null {
  const snapshot = [...state.snapshots].filter(item => item.reportDate === reportDate).sort((a, b) => b.version - a.version)[0]
  if (!snapshot) return null
  const archived = (snapshot.data.reports as DailyReport[] | undefined)?.find(report => report.id === reportId)
  return archived ? archived.amountCny : null
}
function archivedReportAllocation(state: DailyReportState, reportId: string, reportDate: string): number | null {
  const snapshot = [...state.snapshots].filter(item => item.reportDate === reportDate).sort((a, b) => b.version - a.version)[0]
  if (!snapshot) return null
  const links = (snapshot.data.links as DailyReportLink[] | undefined) ?? []
  return roundMoney(links.filter(link => link.reportId === reportId).reduce((sum, link) => sum + Math.abs(link.allocatedAmount), 0))
}
function validateReportPayload(body: Record<string, unknown>, existing?: DailyReport): { error?: string; value?: Omit<DailyReport, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName' | 'updatedBy'> } {
  const type = body.type ?? existing?.type
  const date = body.date ?? existing?.date
  const partyName = body.partyName ?? existing?.partyName
  const documentNo = body.documentNo ?? existing?.documentNo ?? ''
  const quantity = finite(body.quantity ?? existing?.quantity ?? 0)
  const currency = body.currency ?? existing?.currency ?? 'CNY'
  const originalAmount = finite(body.originalAmount ?? existing?.originalAmount)
  const rawRate = finite(body.exchangeRate ?? existing?.exchangeRate ?? 1)
  const note = body.note ?? existing?.note ?? ''
  const source = existing?.source ?? 'manual'
  if (!validKind(type)) return { error: '日报类型必须是 sales 或 purchase。' }
  if (!validDay(date)) return { error: '日期必须是有效的 YYYY-MM-DD。' }
  if (typeof partyName !== 'string' || !partyName.trim() || partyName.trim().length > 160) return { error: '客户/供应商名称为必填，最多 160 字。' }
  if (typeof documentNo !== 'string' || documentNo.length > 100) return { error: '单据编号最多 100 字。' }
  if (quantity === undefined || originalAmount === undefined || rawRate === undefined || rawRate <= 0) return { error: '数量、原币金额和正汇率必须是有限数字。' }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { error: '币种必须是 3 位大写 ISO 代码。' }
  if (typeof note !== 'string' || note.length > 2000) return { error: '备注最多 2000 字。' }
  if (source !== 'manual' && source !== 'history-import') return { error: '日报来源无效。' }
  const exchangeRate = currency === 'CNY' ? 1 : rawRate
  return { value: { type, date, partyName: partyName.trim(), documentNo: documentNo.trim(), quantity, currency, originalAmount: roundMoney(originalAmount), exchangeRate, amountCny: roundMoney(originalAmount * exchangeRate), note: note.trim(), source } }
}

function snapshotFromState(state: DailyReportState, reportDate: string, scope: 'sales' | 'purchase' | 'both', actor: { id: string; name: string }): DailySnapshot {
  const version = Math.max(0, ...state.snapshots.filter(item => item.reportDate === reportDate && item.scope === scope).map(item => item.version)) + 1
  const id = randomUUID(), summary = buildDailyReportSummary(state, reportDate, scope)
  const corrections = state.corrections.filter(item => !item.reportedInSnapshotId && item.originalDate < reportDate && (scope === 'both' || item.affectedReport === scope))
  const reports = liveReports(state).filter(report => report.date === reportDate && (scope === 'both' || report.type === scope))
  const reportIds = new Set(reports.map(report => report.id))
  const links = state.links.filter(link => reportIds.has(link.reportId))
  const k3Rows = state.k3Rows.filter(row => row.active && (row.date <= reportDate || (row.kind === 'receivable' && scope !== 'purchase') || (row.kind === 'payable' && scope !== 'sales')) && (scope === 'both' || row.type === scope)).map(row => ({ ...row, linkedDocuments: documentLinks(state, row) }))
  const warnings = [
    ...(state.mockEnabled ? ['当前为本地隔离演示数据，不能用于财务判断或正式对账。'] : []),
    ...(!state.mockSnapshotAt && !state.k3Sync ? ['未找到 K3Cloud 快照；对账指标显示为暂不可判定。'] : []),
    ...summary.warnings.map(item => `${item.type} ${item.billNo}${item.crossDate ? ' 存在跨日关联' : ''}${item.overAllocatedAmount ? ` 超额分摊 ${item.overAllocatedAmount.toFixed(2)} 元` : ''}`),
  ]
  const snapshot: DailySnapshot = { id, reportDate, scope, version, createdAt: new Date().toISOString(), createdBy: actor.id, source: state.mockEnabled ? 'local-mock' : state.k3Sync ? 'k3cloud' : 'workspace', calculationVersion: 'v1.0.0', isComplete: Boolean(state.mockSnapshotAt || state.k3Sync), warnings: [...warnings, ...(state.k3Sync ? [`K3Cloud 数据于 ${state.k3Sync.lastSyncedAt} 同步；应收/应付余额为同步时点余额。`] : [])], data: { ...deepClone(summary), reports: deepClone(reports), links: deepClone(links), k3Rows: deepClone(k3Rows), corrections: deepClone(corrections) } }
  state.snapshots.unshift(snapshot)
  for (const correction of corrections) correction.reportedInSnapshotId = id
  return snapshot
}

export function dailyReportPushDigest(scope: WorkspaceScope, reportDate: string): ReturnType<typeof buildDailyReportSummary> | undefined {
  const state = readDailyReportState(scope)
  if (!state.mockSnapshotAt && !state.k3Sync && !state.reports.length && !state.k3Rows.length) return undefined
  return buildDailyReportSummary(state, reportDate, 'both')
}

function searchRows(state: DailyReportState, type: DailyKind, query: string) {
  const allowed = type === 'sales' ? ['shipment'] : ['purchase-receipt']
  const lower = query.toLocaleLowerCase()
  return state.k3Rows.filter(row => row.active && row.type === type && allowed.includes(row.kind) && (!lower || [row.billNo, row.partyName, row.partyNumber, row.materialName].some(value => value.toLocaleLowerCase().includes(lower)))).sort((a, b) => b.date.localeCompare(a.date) || a.billNo.localeCompare(b.billNo)).map(row => {
    const allocatedAmount = rowAllocation(state, row.id)
    const related = state.links.filter(link => link.k3RowId === row.id).map(link => ({ reportId: link.reportId, reportDate: state.reports.find(report => report.id === link.reportId)?.date ?? null, allocatedAmount: link.allocatedAmount }))
    return { ...row, linkedDocuments: documentLinks(state, row), allocatedAmount, remainingAmount: roundMoney(Math.max(0, Math.abs(row.amountCny) - allocatedAmount)), overAllocatedAmount: roundMoney(Math.max(0, allocatedAmount - Math.abs(row.amountCny))), related }
  })
}
function deliveryByChannel(state: DailyReportState, snapshotId: string) { return state.deliveries.filter(item => item.snapshotId === snapshotId) }
function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) }
function renderSnapshotHtml(snapshot: DailySnapshot): string {
  const data = snapshot.data as Record<string, unknown>, sales = asRecord(data.sales), purchase = asRecord(data.purchase), orders = asRecord(data.orders), balances = asRecord(data.balances)
  const dailyRows = (data.reports as DailyReport[] | undefined) ?? []
  const k3Rows = (data.k3Rows as K3SnapshotRow[] | undefined) ?? []
  const warnings = snapshot.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')
  const rows = dailyRows.map(row => `<tr><td>${escapeHtml(row.type === 'sales' ? '销售' : '采购')}</td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.documentNo)}</td><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(row.currency)}</td><td>${escapeHtml(row.amountCny.toFixed(2))}</td></tr>`).join('')
  const k3 = k3Rows.map(row => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.billNo)}</td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.materialName)}</td><td>${escapeHtml(row.amountCny.toFixed(2))}</td></tr>`).join('')
  const amount = (object: unknown, key: string) => Number(asRecord(object)[key] ?? 0).toFixed(2)
  const sourceLabel = snapshot.source === 'local-mock' ? '本地隔离演示快照（非真实 ERP）' : snapshot.source === 'k3cloud' ? 'K3Cloud 只读快照' : '工作区快照'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>经营日报 ${escapeHtml(snapshot.reportDate)}</title><style>body{font:14px system-ui,sans-serif;color:#243047;max-width:1100px;margin:32px auto;padding:0 20px}h1,h2{color:#1d3353}.warn{background:#fff8e8;border:1px solid #ead7a7;padding:12px;border-radius:8px}table{width:100%;border-collapse:collapse;margin:10px 0 24px}th,td{border:1px solid #dce2eb;padding:7px;text-align:left}th{background:#f2f5f9}.meta{color:#718096}</style></head><body><h1>销售 / 采购经营日报</h1><p class="meta">报表日期 ${escapeHtml(snapshot.reportDate)} · 归档版本 ${snapshot.version} · ${escapeHtml(snapshot.createdAt)} · ${escapeHtml(sourceLabel)}</p><section class="warn"><b>数据说明</b><ul>${warnings || '<li>无额外警告</li>'}</ul></section><h2>经营摘要</h2><p>销售日报：${amount(sales.daily, 'count')} 笔，金额 ¥${amount(sales.daily, 'amountCny')}；采购日报：${amount(purchase.daily, 'count')} 笔，金额 ¥${amount(purchase.daily, 'amountCny')}。</p><p>销售订单：${amount(asRecord(orders).sales, 'count')} 笔，¥${amount(asRecord(orders).sales, 'amountCny')}；采购订单：${amount(asRecord(orders).purchase, 'count')} 笔，¥${amount(asRecord(orders).purchase, 'amountCny')}。</p><p>应收未收 ¥${amount(asRecord(balances).receivables, 'outstandingAmountCny')}；应付未付 ¥${amount(asRecord(balances).payables, 'outstandingAmountCny')}。</p><h2>日报明细</h2><table><thead><tr><th>类型</th><th>日期</th><th>编号</th><th>客户 / 供应商</th><th>数量</th><th>币种</th><th>人民币</th></tr></thead><tbody>${rows || '<tr><td colspan="7">暂无日报记录</td></tr>'}</tbody></table><h2>K3Cloud / 演示快照行</h2><table><thead><tr><th>单据类型</th><th>单号</th><th>日期</th><th>客商</th><th>物料 / 科目</th><th>金额(人民币)</th></tr></thead><tbody>${k3 || '<tr><td colspan="6">暂无快照行</td></tr>'}</tbody></table></body></html>`
}

export function createDailyReportRouter(): Router {
  const router = Router()

  router.get('/daily-reports', (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope)
    const type = req.query.type === 'sales' || req.query.type === 'purchase' ? req.query.type : undefined
    const from = typeof req.query.from === 'string' && validDay(req.query.from) ? req.query.from : undefined
    const to = typeof req.query.to === 'string' && validDay(req.query.to) ? req.query.to : undefined
    const reports = liveReports(state).filter(report => (!type || report.type === type) && (!from || report.date >= from) && (!to || report.date <= to)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(report => ({ ...report, allocatedAmount: reportAllocation(state, report.id), links: state.links.filter(link => link.reportId === report.id).map(link => ({ ...link, k3Row: state.k3Rows.find(row => row.id === link.k3RowId) })) }))
    return res.json({ reports, mockEnabled: state.mockEnabled, source: state.mockEnabled ? 'local-mock' : 'workspace', notice: state.mockEnabled ? '显示隔离演示数据；非真实业务数据。' : '手工日报仍可录入；当前未连接真实 ERP。' })
  })

  router.get('/daily-reports/k3-lines', (req, res) => {
    const type = req.query.type
    if (!validKind(type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const state = readDailyReportState(scopeFromRequest(req)), query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
    return res.json({ rows: searchRows(state, type, query), source: state.mockEnabled ? 'local-mock' : 'workspace', liveErpConnected: false })
  })

  router.get('/daily-reports/summary', (req, res) => {
    const date = req.query.date
    if (!validDay(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD。' })
    const state = readDailyReportState(scopeFromRequest(req)), requestedScope = req.query.scope
    if (requestedScope !== undefined && !['sales', 'purchase', 'both'].includes(String(requestedScope))) return res.status(400).json({ error: 'scope 参数无效。' })
    return res.json(buildDailyReportSummary(state, date, (requestedScope as 'sales' | 'purchase' | 'both' | undefined) ?? 'both'))
  })

  router.post('/daily-reports/mock-refresh', requireRole('admin', 'plm_manager'), (req, res) => {
    if (!localMockAllowed()) return res.status(404).json({ error: 'not_found', message: '本地演示快照只在非生产环境可用。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const result = mutateState(scope, state => {
        if (state.k3Sync) return { blocked: true as const }
        const replacement = makeLocalMockState()
        // Upsert deterministic demo identities while preserving user-entered records and archives.
        const demoIds = new Set(replacement.k3Rows.map(row => row.id))
        state.k3Rows = [...state.k3Rows.filter(row => !demoIds.has(row.id)), ...replacement.k3Rows]
        state.mockEnabled = true; state.mockSnapshotAt = replacement.mockSnapshotAt
        return { rows: replacement.k3Rows.length, refreshedAt: replacement.mockSnapshotAt, actor: actor.name }
      })
      if ('blocked' in result) return res.status(409).json({ error: 'live_k3cloud_snapshot_exists', message: '当前账套已有真实 K3Cloud 快照；为防止真实与演示数据混用，不能刷新本地演示数据。' })
      return res.json({ ...result, source: 'local-mock', liveErpConnected: false, message: '本地演示快照已刷新；未访问真实 K3Cloud。' })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'mock_refresh_failed', message: error instanceof Error ? error.message : '本地快照刷新失败。' }) }
  })

  router.post('/daily-reports', requireRole(...WRITERS), (req, res) => {
    const scope = scopeFromRequest(req), actor = actorFromRequest(req), payload = validateReportPayload(asRecord(req.body))
    if (!payload.value) return res.status(400).json({ error: 'invalid_daily_report', message: payload.error })
    try {
      const report = mutateState(scope, state => {
        const now = new Date().toISOString(), item: DailyReport = { ...payload.value!, id: randomUUID(), createdAt: now, updatedAt: now, createdBy: actor.id, createdByName: actor.name, updatedBy: actor.id }
        state.reports.unshift(item)
        noteCorrection(state, { originalDate: item.date, type: '日报补录', affectedReport: item.type, referenceId: item.id, originalValue: archivedReportAmount(state, item.id, item.date), newValue: item.amountCny, diffAmount: item.amountCny, reason: '已归档日期新增日报记录。' })
        return item
      })
      return res.status(201).json(report)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'daily_report_save_failed', message: error instanceof Error ? error.message : '日报保存失败。' }) }
  })

  router.patch('/daily-reports/:id', requireRole(...WRITERS), (req, res) => {
    const scope = scopeFromRequest(req), actor = actorFromRequest(req), body = asRecord(req.body)
    try {
      const updated = mutateState(scope, state => {
        const report = state.reports.find(item => item.id === String(req.params.id) && !item.deletedAt)
        if (!report) return undefined
        const parsed = validateReportPayload({ ...body, type: body.type ?? report.type }, report)
        if (!parsed.value) throw new TypeError(parsed.error)
        const oldAmount = archivedReportAmount(state, report.id, report.date) ?? report.amountCny
        const oldDate = report.date, oldType = report.type
        Object.assign(report, parsed.value, { updatedAt: new Date().toISOString(), updatedBy: actor.id })
        if (oldDate === report.date && oldType === report.type) noteCorrection(state, { originalDate: oldDate, type: '日报修改', affectedReport: report.type, referenceId: report.id, originalValue: oldAmount, newValue: report.amountCny, diffAmount: roundMoney(report.amountCny - oldAmount), reason: `日报 ${report.documentNo || report.id} 修改。` })
        else {
          noteCorrection(state, { originalDate: oldDate, type: '日报日期/类型变更', affectedReport: oldType, referenceId: report.id, originalValue: oldAmount, newValue: null, diffAmount: roundMoney(-oldAmount), reason: '日报日期或销售/采购类型变更；原归档口径保留。' })
          const archivedNewAmount = archivedReportAmount(state, report.id, report.date)
          noteCorrection(state, { originalDate: report.date, type: '日报日期/类型变更', affectedReport: report.type, referenceId: report.id, originalValue: archivedNewAmount, newValue: report.amountCny, diffAmount: roundMoney(report.amountCny - (archivedNewAmount ?? 0)), reason: '日报移入已归档日期或业务类型。' })
        }
        return report
      })
      if (!updated) return res.status(404).json({ error: 'daily_report_not_found', message: '日报不存在或已归档删除。' })
      return res.json(updated)
    } catch (error) { const status = error instanceof StateConflictError ? 409 : error instanceof TypeError ? 400 : 500; return res.status(status).json({ error: status === 409 ? 'workspace_conflict' : 'invalid_daily_report', message: error instanceof Error ? error.message : '日报更新失败。' }) }
  })

  router.delete('/daily-reports/:id', requireRole(...WRITERS), (req, res) => {
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const removed = mutateState(scope, state => {
        const report = state.reports.find(item => item.id === String(req.params.id) && !item.deletedAt)
        if (!report) return false
        const oldValue = archivedReportAmount(state, report.id, report.date) ?? report.amountCny
        report.deletedAt = new Date().toISOString(); report.deletedBy = actor.id; report.updatedAt = report.deletedAt; report.updatedBy = actor.id
        state.links = state.links.filter(link => link.reportId !== report.id)
        noteCorrection(state, { originalDate: report.date, type: '日报删除', affectedReport: report.type, referenceId: report.id, originalValue: oldValue, newValue: null, diffAmount: roundMoney(-oldValue), reason: `日报 ${report.documentNo || report.id} 已软删除；已归档快照保持不变。` })
        return true
      })
      return removed ? res.status(204).end() : res.status(404).json({ error: 'daily_report_not_found', message: '日报不存在或已删除。' })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'daily_report_delete_failed', message: error instanceof Error ? error.message : '日报删除失败。' }) }
  })

  router.put('/daily-reports/:id/links', requireRole(...WRITERS), (req, res) => {
    const scope = scopeFromRequest(req), actor = actorFromRequest(req), body = asRecord(req.body), rawLinks = body.links
    if (!Array.isArray(rawLinks) || rawLinks.length > 300) return res.status(400).json({ error: 'links 必须是最多 300 条的数组。' })
    const parsed = rawLinks.map(item => { const link = asRecord(item); return { k3RowId: typeof link.k3RowId === 'string' ? link.k3RowId : '', allocatedAmount: finite(link.allocatedAmount), allocatedQuantity: finite(link.allocatedQuantity ?? 0) } })
    if (parsed.some(link => !link.k3RowId || link.allocatedAmount === undefined || link.allocatedQuantity === undefined) || new Set(parsed.map(link => link.k3RowId)).size !== parsed.length) return res.status(400).json({ error: '每条关联需有唯一 k3RowId、有限分摊金额和数量。' })
    try {
      const result = mutateState(scope, state => {
        const report = state.reports.find(item => item.id === String(req.params.id) && !item.deletedAt)
        if (!report) return { missing: true as const }
        const rows = parsed.map(link => state.k3Rows.find(row => row.id === link.k3RowId))
        if (rows.some(row => !row || !row.active)) return { forbidden: true as const }
        if (rows.some(row => row!.type !== report.type || !['shipment', 'purchase-receipt'].includes(row!.kind))) return { mismatched: true as const }
        const previousAmount = archivedReportAllocation(state, report.id, report.date) ?? reportAllocation(state, report.id)
        state.links = state.links.filter(link => link.reportId !== report.id)
        const now = new Date().toISOString()
        for (let index = 0; index < parsed.length; index += 1) {
          const item = parsed[index]!, row = rows[index]!
          state.links.push({ id: randomUUID(), reportId: report.id, k3RowId: item.k3RowId, allocatedAmount: roundMoney(item.allocatedAmount!), allocatedQuantity: roundMoney(item.allocatedQuantity!), linkedAt: now, linkedBy: actor.id, referenceK3Amount: row!.amountCny, referenceDailyAmount: report.amountCny })
        }
        const currentAmount = reportAllocation(state, report.id)
        noteCorrection(state, { originalDate: report.date, type: '关联变更', affectedReport: report.type, referenceId: report.id, originalValue: previousAmount, newValue: currentAmount, diffAmount: roundMoney(currentAmount - previousAmount), reason: '日报与 K3Cloud 快照行关联/分摊发生变更。' })
        const warnings = parsed.flatMap((item, index) => {
          const row = rows[index]!, total = rowAllocation(state, item.k3RowId), over = roundMoney(Math.max(0, Math.abs(total) - Math.abs(row!.amountCny)))
          const result: string[] = []
          if (over > 0) result.push(`${row!.billNo} 累计超额分摊 ${over.toFixed(2)} 元（允许保存）。`)
          if (row!.date !== report.date) result.push(`${row!.billNo} 为跨日关联：快照日期 ${row!.date}，日报日期 ${report.date}。`)
          return result
        })
        return { links: state.links.filter(link => link.reportId === report.id).map(link => ({ ...link, k3Row: state.k3Rows.find(row => row.id === link.k3RowId) })), warnings }
      })
      if ('missing' in result) return res.status(404).json({ error: 'daily_report_not_found', message: '日报不存在或不属于当前账套。' })
      if ('forbidden' in result) return res.status(403).json({ error: 'k3_line_out_of_scope', message: '快照明细不存在、已失效或不属于当前账套。' })
      if ('mismatched' in result) return res.status(400).json({ error: 'k3_line_type_mismatch', message: '销售日报只能关联销售出库行，采购日报只能关联采购入库行。' })
      return res.json(result)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'link_save_failed', message: error instanceof Error ? error.message : '关联保存失败。' }) }
  })

  router.get('/daily-reports/snapshots', (req, res) => {
    const state = readDailyReportState(scopeFromRequest(req))
    return res.json({ snapshots: state.snapshots.map(({ id, reportDate, scope, version, createdAt, createdBy, source, isComplete, warnings }) => ({ id, reportDate, scope, version, createdAt, createdBy, source, isComplete, warnings })), corrections: state.corrections, deliveries: state.deliveries, mockEnabled: state.mockEnabled })
  })

  router.post('/daily-reports/snapshots', requireRole(...WRITERS), (req, res) => {
    const body = asRecord(req.body), reportDate = body.reportDate, snapshotScope = body.scope ?? 'both'
    if (!validDay(reportDate) || !['sales', 'purchase', 'both'].includes(String(snapshotScope))) return res.status(400).json({ error: 'reportDate 或 scope 参数无效。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const snapshot = mutateState(scope, state => snapshotFromState(state, reportDate, snapshotScope as 'sales' | 'purchase' | 'both', actor))
      return res.status(201).json(snapshot)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'snapshot_create_failed', message: error instanceof Error ? error.message : '快照生成失败。' }) }
  })

  router.get('/daily-reports/snapshots/:id/export.html', (req, res) => {
    const state = readDailyReportState(scopeFromRequest(req)), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="daily-report-${snapshot.reportDate}-v${snapshot.version}.html"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(renderSnapshotHtml(snapshot))
  })

  router.get('/daily-reports/snapshots/:id/export.xlsx', async (req, res) => {
    const state = readDailyReportState(scopeFromRequest(req)), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    const workbook = new ExcelJS.Workbook(), data = snapshot.data as Record<string, unknown>, sales = asRecord(data.sales), purchase = asRecord(data.purchase), orders = asRecord(data.orders), balances = asRecord(data.balances)
    const summary = workbook.addWorksheet('摘要')
    summary.addRows([['经营日报', ''], ['报表日期', snapshot.reportDate], ['归档版本', snapshot.version], ['数据来源', snapshot.source === 'local-mock' ? '本地隔离演示（非真实 ERP）' : '工作区'], ['销售日报金额', asRecord(sales.daily).amountCny ?? 0], ['采购日报金额', asRecord(purchase.daily).amountCny ?? 0], ['销售订单金额', asRecord(orders.sales).amountCny ?? 0], ['采购订单金额', asRecord(orders.purchase).amountCny ?? 0], ['应收未收', asRecord(balances.receivables).outstandingAmountCny ?? 0], ['应付未付', asRecord(balances.payables).outstandingAmountCny ?? 0], ['快照完整', snapshot.isComplete ? '是' : '否'], ...snapshot.warnings.map(warning => ['警告', warning])])
    summary.columns = [{ width: 24 }, { width: 70 }]
    const reportSheet = workbook.addWorksheet('日报明细')
    reportSheet.addRow(['类型', '日期', '编号', '客商', '数量', '币种', '原币金额', '汇率', '人民币金额', '备注'])
    for (const row of (data.reports as DailyReport[] | undefined) ?? []) reportSheet.addRow([row.type === 'sales' ? '销售' : '采购', row.date, row.documentNo, row.partyName, row.quantity, row.currency, row.originalAmount, row.exchangeRate, row.amountCny, row.note])
    const k3Sheet = workbook.addWorksheet('K3快照')
    k3Sheet.addRow(['类型', '单号', '日期', '客商', '物料/科目', '数量', '单位', '单价', '币种', '原币金额', '人民币金额', '已收/付', '状态', '上游单号', '关联单据', '数据来源'])
    for (const row of (data.k3Rows as K3SnapshotRow[] | undefined) ?? []) k3Sheet.addRow([row.kind, row.billNo, row.date, row.partyName, row.materialName, row.quantity, row.unit, row.unitPrice ?? '', row.currency, row.originalAmount, row.amountCny, row.settledAmountCny, row.status, row.upstreamBillNo ?? '', row.linkedDocuments?.map(link => `${link.kind}:${link.billNo}`).join('；') ?? '', row.source])
    const linkSheet = workbook.addWorksheet('关联与分摊')
    linkSheet.addRow(['日报ID', '快照行ID', 'K3单号', '快照日期', '日报日期', '分摊金额', '剩余金额', '超额金额', '跨日'])
    const archivedLinks = (data.links as DailyReportLink[] | undefined) ?? []
    const archivedRowAllocation = (rowId: string) => roundMoney(archivedLinks.filter(link => link.k3RowId === rowId).reduce((sum, link) => sum + Math.abs(link.allocatedAmount), 0))
    for (const link of archivedLinks) {
      const row = (data.k3Rows as K3SnapshotRow[] | undefined)?.find(item => item.id === link.k3RowId), report = (data.reports as DailyReport[] | undefined)?.find(item => item.id === link.reportId)
      const allocated = row ? archivedRowAllocation(row.id) : 0
      linkSheet.addRow([link.reportId, link.k3RowId, row?.billNo ?? '', row?.date ?? '', report?.date ?? '', link.allocatedAmount, row ? roundMoney(Math.max(0, Math.abs(row.amountCny) - allocated)) : '', row ? roundMoney(Math.max(0, allocated - Math.abs(row.amountCny))) : '', row && report && row.date !== report.date ? '是' : '否'])
    }
    for (const name of ['销售对账', '采购对账']) {
      const kind = name === '销售对账' ? sales : purchase
      const sheet = workbook.addWorksheet(name)
      sheet.addRows([['日报关联覆盖率', asRecord(asRecord(kind).reconciliation).dailyCoverage ? asRecord(asRecord(asRecord(kind).reconciliation).dailyCoverage).coverageRate ?? '—' : '—'], ['月度系统金额', asRecord(asRecord(asRecord(kind).reconciliation).monthDifference).systemAmount ?? 0], ['月度快照金额', asRecord(asRecord(asRecord(kind).reconciliation).monthDifference).k3Amount ?? 0], ['月度差额', asRecord(asRecord(asRecord(kind).reconciliation).monthDifference).difference ?? 0], ['年累计系统金额', asRecord(asRecord(asRecord(kind).reconciliation).yearDifference).systemAmount ?? 0], ['年累计快照金额', asRecord(asRecord(asRecord(kind).reconciliation).yearDifference).k3Amount ?? 0]])
    }
    for (const [name, records] of [['应收明细', asRecord(balances.receivables).rows], ['应付明细', asRecord(balances.payables).rows]] as const) {
      const sheet = workbook.addWorksheet(name)
      sheet.addRow(['单据编号', '日期', '客商', '单据金额', '已收/付', '未收/付', '状态'])
      if (Array.isArray(records)) for (const row of records as Array<Record<string, unknown>>) sheet.addRow([row.billNo, row.date, row.partyName, row.amountCny, row.settledAmountCny, row.outstandingAmountCny, row.status])
    }
    for (const sheet of workbook.worksheets) { sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.getRow(1).font = { bold: true }; sheet.columns.forEach(column => { if (!column.width) column.width = 18 }) }
    const buffer = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="daily-report-${snapshot.reportDate}-v${snapshot.version}.xlsx"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(Buffer.from(buffer))
  })

  router.post('/daily-reports/snapshots/:id/deliveries', requireRole(...WRITERS), (req, res) => {
    const body = asRecord(req.body), channel = body.channel
    if (channel !== 'email' && channel !== 'dingtalk') return res.status(400).json({ error: 'channel 必须为 email 或 dingtalk。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const delivery = mutateState(scope, state => {
        const snapshot = state.snapshots.find(item => item.id === String(req.params.id))
        if (!snapshot) return undefined
        const existing = state.deliveries.find(item => item.snapshotId === snapshot.id && item.channel === channel)
        if (existing) return existing
        const item: DailyDelivery = { id: randomUUID(), snapshotId: snapshot.id, channel, targetDisplay: '本地隔离模拟目标（未实际发送）', status: 'simulated', message: '仅记录本地模拟结果；未连接 SMTP、钉钉或任何真实收件人/群。', createdAt: new Date().toISOString(), createdBy: actor.id }
        state.deliveries.unshift(item)
        return item
      })
      if (!delivery) return res.status(404).json({ error: 'snapshot_not_found', message: '快照不存在或不属于当前账套。' })
      return res.status(201).json(delivery)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'delivery_simulation_failed', message: error instanceof Error ? error.message : '模拟推送记录失败。' }) }
  })

  router.get('/daily-reports/snapshots/:id', (req, res) => {
    const state = readDailyReportState(scopeFromRequest(req)), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    return res.json({ snapshot, deliveries: deliveryByChannel(state, snapshot.id) })
  })

  return router
}
