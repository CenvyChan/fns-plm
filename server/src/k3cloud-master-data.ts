import { createHash } from 'node:crypto'
import { getAppState, setAppState } from './database.js'
import type { WorkspaceScope } from './scope.js'

export const K3_MASTER_DATA_KINDS = ['customer', 'supplier', 'salesperson', 'user'] as const
export type K3MasterDataKind = typeof K3_MASTER_DATA_KINDS[number]
export const K3_MASTER_DATA_FIELDS = ['id', 'number', 'name', 'status', 'category', 'department', 'ownerNumber', 'ownerName', 'modifiedAt'] as const
export type K3MasterDataField = typeof K3_MASTER_DATA_FIELDS[number]
export const K3_MASTER_DATA_REQUIRED_FIELDS = ['id', 'name'] as const
export type K3MasterDataMapping = { formId: string; fields: Partial<Record<K3MasterDataField, string>> }
export type K3MasterDataRecord = {
  id: string; kind: K3MasterDataKind; erpId: string; number: string; name: string
  status: string; category: string; department: string; ownerNumber: string; ownerName: string; modifiedAt: string
}
export type K3MasterDataState = {
  lastSyncedAt: string | null
  configuredKinds: K3MasterDataKind[]
  rowCounts: Partial<Record<K3MasterDataKind, number>>
  records: Partial<Record<K3MasterDataKind, K3MasterDataRecord[]>>
}
export type K3MasterDataQueryPage = (formId: string, fieldKeys: string, startRow: number) => Promise<Array<Record<string, string | null>>>
const PAGE_SIZE = 200
const MAX_ROWS_PER_KIND = 5_000
const emptyState = (): K3MasterDataState => ({ lastSyncedAt: null, configuredKinds: [], rowCounts: {}, records: {} })
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function stateKey(scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>): string {
  return `k3cloud-master-data:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}
export function readK3CloudMasterData(scope: WorkspaceScope): K3MasterDataState {
  const value = asRecord(getAppState<unknown>(stateKey(scope), emptyState()))
  const fallback = emptyState()
  return {
    ...fallback,
    ...value,
    configuredKinds: Array.isArray(value.configuredKinds) ? value.configuredKinds.filter((kind): kind is K3MasterDataKind => K3_MASTER_DATA_KINDS.includes(kind as K3MasterDataKind)) : [],
    rowCounts: asRecord(value.rowCounts) as Partial<Record<K3MasterDataKind, number>>,
    records: asRecord(value.records) as Partial<Record<K3MasterDataKind, K3MasterDataRecord[]>>,
    lastSyncedAt: typeof value.lastSyncedAt === 'string' ? value.lastSyncedAt : null,
  }
}
function mappedText(row: Record<string, string | null>, mapping: K3MasterDataMapping, key: K3MasterDataField): string {
  const field = mapping.fields[key]
  return field ? String(row[field] ?? '').trim().slice(0, key === 'name' ? 500 : 240) : ''
}
function stableId(kind: K3MasterDataKind, erpId: string): string {
  return `k3-master-${kind}-${createHash('sha256').update(`${kind}\0${erpId}`).digest('hex').slice(0, 24)}`
}
/** Collect and validate every configured master-data source before atomically publishing one scoped snapshot. */
export async function syncK3CloudMasterData(
  scope: WorkspaceScope,
  mappings: Partial<Record<K3MasterDataKind, K3MasterDataMapping>>,
  queryPage: K3MasterDataQueryPage,
): Promise<{ source: 'k3cloud'; refreshedAt: string; configuredKinds: K3MasterDataKind[]; rowCounts: Partial<Record<K3MasterDataKind, number>>; totalRows: number }> {
  const configuredKinds = K3_MASTER_DATA_KINDS.filter(kind => Boolean(mappings[kind]))
  if (!configuredKinds.length) throw new TypeError('K3Cloud 尚未配置客户、供应商、业务员或 ERP 用户主数据映射。')
  const refreshedAt = new Date().toISOString()
  const nextRecords: Partial<Record<K3MasterDataKind, K3MasterDataRecord[]>> = {}
  const rowCounts: Partial<Record<K3MasterDataKind, number>> = {}

  for (const kind of configuredKinds) {
    const mapping = mappings[kind]!
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(mapping.formId) || !mapping.fields || typeof mapping.fields !== 'object') throw new TypeError(`K3Cloud ${kind} 主数据映射无效。`)
    if (Object.keys(mapping.fields).some(field => !K3_MASTER_DATA_FIELDS.includes(field as K3MasterDataField))) throw new TypeError(`K3Cloud ${kind} 主数据映射包含不支持的规范字段；仅允许已定义的主数据字段。`)
    const required = K3_MASTER_DATA_REQUIRED_FIELDS
    if (required.some(key => typeof mapping.fields[key] !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(mapping.fields[key]!))) throw new TypeError(`K3Cloud ${kind} 必须映射字段：${required.join(', ')}。`)
    const selectedFields = [...new Set(K3_MASTER_DATA_FIELDS.flatMap(key => {
      const field = mapping.fields[key]
      return typeof field === 'string' && field.trim() ? [field] : []
    }))]
    const seen = new Set<string>()
    const records: K3MasterDataRecord[] = []
    for (let startRow = 0; ; startRow += PAGE_SIZE) {
      if (startRow >= MAX_ROWS_PER_KIND) {
        const overflow = await queryPage(mapping.formId, selectedFields.join(','), startRow)
        if (overflow.length) throw new RangeError(`K3Cloud ${kind} 主数据超过每类 ${MAX_ROWS_PER_KIND} 行的安全上限；未替换现有快照。`)
        break
      }
      const page = await queryPage(mapping.formId, selectedFields.join(','), startRow)
      if (!Array.isArray(page)) throw new Error(`K3Cloud ${kind} 主数据查询响应格式无效。`)
      for (const row of page) {
        const erpId = mappedText(row, mapping, 'id')
        const name = mappedText(row, mapping, 'name')
        if (!erpId || !name) throw new Error(`K3Cloud ${kind} 主数据存在缺少唯一 ID 或名称的记录。`)
        if (seen.has(erpId)) throw new Error(`K3Cloud ${kind} 主数据返回重复 ID；请映射稳定的 ERP 唯一键。`)
        seen.add(erpId)
        records.push({
          id: stableId(kind, erpId), kind, erpId,
          number: mappedText(row, mapping, 'number') || erpId,
          name, status: mappedText(row, mapping, 'status'), category: mappedText(row, mapping, 'category'),
          department: mappedText(row, mapping, 'department'), ownerNumber: mappedText(row, mapping, 'ownerNumber'),
          ownerName: mappedText(row, mapping, 'ownerName'), modifiedAt: mappedText(row, mapping, 'modifiedAt'),
        })
      }
      if (page.length < PAGE_SIZE) break
    }
    if (records.length > MAX_ROWS_PER_KIND) throw new RangeError(`K3Cloud ${kind} 主数据超过同步安全上限；未替换现有快照。`)
    nextRecords[kind] = records
    rowCounts[kind] = records.length
  }

  const previous = readK3CloudMasterData(scope)
  const records = { ...previous.records, ...nextRecords }
  const combinedCounts = { ...previous.rowCounts, ...rowCounts }
  const combinedKinds = [...new Set([...previous.configuredKinds, ...configuredKinds])]
  setAppState(stateKey(scope), { lastSyncedAt: refreshedAt, configuredKinds: combinedKinds, rowCounts: combinedCounts, records })
  return { source: 'k3cloud', refreshedAt, configuredKinds, rowCounts, totalRows: Object.values(rowCounts).reduce((sum, count) => sum + (count ?? 0), 0) }
}
