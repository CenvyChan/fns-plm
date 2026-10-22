import { createHash, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import multer from 'multer'
import { Router, type Request } from 'express'
import { requireRole } from './auth.js'
import { db, getAppStateVersioned, setAppStateIfRevision, StateConflictError } from './database.js'
import { parseDailyReportImportFile } from './daily-report-import.js'
import { BoundedPreviewCache, MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES, MAX_PENDING_IMPORT_PREVIEWS } from './import-preview-cache.js'
import type { WorkspaceScope } from './scope.js'
import { findDailyParty, findLegacyDailyParty, getDailyReportingAccess, hasDailyPartyAssignment, readDailyReportingAdminState, recordDailyReportingMigrationBatch, type DailyParty } from './daily-reporting-admin.js'

export type DailyKind = 'sales' | 'purchase'
export type K3DocumentKind = 'shipment' | 'purchase-receipt' | 'sales-order' | 'purchase-order' | 'receivable' | 'payable' | 'sales-invoice' | 'purchase-invoice'
export const DAILY_K3_SOURCE_KINDS: K3DocumentKind[] = ['shipment', 'purchase-receipt', 'sales-order', 'purchase-order', 'receivable', 'payable', 'sales-invoice', 'purchase-invoice']
export const DAILY_K3_REQUIRED_FIELDS = ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] as const
export type DailyK3Field = 'id' | 'billNo' | 'date' | 'modifiedAt' | 'partyNumber' | 'partyName' | 'materialName' | 'quantity' | 'unit' | 'unitPrice' | 'currency' | 'originalAmount' | 'amountCny' | 'settledAmountCny' | 'status' | 'upstreamId' | 'upstreamBillNo' | 'upstreamLineId' | 'taxAmount' | 'taxAmountCny'
export type DailyK3SourceMapping = { formId: string; fields: Partial<Record<DailyK3Field, string>> }
export type DailyK3SyncMetadata = { source: 'k3cloud' | 'history-import'; lastSyncedAt: string; rowCounts: Partial<Record<K3DocumentKind, number>>; changedRowCounts?: Partial<Record<K3DocumentKind, number>>; mode?: 'full' | 'incremental' | 'mixed'; incrementalFrom?: string | null; fullScanKinds?: K3DocumentKind[] }
export type DailySource = 'manual' | 'history-import'

export interface DailyReport {
  id: string; type: DailyKind; date: string; partyName: string; documentNo: string; quantity: number; currency: string
  originalAmount: number; originalAmountExact?: string; exchangeRate: number; exchangeRateExact?: string; amountCny: number; amountCnyExact?: string; note: string; source: DailySource
  sourceIdempotencyKey?: string; sourceFileName?: string; sourceRow?: number; importBatchId?: string
  legacyCompanyCode?: string; legacyPartyId?: string; legacyUserId?: string; legacyUsername?: string; legacyUserName?: string
  legacySourceFile?: string; legacyImportBatch?: string; legacySourceRow?: number; legacyBusinessType?: string
  legacySourcePartyStatus?: 'linked' | 'pending'; legacyUserStatus?: 'pending'
  createdAt: string; updatedAt: string; createdBy: string; createdByName: string; updatedBy: string; deletedAt?: string; deletedBy?: string
  partyId?: string
}
export interface K3SnapshotRow {
  id: string; kind: K3DocumentKind; type: DailyKind; billNo: string; date: string; partyNumber: string; partyName: string
  materialName: string; quantity: number; unit: string; currency: string; originalAmount: number; amountCny: number
  settledAmountCny: number; status: string; source: 'local-mock' | 'k3cloud' | 'history-import'; snapshotAt: string; active: boolean
  erpId?: string; modifiedAt?: string; inactiveAt?: string; unitPrice?: number; upstreamId?: string; upstreamBillNo?: string; upstreamLineId?: string; taxAmount?: number; taxAmountCny?: number
  quantityExact?: string; unitPriceExact?: string; originalAmountExact?: string; amountCnyExact?: string
  legacyCompanyCode?: string; legacyHeaderId?: string; legacyLineId?: string; legacyRecordId?: string; legacyFormId?: string; legacySequence?: number
  materialNumber?: string; specification?: string
  linkedDocuments?: Array<Pick<K3SnapshotRow, 'id' | 'kind' | 'billNo' | 'date' | 'partyName' | 'materialName' | 'quantity' | 'unit' | 'unitPrice' | 'currency' | 'amountCny' | 'status'>>
}
export interface LegacyK3SnapshotHeader {
  id: string; legacyCompanyCode: string; legacyRecordId: string; formId: string; fid: string
  kind: 'shipment' | 'purchase-receipt'; type: DailyKind; businessType: 'SALES_OUT' | 'PURCHASE_IN'
  billNo: string; date: string; status: string; approveDate?: string; orgNumber: string
  partyNumber: string; partyName: string; currency: string; totalAmountExact: string; totalQuantityExact: string
  legacyPartyMappingId?: string; active: boolean; inactiveAt?: string; snapshotAt: string
}
export interface DailyK3MigrationSummary {
  legacyCompanyCode: string; headerCount: number; lineCount: number; inactiveHeaderCount: number; inactiveLineCount: number
  digest: string; completedAt: string
}
interface DailyK3MigrationStage {
  legacyCompanyCode: string; expectedHeaders?: number; expectedLines?: number
  headers: LegacyK3SnapshotHeader[]; lines: K3SnapshotRow[]
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
  createdBy: string; source: 'local-mock' | 'k3cloud' | 'history-import' | 'workspace'; calculationVersion: string; isComplete: boolean
  warnings: string[]; data: Record<string, unknown>
}
export interface DailyDelivery {
  id: string; snapshotId: string; channel: 'email' | 'dingtalk'; targetDisplay: string; status: 'simulated'
  message: string; createdAt: string; createdBy: string
}
type ImportBatchAudit = { id: string; actorId: string; actorName?: string; scopeKey: string; type: DailyKind | 'mixed'; fileName?: string; digest: string; completedAt: string; inserted: number; skipped: number; dateFrom: string | null; dateTo: string | null }
type ImportPreview = { id: string; actorId: string; scopeKey: string; type: DailyKind | 'mixed'; fileName?: string; digest: string; expiresAt: string; blocked: boolean; rows: Array<{ rowNumber: number; payload: Omit<DailyReport, 'id'|'createdAt'|'updatedAt'|'createdBy'|'createdByName'|'updatedBy'>; duplicate: boolean }> }
export interface DailyReportState {
  importPreviews?: ImportPreview[]; importBatches?: ImportBatchAudit[]; reports: DailyReport[]; k3Rows: K3SnapshotRow[]; links: DailyReportLink[]; snapshots: DailySnapshot[]
  corrections: DailyCorrection[]; deliveries: DailyDelivery[]; mockSnapshotAt: string | null; mockEnabled: boolean; k3Sync: DailyK3SyncMetadata | null
  k3HistoricalHeaders: LegacyK3SnapshotHeader[]; k3MigrationStage?: DailyK3MigrationStage; k3MigrationSummary?: DailyK3MigrationSummary
}

const STATE_PREFIX = 'daily-reporting'
const WRITERS = ['admin', 'plm_manager', 'member'] as const
const MIGRATION_MANAGERS = ['admin', 'plm_manager'] as const
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
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
function decimalParts(value: string): { coefficient: bigint; scale: number } | undefined {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match || value.length > 100) return undefined
  const exponent = Number(match[5] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 80) return undefined
  const integer = match[2] ?? '0', fraction = match[3] ?? match[4] ?? ''
  let scale = fraction.length - exponent
  if (scale > 80) return undefined
  let coefficient = BigInt(`${integer}${fraction}` || '0')
  if (match[1] === '-') coefficient = -coefficient
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0 }
  return { coefficient, scale }
}
function multiplyDecimalText(leftText: string, rightText: string, targetScale = 6): string | undefined {
  const left = decimalParts(leftText), right = decimalParts(rightText)
  if (!left || !right) return undefined
  let coefficient = left.coefficient * right.coefficient
  const sourceScale = left.scale + right.scale
  if (sourceScale > targetScale) {
    const divisor = 10n ** BigInt(sourceScale - targetScale), negative = coefficient < 0n
    const absolute = negative ? -coefficient : coefficient
    coefficient = (absolute + divisor / 2n) / divisor
    if (negative) coefficient = -coefficient
  } else coefficient *= 10n ** BigInt(targetScale - sourceScale)
  const negative = coefficient < 0n, digits = (negative ? -coefficient : coefficient).toString().padStart(targetScale + 1, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -targetScale)}.${digits.slice(-targetScale)}`
}
function exactDecimalText(preferred: unknown, original: unknown, numeric: number): string {
  const decimalPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
  for (const candidate of [preferred, original]) {
    if (typeof candidate !== 'string') continue
    const text = candidate.trim()
    if (text.length <= 100 && decimalPattern.test(text) && Number.isFinite(Number(text)) && Number(text) === numeric) return text
  }
  return String(numeric)
}
const deepClone = <T>(value: T): T => structuredClone(value)
function stateKey(scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>): string {
  return `${STATE_PREFIX}:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}
