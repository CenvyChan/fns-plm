export type K3FormDomain = 'master' | 'purchase' | 'sales' | 'production' | 'quality' | 'warehouse' | 'finance'
export type K3MappingTarget =
  | 'shipment' | 'purchase-receipt' | 'sales-order' | 'purchase-order'
  | 'receivable' | 'payable' | 'sales-invoice' | 'purchase-invoice'
  | 'customer' | 'supplier' | 'salesperson' | 'user'
export type K3FormCatalogEntry = {
  formId: string
  name: string
  domain: K3FormDomain
  sourceCatalogMarkedVerified: boolean
  referencedAsExample: boolean
  downstream: string[]
  suggestedFor: K3MappingTarget[]
  notes: string
}

/**
 * Curated from the uploaded read-only MCP package's catalog.py and examples.
 * sourceCatalogMarkedVerified describes that package's source account only;
 * it is never evidence that the currently selected PLM account was checked.
 */
export const K3_FORM_CATALOG: K3FormCatalogEntry[] = [
  { formId: 'BD_MATERIAL', name: '物料', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: true, downstream: [], suggestedFor: [], notes: '上传目录标记已核实；另在示例中出现。当前账套仍须查询元数据核验。' },
  { formId: 'BD_Customer', name: '客户', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: ['customer'], notes: '仅为上传目录的客户主数据 FormId 记录；字段需从当前账套元数据选择。' },
  { formId: 'BD_Supplier', name: '供应商', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: ['supplier'], notes: '仅为上传目录的供应商主数据 FormId 记录；字段需从当前账套元数据选择。' },
  { formId: 'BD_Empinfo', name: '员工', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: ['salesperson'], notes: '员工档案可作为业务员候选；请核对当前账套业务语义和部门/人员字段。' },
  { formId: 'ORG_Organizations', name: '组织', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '' },
  { formId: 'BD_Department', name: '部门', domain: 'master', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '' },
  { formId: 'PUR_Requisition', name: '采购申请单', domain: 'purchase', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: ['PUR_PurchaseOrder'], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PUR_PurchaseOrder', name: '采购订单', domain: 'purchase', sourceCatalogMarkedVerified: true, referencedAsExample: true, downstream: ['PUR_ReceiveBill', 'STK_InStock'], suggestedFor: ['purchase-order'], notes: '上传目录标记已核实且示例中出现；其记录说明采购单后续可到收料/入库。当前账套需重新核验。' },
  { formId: 'PUR_ReceiveBill', name: '采购收料单', domain: 'purchase', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: ['QM_InspectBill', 'STK_InStock', 'PUR_MRB'], suggestedFor: [], notes: '上传目录记录：WMS 收料链路上游；2026-09-03 曾核对其原账套元数据。收料/质检与实际采购入库不是同一环节；作为 purchase-receipt 前请核对 PLM 口径。' },
  { formId: 'STK_InStock', name: '采购/其他入库单', domain: 'purchase', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: ['purchase-receipt'], notes: '上传目录明确区分：采购入库使用 STK_InStock，而非 PUR_ReceiveBill。当前账套需重新核验。' },
  { formId: 'PUR_MRB', name: '采购退料单', domain: 'purchase', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '' },
  { formId: 'SAL_SaleOrder', name: '销售订单', domain: 'sales', sourceCatalogMarkedVerified: true, referencedAsExample: true, downstream: ['SAL_DELIVERYNOTICE', 'SAL_OUTSTOCK'], suggestedFor: ['sales-order'], notes: '上传目录标记已核实且示例中出现；实际字段与目标账套均未在本流程中验证。' },
  { formId: 'SAL_DELIVERYNOTICE', name: '发货通知单', domain: 'sales', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: ['SAL_OUTSTOCK'], suggestedFor: [], notes: '上传目录记录：原账套发货链路上游为本单而非直接从 SAL_SaleOrder 推出库；提到 FCheckDelivery 虽 IsViewVisible=false 但仍可查询，并将 FStockOrgId、FEntryID 记为不可查。该注记与通用隐藏字段规则冲突，当前账套需以动态元数据和实际只读查询核实，界面默认不勾隐藏字段。' },
  { formId: 'SAL_OUTSTOCK', name: '销售出库单', domain: 'sales', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: ['shipment'], notes: '销售出库标识，与所有者提供的其他出库 STK_MisDelivery 不同；历史 STK_OutStock 在目标探测中未找到。当前账套字段与报表能力仍需核验。' },
  { formId: 'SAL_RETURNSTOCK', name: '销售退货单', domain: 'sales', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PRD_MO', name: '生产订单', domain: 'production', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: ['PRD_PickMtrl', 'PRD_MORPT'], suggestedFor: [], notes: '上传目录项目备注称一张 MO 对应一个 ProductionOrder（非按分录）；属于原业务实现假设，需按本企业流程确认。' },
  { formId: 'PRD_PPBOM', name: '生产用料清单', domain: 'production', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PRD_PickMtrl', name: '生产领料单', domain: 'production', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: ['PRD_ReturnMtrl'], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PRD_FeedMtrl', name: '生产补料单', domain: 'production', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PRD_ReturnMtrl', name: '生产退料单', domain: 'production', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'PRD_MORPT', name: '生产汇报单', domain: 'production', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: ['PRD_INSTOCK'], suggestedFor: [], notes: '' },
  { formId: 'PRD_INSTOCK', name: '生产入库单', domain: 'production', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'QM_InspectBill', name: '检验单', domain: 'quality', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录备注：采购收料的可选边，不是采购入库必经单据；来源代码注明其元数据已在原账套核对。' },
  { formId: 'STK_Inventory', name: '即时库存', domain: 'warehouse', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '即时库存不是物料档案；上传目录提到常见可用量字段 FAVBQty，但目标账套需动态发现，不能直接套用。' },
  { formId: 'STK_MisDelivery', name: '其他出库单', domain: 'warehouse', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '所有者明确提供的其他出库 FormId；本候选未做目标账套查询验证，不等于销售出库 SAL_OUTSTOCK。' },
  { formId: 'STK_OutStock', name: '历史目录标识（目标未找到）', domain: 'warehouse', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '目标账套已知探测未找到此标识；不得用它代替 STK_MisDelivery 或 SAL_OUTSTOCK，也不得据此断定没有销售出库业务。' },
  { formId: 'STK_TransferDirect', name: '直接调拨单', domain: 'warehouse', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'STK_StockCountInput', name: '盘盈单', domain: 'warehouse', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'STK_StockCountLoss', name: '盘亏单', domain: 'warehouse', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '上传目录候选，未标记为源账套已核实。' },
  { formId: 'AR_receiveBill', name: '收款单', domain: 'finance', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '这是收款单，不可仅凭名称等同于应收单余额 FormId。' },
  { formId: 'AP_PAYBILL', name: '付款单', domain: 'finance', sourceCatalogMarkedVerified: false, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '这是付款单，不可仅凭名称等同于应付单余额 FormId。' },
  { formId: 'GL_VOUCHER', name: '凭证', domain: 'finance', sourceCatalogMarkedVerified: true, referencedAsExample: false, downstream: [], suggestedFor: [], notes: '' },
]

export const K3_FORM_CATALOG_NOTE = '此目录仅为上传包中的已知表单/业务链缓存：源目录“已核实”只代表其原账套标记；示例是参考；候选未标记已核实。均不代表当前 PLM 账套可用。字段事实必须以当前账套 query_metadata(FormId) 返回并经管理员核验的结果为准。'
