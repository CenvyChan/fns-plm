export const operationalRoutes = [
  { page: 'operational-inventory', title: '即时库存', id: 'instant-inventory' },
  { page: 'operational-movements', title: '收发存', id: 'stock-movement' },
  { page: 'operational-purchase', title: '采购执行', id: 'purchase-execution' },
  { page: 'operational-sales', title: '销售执行', id: 'sales-execution' },
  { page: 'operational-aging', title: '库存账龄', id: 'inventory-aging' },
] as const

export const reportCandidateRoutes = [
  { page: 'operational-candidate-sales-collect', candidateId: 'sales-collect', title: '销售执行汇总', formId: 'SAL_CollectReport' },
  { page: 'operational-candidate-subcontract-detail', candidateId: 'subcontract-detail', title: '委外订单执行明细', formId: 'SUB_ROExecuteDetailRpt' },
  { page: 'operational-candidate-subcontract-summary', candidateId: 'subcontract-summary', title: '委外订单执行汇总', formId: 'SUB_ROExecuteSummaryRpt' },
  { page: 'operational-candidate-ar-aging', candidateId: 'ar-aging', title: '应收账龄', formId: 'AR_AgingAnalysis' },
  { page: 'operational-candidate-ar-detail', candidateId: 'ar-detail', title: '应收明细', formId: 'AR_PAYDETAILREPORT' },
  { page: 'operational-candidate-ap-aging', candidateId: 'ap-aging', title: '应付账龄', formId: 'AP_AgingAnalysis' },
  { page: 'operational-candidate-ap-uninvoiced-detail', candidateId: 'ap-uninvoiced-detail', title: '应付未开票明细', formId: 'AP_IVDetailReport' },
  { page: 'operational-candidate-ap-detail', candidateId: 'ap-detail', title: '应付明细', formId: 'AP_PAYDETAILREPORT' },
  { page: 'operational-candidate-ap-summary', candidateId: 'ap-summary', title: '应付汇总', formId: 'AP_SumReport' },
  { page: 'operational-candidate-cost-analysis', candidateId: 'cost-analysis', title: '成本分析', formId: 'QINL_YSCBFXB' },
] as const

export const reportCandidatePlaceholderRoute = {
  page: 'operational-candidate-ar-summary', candidateId: 'ar-summary-placeholder', title: 'AR汇总待定义', formId: null,
} as const

export const reportCandidateEntryRoutes = [
  { page: 'operational-purchase', candidateId: 'purchase-order-detail', title: '采购订单执行明细', formId: 'PUR_PurchaseOrderDetailRpt' },
  { page: 'operational-sales', candidateId: 'sales-detail', title: '销售执行明细', formId: 'SAL_DetailReport' },
  ...reportCandidateRoutes,
  reportCandidatePlaceholderRoute,
] as const

export const reportCandidatePageById = Object.fromEntries(reportCandidateEntryRoutes.map(route => [route.candidateId, route])) as Record<string, (typeof reportCandidateEntryRoutes)[number]>
export const reportCandidateRouteForFormId = (formId: string) => reportCandidateEntryRoutes.find(route => route.formId === formId)
export const reportCandidateRouteForPage = (page: string) => reportCandidateEntryRoutes.find(route => route.page === page)

export const reportCandidateLockedStatusLabel = '附件候选 · 未验证 · live call 锁定'
export const operationalStatusLabel = (status?: string) => ({
  fixture: '本地示例', uncollected: '未采集', unsupported: '待接线 / 缺少来源', unconnected: '未连接',
  candidate_unverified_locked: reportCandidateLockedStatusLabel, not_defined: '待定义 · 无 FormId',
}[status || ''] || '状态待确认')

/** Report-owned UI contract only: not a returned field, fixture value or query parameter. */
export const specificationModelFilter = {
  label: '规格/型号',
  status: 'unverified',
  disabled: true,
  fieldKey: null,
  candidateSource: '物料主数据规格型号 / 报表关联物料属性（候选来源，未验证）',
  reason: '报表来源与规格型号 FieldKey 尚未核验，暂不可搜索；不发送查询。',
} as const

export type InventoryChartRow = { materialNumber: string; materialName: string; unit: string; quantity: number }
/** Only same-material, same-unit quantities may be combined. Names are labels, never identities. */
export function groupInventoryRows(rows: Record<string, unknown>[]): InventoryChartRow[] {
  const groups = new Map<string, InventoryChartRow>()
  for (const row of rows) {
    if (typeof row.materialNumber !== 'string' || !row.materialNumber.trim() || typeof row.unit !== 'string' || !row.unit.trim() || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity)) continue
    const key = JSON.stringify([row.materialNumber, row.unit])
    const previous = groups.get(key)
    const quantity = (previous?.quantity ?? 0) + row.quantity
    if (!Number.isFinite(quantity)) continue
    groups.set(key, { materialNumber: row.materialNumber, materialName: String(row.materialName || row.materialNumber), unit: row.unit, quantity })
  }
  return [...groups.values()]
}

export type InventoryFixtureKpis = { rowCount: number; materialCount: number; warehouseCount: number; quantitiesByUnit: Array<{ unit: string; quantity: number }> }
/** KPI inputs are the normalized local fixture fields only; do not map unverified K3 rows here. */
export function summarizeInventoryFixture(rows: Record<string, unknown>[]): InventoryFixtureKpis {
  const materials = new Set<string>(), warehouses = new Set<string>(), quantities = new Map<string, number>()
  for (const row of rows) {
    if (typeof row.materialNumber === 'string' && row.materialNumber.trim()) materials.add(row.materialNumber)
    if (typeof row.warehouse === 'string' && row.warehouse.trim()) warehouses.add(row.warehouse)
    if (typeof row.unit !== 'string' || !row.unit.trim() || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity)) continue
    const next = (quantities.get(row.unit) ?? 0) + row.quantity
    if (Number.isFinite(next)) quantities.set(row.unit, next)
  }
  return { rowCount: rows.length, materialCount: materials.size, warehouseCount: warehouses.size, quantitiesByUnit: [...quantities].map(([unit, quantity]) => ({ unit, quantity })) }
}

/** Each unit gets an independent scale, so lengths do not imply comparability across units. */
export function inventoryBarPercent(row: InventoryChartRow, rows: InventoryChartRow[]): number {
  const maximum = Math.max(1, ...rows.filter(item => item.unit === row.unit).map(item => Math.abs(item.quantity)))
  return Math.min(100, 100 * Math.abs(row.quantity) / maximum)
}

export const operationalFieldLabel: Record<string, string> = {
  q: '物料 / 仓库搜索', warehouse: '仓库', unit: '单位', stockOrganization: '库存组织', batch: '批次', stockStatus: '库存状态', asOfDate: '截至时点', dateFrom: '开始日期', dateTo: '结束日期', movementType: '收发业务类型', materialNumber: '物料编码', purchaseOrganization: '采购组织', salesOrganization: '销售组织', supplier: '供应商', buyer: '采购员', customer: '客户', salesperson: '销售员', status: '单据状态', dueDate: '要求交期', agingBucket: '账龄区间', materialName: '物料名称', quantity: '现存数量',
}