function emptyState(): DailyReportState {
  return { importPreviews: [], importBatches: [], reports: [], k3Rows: [], links: [], snapshots: [], corrections: [], deliveries: [], mockSnapshotAt: null, mockEnabled: false, k3Sync: null, k3HistoricalHeaders: [] }
}
function normalizedState(value: unknown): DailyReportState {
  const state = { ...emptyState(), ...asRecord(value) } as DailyReportState
  for (const key of ['reports', 'k3Rows', 'links', 'snapshots', 'corrections', 'deliveries', 'k3HistoricalHeaders', 'importPreviews', 'importBatches'] as const) if (!Array.isArray(state[key])) state[key] = [] as never
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
function legacyString(value: unknown, max: number): string | undefined {
  const candidate = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : ''
  return candidate && candidate.length <= max ? candidate : undefined
}
function legacyBlankString(value: unknown, max: number): string | undefined {
  if (typeof value === 'string' && value.trim() === '') return ''
  return legacyString(value, max)
}
function legacyDecimal(value: unknown): { exact: string; numeric: number } | undefined {
  const exact = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!exact || exact.length > 100 || !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(exact)) return undefined
  const numeric = Number(exact)
  return Number.isFinite(numeric) ? { exact, numeric } : undefined
}
function legacyTimestamp(value: unknown): string | undefined {
  const input = legacyString(value, 80)
  if (!input) return undefined
  const parsed = new Date(input)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined
}
function legacyK3Id(kind: 'header' | 'line', companyCode: string, ...parts: string[]): string {
  return `legacy-k3-${kind}-${createHash('sha256').update(JSON.stringify([companyCode, ...parts])).digest('hex').slice(0, 32)}`
}
function parseLegacyK3Header(value: unknown, companyCode: string): LegacyK3SnapshotHeader | undefined {
  const row = asRecord(value), legacyRecordId = legacyString(row.legacyRecordId, 40), formId = legacyString(row.formId, 64), fid = legacyString(row.fid, 64)
  const businessType = row.businessType === 'SALES_OUT' ? 'SALES_OUT' : row.businessType === 'PURCHASE_IN' ? 'PURCHASE_IN' : undefined
  const type: DailyKind | undefined = businessType === 'SALES_OUT' ? 'sales' : businessType === 'PURCHASE_IN' ? 'purchase' : undefined
  const date = typeof row.date === 'string' && validDay(row.date) ? row.date : undefined
  const status = legacyBlankString(row.status, 32), orgNumber = legacyBlankString(row.orgNumber, 64)
  const partyNumber = legacyBlankString(row.partyNumber, 64), partyName = legacyBlankString(row.partyName, 200)
  const currency = typeof row.currency === 'string' && row.currency.length <= 16 ? row.currency.trim().toUpperCase() : undefined
  const totalAmount = legacyDecimal(row.totalAmountExact), totalQuantity = legacyDecimal(row.totalQuantityExact)
  const snapshotAt = legacyTimestamp(row.snapshotAt), approveDate = row.approveDate === null || row.approveDate === '' || row.approveDate === undefined ? undefined : legacyTimestamp(row.approveDate)
  const inactiveAt = row.inactiveAt === null || row.inactiveAt === '' || row.inactiveAt === undefined ? undefined : legacyTimestamp(row.inactiveAt)
  const legacyPartyMappingId = row.legacyPartyMappingId === null || row.legacyPartyMappingId === '' || row.legacyPartyMappingId === undefined ? undefined : legacyString(row.legacyPartyMappingId, 128)
  if (!legacyRecordId || !/^\d+$/.test(legacyRecordId) || !formId || !fid || !businessType || !type || !date || status === undefined || orgNumber === undefined || partyNumber === undefined || partyName === undefined || currency === undefined || !totalAmount || !totalQuantity || !snapshotAt || (row.approveDate && !approveDate) || (row.inactiveAt && !inactiveAt) || (row.legacyPartyMappingId && !legacyPartyMappingId) || typeof row.active !== 'boolean') return undefined
  const kind = type === 'sales' ? 'shipment' : 'purchase-receipt'
  return {
    id: legacyK3Id('header', companyCode, formId, fid), legacyCompanyCode: companyCode, legacyRecordId, formId, fid,
    kind, type, businessType, billNo: legacyString(row.billNo, 80) ?? '', date, status, ...(approveDate ? { approveDate } : {}), orgNumber,
    partyNumber, partyName, currency, totalAmountExact: totalAmount.exact, totalQuantityExact: totalQuantity.exact,
    ...(legacyPartyMappingId ? { legacyPartyMappingId } : {}), active: row.active, ...(inactiveAt ? { inactiveAt } : {}), snapshotAt,
  }
}
function parseLegacyK3Line(value: unknown, companyCode: string, headersBySourceId: Map<string, LegacyK3SnapshotHeader>): K3SnapshotRow | undefined {
  const row = asRecord(value), legacyRecordId = legacyString(row.legacyRecordId, 40), legacyHeaderRecordId = legacyString(row.legacyHeaderRecordId, 40)
  const formId = legacyString(row.formId, 64), fid = legacyString(row.fid, 64), entryId = legacyString(row.entryId, 64)
  const sourceHeaderKey = formId && fid ? `${formId}\u0000${fid}` : ''
  const header = headersBySourceId.get(sourceHeaderKey)
  const sequence = typeof row.sequence === 'number' ? row.sequence : typeof row.sequence === 'string' && /^\d+$/.test(row.sequence) ? Number(row.sequence) : 0
  const quantity = legacyDecimal(row.quantityExact), unitPrice = legacyDecimal(row.unitPriceExact)
  const originalAmount = legacyDecimal(row.originalAmountExact), amountCny = legacyDecimal(row.amountCnyExact)
  const materialNumber = legacyBlankString(row.materialNumber, 80), materialName = legacyBlankString(row.materialName, 200)
  const specification = legacyBlankString(row.specification, 512), unit = legacyBlankString(row.unit, 32)
  if (!legacyRecordId || !/^\d+$/.test(legacyRecordId) || !legacyHeaderRecordId || !formId || !fid || !entryId || !header || header.legacyRecordId !== legacyHeaderRecordId || !Number.isSafeInteger(sequence) || sequence < 0 || !quantity || !unitPrice || !originalAmount || !amountCny || materialNumber === undefined || materialName === undefined || specification === undefined || unit === undefined) return undefined
  const id = legacyK3Id('line', companyCode, formId, fid, entryId)
  return {
    id, erpId: `${formId}:${fid}:${entryId}`, kind: header.kind, type: header.type, billNo: header.billNo, date: header.date,
    partyNumber: header.partyNumber, partyName: header.partyName, materialNumber, materialName, specification, quantity: quantity.numeric, quantityExact: quantity.exact,
    unit, unitPrice: unitPrice.numeric, unitPriceExact: unitPrice.exact, currency: header.currency,
    originalAmount: originalAmount.numeric, originalAmountExact: originalAmount.exact, amountCny: amountCny.numeric, amountCnyExact: amountCny.exact,
    settledAmountCny: 0, status: header.status, source: 'history-import', snapshotAt: header.snapshotAt, active: header.active,
    ...(header.inactiveAt ? { inactiveAt: header.inactiveAt } : {}), legacyCompanyCode: companyCode, legacyHeaderId: header.id,
    legacyLineId: entryId, legacyRecordId, legacyFormId: formId, legacySequence: sequence,
  }
}
function actorFromRequest(req: Request): { id: string; name: string } {
  return { id: req.authUser?.id ?? 'unknown', name: req.authUser?.displayName ?? '工作区成员' }
}
function partyForReport(scope: WorkspaceScope, req: Request, type: unknown, value: unknown): { party?: DailyParty; error?: string; status?: number } {
  const kind = type === 'sales' ? 'customer' : type === 'purchase' ? 'supplier' : undefined
  if (!kind) return {}
  const partyId = typeof value === 'string' ? value.trim() : ''
  const configured = readDailyReportingAdminState(scope).masterDataConfigured
  const role = req.authUser?.role
  if (!partyId) return !configured && (role === 'admin' || role === 'plm_manager') ? {} : { error: '请从当前账套客户/供应商主档中选择客商。', status: 400 }
  const party = findDailyParty(scope, partyId, kind)
  if (!party) return { error: '所选客商不存在、已停用或与销售/采购类型不匹配。', status: 400 }
  if (role !== 'admin' && role !== 'plm_manager' && !hasDailyPartyAssignment(scope, req.authUser?.id ?? '', kind, party.id)) return { error: '当前成员未被分配到该客商，不能录入或修改该客商日报。', status: 403 }
  return { party }
}
function reportingAccess(scope: WorkspaceScope, req: Request) {
  return getDailyReportingAccess(scope, req.authUser?.id ?? '', req.authUser?.role ?? '')
}
function scopeIsAllowed(access: ReturnType<typeof reportingAccess>, requested: 'sales' | 'purchase' | 'both'): boolean {
  return requested === 'both' ? access.sales && access.purchase : access[requested]
}
function snapshotIsAllowed(access: ReturnType<typeof reportingAccess>, snapshot: DailySnapshot): boolean {
  return snapshot.scope === 'both' ? access.sales && access.purchase : access[snapshot.scope]
}
function liveReports(state: DailyReportState): DailyReport[] { return state.reports.filter(report => !report.deletedAt) }
function rowAllocation(state: DailyReportState, rowId: string): number {
  return roundMoney(state.links.filter(link => link.k3RowId === rowId).reduce((total, link) => total + Math.abs(link.allocatedAmount), 0))
}
function reportAllocation(state: DailyReportState, reportId: string): number {
  return roundMoney(state.links.filter(link => link.reportId === reportId).reduce((total, link) => total + Math.abs(link.allocatedAmount), 0))
}
function activeReportAllocation(state: DailyReportState, reportId: string): number {
  const activeRowIds = new Set(state.k3Rows.filter(row => row.active).map(row => row.id))
  return roundMoney(state.links.filter(link => link.reportId === reportId && activeRowIds.has(link.k3RowId)).reduce((total, link) => total + Math.abs(link.allocatedAmount), 0))
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
  const previousCheckpoint = stateVersion.value.k3Sync?.source === 'k3cloud' ? stateVersion.value.k3Sync.lastSyncedAt : null
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
    const hasPriorKindSnapshot = stateVersion.value.k3Sync?.source === 'k3cloud' && Object.hasOwn(stateVersion.value.k3Sync.rowCounts, kind)
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
  const inactiveRows = stateVersion.value.k3Rows
    .filter(row => row.source === 'k3cloud' && !incomingIds.has(row.id) && fullScanKinds.includes(row.kind))
    .map(row => row.active ? { ...row, active: false, inactiveAt: refreshedAt } : row)
  const nextRows = [...previousRows, ...inactiveRows, ...collected]
  const nextRowIds = new Set(nextRows.map(row => row.id))
  const rowCounts = Object.fromEntries(DAILY_K3_SOURCE_KINDS.map(kind => [kind, nextRows.filter(row => row.kind === kind && row.active).length])) as Partial<Record<K3DocumentKind, number>>
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
  const covered = roundMoney(dailyReports.reduce((sum, report) => sum + Math.min(Math.abs(report.amountCny), activeReportAllocation(state, report.id)), 0))
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
    dailyCoverage: { reportCount: dailyReports.length, totalAmount: dailyBase, coveredAmount: covered, coverageRate: dailyBase ? roundMoney(covered / dailyBase * 100) : null, reports: dailyReports.map(report => { const allocatedAmount = activeReportAllocation(state, report.id); return { ...report, allocatedAmount, historicalAllocatedAmount: reportAllocation(state, report.id), cappedAllocatedAmount: Math.min(Math.abs(report.amountCny), allocatedAmount) } }) },
    monthDifference: { from: startOfMonth(reportDate), to: reportDate, systemAmount: monthSystem, k3Amount: monthK3, difference: monthDiff, differenceRate: complete && monthK3 !== 0 ? roundMoney(monthDiff / Math.abs(monthK3) * 100) : null, isComplete: complete },
    yearDifference: { from: startOfYear(reportDate), to: reportDate, systemAmount: yearSystem, k3Amount: yearK3, difference: yearDiff, differenceRate: complete && yearK3 !== 0 ? roundMoney(yearDiff / Math.abs(yearK3) * 100) : null, isComplete: complete },
    k3Allocation: { rowCount: allocationRows.length, originalAmount: roundMoney(monthRows.reduce((sum, row) => sum + row.amountCny, 0)), allocatedAmount: roundMoney(allocationRows.reduce((sum, row) => sum + row.allocatedAmount, 0)), remainingAmount: roundMoney(allocationRows.reduce((sum, row) => sum + Math.max(0, Math.abs(row.amountCny) - Math.abs(row.allocatedAmount)), 0)), overAllocatedAmount: roundMoney(allocationRows.reduce((sum, row) => sum + row.overAllocatedAmount, 0)), crossDateCount: allocationRows.filter(row => row.crossDate).length, rows: allocationRows },
  }
}

export function buildDailyReportSummary(state: DailyReportState, reportDate: string, scope: 'sales' | 'purchase' | 'both' = 'both') {
  const reports = liveReports(state).filter(report => report.date === reportDate && (scope === 'both' || report.type === scope))
  const visibleK3Kinds = scope === 'sales' ? new Set(['shipment', 'sales-order', 'sales-invoice', 'receivable']) : scope === 'purchase' ? new Set(['purchase-receipt', 'purchase-order', 'purchase-invoice', 'payable']) : null
  const k3Sync = state.k3Sync ? deepClone(state.k3Sync) : null
  if (k3Sync && visibleK3Kinds) {
    k3Sync.rowCounts = Object.fromEntries(Object.entries(k3Sync.rowCounts).filter(([kind]) => visibleK3Kinds.has(kind)))
    if (k3Sync.changedRowCounts) k3Sync.changedRowCounts = Object.fromEntries(Object.entries(k3Sync.changedRowCounts).filter(([kind]) => visibleK3Kinds.has(kind)))
    if (k3Sync.fullScanKinds) k3Sync.fullScanKinds = k3Sync.fullScanKinds.filter(kind => visibleK3Kinds.has(kind))
  }
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
    return reconciliationFor(state, kind as DailyKind, reportDate).k3Allocation.rows.filter(row => row.overAllocatedAmount > 0 || row.crossDate).map(row => ({ type: kind, billNo: row.billNo, overAllocatedAmount: row.overAllocatedAmount, crossDate: row.crossDate, inactiveSource: false }))
  })
  const invalidSourceWarnings = state.links.flatMap(link => {
    const report = state.reports.find(item => item.id === link.reportId && !item.deletedAt)
    if (!report || (scope !== 'both' && report.type !== scope) || state.k3Rows.find(row => row.id === link.k3RowId)?.active) return []
    const sourceRow = state.k3Rows.find(row => row.id === link.k3RowId)
    return [{ type: report.type, billNo: sourceRow?.billNo ?? link.k3RowId, overAllocatedAmount: 0, crossDate: false, inactiveSource: true }]
  })
  warningRows.push(...invalidSourceWarnings)
  const source = state.mockEnabled ? 'local-mock' : state.k3Sync?.source ?? 'workspace'
  return {
    reportDate, generatedAt: new Date().toISOString(), source, isMock: state.mockEnabled,
    mockSnapshotAt: state.mockSnapshotAt, k3Sync, k3HistoricalMigration: state.k3MigrationSummary ?? null, liveErpConnected: state.k3Sync?.source === 'k3cloud',
    sales: scope === 'purchase' ? undefined : { daily: sumDaily('sales'), reconciliation: reconciliationFor(state, 'sales', reportDate) },
    purchase: scope === 'sales' ? undefined : { daily: sumDaily('purchase'), reconciliation: reconciliationFor(state, 'purchase', reportDate) },
    orders: { sales: orderSummary(salesOrders), purchase: orderSummary(purchaseOrders) },
    fulfillment: { sales: orderSummary(shipments), purchase: orderSummary(receipts) },
    invoices: { sales: orderSummary(salesInvoices), purchase: orderSummary(purchaseInvoices) },
    balances: { receivables: balanceSummary(receivables), payables: balanceSummary(payables) },
    warnings: warningRows,
    notice: state.mockEnabled ? '本地隔离演示快照；非真实 K3Cloud 数据，金额仅用于功能验证。' : state.k3Sync?.source === 'history-import' ? `旧系统 K3 历史快照已迁入（${state.k3MigrationSummary?.lineCount ?? 0} 行），不是实时 ERP 连接；应收/应付余额未从该库存历史数据推算。` : state.k3Sync ? `真实 K3Cloud 只读快照已同步于 ${state.k3Sync.lastSyncedAt}；应收/应付余额为该同步时点余额，并非按报表日重算。` : '尚无 K3Cloud 快照；金额对账暂不可判定，缺失数据未按零处理。',
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
function validateReportPayload(body: Record<string, unknown>, existing?: DailyReport, options: { preserveCnySnapshot?: boolean; allowLegacyMetadata?: boolean } = {}): { error?: string; value?: Omit<DailyReport, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName' | 'updatedBy'> } {
  const type = body.type ?? existing?.type
  const date = body.date ?? existing?.date
  const partyName = body.partyName ?? existing?.partyName
  const documentNo = body.documentNo ?? existing?.documentNo ?? ''
  const quantity = finite(body.quantity ?? existing?.quantity ?? 0)
  const currency = body.currency ?? existing?.currency ?? 'CNY'
  const originalAmountInput = body.originalAmount ?? existing?.originalAmountExact ?? existing?.originalAmount
  const originalAmount = finite(originalAmountInput)
  const rawRateInput = body.exchangeRate ?? existing?.exchangeRateExact ?? existing?.exchangeRate ?? 1
  const rawRate = finite(rawRateInput)
  const rawCnyInput = body.amountCny ?? body.amountCnyExact ?? existing?.amountCnyExact ?? existing?.amountCny
  const note = body.note ?? existing?.note ?? ''
  const partyId = body.partyId ?? existing?.partyId
  const source = existing?.source ?? 'manual'
  if (!validKind(type)) return { error: '日报类型必须是 sales 或 purchase。' }
  if (!validDay(date)) return { error: '日期必须是有效的 YYYY-MM-DD。' }
  if (typeof partyName !== 'string' || !partyName.trim() || partyName.trim().length > 160) return { error: '客户/供应商名称为必填，最多 160 字。' }
  if (typeof documentNo !== 'string' || documentNo.length > 100) return { error: '单据编号最多 100 字。' }
  if (quantity === undefined || originalAmount === undefined || rawRate === undefined || rawRate <= 0) return { error: '数量、原币金额和正汇率必须是有限数字。' }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { error: '币种必须是 3 位大写 ISO 代码。' }
  if (typeof note !== 'string' || note.length > 2000) return { error: '备注最多 2000 字。' }
  if (partyId !== undefined && (typeof partyId !== 'string' || partyId.length > 100)) return { error: '客商关联无效。' }
  if (source !== 'manual' && source !== 'history-import') return { error: '日报来源无效。' }
  const originalAmountExact = exactDecimalText(body.originalAmountExact, originalAmountInput, originalAmount)
  const exchangeRateExact = currency === 'CNY' ? '1' : exactDecimalText(body.exchangeRateExact, rawRateInput, rawRate)
  const hasCnySnapshot = options.preserveCnySnapshot && rawCnyInput !== undefined && rawCnyInput !== null && rawCnyInput !== ''
  const rawCny = hasCnySnapshot ? finite(rawCnyInput) : undefined
  if (hasCnySnapshot && rawCny === undefined) return { error: '历史人民币金额快照必须是有限数字。' }
  const amountCnyExact = rawCny === undefined ? multiplyDecimalText(originalAmountExact, exchangeRateExact) : exactDecimalText(body.amountCnyExact, rawCnyInput, rawCny)
  const amountCny = amountCnyExact === undefined ? undefined : finite(amountCnyExact)
  if (amountCny === undefined) return { error: '原币金额或汇率精度无效，无法生成人民币金额快照。' }
  const allowLegacyMetadata = options.allowLegacyMetadata === true || existing?.source === 'history-import'
  const legacy = existing as unknown as Record<string, unknown> | undefined
  const legacyText = (key: string, max: number): string | undefined | null => {
    if (!allowLegacyMetadata) return undefined
    const value = body[key] ?? legacy?.[key]
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string' || value.length > max) return null
    return value.trim()
  }
  const legacyCompanyCode = legacyText('legacyCompanyCode', 32)
  const legacyPartyId = legacyText('legacyPartyId', 128)
  const legacyUserId = legacyText('legacyUserId', 128)
  const legacyUsername = legacyText('legacyUsername', 128)
  const legacyUserName = legacyText('legacyUserName', 160)
  const legacySourceFile = legacyText('legacySourceFile', 255)
  const legacyImportBatch = legacyText('legacyImportBatch', 128)
  const legacyBusinessType = legacyText('legacyBusinessType', 64)
  if ([legacyCompanyCode, legacyPartyId, legacyUserId, legacyUsername, legacyUserName, legacySourceFile, legacyImportBatch, legacyBusinessType].some(value => value === null)) return { error: '旧系统来源或责任人字段长度/类型无效。' }
  const rawLegacyRow = allowLegacyMetadata ? body.legacySourceRow ?? legacy?.legacySourceRow : undefined
  const legacySourceRow = rawLegacyRow === undefined || rawLegacyRow === null || rawLegacyRow === '' ? undefined : typeof rawLegacyRow === 'number' ? rawLegacyRow : typeof rawLegacyRow === 'string' && /^\d+$/.test(rawLegacyRow) ? Number(rawLegacyRow) : Number.NaN
  if (legacySourceRow !== undefined && (!Number.isSafeInteger(legacySourceRow) || legacySourceRow < 1)) return { error: '旧来源行号必须是正整数。' }
  const sourceCompanyCode = legacyCompanyCode?.toUpperCase()
  const rawPartyStatus = allowLegacyMetadata ? body.legacySourcePartyStatus ?? existing?.legacySourcePartyStatus : undefined
  const legacySourcePartyStatus = rawPartyStatus === 'linked' || rawPartyStatus === 'pending' ? rawPartyStatus : undefined
  return { value: {
    type, date, partyName: partyName.trim(), documentNo: documentNo.trim(), quantity, currency,
    originalAmount, originalAmountExact, exchangeRate: currency === 'CNY' ? 1 : rawRate,
    exchangeRateExact, amountCny, amountCnyExact, note: note.trim(), source,
    ...(typeof partyId === 'string' && partyId ? { partyId } : {}),
    ...(sourceCompanyCode ? { legacyCompanyCode: sourceCompanyCode } : {}),
    ...(legacyPartyId ? { legacyPartyId } : {}), ...(legacyUserId ? { legacyUserId, legacyUserStatus: 'pending' as const } : {}),
    ...(legacyUsername ? { legacyUsername } : {}), ...(legacyUserName ? { legacyUserName } : {}),
    ...(legacySourceFile ? { legacySourceFile } : {}), ...(legacyImportBatch ? { legacyImportBatch } : {}),
    ...(legacySourceRow === undefined ? {} : { legacySourceRow }), ...(legacyBusinessType ? { legacyBusinessType } : {}),
    ...(legacySourcePartyStatus ? { legacySourcePartyStatus } : {}),
    ...(existing?.sourceIdempotencyKey ? { sourceIdempotencyKey: existing.sourceIdempotencyKey } : {}),
    ...(existing?.sourceFileName ? { sourceFileName: existing.sourceFileName } : {}),
    ...(existing?.sourceRow !== undefined ? { sourceRow: existing.sourceRow } : {}),
    ...(existing?.importBatchId ? { importBatchId: existing.importBatchId } : {}),
  } }
}

type ImportPreviewRow = { line: number; value?: Omit<DailyReport, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName' | 'updatedBy'>; errors: string[]; duplicateReason?: 'existing' | 'same_batch' }
type PendingImportPreview = { token: string; actorId: string; scopeKey: string; expiresAt: number; rows: ImportPreviewRow[]; fileName: string; digest: string; migration: boolean; sourceCompanyCode?: string }
const pendingImportPreviews = new BoundedPreviewCache<PendingImportPreview>(MAX_PENDING_IMPORT_PREVIEWS, MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES)
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 } }).single('file')
const importPreviewTtlMs = 15 * 60 * 1000

function importDuplicateKey(value: Pick<DailyReport, 'type' | 'date' | 'partyName' | 'documentNo' | 'quantity' | 'currency' | 'originalAmount' | 'exchangeRate' | 'note'> & Partial<Pick<DailyReport, 'originalAmountExact' | 'exchangeRateExact'>>): string {
  const documentNo = value.documentNo.trim().toLocaleLowerCase()
  return documentNo
    ? `${value.type}|${value.date}|doc:${documentNo}`
    : `${value.type}|${value.date}|row:${JSON.stringify([value.partyName.trim().toLocaleLowerCase(), value.quantity, value.currency, value.originalAmountExact ?? value.originalAmount, value.exchangeRateExact ?? value.exchangeRate, value.note.trim()])}`
}
function makeImportSourceKey(value: Parameters<typeof importDuplicateKey>[0], externalKey?: string): string {
  if (externalKey) return `external:${value.type}:${externalKey}`
  return `auto:${createHash('sha256').update(importDuplicateKey(value)).digest('hex')}`
}
function classifyImportDuplicates(state: DailyReportState, rows: ImportPreviewRow[]): void {
  const existingKeys = new Set(liveReports(state).map(importDuplicateKey))
  const existingSourceKeys = new Set(state.reports.map(item => item.sourceIdempotencyKey).filter((key): key is string => Boolean(key)))
  const batchKeys = new Set<string>(), batchSourceKeys = new Set<string>()
  for (const row of rows) {
    row.duplicateReason = undefined
    if (!row.value || row.errors.length) continue
    const key = importDuplicateKey(row.value)
    const sourceKey = row.value.sourceIdempotencyKey ?? ''
    if (existingKeys.has(key) || existingSourceKeys.has(sourceKey)) row.duplicateReason = 'existing'
    else if (batchKeys.has(key) || batchSourceKeys.has(sourceKey)) row.duplicateReason = 'same_batch'
    batchKeys.add(key); batchSourceKeys.add(sourceKey)
  }
}
function importPreviewResponse(preview: PendingImportPreview, headers: string[], mappedFields: string[]) {
  const errors = preview.rows.filter(row => row.errors.length).length
  const duplicates = preview.rows.filter(row => row.duplicateReason).length
  const valid = preview.rows.filter(row => !row.errors.length).length
  return {
    previewId: preview.token, fileName: preview.fileName, expiresAt: new Date(preview.expiresAt).toISOString(), headers, mappedFields,
    totalRows: preview.rows.length, validRows: valid, duplicateRows: duplicates, importableRows: Math.max(0, valid - duplicates), errorRows: errors,
    migration: preview.migration, ...(preview.sourceCompanyCode ? { sourceCompanyCode: preview.sourceCompanyCode } : {}),
    rows: preview.rows.map(row => ({ line: row.line, status: row.errors.length ? 'invalid' : row.duplicateReason ? 'duplicate' : 'ready', data: row.value, errors: row.errors, duplicateReason: row.duplicateReason })),
  }
}

function snapshotFromState(state: DailyReportState, reportDate: string, scope: 'sales' | 'purchase' | 'both', actor: { id: string; name: string }): DailySnapshot {
  const version = Math.max(0, ...state.snapshots.filter(item => item.reportDate === reportDate && item.scope === scope).map(item => item.version)) + 1
  const id = randomUUID(), summary = buildDailyReportSummary(state, reportDate, scope)
  const corrections = state.corrections.filter(item => !item.reportedInSnapshotId && item.originalDate < reportDate && (scope === 'both' || item.affectedReport === scope))
  const reports = liveReports(state).filter(report => report.date === reportDate && (scope === 'both' || report.type === scope))
  const reportIds = new Set(reports.map(report => report.id))
  const links = state.links.filter(link => reportIds.has(link.reportId))
  const linkedK3RowIds = new Set(links.map(link => link.k3RowId))
  const k3Rows = state.k3Rows.filter(row => ((row.active && (row.date <= reportDate || (row.kind === 'receivable' && scope !== 'purchase') || (row.kind === 'payable' && scope !== 'sales'))) || linkedK3RowIds.has(row.id)) && (scope === 'both' || row.type === scope)).map(row => ({ ...row, linkedDocuments: documentLinks(state, row) }))
  const warnings = [
    ...(state.mockEnabled ? ['当前为本地隔离演示数据，不能用于财务判断或正式对账。'] : []),
    ...(!state.mockSnapshotAt && !state.k3Sync ? ['未找到 K3Cloud 快照；对账指标显示为暂不可判定。'] : []),
    ...summary.warnings.map(item => item.inactiveSource ? `${item.type} ${item.billNo} 关联来源已失效，当前覆盖率不计入。` : `${item.type} ${item.billNo}${item.crossDate ? ' 存在跨日关联' : ''}${item.overAllocatedAmount ? ` 超额分摊 ${item.overAllocatedAmount.toFixed(2)} 元` : ''}`),
  ]
  const snapshotSource = state.mockEnabled ? 'local-mock' : state.k3Sync?.source === 'history-import' ? 'history-import' : state.k3Sync ? 'k3cloud' : 'workspace'
  const snapshotNote = state.k3Sync?.source === 'history-import' ? `旧系统 K3 历史快照已于 ${state.k3Sync.lastSyncedAt} 迁入；不代表实时 ERP 连接。` : state.k3Sync ? `K3Cloud 数据于 ${state.k3Sync.lastSyncedAt} 同步；应收/应付余额为同步时点余额。` : undefined
  const snapshot: DailySnapshot = { id, reportDate, scope, version, createdAt: new Date().toISOString(), createdBy: actor.id, source: snapshotSource, calculationVersion: 'v1.0.0', isComplete: Boolean(state.mockSnapshotAt || state.k3Sync), warnings: [...warnings, ...(snapshotNote ? [snapshotNote] : [])], data: { ...deepClone(summary), reports: deepClone(reports), links: deepClone(links), k3Rows: deepClone(k3Rows), corrections: deepClone(corrections) } }
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
  const rows = dailyRows.map(row => `<tr><td>${escapeHtml(row.type === 'sales' ? '销售' : '采购')}</td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.documentNo)}</td><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(row.currency)}</td><td>${escapeHtml(row.originalAmountExact ?? row.originalAmount)}</td><td>${escapeHtml(row.exchangeRateExact ?? row.exchangeRate)}</td><td>${escapeHtml(row.amountCnyExact ?? row.amountCny)}</td></tr>`).join('')
  const k3 = k3Rows.map(row => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.billNo)}</td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.materialName)}</td><td>${escapeHtml(row.amountCny.toFixed(2))}</td></tr>`).join('')
  const amount = (object: unknown, key: string) => Number(asRecord(object)[key] ?? 0).toFixed(2)
  const sourceLabel = snapshot.source === 'local-mock' ? '本地隔离演示快照（非真实 ERP）' : snapshot.source === 'history-import' ? '旧系统 K3 历史迁移快照（非实时连接）' : snapshot.source === 'k3cloud' ? 'K3Cloud 只读快照' : '工作区快照'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>经营日报 ${escapeHtml(snapshot.reportDate)}</title><style>body{font:14px system-ui,sans-serif;color:#243047;max-width:1100px;margin:32px auto;padding:0 20px}h1,h2{color:#1d3353}.warn{background:#fff8e8;border:1px solid #ead7a7;padding:12px;border-radius:8px}table{width:100%;border-collapse:collapse;margin:10px 0 24px}th,td{border:1px solid #dce2eb;padding:7px;text-align:left}th{background:#f2f5f9}.meta{color:#718096}</style></head><body><h1>销售 / 采购经营日报</h1><p class="meta">报表日期 ${escapeHtml(snapshot.reportDate)} · 归档版本 ${snapshot.version} · ${escapeHtml(snapshot.createdAt)} · ${escapeHtml(sourceLabel)}</p><section class="warn"><b>数据说明</b><ul>${warnings || '<li>无额外警告</li>'}</ul></section><h2>经营摘要</h2><p>销售日报：${amount(sales.daily, 'count')} 笔，金额 ¥${amount(sales.daily, 'amountCny')}；采购日报：${amount(purchase.daily, 'count')} 笔，金额 ¥${amount(purchase.daily, 'amountCny')}。</p><p>销售订单：${amount(asRecord(orders).sales, 'count')} 笔，¥${amount(asRecord(orders).sales, 'amountCny')}；采购订单：${amount(asRecord(orders).purchase, 'count')} 笔，¥${amount(asRecord(orders).purchase, 'amountCny')}。</p><p>应收未收 ¥${amount(asRecord(balances).receivables, 'outstandingAmountCny')}；应付未付 ¥${amount(asRecord(balances).payables, 'outstandingAmountCny')}。</p><h2>日报明细</h2><table><thead><tr><th>类型</th><th>日期</th><th>编号</th><th>客户 / 供应商</th><th>数量</th><th>币种</th><th>原币金额</th><th>汇率</th><th>人民币金额</th></tr></thead><tbody>${rows || '<tr><td colspan="9">暂无日报记录</td></tr>'}</tbody></table><h2>K3Cloud / 演示快照行</h2><table><thead><tr><th>单据类型</th><th>单号</th><th>日期</th><th>客商</th><th>物料 / 科目</th><th>金额(人民币)</th></tr></thead><tbody>${k3 || '<tr><td colspan="6">暂无快照行</td></tr>'}</tbody></table></body></html>`
}

type ImportComparable = Pick<DailyReport, 'type' | 'date' | 'partyId' | 'partyName' | 'documentNo' | 'quantity' | 'currency' | 'originalAmount' | 'exchangeRate' | 'note'>
function sameImportValues(left: ImportComparable, right: ImportComparable): boolean {
  const sameParty = left.partyId && right.partyId ? left.partyId === right.partyId : left.partyName.trim().toLocaleLowerCase() === right.partyName.trim().toLocaleLowerCase()
  return Boolean(sameParty && left.quantity === right.quantity && left.currency === right.currency && left.originalAmount === right.originalAmount && left.exchangeRate === right.exchangeRate && left.note === right.note)
}
function sameImportBusinessRecord(left: ImportComparable, right: ImportComparable): boolean {
  const sameParty = left.partyId && right.partyId ? left.partyId === right.partyId : left.partyName === right.partyName
  const documentNo = left.documentNo.trim().toLocaleLowerCase()
  return Boolean(left.type === right.type && left.date === right.date && documentNo === right.documentNo.trim().toLocaleLowerCase() && (documentNo || (sameParty && sameImportValues(left, right))))
}

function parseImportCsv(text: string): unknown[][] {
  const rows: string[][] = [], source = text.replace(/^\uFEFF/, '')
  let row: string[] = [], cell = '', quoted = false, afterQuote = false, rowNum = 1
  const pushRow = () => { row.push(cell); if (row.some(value => value.trim() !== '')) rows.push(row); row = []; cell = ''; afterQuote = false; rowNum++; if (rows.length > 5001) throw new Error('CSV 最多允许 5000 行数据。') }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') { quoted = false; afterQuote = true }
      else cell += c
    } else if (afterQuote) {
      if (c === ',') { row.push(cell); cell = ''; afterQuote = false }
      else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow() }
      else throw new Error(`CSV 第 ${rowNum} 行闭合引号后只能出现逗号或换行。`)
    } else if (c === '"') {
      if (cell.length !== 0) throw new Error(`CSV 第 ${rowNum} 行引号必须位于字段开头。`)
      quoted = true
    } else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow() }
    else cell += c
  }
  if (quoted) throw new Error('CSV 引号未闭合。')
  if (cell.length || row.length || afterQuote) pushRow()
  const width = rows[0]?.length ?? 0
  for (let index = 1; index < rows.length; index++) if (rows[index]!.length !== width) throw new Error(`CSV 第 ${index + 1} 行列数与表头不一致。`)
  return rows
}
export function createDailyReportRouter(): Router {
  const router = Router()
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 0 } })
  const monthlyResponse = (req: Request, res: import('express').Response, excel: boolean) => {
    const month = req.query.month
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month 必须为有效 YYYY-MM。' })
    const [year, monthNumber] = month.split('-').map(Number)
    if (year! < 2000 || year! > 2999) return res.status(400).json({ error: 'month 必须在 2000-2999 年范围内。' })
    const daysInMonth = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
    if (!Number.isFinite(daysInMonth) || new Date(Date.UTC(year!, monthNumber! - 1, 1)).toISOString().slice(0, 7) !== month) return res.status(400).json({ error: 'month 必须为有效 YYYY-MM。' })
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), access = reportingAccess(scope, req)
    if (!access.sales && !access.purchase) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有日报查看权限。' })
    const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
    const sumDecimal = (values: string[]): string => {
      let coefficient = 0n, scale = 0
      for (const text of values) {
        const part = decimalParts(text)
        if (!part) continue
        if (part.scale > scale) { coefficient *= 10n ** BigInt(part.scale - scale); scale = part.scale }
        coefficient += part.coefficient * 10n ** BigInt(scale - part.scale)
      }
      const divisor = 10n ** BigInt(scale), negative = coefficient < 0n, absolute = negative ? -coefficient : coefficient
      const cents = (absolute * 100n + divisor / 2n) / divisor
      return `${negative && cents !== 0n ? '-' : ''}${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, '0')}`
    }
    const moneyNumber = (values: string[]) => Number(sumDecimal(values))
    const permittedTypes: DailyKind[] = (['sales', 'purchase'] as const).filter(type => access[type])
    const kindFor = (type: DailyKind) => type === 'sales' ? 'shipment' : 'purchase-receipt'
    const k3AvailableByType: Partial<Record<DailyKind, boolean>> = {}
    for (const type of permittedTypes) {
      const kind = kindFor(type)
      const metaHasKind = Boolean(state.k3Sync && Object.prototype.hasOwnProperty.call(state.k3Sync.rowCounts ?? {}, kind))
      const hasHeader = state.k3HistoricalHeaders.some(header => header.type === type)
      const hasTypeSnapshot = state.k3Rows.some(row => row.type === type && row.kind === kind && ['k3cloud', 'history-import', 'local-mock'].includes(row.source))
      k3AvailableByType[type] = metaHasKind || hasHeader || hasTypeSnapshot
    }
    const days: Array<Record<string, unknown> & { date: string }> = Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      const output: Record<string, unknown> & { date: string } = { date }
      for (const type of permittedTypes) {
        const reports = state.reports.filter(report => !report.deletedAt && report.type === type && report.date === date)
        const system = { count: reports.length, quantity: Math.round(reports.reduce((sum, report) => sum + Number(report.quantity || 0), 0) * 1_000_000) / 1_000_000, amountCny: moneyNumber(reports.map(report => String(report.amountCnyExact ?? report.amountCny ?? 0))) }
        const kind = kindFor(type)
        const headers = state.k3HistoricalHeaders.filter(header => header.active && header.type === type && header.kind === kind && header.date === date && !/(反审核|未审核|未审批|删除|作废)/.test(header.status ?? ''))
        const headerById = new Map(headers.map(header => [header.id, header]))
        const knownHeaderIds = new Set(state.k3HistoricalHeaders.map(header => header.id))
        const eligible = state.k3Rows.filter(row => row.active && row.type === type && row.kind === kind && row.date === date && !/(反审核|未审核|未审批|删除|作废)/.test(row.status ?? '') && (!row.legacyHeaderId || (headerById.has(row.legacyHeaderId) && knownHeaderIds.has(row.legacyHeaderId))))
        let count = headers.length, quantity = headers.reduce((sum, header) => sum + Number(header.totalQuantityExact || 0), 0)
        const amountParts = headers.map(header => header.totalAmountExact || '0')
        const ordinary = eligible.filter(row => !row.legacyHeaderId || !headerById.has(row.legacyHeaderId))
        const documents = new Map<string, K3SnapshotRow[]>()
        for (const row of ordinary) {
          const identity = `${row.kind}:${row.billNo || row.erpId || row.id}`
          const group = documents.get(identity) ?? []; group.push(row); documents.set(identity, group)
        }
        count += documents.size
        for (const lines of documents.values()) {
          quantity += lines.reduce((sum, row) => sum + Number(row.quantityExact ?? row.quantity ?? 0), 0)
          amountParts.push(...lines.map(row => String(row.amountCnyExact ?? row.amountCny ?? 0)))
        }
        const k3 = { count, quantity: Math.round(quantity * 1_000_000) / 1_000_000, amountCny: moneyNumber(amountParts) }
        const available = k3AvailableByType[type] ?? false
        output[type] = { system, k3, difference: available ? round(system.amountCny - k3.amountCny) : null }
      }
      return output
    })
    const totals: Partial<Record<DailyKind, { system: { count: number; quantity: number; amountCny: number }; k3: { count: number; quantity: number; amountCny: number }; difference: number | null }>> = {}
    for (const type of permittedTypes) {
      const sums = (key: 'system' | 'k3') => days.reduce((acc, day) => {
        const value = (day[type] as { system: { count: number; quantity: number; amountCny: number }; k3: { count: number; quantity: number; amountCny: number } })[key]
        acc.count += value.count; acc.quantity += value.quantity; acc.amountCnyParts.push(String(value.amountCny)); return acc
      }, { count: 0, quantity: 0, amountCnyParts: [] as string[] })
      const systemRaw = sums('system'), k3Raw = sums('k3')
      const system = { count: systemRaw.count, quantity: Math.round(systemRaw.quantity * 1_000_000) / 1_000_000, amountCny: moneyNumber(systemRaw.amountCnyParts) }
      const k3 = { count: k3Raw.count, quantity: Math.round(k3Raw.quantity * 1_000_000) / 1_000_000, amountCny: moneyNumber(k3Raw.amountCnyParts) }
      totals[type] = { system, k3, difference: k3AvailableByType[type] ? round(system.amountCny - k3.amountCny) : null }
    }
    const k3Available = permittedTypes.some(type => k3AvailableByType[type])
    const result = { month, days, totals, access, mockEnabled: state.mockEnabled, notice: k3Available ? (state.mockEnabled ? '当前为本地演示快照，不代表真实ERP数据。' : '') : '当前账套未导入或无ERP快照；K3显示0仅表示无快照，不代表实际费用为0。', amountBasis: '系统按已保存日报日期、数量及人民币金额汇总（优先精确金额）；K3按有效销售出库/采购入库快照汇总，已迁移单据优先使用单据头金额与数量，普通快照按行汇总并按ERP单据身份去重；不按关联分摊。数量按原记录单位汇总，不同单位可能不可直接比较。此报表仅读取已有数据，不触发 ERP。', k3Available, k3AvailableByType }
    if (!excel) return res.json(result)
    void (async () => {
      type MonthlyBusiness = NonNullable<(typeof totals)[DailyKind]>
      const workbook = new ExcelJS.Workbook()
      const summarySheet = workbook.addWorksheet('采销逐日汇总')
      summarySheet.addRow(['日期', ...permittedTypes.flatMap(type => {
        const label = type === 'sales' ? '销售' : '采购'
        return [`${label}笔数`, `${label}数量`, type === 'sales' ? '销售金额CNY' : '采购费用CNY']
      })])
      const summaryValues = (row: Partial<Record<DailyKind, MonthlyBusiness>>) => permittedTypes.flatMap(type => {
        const metric = row[type]!.system
        return [metric.count, metric.quantity, metric.amountCny]
      })
      for (const day of days) summarySheet.addRow([day.date, ...summaryValues(day as Partial<Record<DailyKind, MonthlyBusiness>>)])
      summarySheet.addRow(['月度合计', ...summaryValues(totals)])
      for (const type of permittedTypes) {
        const sheet = workbook.addWorksheet(type === 'sales' ? '销售逐日核对' : '采购逐日核对')
        const values = (row: MonthlyBusiness) => [row.system.count, row.system.quantity, row.system.amountCny,
          k3AvailableByType[type] ? row.k3.count : null,
          k3AvailableByType[type] ? row.k3.quantity : null,
          k3AvailableByType[type] ? row.k3.amountCny : null, row.difference]
        sheet.addRow(['日期', '系统笔数', '系统数量', '系统金额CNY', '金蝶单据数', '金蝶数量', '金蝶金额CNY', '金额差CNY'])
        for (const day of days) sheet.addRow([day.date, ...values(day[type] as MonthlyBusiness)])
        sheet.addRow(['月度合计', ...values(totals[type]!)])
      }
      for (const sheet of workbook.worksheets) {
        sheet.addRow(['说明', result.amountBasis]); sheet.addRow(['提示', result.notice || '金蝶侧为已保存快照，不代表实时数据。未提供快照的核对列留空。'])
        sheet.columns.forEach(column => { column.width = 20 })
        sheet.getRow(1).font = { bold: true }
        sheet.views = [{ state: 'frozen', ySplit: 1 }]
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="monthly-daily-${month}.xlsx"`); res.send(Buffer.from(await workbook.xlsx.writeBuffer()))
    })().catch(error => { if (!res.headersSent) res.status(500).json({ error: 'monthly_export_failed', message: error instanceof Error ? error.message : '导出失败。' }) })
  }
  router.get('/daily-reports/monthly', (req, res) => monthlyResponse(req, res, false))
  router.get('/daily-reports/monthly/export.xlsx', (req, res) => monthlyResponse(req, res, true))

  router.get('/daily-reports/imports', requireRole('admin', 'plm_manager'), (req, res) => {
    const scope = scopeFromRequest(req)
    const batches = readDailyReportState(scope).importBatches ?? []
    if (req.query.type !== undefined && !validKind(req.query.type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const scoped = batches.filter(batch => batch.scopeKey === stateKey(scope) && (!req.query.type || batch.type === req.query.type || batch.type === 'mixed')).slice().reverse()
    const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100))
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0)
    return res.json({ batches: scoped.slice(offset, offset + limit), total: scoped.length, limit, offset, hasMore: offset + limit < scoped.length })
  })
  router.get('/daily-reports/imports/:type/template', requireRole('admin', 'plm_manager'), async (req, res) => {
    if (!validKind(req.params.type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('日报导入')
    sheet.addRow(['业务类型', '日期', '客户/供应商', '单据编号', '数量', '币种', '原币金额', '汇率', '备注'])
    sheet.addRow([req.params.type, '2026-01-31', '请填写当前账套主档名称', 'DOC-001', 1, 'CNY', 100, 1, ''])
    sheet.columns.forEach(column => { column.width = 22 })
    const bytes = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="daily-report-${req.params.type}-template.xlsx"`)
    return res.send(Buffer.from(bytes))
  })
  // Compatibility adapter for 840e34a. Keep today's scope/master-data guards;
  // never restore its weaker 'same bill number => silently skip changed content' behavior.
  const legacyUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 } })
  router.post('/daily-reports/import/preview', requireRole('admin', 'plm_manager'), (req, res, next) => {
    legacyUpload.single('file')(req, res, error => error ? res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'daily_report_import_upload_rejected', message: '请选择单个不超过 10 MiB 的 XLSX 或 CSV 文件；可附带 type。' }) : next())
  }, async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'daily_report_import_file_required', message: '请选择一个 CSV 或 XLSX 文件。' })
    const defaultType = typeof req.body?.type === 'string' ? req.body.type : ''
    if (defaultType && !validKind(defaultType)) return res.status(400).json({ error: 'invalid_daily_report_type', message: '默认日报类型必须是 sales 或 purchase。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const parsed = await parseDailyReportImportFile(req.file.originalname, req.file.buffer, defaultType)
      if (parsed.mappedFields.includes('legacyCompanyCode') || parsed.mappedFields.includes('sourceIdempotencyKey') || !readDailyReportingAdminState(scopeFromRequest(req)).masterDataConfigured) return next()
      const state = readDailyReportState(scope), masters = readDailyReportingAdminState(scope)
      const valid: ImportPreview['rows'] = []
      const rows = parsed.rows.map(row => {
        const errors = [...row.errors]
        const kind = row.values.type
        const partyText = String(row.values.partyName ?? '').trim()
        const matches = masters.parties.filter(party => party.active && party.kind === (kind === 'sales' ? 'customer' : 'supplier') && (party.name === partyText || party.aliases.includes(partyText)))
        const party = validKind(kind) && matches.length === 1 ? matches[0] : undefined
        if (!party) errors.push('客商未匹配当前账套中唯一且启用的同业务主档，请先维护主档。')
        const validation = validateReportPayload({ ...row.values, ...(party ? { partyId: party.id, partyName: party.name } : {}) }, undefined, { preserveCnySnapshot: true })
        if (validation.error) errors.push(validation.error)
        const value = validation.value
        if (value && !Number.isFinite(value.amountCny)) errors.push('换算金额超出有效数值范围。')
        let duplicateReason: 'existing' | 'same_batch' | undefined
        if (value && !errors.length) {
          value.source = 'history-import'
          value.sourceIdempotencyKey = makeImportSourceKey(value)
          const existing = state.reports.filter(report => !report.deletedAt || report.sourceIdempotencyKey === value.sourceIdempotencyKey).filter(report => sameImportBusinessRecord(report, value))
          const previous = valid.filter(item => sameImportBusinessRecord(item.payload, value))
          if ([...existing, ...previous.map(item => item.payload)].some(item => !sameImportValues(item, value))) errors.push('相同业务日期和单号已存在不同内容，需人工核对；不会覆盖或静默跳过。')
          else {
            duplicateReason = existing.length ? 'existing' : previous.length ? 'same_batch' : undefined
            valid.push({ rowNumber: row.line, payload: value, duplicate: Boolean(duplicateReason) })
          }
        }
        return { line: row.line, status: errors.length ? 'invalid' : duplicateReason ? 'duplicate' : 'ready', data: value, errors, duplicateReason }
      })
      const errorRows = rows.filter(row => row.errors.length).length
      const duplicateRows = rows.filter(row => row.duplicateReason).length
      const types = [...new Set(valid.map(row => row.payload.type))]
      const id = randomUUID(), expiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
      const preview: ImportPreview = { id, actorId: actor.id, scopeKey: stateKey(scope), type: types.length === 1 ? types[0]! : 'mixed', fileName: req.file.originalname.slice(0, 160), digest: createHash('sha256').update(req.file.buffer).digest('hex'), expiresAt, blocked: errorRows > 0 || !valid.length, rows: valid }
      if (Buffer.byteLength(JSON.stringify(preview), 'utf8') * 4 > 32 * 1024 * 1024) return res.status(413).json({ error: 'daily_report_import_preview_too_large', message: '预览超过安全容量，请减少行数或备注长度。' })
      mutateState(scope, current => {
        current.importPreviews = (current.importPreviews ?? []).filter(item => Date.parse(item.expiresAt) > Date.now()).slice(-7)
        while (current.importPreviews.length && Buffer.byteLength(JSON.stringify([...current.importPreviews, preview]), 'utf8') * 4 > 32 * 1024 * 1024) current.importPreviews.shift()
        current.importPreviews.push(preview)
      })
      return res.json({ previewId: id, fileName: preview.fileName, expiresAt, headers: parsed.headers, mappedFields: parsed.mappedFields, totalRows: rows.length, validRows: rows.length - errorRows, duplicateRows, importableRows: rows.length - errorRows - duplicateRows, errorRows, rows })
    } catch (error) {
      return res.status(error instanceof StateConflictError ? 409 : 400).json({ error: 'daily_report_import_parse_failed', message: error instanceof Error ? error.message : '文件解析失败。' })
    }
  })
  router.post('/daily-reports/imports/:type/preview', requireRole('admin', 'plm_manager'), (req, res, next) => {
    if (!validKind(req.params.type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    upload.single('file')(req, res, error => error ? res.status(400).json({ error: 'invalid_import_upload', message: '请选择单个不超过 12 MiB 的 XLSX 或 CSV 文件。' }) : next())
  }, async (req, res) => {
    if (!validKind(req.params.type) || !req.file) return res.status(400).json({ error: '请上传 file 文件。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req), kind = req.params.type
    let grid: unknown[][]
    try {
      if (/\.csv$/i.test(req.file.originalname)) {
        grid = parseImportCsv(new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer).replace(/^\uFEFF/, ''))
      } else if (/\.xlsx$/i.test(req.file.originalname)) {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(req.file.buffer)
        const sheet = workbook.worksheets[0]
        if (!sheet || sheet.rowCount > 5001 || sheet.columnCount > 64) throw new Error('首个工作表需包含表头、最多 5000 行数据及 64 列。')
        grid = []
        sheet.eachRow({ includeEmpty: true }, row => {
          const cells: unknown[] = []
          for (let column = 1; column <= row.cellCount; column++) {
            const value = row.getCell(column).value
            if (value && typeof value === 'object' && !(value instanceof Date)) {
              if ('formula' in value || 'sharedFormula' in value) throw new Error(`第 ${row.number} 行包含公式，请粘贴为纯值后导入。`)
              if ('text' in value) cells.push(value.text)
              else if ('richText' in value) cells.push(value.richText.map(part => part.text).join(''))
              else throw new Error(`第 ${row.number} 行含有不支持的单元格类型。`)
            } else cells.push(value)
          }
          grid.push(cells)
        })
      } else throw new Error('仅支持 .xlsx 或 UTF-8 .csv 文件。')
    } catch (error) {
      return res.status(400).json({ error: 'invalid_import_file', message: error instanceof Error ? error.message : '文件格式无效。' })
    }
    if (grid.length < 2 || grid.length > 5001) return res.status(400).json({ error: '文件需包含表头及最多 5000 行数据。' })
    const headers = grid[0]!.map(value => String(value ?? '').trim())
    const aliases = [['业务类型', 'type', '类型'], ['日期', 'date'], ['客户/供应商', '客户', '供应商', '客商', 'partyName', 'partyId'], ['单据编号', '单据号', 'documentNo'], ['数量', 'quantity'], ['币种', 'currency'], ['原币金额', 'originalAmount'], ['汇率', 'exchangeRate'], ['备注', 'note']]
    const indexes = aliases.map(names => headers.findIndex(header => names.includes(header)))
    const errors: Array<{ rowNumber: number; field: string; message: string }> = []
    for (const index of [1, 2, 4, 6]) if (indexes[index] === -1) errors.push({ rowNumber: 1, field: aliases[index]![0]!, message: '缺少必填列，请使用当前业务的导入模板。' })
    for (const names of aliases) if (headers.filter(header => names.includes(header)).length > 1) errors.push({ rowNumber: 1, field: names[0]!, message: '同一字段出现多列，无法确定应使用哪一列。' })
    const state = readDailyReportState(scope), admin = readDailyReportingAdminState(scope)
    const parties = admin.parties.filter(party => party.kind === (kind === 'sales' ? 'customer' : 'supplier') && party.active)
    const valid: ImportPreview['rows'] = []
    let totalRows = 0
    for (let index = 1; index < grid.length; index++) {
      const cells = grid[index]!
      if (cells.every(value => value == null || (typeof value === 'string' && !value.trim()))) continue
      totalRows++
      const rowNumber = index + 1, errorsBefore = errors.length
      const get = (column: number) => indexes[column]! < 0 ? '' : cells[indexes[column]!]
      const addError = (field: string, message: string) => errors.push({ rowNumber, field, message })
      const fileType = String(get(0) ?? '').trim()
      if (fileType && fileType !== kind) addError('type', '文件业务类型与所选导入入口不一致。')
      const rawDate = get(1)
      let date = ''
      if (rawDate instanceof Date && Number.isFinite(rawDate.getTime())) date = rawDate.toISOString().slice(0, 10)
      else if (typeof rawDate === 'number' && Number.isInteger(rawDate) && rawDate > 0 && rawDate <= 2958465) date = new Date(Date.UTC(1899, 11, 30) + rawDate * 86400000).toISOString().slice(0, 10)
      else if (typeof rawDate === 'string') date = rawDate.trim().replaceAll('/', '-')
      if (!validDay(date)) addError('date', '必须是完整有效的 YYYY-MM-DD 日期，不能含时间或其他后缀。')
      const partyText = String(get(2) ?? '').trim()
      const matching = parties.filter(party => party.id === partyText || party.name === partyText)
      const party = matching.length === 1 ? matching[0] : undefined
      if (!party) addError('partyName', '客商未匹配当前账套中唯一且启用的同业务主档，请先维护主档。')
      const number = (column: number, field: string, required = true, fallback = 1): number => {
        const value = get(column)
        if (value == null || (typeof value === 'string' && !value.trim())) {
          if (required) addError(field, '此数字字段必填。')
          return required ? NaN : fallback
        }
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))) {
          addError(field, '必须为有效十进制数字。'); return NaN
        }
        const result = Number(value)
        if (!Number.isFinite(result)) addError(field, '必须为有限数字。')
        return result
      }
      const currency = String(get(5) || 'CNY').trim().toUpperCase()
      const quantity = number(4, 'quantity'), originalAmount = number(6, 'originalAmount')
      const rawRate = number(7, 'exchangeRate', currency !== 'CNY')
      if (!/^[A-Z]{3}$/.test(currency)) addError('currency', '币种必须为三位大写代码。')
      if (!Number.isFinite(rawRate) || rawRate <= 0 || (currency === 'CNY' && rawRate !== 1)) addError('exchangeRate', currency === 'CNY' ? '人民币汇率须为 1；可留空由系统填入。' : '外币汇率必须为正数。')
      if (String(get(3) ?? '').trim().length > 100) addError('documentNo', '单据编号最多 100 字。')
      const payload = validateReportPayload({ type: kind, date, partyName: party?.name ?? partyText, partyId: party?.id, documentNo: String(get(3) ?? '').trim(), quantity, currency, originalAmount, originalAmountExact: String(get(6) ?? '').trim(), exchangeRate: rawRate, exchangeRateExact: String(get(7) || 1).trim(), note: String(get(8) ?? '') })
      if (!payload.value) addError('row', payload.error ?? '数据无效。')
      else if (!Number.isFinite(payload.value.amountCny)) addError('amountCny', '换算金额超出有效数值范围。')
      if (!party || !payload.value || errors.length !== errorsBefore) continue
      payload.value.source = 'history-import'
      payload.value.sourceIdempotencyKey = makeImportSourceKey(payload.value)
      const candidates = [...state.reports.filter(report => !report.deletedAt || report.sourceIdempotencyKey === payload.value!.sourceIdempotencyKey), ...valid.map(row => row.payload)]
      const matches = candidates.filter(report => sameImportBusinessRecord(report, payload.value!))
      if (matches.some(report => !sameImportValues(report, payload.value!))) { addError('documentNo', '相同业务日期、客商和单号已存在不同内容，需人工核对；不会覆盖原记录。'); continue }
      valid.push({ rowNumber, payload: payload.value, duplicate: matches.some(report => sameImportValues(report, payload.value!)) })
    }
    if (!totalRows) errors.push({ rowNumber: 1, field: 'file', message: '文件没有非空数据行。' })
    const id = randomUUID(), expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(), digest = createHash('sha256').update(req.file.buffer).digest('hex')
    const canCommit = errors.length === 0 && valid.length > 0
    try {
      const preview: ImportPreview = { id, actorId: actor.id, scopeKey: stateKey(scope), type: kind, fileName: req.file.originalname.slice(0, 160), digest, expiresAt, blocked: !canCommit, rows: valid }
      if (Buffer.byteLength(JSON.stringify(preview), 'utf8') * 4 > 32 * 1024 * 1024) return res.status(413).json({ error: 'daily_report_import_preview_too_large', message: '预览超过安全容量，请减少行数或备注长度。' })
      mutateState(scope, current => {
        current.importPreviews = (current.importPreviews ?? []).filter(item => Date.parse(item.expiresAt) > Date.now()).slice(-7)
        while (current.importPreviews.length && Buffer.byteLength(JSON.stringify([...current.importPreviews, preview]), 'utf8') * 4 > 32 * 1024 * 1024) current.importPreviews.shift()
        current.importPreviews.push(preview)
      })
    } catch (error) { return res.status(409).json({ error: 'preview_save_failed', message: error instanceof Error ? error.message : '预览保存失败。' }) }
    const rows = valid.map(row => ({ rowNumber: row.rowNumber, ...row.payload, duplicate: row.duplicate }))
    const dates = rows.map(row => row.date).sort()
    return res.json({ previewId: id, kind, rows, errors, totalRows, validRows: valid.length, duplicateRows: valid.filter(row => row.duplicate).length, canCommit, dateFrom: dates[0] ?? null, dateTo: dates.at(-1) ?? null, expiresAt })
  })
  router.post(['/daily-reports/imports/:type/commit', '/daily-reports/import/commit'], requireRole('admin', 'plm_manager'), (req, res, next) => {
    const legacy = req.path === '/daily-reports/import/commit'
    if (!legacy && !validKind(req.params.type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    const previewId = typeof req.body?.previewId === 'string' ? req.body.previewId : ''
    if (!previewId) return res.status(400).json({ error: 'previewId 必填。' })
    if (legacy && pendingImportPreviews.get(previewId)) return next()
    try {
      const result = mutateState(scope, state => {
        const preview = state.importPreviews?.find(item => item.id === previewId && item.actorId === actor.id && item.scopeKey === stateKey(scope) && (legacy || item.type === req.params.type))
        if (!preview || Date.parse(preview.expiresAt) <= Date.now()) return { invalid: true as const }
        if (preview.blocked) return { blocked: true as const }
        const insert: ImportPreview['rows'] = []
        let skipped = 0
        for (const row of preview.rows) {
          const party = findDailyParty(scope, row.payload.partyId ?? '', row.payload.type === 'sales' ? 'customer' : 'supplier')
          if (!party || !party.active || party.name !== row.payload.partyName) return { invalid: true as const }
          const candidates = [...state.reports.filter(report => !report.deletedAt || report.sourceIdempotencyKey === row.payload.sourceIdempotencyKey), ...insert.map(item => item.payload)]
          const matches = candidates.filter(report => sameImportBusinessRecord(report, row.payload))
          if (matches.some(report => !sameImportValues(report, row.payload))) return { conflict: true as const }
          if (matches.some(report => sameImportValues(report, row.payload))) skipped++
          else insert.push(row)
        }
        const now = new Date().toISOString()
        const imported: Array<Pick<DailyReport, 'id' | 'type' | 'date' | 'documentNo' | 'amountCny'>> = []
        for (const row of insert) {
          const item: DailyReport = { ...row.payload, importBatchId: preview.id, sourceFileName: preview.fileName, sourceRow: row.rowNumber, source: 'history-import', id: randomUUID(), createdAt: now, updatedAt: now, createdBy: actor.id, createdByName: actor.name, updatedBy: actor.id }
          state.reports.unshift(item)
          imported.push({ id: item.id, type: item.type, date: item.date, documentNo: item.documentNo, amountCny: item.amountCny })
          noteCorrection(state, { originalDate: item.date, type: '日报补录', affectedReport: item.type, referenceId: item.id, originalValue: archivedReportAmount(state, item.id, item.date), newValue: item.amountCny, diffAmount: item.amountCny, reason: '已归档日期新增导入日报记录。' })
        }
        state.importPreviews = state.importPreviews?.filter(item => item.id !== previewId)
        const dates = preview.rows.map(row => row.payload.date).sort()
        const result = { inserted: insert.length, skipped, dateFrom: dates[0] ?? null, dateTo: dates.at(-1) ?? null }
        state.importBatches = [...(state.importBatches ?? []), { id: preview.id, actorId: actor.id, actorName: actor.name, scopeKey: stateKey(scope), type: preview.type, fileName: preview.fileName, digest: preview.digest, completedAt: now, ...result }]
        return { ...result, batchId: preview.id, imported }
      })
      if ('invalid' in result) return res.status(legacy ? 404 : 409).json({ error: 'preview_invalid', message: '预览不存在、已过期、非当前操作人/账套，或客商主档已变更。请重新预览。' })
      if ('blocked' in result) return res.status(legacy ? 422 : 409).json({ error: 'daily_report_import_validation_failed', message: '存在字段错误行，未写入任何日报。请修正文件并重新预览。' })
      if ('conflict' in result) return res.status(409).json({ error: 'import_conflict', message: '预览后出现相同单号但内容不同的记录，请重新预览并人工核对。未写入任何日报。' })
      return res.json(legacy ? { ...result, importedCount: result.inserted, skippedDuplicates: result.skipped, message: `已导入 ${result.inserted} 条，跳过重复 ${result.skipped} 条。` } : result)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'import_commit_failed', message: error instanceof Error ? error.message : '导入提交失败。' }) }
  })

  const receiveImportFile = (req: Request, res: import('express').Response, next: import('express').NextFunction) => req.file ? next() : importUpload(req, res, error => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE'
      return res.status(tooLarge ? 413 : 400).json({ error: 'daily_report_import_upload_rejected', message: tooLarge ? '导入文件不能超过 10 MB。' : '上传请求格式无效；一次只能上传一个文件。' })
    }
    return res.status(400).json({ error: 'daily_report_import_upload_failed', message: '导入文件上传失败。' })
  })

  router.get('/daily-reports', (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope)
    const type = req.query.type === 'sales' || req.query.type === 'purchase' ? req.query.type : undefined
    const access = reportingAccess(scope, req)
    if (!access.sales && !access.purchase) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员尚未分配客户或供应商日报权限。' })
    if (type && !access[type]) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有此业务线的日报查看权限。' })
    const from = typeof req.query.from === 'string' && validDay(req.query.from) ? req.query.from : undefined
    const to = typeof req.query.to === 'string' && validDay(req.query.to) ? req.query.to : undefined
    const reports = liveReports(state).filter(report => access[report.type] && (!type || report.type === type) && (!from || report.date >= from) && (!to || report.date <= to)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(report => ({ ...report, canEdit: req.authUser?.role === 'admin' || req.authUser?.role === 'plm_manager' || (req.authUser?.role === 'member' && !partyForReport(scope, req, report.type, report.partyId).error), allocatedAmount: reportAllocation(state, report.id), links: state.links.filter(link => link.reportId === report.id).map(link => ({ ...link, k3Row: state.k3Rows.find(row => row.id === link.k3RowId) })) }))
    return res.json({ reports, access, mockEnabled: state.mockEnabled, source: state.mockEnabled ? 'local-mock' : 'workspace', notice: state.mockEnabled ? '显示隔离演示数据；非真实业务数据。' : '手工日报仍可录入；当前未连接真实 ERP。' })
  })

  // One authorized, filtered set drives records, aggregates and XLSX export.
  const analysisPayload = (req: Request, type: DailyKind) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), access = reportingAccess(scope, req)
    if (!access[type]) return { denied: true as const }
    const recordingPerson = (row: DailyReport) => {
      const legacyId = row.legacyUserId?.trim() || row.legacyUsername?.trim()
      if (legacyId) return { id: `legacy:${encodeURIComponent(row.legacyCompanyCode || '')}:${encodeURIComponent(legacyId)}`, label: `${row.legacyUserName?.trim() || row.legacyUsername?.trim() || legacyId}（历史）` }
      return { id: row.createdBy || '', label: row.createdByName?.trim() || row.createdBy || '' }
    }
    const scalarKeys = ['from', 'to', 'partyName', 'source', 'q']
    if (scalarKeys.some(key => req.query[key] !== undefined && typeof req.query[key] !== 'string')) return { invalid: true as const }
    const selectedValues = (key: 'createdBy' | 'currency', limit: number): string[] | null => {
      const value = req.query[key]
      if (value === undefined) return []
      const values = Array.isArray(value) ? value : [value]
      if (values.length > limit || values.some(item => typeof item !== 'string' || !item.trim())) return null
      return [...new Set(values.map(item => String(item).trim()))]
    }
    const createdBy = selectedValues('createdBy', 50), currency = selectedValues('currency', 2)
    if (!createdBy || !currency || currency.some(value => !['CNY', 'USD'].includes(value))) return { invalid: true as const }
    const raw = (key: string) => typeof req.query[key] === 'string' ? String(req.query[key]).trim() : ''
    const from = raw('from'), to = raw('to'), partyName = raw('partyName')
    const source = raw('source'), q = raw('q')
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)
      || (source && !['manual', 'history-import'].includes(source))) return { invalid: true as const }
    const filters = { type, from, to, partyName, createdBy, currency, source, q }
    const all = liveReports(state).filter(row => row.type === type)
    const rows = all.filter(row => (!from || row.date >= from) && (!to || row.date <= to)
      && (!partyName || row.partyName.includes(partyName)) && (!createdBy.length || createdBy.includes(recordingPerson(row).id))
      && (!currency.length || currency.includes(row.currency)) && (!source || row.source === source)
      && (!q || `${row.partyName} ${row.documentNo} ${row.note}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    const reports = rows.map(report => ({
      ...report,
      recordedByName: recordingPerson(report).label,
      canEdit: req.authUser?.role === 'admin' || req.authUser?.role === 'plm_manager'
        || (req.authUser?.role === 'member' && !partyForReport(scope, req, report.type, report.partyId).error),
      allocatedAmount: reportAllocation(state, report.id),
      links: state.links.filter(link => link.reportId === report.id).map(link => ({ ...link, k3Row: state.k3Rows.find(row => row.id === link.k3RowId) })),
    }))
    const aggregate = (items: DailyReport[]) => ({
      count: items.length,
      quantity: roundQuantity(items.reduce((total, row) => total + row.quantity, 0)),
      amountCny: roundMoney(items.reduce((total, row) => total + row.amountCny, 0)),
    })
    const summary = {
      ...aggregate(rows),
      cnyAmount: roundMoney(rows.filter(row => row.currency === 'CNY').reduce((total, row) => total + row.originalAmount, 0)),
      usdAmount: roundMoney(rows.filter(row => row.currency === 'USD').reduce((total, row) => total + row.originalAmount, 0)),
    }
    const grouped = (key: (row: DailyReport) => string) => {
      const groups = new Map<string, DailyReport[]>()
      for (const row of rows) {
        const label = key(row), group = groups.get(label) ?? []
        group.push(row); groups.set(label, group)
      }
      return [...groups].map(([label, items]) => ({ label, ...aggregate(items) }))
    }
    const trend = (key: (row: DailyReport) => string) => grouped(key)
      .sort((a, b) => a.label.localeCompare(b.label)).map(({ label, ...values }) => ({ period: label, ...values }))
    const counterpartRank = grouped(row => row.partyName)
      .sort((a, b) => b.amountCny - a.amountCny || a.label.localeCompare(b.label)).slice(0, 10)
    const peopleById = new Map<string, { id: string; label: string }>()
    for (const row of all) {
      const person = recordingPerson(row)
      if (!person.id.trim()) continue
      const current = peopleById.get(person.id)
      if (!current || current.label === current.id && person.label !== person.id) peopleById.set(person.id, person)
    }
    const people = [...peopleById.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
    return {
      filters, reports, summary, dailyTrend: trend(row => row.date), monthlyTrend: trend(row => row.date.slice(0, 7)),
      counterpartRank, options: { people }, mockEnabled: state.mockEnabled,
      notice: state.mockEnabled ? '隔离演示数据，非真实业务数据；分析不触发 ERP 同步。' : '读取当前账套已保存日报；分析不触发 ERP 同步。',
      amountBasis: '数量可能包含不同计量单位，合计仅供参考；原币按 CNY/USD 分别汇总，人民币按保存金额合计后显示两位小数，不重算历史汇率。',
    }
  }
  router.get('/daily-reports/analysis', (req, res) => {
    const type = req.query.type
    if (!validKind(type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const result = analysisPayload(req, type)
    if ('denied' in result) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有此业务线的日报查看权限。' })
    if ('invalid' in result) return res.status(400).json({ error: 'analysis_filter_invalid', message: '日期范围、币种或来源参数无效。' })
    return res.json(result)
  })
  router.get('/daily-reports/analysis/export.xlsx', async (req, res) => {
    const type = req.query.type
    if (!validKind(type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const result = analysisPayload(req, type)
    if ('denied' in result) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有此业务线的日报查看权限。' })
    if ('invalid' in result) return res.status(400).json({ error: 'analysis_filter_invalid', message: '日期范围、币种或来源参数无效。' })
    try {
      const workbook = new ExcelJS.Workbook(), summary = workbook.addWorksheet('摘要'), detail = workbook.addWorksheet('日报明细')
      // Explicit string cells, never formula objects; also safe when copied into a spreadsheet.
      const safeCell = (value: string | number | undefined) => typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
      const labels = { count: '记录数', quantity: '数量（可能混合单位）', cnyAmount: 'CNY 原币金额', usdAmount: 'USD 原币金额', amountCny: '折合人民币金额' }
      summary.addRow(['指标', '值', '说明'])
      for (const [key, value] of Object.entries(result.summary)) summary.addRow([key, value, labels[key as keyof typeof labels]])
      summary.addRow(['数据来源', result.notice]); summary.addRow(['金额与数量口径', result.amountBasis])
      const filterLabels = { type: '业务线', from: '开始日期', to: '结束日期', partyName: '客商名称包含', createdBy: '录入人 ID', currency: '币种', source: '来源', q: '关键词' }
      for (const [key, value] of Object.entries(result.filters)) {
        const display = Array.isArray(value) ? value.join(', ') : value
        summary.addRow([filterLabels[key as keyof typeof filterLabels], safeCell(display || '不限')])
      }
      detail.addRow(['日期', '客商', '单号', '数量', '币种', '原币', '汇率', '人民币', '录入人', '来源', 'ID'])
      for (const row of result.reports) detail.addRow([
        row.date, row.partyName, row.documentNo, row.quantity, row.currency, row.originalAmount,
        row.exchangeRate, row.amountCny, row.recordedByName, row.source, row.id,
      ].map(safeCell))
      summary.columns.forEach(column => { column.width = 32 }); detail.columns.forEach(column => { column.width = 22 })
      summary.getRow(1).font = { bold: true }; detail.getRow(1).font = { bold: true }
      const buffer = await workbook.xlsx.writeBuffer()
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="daily-report-analysis-${type}.xlsx"`)
      return res.send(Buffer.from(buffer))
    } catch (error) {
      console.error('Daily analysis export failed.', error)
      return res.status(500).json({ error: 'daily_analysis_export_failed', message: '日报导出失败，请稍后重试。' })
    }
  })

  router.get('/daily-reports/k3-lines', (req, res) => {
    const type = req.query.type
    if (!validKind(type)) return res.status(400).json({ error: 'type 必须是 sales 或 purchase。' })
    const scope = scopeFromRequest(req), access = reportingAccess(scope, req)
    if (!access[type]) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有此业务线的 K3 对账查看权限。' })
    const state = readDailyReportState(scope), query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
    return res.json({ rows: searchRows(state, type, query), source: state.mockEnabled ? 'local-mock' : state.k3Sync?.source ?? 'workspace', liveErpConnected: state.k3Sync?.source === 'k3cloud' })
  })

  router.get('/daily-reporting/migration/k3/status', requireRole(...MIGRATION_MANAGERS), (req, res) => {
    const state = readDailyReportState(scopeFromRequest(req)), stage = state.k3MigrationStage
    return res.json({ finalized: state.k3MigrationSummary ?? null, staged: stage ? { companyCode: stage.legacyCompanyCode, headers: stage.headers.length, lines: stage.lines.length, expectedHeaders: stage.expectedHeaders ?? null, expectedLines: stage.expectedLines ?? null } : null })
  })

  router.post('/daily-reporting/migration/k3/headers', requireRole(...MIGRATION_MANAGERS), (req, res) => {
    const body = asRecord(req.body), companyCode = legacyString(body.companyCode, 32)?.toUpperCase() ?? '', rows = body.rows
    const expectedCount = body.expectedCount === undefined ? undefined : finite(body.expectedCount)
    if (!companyCode || !Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 100_000)) || (body.expectedCount !== undefined && expectedCount === undefined)) return res.status(400).json({ error: 'k3_header_import_request_invalid', message: '公司代码、1–1000 条表头和可选 expectedCount 必须有效。' })
    const parsed = rows.map((row, index) => ({ index, value: parseLegacyK3Header(row, companyCode) }))
    if (parsed.some(item => !item.value)) return res.status(422).json({ error: 'k3_header_import_row_invalid', message: '有无效的旧 K3 表头；未写入该批次。', rows: parsed.filter(item => !item.value).map(item => item.index + 1) })
    const incoming = parsed.map(item => item.value!), scope = scopeFromRequest(req)
    try {
      const result = mutateState(scope, state => {
        const finalized = state.k3MigrationSummary
        if (finalized) {
          const existing = new Map(state.k3HistoricalHeaders.map(item => [item.id, item]))
          const same = finalized.legacyCompanyCode === companyCode && incoming.every(item => JSON.stringify(existing.get(item.id)) === JSON.stringify(item))
          return same ? { alreadyFinalized: true as const, inserted: 0, skipped: incoming.length, total: finalized.headerCount } : { conflict: 'A different K3 migration is already finalized for this scope.' }
        }
        if (state.k3Sync?.source === 'k3cloud') return { conflict: 'A live K3Cloud snapshot exists; historical import is blocked to prevent mixing.' }
        if (state.k3MigrationStage && state.k3MigrationStage.legacyCompanyCode !== companyCode) return { conflict: 'A different company migration is already staged in this scope.' }
        const stage = state.k3MigrationStage ?? { legacyCompanyCode: companyCode, headers: [], lines: [] }
        if (expectedCount !== undefined && stage.expectedHeaders !== undefined && stage.expectedHeaders !== expectedCount) return { conflict: 'expected header count cannot change within a migration.' }
        const known = new Map(stage.headers.map(item => [item.id, item])), additions: LegacyK3SnapshotHeader[] = []
        let skipped = 0
        for (const item of incoming) {
          const prior = known.get(item.id)
          if (prior) { if (JSON.stringify(prior) !== JSON.stringify(item)) return { conflict: `conflicting source header ${item.formId}/${item.fid}.` }; skipped++; continue }
          known.set(item.id, item); additions.push(item)
        }
        if (expectedCount !== undefined) stage.expectedHeaders = expectedCount
        stage.headers.push(...additions); state.k3MigrationStage = stage
        return { inserted: additions.length, skipped, total: stage.headers.length }
      })
      if ('conflict' in result) return res.status(409).json({ error: 'k3_header_import_conflict', message: result.conflict })
      return res.status('alreadyFinalized' in result ? 200 : 201).json({ ...result, companyCode })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'k3_header_import_failed', message: error instanceof Error ? error.message : 'K3 历史表头暂存失败。' }) }
  })

  router.post('/daily-reporting/migration/k3/lines', requireRole(...MIGRATION_MANAGERS), (req, res) => {
    const body = asRecord(req.body), companyCode = legacyString(body.companyCode, 32)?.toUpperCase() ?? '', rows = body.rows
    const expectedCount = body.expectedCount === undefined ? undefined : finite(body.expectedCount)
    if (!companyCode || !Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 100_000)) || (body.expectedCount !== undefined && expectedCount === undefined)) return res.status(400).json({ error: 'k3_line_import_request_invalid', message: '公司代码、1–1000 条明细和可选 expectedCount 必须有效。' })
    const scope = scopeFromRequest(req)
    try {
      const result = mutateState(scope, state => {
        const finalized = state.k3MigrationSummary
        if (finalized) {
          const existing = new Map(state.k3Rows.filter(item => item.source === 'history-import').map(item => [item.id, item]))
          const headers = new Map(state.k3HistoricalHeaders.map(item => [`${item.formId}\u0000${item.fid}`, item]))
          const incoming = rows.map(row => parseLegacyK3Line(row, companyCode, headers))
          const same = finalized.legacyCompanyCode === companyCode && incoming.every(item => item && JSON.stringify(existing.get(item.id)) === JSON.stringify(item))
          return same ? { alreadyFinalized: true as const, inserted: 0, skipped: incoming.length, total: finalized.lineCount } : { conflict: 'A different K3 migration is already finalized for this scope.' }
        }
        const stage = state.k3MigrationStage
        if (!stage || stage.legacyCompanyCode !== companyCode) return { conflict: 'Import all K3 headers for this company before staging lines.' }
        if (state.k3Sync?.source === 'k3cloud') return { conflict: 'A live K3Cloud snapshot exists; historical import is blocked to prevent mixing.' }
        if (expectedCount !== undefined && stage.expectedLines !== undefined && stage.expectedLines !== expectedCount) return { conflict: 'expected line count cannot change within a migration.' }
        const headersBySourceId = new Map(stage.headers.map(item => [`${item.formId}\u0000${item.fid}`, item]))
        const parsed = rows.map((row, index) => ({ index, value: parseLegacyK3Line(row, companyCode, headersBySourceId) }))
        if (parsed.some(item => !item.value)) return { invalidRows: parsed.filter(item => !item.value).map(item => item.index + 1) }
        const incoming = parsed.map(item => item.value!), known = new Map(stage.lines.map(item => [item.id, item])), additions: K3SnapshotRow[] = []
        let skipped = 0
        for (const item of incoming) {
          const prior = known.get(item.id)
          if (prior) { if (JSON.stringify(prior) !== JSON.stringify(item)) return { conflict: `conflicting source line ${item.legacyFormId}/${item.erpId}.` }; skipped++; continue }
          known.set(item.id, item); additions.push(item)
        }
        if (expectedCount !== undefined) stage.expectedLines = expectedCount
        stage.lines.push(...additions)
        return { inserted: additions.length, skipped, total: stage.lines.length }
      })
      if ('conflict' in result) return res.status(409).json({ error: 'k3_line_import_conflict', message: result.conflict })
      if ('invalidRows' in result) return res.status(422).json({ error: 'k3_line_import_row_invalid', message: '有无效的旧 K3 明细或缺少对应表头；未写入该批次。', rows: result.invalidRows })
      return res.status('alreadyFinalized' in result ? 200 : 201).json({ ...result, companyCode })
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'k3_line_import_failed', message: error instanceof Error ? error.message : 'K3 历史明细暂存失败。' }) }
  })

  router.post('/daily-reporting/migration/k3/finalize', requireRole(...MIGRATION_MANAGERS), (req, res) => {
    const body = asRecord(req.body), companyCode = legacyString(body.companyCode, 32)?.toUpperCase() ?? ''
    const expectedHeaders = finite(body.expectedHeaders), expectedLines = finite(body.expectedLines)
    if (!companyCode || expectedHeaders === undefined || expectedLines === undefined || !Number.isSafeInteger(expectedHeaders) || !Number.isSafeInteger(expectedLines) || expectedHeaders < 0 || expectedLines < 0 || expectedHeaders > 100_000 || expectedLines > 100_000) return res.status(400).json({ error: 'k3_finalize_request_invalid', message: '公司代码以及有效的 expectedHeaders/expectedLines 为必填项。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    try {
      const result = db.transaction(() => mutateState(scope, state => {
        if (state.k3MigrationSummary) {
          const summary = state.k3MigrationSummary
          return summary.legacyCompanyCode === companyCode && summary.headerCount === expectedHeaders && summary.lineCount === expectedLines
            ? { alreadyFinalized: true as const, summary }
            : { conflict: 'A different K3 migration has already been finalized.' }
        }
        const stage = state.k3MigrationStage
        if (!stage || stage.legacyCompanyCode !== companyCode) return { conflict: 'No staged K3 migration exists for this company.' }
        if ((stage.expectedHeaders !== undefined && stage.expectedHeaders !== expectedHeaders) || (stage.expectedLines !== undefined && stage.expectedLines !== expectedLines)) return { conflict: 'Final counts differ from the staged manifest.' }
        if (stage.headers.length !== expectedHeaders || stage.lines.length !== expectedLines) return { incomplete: { headers: stage.headers.length, expectedHeaders, lines: stage.lines.length, expectedLines } }
        if (state.mockEnabled || state.k3Sync?.source === 'k3cloud' || state.k3Rows.some(row => row.source !== 'history-import') || state.k3HistoricalHeaders.length) return { conflict: 'This scope already contains demo, live K3, or prior historical snapshot rows; import cannot be mixed.' }
        const headerIds = new Set(stage.headers.map(item => item.id))
        if (stage.lines.some(line => !line.legacyHeaderId || !headerIds.has(line.legacyHeaderId))) return { conflict: 'At least one line has no staged legacy header.' }
        const sortedHeaders = [...stage.headers].sort((a, b) => a.id.localeCompare(b.id)), sortedLines = [...stage.lines].sort((a, b) => a.id.localeCompare(b.id))
        const digest = createHash('sha256').update(JSON.stringify({ headers: sortedHeaders, lines: sortedLines })).digest('hex')
        const completedAt = new Date().toISOString(), inactiveHeaderCount = stage.headers.filter(item => !item.active).length, inactiveLineCount = stage.lines.filter(item => !item.active).length
        const summary: DailyK3MigrationSummary = { legacyCompanyCode: companyCode, headerCount: stage.headers.length, lineCount: stage.lines.length, inactiveHeaderCount, inactiveLineCount, digest, completedAt }
        const rowCounts = { shipment: stage.lines.filter(item => item.kind === 'shipment' && item.active).length, 'purchase-receipt': stage.lines.filter(item => item.kind === 'purchase-receipt' && item.active).length }
        const lastSyncedAt = stage.headers.map(item => item.snapshotAt).sort().at(-1) ?? completedAt
        state.k3HistoricalHeaders = stage.headers; state.k3Rows.push(...stage.lines)
        state.k3Sync = { source: 'history-import', lastSyncedAt, rowCounts, mode: 'full', incrementalFrom: null, fullScanKinds: ['shipment', 'purchase-receipt'] }
        state.k3MigrationSummary = summary; delete state.k3MigrationStage
        recordDailyReportingMigrationBatch(scope, req, 'M06-k3-headers', companyCode, stage.headers.length, createHash('sha256').update(JSON.stringify(sortedHeaders)).digest('hex'), { inserted: stage.headers.length, skipped: 0, conflicts: 0 })
        recordDailyReportingMigrationBatch(scope, req, 'M06-k3-lines', companyCode, stage.lines.length, createHash('sha256').update(JSON.stringify(sortedLines)).digest('hex'), { inserted: stage.lines.length, skipped: 0, conflicts: 0 })
        return { summary, activeLineCounts: rowCounts, actor: actor.name }
      }))()
      if ('conflict' in result) return res.status(409).json({ error: 'k3_migration_finalize_conflict', message: result.conflict })
      if ('incomplete' in result) return res.status(422).json({ error: 'k3_migration_incomplete', message: '暂存行数与清单不一致；未发布历史快照。', ...result.incomplete })
      return res.status('alreadyFinalized' in result ? 200 : 201).json(result)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: 'k3_migration_finalize_failed', message: error instanceof Error ? error.message : 'K3 历史快照完结失败。' }) }
  })

  router.get('/daily-reports/summary', (req, res) => {
    const date = req.query.date
    if (!validDay(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD。' })
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), access = reportingAccess(scope, req), requestedScope = req.query.scope
    if (requestedScope !== undefined && !['sales', 'purchase', 'both'].includes(String(requestedScope))) return res.status(400).json({ error: 'scope 参数无效。' })
    const effectiveScope = (requestedScope as 'sales' | 'purchase' | 'both' | undefined) ?? (access.sales && access.purchase ? 'both' : access.sales ? 'sales' : access.purchase ? 'purchase' : undefined)
    if (!effectiveScope || !scopeIsAllowed(access, effectiveScope)) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员没有所请求业务线的日报汇总权限。' })
    return res.json({ ...buildDailyReportSummary(state, date, effectiveScope), access })
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

  router.post('/daily-reports/import/preview', requireRole(...MIGRATION_MANAGERS), receiveImportFile, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'daily_report_import_file_required', message: '请选择一个 CSV 或 XLSX 文件。' })
    const defaultType = typeof req.body?.type === 'string' ? req.body.type : ''
    if (defaultType && !validKind(defaultType)) return res.status(400).json({ error: 'invalid_daily_report_type', message: '默认日报类型必须是 sales 或 purchase。' })
    try {
      const parsed = await parseDailyReportImportFile(req.file.originalname, req.file.buffer, defaultType)
      if (!parsed.rows.length) return res.status(400).json({ error: 'daily_report_import_empty', message: '文件没有日报数据行。' })
      const migration = parsed.mappedFields.includes('legacyCompanyCode')
      if (migration && !['admin', 'plm_manager'].includes(req.authUser?.role ?? '')) return res.status(403).json({ error: 'migration_manager_required', message: '包含旧公司/责任人迁移字段的文件只能由日报管理员导入。' })
      const sourceCodes = parsed.rows.map(row => typeof row.values.legacyCompanyCode === 'string' ? row.values.legacyCompanyCode.trim().toUpperCase() : '').filter(Boolean)
      const sourceCompanyCode = sourceCodes[0]
      if (migration && (!sourceCompanyCode || sourceCodes.length !== parsed.rows.length || new Set(sourceCodes).size !== 1)) return res.status(400).json({ error: 'daily_report_import_company_mismatch', message: '迁移文件每一行都必须含相同的旧公司代码。' })
      const scope = scopeFromRequest(req)
      const rows: ImportPreviewRow[] = parsed.rows.map(row => {
        const validation = validateReportPayload(row.values, undefined, { preserveCnySnapshot: true, allowLegacyMetadata: migration })
        const errors = [...row.errors, ...(validation.error ? [validation.error] : [])]
        const rawKey = row.values.sourceIdempotencyKey
        const externalKey = typeof rawKey === 'string' ? rawKey.trim() : ''
        if (rawKey !== undefined && (typeof rawKey !== 'string' || externalKey.length > 160 || /[\u0000-\u001f\u007f]/.test(externalKey))) errors.push('来源幂等键必须是最多 160 字且不含控制字符的文本。')
        let value = validation.value ? { ...validation.value, source: 'history-import' as const, sourceIdempotencyKey: makeImportSourceKey(validation.value, externalKey || undefined) } : undefined
        if (value && migration) {
          const party = value.legacyCompanyCode && value.legacyPartyId ? findLegacyDailyParty(scope, value.type === 'sales' ? 'customer' : 'supplier', value.legacyCompanyCode, value.legacyPartyId) : undefined
          value = { ...value, ...(party ? { partyId: party.id, legacySourcePartyStatus: 'linked' as const } : { legacySourcePartyStatus: 'pending' as const }) }
        }
        return { line: row.line, value, errors }
      })
      classifyImportDuplicates(readDailyReportState(scope), rows)
      const actor = actorFromRequest(req)
      const now = Date.now()
      pendingImportPreviews.prune(now)
      const preview: PendingImportPreview = { token: randomUUID(), actorId: actor.id, scopeKey: stateKey(scope), expiresAt: now + importPreviewTtlMs, rows, fileName: req.file.originalname.slice(0, 160), digest: createHash('sha256').update(req.file.buffer).digest('hex'), migration, ...(sourceCompanyCode ? { sourceCompanyCode } : {}) }
      if (!pendingImportPreviews.set(preview, now)) return res.status(413).json({ error: 'daily_report_import_preview_too_large', message: '该预览超过服务器缓存容量，无法安全保留；请减少文件行数或备注长度后重试。' })
      return res.status(200).json(importPreviewResponse(preview, parsed.headers, parsed.mappedFields))
    } catch (error) {
      return res.status(400).json({ error: 'daily_report_import_parse_failed', message: error instanceof Error ? error.message : '文件解析失败。' })
    }
  })

  router.post('/daily-reports/import/commit', requireRole(...MIGRATION_MANAGERS), (req, res) => {
    const previewId = typeof req.body?.previewId === 'string' ? req.body.previewId : ''
    const preview = pendingImportPreviews.get(previewId)
    if (!preview || preview.expiresAt <= Date.now()) {
      if (preview) pendingImportPreviews.delete(previewId)
      return res.status(404).json({ error: 'daily_report_import_preview_expired', message: '导入预览不存在或已过期，请重新上传并预览。' })
    }
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    if (preview.actorId !== actor.id || preview.scopeKey !== stateKey(scope)) return res.status(404).json({ error: 'daily_report_import_preview_not_found', message: '导入预览不属于当前用户和账套。' })
    if (preview.migration && !['admin', 'plm_manager'].includes(req.authUser?.role ?? '')) return res.status(403).json({ error: 'migration_manager_required', message: '旧公司历史迁移只能由日报管理员提交。' })
    const invalidRows = preview.rows.filter(row => row.errors.length)
    if (invalidRows.length) return res.status(422).json({ error: 'daily_report_import_validation_failed', message: '存在字段错误行；请修正文件后重新预览并提交，未写入任何日报。', rows: invalidRows.map(row => ({ line: row.line, errors: row.errors })) })
    try {
      const transactionResult = db.transaction(() => mutateState(scope, state => {
        const knownKeys = new Set(liveReports(state).map(importDuplicateKey))
        const knownSourceKeys = new Set(state.reports.map(item => item.sourceIdempotencyKey).filter((key): key is string => Boolean(key)))
        const batchKeys = new Set<string>(), batchSourceKeys = new Set<string>()
        const imported: DailyReport[] = []
        const migrationCounts: Record<DailyKind, { rowCount: number; inserted: number; skipped: number; digestRows: unknown[] }> = {
          sales: { rowCount: 0, inserted: 0, skipped: 0, digestRows: [] }, purchase: { rowCount: 0, inserted: 0, skipped: 0, digestRows: [] },
        }
        let skippedDuplicates = 0
        for (const row of preview.rows) {
          const validation = validateReportPayload(row.value as unknown as Record<string, unknown>, undefined, { preserveCnySnapshot: true, allowLegacyMetadata: preview.migration })
          if (!validation.value) throw new TypeError(`第 ${row.line} 行重新校验失败：${validation.error}`)
          const value = {
            ...validation.value, source: 'history-import' as const,
            sourceIdempotencyKey: row.value!.sourceIdempotencyKey,
            sourceFileName: preview.fileName, sourceRow: row.line, importBatchId: preview.token,
          }
          const migrationCount = migrationCounts[value.type]
          migrationCount.rowCount += 1
          migrationCount.digestRows.push({ line: row.line, sourceIdempotencyKey: value.sourceIdempotencyKey, legacyPartyId: value.legacyPartyId, originalAmountExact: value.originalAmountExact, exchangeRateExact: value.exchangeRateExact, amountCnyExact: value.amountCnyExact })
          const key = importDuplicateKey(value)
          const sourceKey = value.sourceIdempotencyKey
          if (typeof sourceKey !== 'string' || !sourceKey) throw new TypeError(`第 ${row.line} 行缺少来源幂等键。`)
          if (knownKeys.has(key) || knownSourceKeys.has(sourceKey) || batchKeys.has(key) || batchSourceKeys.has(sourceKey)) { skippedDuplicates++; migrationCount.skipped++; continue }
          knownKeys.add(key); knownSourceKeys.add(sourceKey); batchKeys.add(key); batchSourceKeys.add(sourceKey)
          const now = new Date().toISOString()
          const item: DailyReport = { ...value, id: randomUUID(), createdAt: now, updatedAt: now, createdBy: actor.id, createdByName: actor.name, updatedBy: actor.id }
          state.reports.unshift(item)
          noteCorrection(state, { originalDate: item.date, type: '历史日报导入', affectedReport: item.type, referenceId: item.id, originalValue: archivedReportAmount(state, item.id, item.date), newValue: item.amountCny, diffAmount: item.amountCny, reason: '已归档日期新增历史日报记录。' })
          imported.push(item); migrationCount.inserted++
        }
        if (preview.migration && preview.sourceCompanyCode) for (const type of ['sales', 'purchase'] as const) {
          const item = migrationCounts[type]
          if (!item.rowCount) continue
          const digest = createHash('sha256').update(JSON.stringify(item.digestRows)).digest('hex')
          recordDailyReportingMigrationBatch(scope, req, type === 'sales' ? 'M01-sales-reports' : 'M02-purchase-reports', preview.sourceCompanyCode, item.rowCount, digest, { inserted: item.inserted, skipped: item.skipped, conflicts: 0 })
        }
        const dates = preview.rows.map(row => row.value!.date).sort()
        const types = [...new Set(preview.rows.map(row => row.value!.type))]
        state.importBatches = [...(state.importBatches ?? []), { id: preview.token, actorId: actor.id, actorName: actor.name, scopeKey: stateKey(scope), type: types.length === 1 ? types[0]! : 'mixed', fileName: preview.fileName, digest: preview.digest, completedAt: new Date().toISOString(), inserted: imported.length, skipped: skippedDuplicates, dateFrom: dates[0] ?? null, dateTo: dates.at(-1) ?? null }]
        return { batchId: preview.token, inserted: imported.length, skipped: skippedDuplicates, importedCount: imported.length, skippedDuplicates, imported: imported.map(item => ({ id: item.id, type: item.type, date: item.date, documentNo: item.documentNo, amountCny: item.amountCny, amountCnyExact: item.amountCnyExact, sourceIdempotencyKey: item.sourceIdempotencyKey })) }
      }))()
      const result = transactionResult
      pendingImportPreviews.delete(previewId)
      return res.json({ ...result, message: `已导入 ${result.importedCount} 条，跳过重复 ${result.skippedDuplicates} 条。` })
    } catch (error) {
      const status = error instanceof StateConflictError ? 409 : error instanceof TypeError ? 422 : 500
      return res.status(status).json({ error: status === 409 ? 'workspace_conflict' : status === 422 ? 'daily_report_import_validation_failed' : 'daily_report_import_commit_failed', message: error instanceof Error ? error.message : '日报批量导入失败。', importedCount: 0 })
    }
  })

  router.post('/daily-reports', requireRole(...WRITERS), (req, res) => {
    const scope = scopeFromRequest(req), actor = actorFromRequest(req), body = asRecord(req.body)
    const normalizedBody = { ...body }
    if (body.currency === 'USD' && readDailyReportingAdminState(scope).masterDataConfigured && typeof body.date === 'string' && validDay(body.date)) {
      const reportMonth = body.date.slice(0, 7)
      const monthlyRate = readDailyReportingAdminState(scope).exchangeRates.find(item => item.month === reportMonth)
      if (!monthlyRate) return res.status(400).json({ error: 'monthly_exchange_rate_required', message: `尚未维护 ${reportMonth} USD→CNY 月汇率，请先由日报管理员维护。` })
      normalizedBody.exchangeRate = monthlyRate.rate
    }
    const partyCheck = partyForReport(scope, req, body.type, body.partyId)
    if (partyCheck.error) return res.status(partyCheck.status ?? 400).json({ error: 'daily_party_rejected', message: partyCheck.error })
    const payload = validateReportPayload({ ...normalizedBody, ...(partyCheck.party ? { partyId: partyCheck.party.id, partyName: partyCheck.party.name } : {}) })
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
    const existing = readDailyReportState(scope).reports.find(item => item.id === String(req.params.id) && !item.deletedAt)
    const partyCheck = partyForReport(scope, req, body.type ?? existing?.type, body.partyId ?? existing?.partyId)
    if (partyCheck.error) return res.status(partyCheck.status ?? 400).json({ error: 'daily_party_rejected', message: partyCheck.error })
    const patchBody = { ...body, ...(partyCheck.party ? { partyId: partyCheck.party.id, partyName: partyCheck.party.name } : {}) }
    try {
      const updated = mutateState(scope, state => {
        const report = state.reports.find(item => item.id === String(req.params.id) && !item.deletedAt)
        if (!report) return undefined
        const parsed = validateReportPayload({ ...patchBody, type: body.type ?? report.type }, report, {
          preserveCnySnapshot: report.source === 'history-import' && body.originalAmount === undefined && body.exchangeRate === undefined && body.currency === undefined,
          allowLegacyMetadata: report.source === 'history-import',
        })
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
        if (partyForReport(scope, req, report.type, report.partyId).error) return 'forbidden' as const
        const oldValue = archivedReportAmount(state, report.id, report.date) ?? report.amountCny
        report.deletedAt = new Date().toISOString(); report.deletedBy = actor.id; report.updatedAt = report.deletedAt; report.updatedBy = actor.id
        state.links = state.links.filter(link => link.reportId !== report.id)
        noteCorrection(state, { originalDate: report.date, type: '日报删除', affectedReport: report.type, referenceId: report.id, originalValue: oldValue, newValue: null, diffAmount: roundMoney(-oldValue), reason: `日报 ${report.documentNo || report.id} 已软删除；已归档快照保持不变。` })
        return true
      })
      if (removed === 'forbidden') return res.status(403).json({ error: 'daily_party_rejected', message: '当前成员未被分配到该客商，不能删除此日报。' })
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
        if (partyForReport(scope, req, report.type, report.partyId).error) return { partyForbidden: true as const }
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
      if ('partyForbidden' in result) return res.status(403).json({ error: 'daily_party_rejected', message: '当前成员未被分配到该客商，不能修改此日报关联。' })
      if ('forbidden' in result) return res.status(403).json({ error: 'k3_line_out_of_scope', message: '快照明细不存在、已失效或不属于当前账套。' })
      if ('mismatched' in result) return res.status(400).json({ error: 'k3_line_type_mismatch', message: '销售日报只能关联销售出库行，采购日报只能关联采购入库行。' })
      return res.json(result)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'link_save_failed', message: error instanceof Error ? error.message : '关联保存失败。' }) }
  })

  router.get('/daily-reports/snapshots', (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), access = reportingAccess(scope, req)
    if (!access.sales && !access.purchase) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员尚未分配日报业务线权限。' })
    const snapshots = state.snapshots.filter(snapshot => snapshotIsAllowed(access, snapshot))
    const snapshotIds = new Set(snapshots.map(snapshot => snapshot.id))
    return res.json({ snapshots: snapshots.map(({ id, reportDate, scope: snapshotScope, version, createdAt, createdBy, source, isComplete, warnings }) => ({ id, reportDate, scope: snapshotScope, version, createdAt, createdBy, source, isComplete, warnings })), corrections: state.corrections.filter(item => access[item.affectedReport]), deliveries: state.deliveries.filter(item => snapshotIds.has(item.snapshotId)), mockEnabled: state.mockEnabled, access })
  })

  router.post('/daily-reports/snapshots', requireRole(...WRITERS), (req, res) => {
    const body = asRecord(req.body), reportDate = body.reportDate, snapshotScope = body.scope ?? 'both'
    if (!validDay(reportDate) || !['sales', 'purchase', 'both'].includes(String(snapshotScope))) return res.status(400).json({ error: 'reportDate 或 scope 参数无效。' })
    const scope = scopeFromRequest(req), actor = actorFromRequest(req)
    if (!scopeIsAllowed(reportingAccess(scope, req), snapshotScope as 'sales' | 'purchase' | 'both')) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员不能归档所请求业务线的数据。' })
    try {
      const snapshot = mutateState(scope, state => snapshotFromState(state, reportDate, snapshotScope as 'sales' | 'purchase' | 'both', actor))
      return res.status(201).json(snapshot)
    } catch (error) { return res.status(error instanceof StateConflictError ? 409 : 500).json({ error: error instanceof StateConflictError ? 'workspace_conflict' : 'snapshot_create_failed', message: error instanceof Error ? error.message : '快照生成失败。' }) }
  })

  router.get('/daily-reports/snapshots/:id/export.html', (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot || !snapshotIsAllowed(reportingAccess(scope, req), snapshot)) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="daily-report-${snapshot.reportDate}-v${snapshot.version}.html"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(renderSnapshotHtml(snapshot))
  })

  router.get('/daily-reports/snapshots/:id/export.xlsx', async (req, res) => {
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot || !snapshotIsAllowed(reportingAccess(scope, req), snapshot)) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    const workbook = new ExcelJS.Workbook(), data = snapshot.data as Record<string, unknown>, sales = asRecord(data.sales), purchase = asRecord(data.purchase), orders = asRecord(data.orders), balances = asRecord(data.balances)
    const summary = workbook.addWorksheet('摘要')
    summary.addRows([['经营日报', ''], ['报表日期', snapshot.reportDate], ['归档版本', snapshot.version], ['数据来源', snapshot.source === 'local-mock' ? '本地隔离演示（非真实 ERP）' : '工作区'], ['销售日报金额', asRecord(sales.daily).amountCny ?? 0], ['采购日报金额', asRecord(purchase.daily).amountCny ?? 0], ['销售订单金额', asRecord(orders.sales).amountCny ?? 0], ['采购订单金额', asRecord(orders.purchase).amountCny ?? 0], ['应收未收', asRecord(balances.receivables).outstandingAmountCny ?? 0], ['应付未付', asRecord(balances.payables).outstandingAmountCny ?? 0], ['快照完整', snapshot.isComplete ? '是' : '否'], ...snapshot.warnings.map(warning => ['警告', warning])])
    summary.columns = [{ width: 24 }, { width: 70 }]
    const reportSheet = workbook.addWorksheet('日报明细')
    reportSheet.addRow(['类型', '日期', '编号', '客商', '数量', '币种', '原币金额', '汇率', '人民币金额', '备注'])
    for (const row of (data.reports as DailyReport[] | undefined) ?? []) reportSheet.addRow([row.type === 'sales' ? '销售' : '采购', row.date, row.documentNo, row.partyName, row.quantity, row.currency, row.originalAmountExact ?? row.originalAmount, row.exchangeRateExact ?? row.exchangeRate, row.amountCnyExact ?? row.amountCny, row.note])
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
    const requestedSnapshot = readDailyReportState(scope).snapshots.find(item => item.id === String(req.params.id))
    if (requestedSnapshot && !snapshotIsAllowed(reportingAccess(scope, req), requestedSnapshot)) return res.status(403).json({ error: 'daily_reporting_access_denied', message: '当前成员不能推送此业务线快照。' })
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
    const scope = scopeFromRequest(req), state = readDailyReportState(scope), snapshot = state.snapshots.find(item => item.id === String(req.params.id))
    if (!snapshot || !snapshotIsAllowed(reportingAccess(scope, req), snapshot)) return res.status(404).json({ error: 'snapshot_not_found', message: '报表快照不存在或不属于当前账套。' })
    return res.json({ snapshot, deliveries: deliveryByChannel(state, snapshot.id) })
  })

  return router
}
