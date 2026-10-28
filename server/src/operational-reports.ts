import { Router, type Request } from 'express'
import { getAppState } from './database.js'
import type { WorkspaceScope } from './scope.js'
import { getDailyReportingAccess } from './daily-reporting-admin.js'
import { buildSecondPhaseReportDemo, type SecondPhaseReportKind } from './second-phase-report-contract.js'
import { AR_SUMMARY_PLACEHOLDER, REPORT_CANDIDATES } from './report-candidate-contract.js'
import { GET_INVENTORY_DATA_READ_ONLY_OBSERVATION, TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS } from './target-account-readonly-observations.js'

type CandidateField = { name: string; label: string; status: 'candidate_unverified'; filterable: boolean; use: string }
const field = (name: string, label: string, filterable: boolean, use: string): CandidateField => ({ name, label, status: 'candidate_unverified', filterable, use })
const dimensions = [
  field('stockOrganization', '库存组织', true, '范围隔离；库存组织代码须由当前授权环境核验，不以PLM组织ID代替'),
  field('warehouse', '仓库', true, '仓库筛选与分类轴'),
  field('materialNumber', '物料编码', true, '同物料分组和明细关联'),
  field('materialName', '物料名称', true, '明细与图表标签'),
  field('unit', '计量单位', true, '量纲分组；不同单位不得直接相加'),
  field('stockStatus', '库存状态', true, '区分可用、冻结等业务状态；语义须核验'),
]
// These are source candidates only; no account-specific observations are retained here.
const source = (formId: string | null, entity: string | null, fieldKeys: string[], evidence: string, limitations: string[], label: string | null = null) => ({ formId, entity, label, fieldKeys, status: 'candidate_unverified' as const, evidence, limitations })
const filter = (name: string, key: string | null, evidence: string, classification: 'code_contract_candidate' | 'k3_candidate_unconfirmed' | 'ui_only_local' = 'k3_candidate_unconfirmed') => ({ name, key, status: 'candidate_unverified' as const, classification, evidence })
const metric = (name: string, formula: string, unit: string, chart: string, status: 'needs_real_data' | 'unsupported', requires: string[]) => ({ name, formula, unit, chart, status, requires })
const inventorySources = [source('STK_Inventory', null, ['FID', 'FStockOrgId', 'FMaterialId', 'FStockId', 'FStockStatusId', 'FBaseUnitId', 'FBaseQty'], '通用表单与字段候选；没有保留任何账号专属响应、映射或行值。', ['范围绑定、字段语义和精确 entity Key 均待核验。'], '即时库存（候选标签，非 entity Key）')]
const unknownSources = (evidence: string) => [source(null, null, [], evidence, ['没有明确的当前账套 FormId/entity/字段Key；不猜测具体字段。'])]

// User-transcribed public-document guidance; not independently verified here and
// not a target-account deployment/API confirmation. Keep lanes distinct from sourceContracts.
const lane = (name: string, service: string, method: string, formId: string | null, parameters: string[], provenance: string, limitations: string[]) => ({ name, service, method, formId, parameters, status: 'candidate_unverified' as const, provenance, limitations })
const publicGuidance = {
  'instant-inventory': {
    publicGuidanceNote: '用户转述的公开指南结论，未由本代理独立核验；部署API、目标版本及账套参数均未验证。GetInventoryData 仅为用户提供的契约，不与 ExecuteBillQuery 合并。',
    interfaceLanes: [
      lane('即时库存 ExecuteBillQuery', '动态表单查询', 'ExecuteBillQuery', 'STK_Inventory', ['目标账套字段Key', '过滤参数', '组织范围'], '用户转述公开指南：STK_Inventory/ExecuteBillQuery 可候选。', ['目标部署API未验证；entity、FieldKeys、过滤语法、组织绑定与授权范围未确认。']),
      lane('即时库存 GetInventoryData', '库存查询', 'GetInventoryData', null, ['库存组织编码映射', '目标部署参数'], '仅用户提供的接口契约；公开文章正文不可达（据用户转述）。', ['不视为已验证的官方接口或部署API；不得推定组织编码/字段/响应结构。']),
    ],
  },
  'stock-movement': {
    publicGuidanceNote: '用户转述公开指南；仅为报表API候选，目标版本、参数及目标账套均未验证。图表是实际行验证后的展示建议，不代表API字段。',
    interfaceLanes: [
      lane('会计期间简易账表', 'DynamicFormService', 'GetSysReportData', 'BD_HS_INOUTSTOCKSUMMARYRPT', ['目标版本', 'FormId', 'Model（必填与否/结构待确认）'], '用户转述：V6示例给出 BD_HS_INOUTSTOCKSUMMARYRPT；另官方页面省略 BD_ 前缀。', ['FormId存在文档冲突；Model必填规则与结构未决；目标版本/API/参数未验证。']),
      lane('物料收发明细/汇总', 'StockReportQueryService', 'GetReportData', null, ['FSCHEMEID（必须非默认）', '报表FormId', '目标版本/参数'], '用户转述公开指南：物料收发明细/汇总走 StockReportQueryService.GetReportData；文档确认的仅有 STK_StockDetailRpt 明细ID。', ['STK_StockDetailRpt 可作明细候选；汇总ID未知；方案ID需非默认；目标账套/调用未验证。']),
    ],
  },
  'purchase-execution': {
    publicGuidanceNote: '用户转述的公开指南提及采购执行指标，但没有精确报表FormId、API类型或FieldKeys；本地源单据FormId只保留为本地候选。图表是已验证行前提下的建议。',
    interfaceLanes: [lane('采购执行公开报表指南', '未知', '未知', null, ['报表FormId未知', 'API类型未知', 'FieldKeys未知'], '用户转述公开指南：有指标指导；非目标账套确认。', ['本地 PUR_PurchaseOrder、PUR_ReceiveBill、STK_InStock 是源单据候选，不是报表接口契约；逐行链、收料/入库量须分别验证。'])],
  },
  'sales-execution': {
    publicGuidanceNote: '用户转述的公开指南提及销售执行指标，但没有精确报表FormId、API类型或FieldKeys；本地源单据FormId只保留为本地候选。通知、实际出库、退货、结算与收款须分开。图表是已验证行前提下的建议。',
    interfaceLanes: [lane('销售执行公开报表指南', '未知', '未知', null, ['报表FormId未知', 'API类型未知', 'FieldKeys未知'], '用户转述公开指南：有指标指导；非目标账套确认。', ['本地 SAL_SaleOrder、SAL_DELIVERYNOTICE、SAL_OUTSTOCK 是源单据候选，不是报表接口契约；行链及结算/收款接口未知。'])],
  },
  'inventory-aging': {
    publicGuidanceNote: '用户转述公开指南：账龄走 StockReportQueryService.GetReportData，不能套用 GetSysReportData。图表仅为已验证行前提下的建议；参考价金额不是账面估值。',
    interfaceLanes: [lane('库存账龄报表', 'StockReportQueryService', 'GetReportData', null, ['FSCHEMEID（必须非默认）', '报表FormId未知', '目标版本/参数'], '用户转述公开指南：StockReportQueryService.GetReportData；文档未确认账龄FormId。', ['FormId、方案配置和目标账套均未验证；FIFO需关联截止日剩余层；参考价金额不得称作账面估值。'])],
  },
} as const
export const OPERATIONAL_REPORTS = [
  {
    ...publicGuidance['instant-inventory'],
    id: 'instant-inventory', name: '即时库存', status: 'uncollected',
    description: '库存采集接线尚未实现；需要组织、仓库、物料、单位及库存时点数量的可靠来源。',
    fields: ['warehouse', 'materialNumber', 'materialName', 'unit', 'quantity'],
    sourceContracts: inventorySources,
    filterContracts: [filter('q', null, '仅本地 fixture 对物料号/名称/仓库文本搜索；不映射K3字段。', 'ui_only_local'), filter('warehouse', 'FStockId', '本地请求/历史证据Key候选；仓库语义映射未确认。', 'code_contract_candidate'), filter('unit', 'FBaseUnitId', '本地请求/历史证据Key候选；单位映射未确认。', 'code_contract_candidate'), filter('stockOrganization', 'FStockOrgId', '本地请求/历史证据Key候选；历史过滤值不构成组织绑定/授权。', 'code_contract_candidate'), filter('batch', null, 'fieldSpecs概念；无本地精确Key，K3字段候选未确认。'), filter('stockStatus', 'FStockStatusId', '本地请求/历史证据Key候选；值域/语义未确认。', 'code_contract_candidate'), filter('asOfDate', null, 'fieldSpecs概念；无本地历史时点查询契约，K3候选未确认。')],
    metricSpecs: [metric('现存数量', '读取直接已核验库存数量；当前仅有本地 FBaseQty Key 候选，不能据此出值；不推算可用量', '基础单位（字段待映射）', '仓库柱图；需实际数据', 'needs_real_data', ['范围绑定', '仓库/物料/单位字段映射', '真实业务行']), metric('可用数量', '不得由现存量推算；只能读取已确认口径字段', '基础单位（待确认）', '暂不支持出值', 'unsupported', ['当前账套字段和可用量口径'])],
    filterSpecs: ['q', 'warehouse', 'unit', 'stockOrganization', 'batch', 'stockStatus', 'asOfDate'],
    fieldSpecs: [...dimensions, field('batch', '批次', true, '批次明细，不能据此推定FIFO账龄'), field('asOfDate', '库存时点', true, '快照时效，历史时点查询能力待确认'), field('quantity', '现存数量', false, '按物料与单位分组的库存柱图，不等于可承诺量'), field('availableQuantity', '可用数量', false, '必须确认可用口径，不从现存量猜算')],
    chartPrerequisites: ['仓库条形图：确认库存组织、仓库、物料、数量与单位后才能绘制', '按物料和单位分组；仅同物料、同单位可汇总，不跨单位合计', '可用量、金额指标还需各自已核验的直接字段和口径'],
  },
  {
    ...publicGuidance['stock-movement'],
    id: 'stock-movement', name: '收发存', status: 'unsupported',
    description: '当前日报快照没有完整期初、期间库存流水和期末来源；收发存接线占位，不能倒算期初。',
    fields: [], filterSpecs: ['dateFrom', 'dateTo', 'stockOrganization', 'warehouse', 'materialNumber', 'unit', 'movementType', 'stockStatus'],
    sourceContracts: unknownSources('本地材料没有证明可用于此报表的当前账套库存流水/余额来源；目录仅有候选表单身份。'),
    filterContracts: ['dateFrom', 'dateTo', 'stockOrganization', 'warehouse', 'materialNumber', 'unit', 'movementType', 'stockStatus'].map(name => filter(name, null, '筛选概念候选；无已确认字段Key。')),
    metricSpecs: [metric('期初/入库/出库/期末', '期末 = 期初 + 期间净变动；须同会计组织/会计期间/成本范围且完整流水勾稽，不能倒算期初；单价=金额/数量，数量为0或null不出值', '同物料同单位数量', '收发柱图与结存折线暂不支持', 'unsupported', ['可靠期初', '完整收发流水', '可靠期末', '退货/调拨/红字口径'])],
    fieldSpecs: [...dimensions, field('dateFrom', '期间开始', true, '期间边界'), field('dateTo', '期间结束', true, '期间边界'), field('movementType', '收发业务类型', true, '调拨、退货、红字、调整口径须确认'), field('openingQty', '期初数量', false, '必须有可靠期初余额，禁止倒算'), field('inboundQty', '期间入库数量', false, '仅已确认的库存收入，收料通知不是入库'), field('outboundQty', '期间出库数量', false, '仅已确认的库存发出，发货通知不是出库'), field('closingQty', '期末数量', false, '与同组织/仓库/物料/单位的期初和完整流水勾稽'), field('referenceAmount', '参考金额', false, '价格来源、币别、含税与参考价口径未确认')],
    chartPrerequisites: ['收发柱图与结存折线：需可靠期初、完整期间流水、期末余额和期间边界', '采购收料与入库分开；销售发货通知与实际出库分开', '退货、调拨、红字和参考金额口径需先确认；不猜周转率'],
  },
  {
    ...publicGuidance['purchase-execution'],
    id: 'purchase-execution', name: '采购执行', status: 'unsupported',
    description: '现有订单/采购单据快照不保证订单行到收料、入库行的可靠关联；执行查询接线占位。',
    fields: [], filterSpecs: ['dateFrom', 'dateTo', 'purchaseOrganization', 'supplier', 'buyer', 'materialNumber', 'status'],
    sourceContracts: [source('PUR_PurchaseOrder', null, [], '本地K3_FORM_CATALOG候选FormId；不是当前账套确认。', ['entity Key与字段Key未由本地契约给出；当前账套/逐行链未验证。'], '采购订单'), source('PUR_ReceiveBill', null, [], '本地K3_FORM_CATALOG独立目录候选：采购收料单；不同于采购入库单。', ['entity Key、字段Key及目标账套适用性未确认；收料不等于入库。'], '采购收料单'), source('STK_InStock', null, [], '本地K3_FORM_CATALOG独立目录候选：采购/其他入库单。', ['entity Key、字段Key及目标账套适用性未确认；入库数量须独立于收料。'], '采购/其他入库单'), ...unknownSources('订单行到收料/入库的精确源entity和字段Key未知。')],
    filterContracts: ['dateFrom', 'dateTo', 'purchaseOrganization', 'supplier', 'buyer', 'materialNumber', 'status'].map(name => filter(name, null, '筛选概念候选；无当前账套字段Key。')),
    metricSpecs: [metric('未完成数量候选', 'max(订货数量 - 已确认收料数量, 0)；超收单列；关闭/退料/取消口径待定', '同订单行同单位数量', '暂不可出值', 'unsupported', ['行键关联', '关闭/退料规则', '单位换算']), metric('未完成金额候选', '未完成数量 × 已核验单位行价；确认税/折扣/币别；同币别分组，禁止跨币别合计', '按币别金额', '暂不可出值', 'unsupported', ['行价/税口径', '币别', '未完成数量规则']), metric('收料进度', '若订货数量 > 0：(累计收料数量 / 订货数量) × 100；同一订单行、同计量单位；分母为0/负数不计算', '%', '按订单行进度条暂不可出值', 'unsupported', ['订单行键', '同单位订货及收料量', '真实关联']), metric('入库进度', '若订货数量 > 0：(累计采购入库数量 / 订货数量) × 100；独立于收料进度；同订单行/同单位；分母为0/负数不计算', '%', '单独进度条暂不可出值', 'unsupported', ['订单行键', 'STK_InStock 实际入库行关联', '退料处理'])],
    fieldSpecs: [field('purchaseOrganization', '采购组织', true, '组织范围，不能仅凭客户端输入替代授权范围'), field('supplier', '供应商', true, '供应商分组与筛选'), field('buyer', '采购员', true, '采购员维度'), field('dateFrom', '开始日期', true, '须确认按下单/到货/入库哪类日期筛选'), field('dateTo', '结束日期', true, '日期范围'), field('status', '订单状态', true, '审核、关闭、作废和反审核处理'), field('materialNumber', '物料编码', true, '物料分组'), field('orderLineId', '订单行键', false, '精确关联与去重，不能仅按单号拼接'), field('orderQty', '订货数量', false, '分母需大于零且与执行数量同单位'), field('receivedQty', '累计收料数量', false, '收料进度，不与入库量相加'), field('inboundQty', '累计入库数量', false, '独立入库执行进度，需处理退料'), field('openQty', '未完成数量', false, '须确认关闭、超收和退料口径后计算'), field('unit', '计量单位', false, '订单/收料/库存单位换算必须明确'), field('currency', '币别', true, '金额分组'), field('amount', '订单金额', false, '未完成金额候选=未完成数量×已核验单位行价；确认税/折扣/币别，按币别分组不跨币别合计')],
    chartPrerequisites: ['订单进度条：订单行到收料/入库行的逐行来源链、累计数量与单位已核验', '收料与入库分别显示，不能混加；退料、关闭、作废及超收需明确处理', '未完成金额排行需行价、税、币别与未完成口径；暂无业务行不能出值'],
  },
  {
    ...publicGuidance['sales-execution'],
    id: 'sales-execution', name: '销售执行', status: 'unsupported',
    description: '现有销售订单/发货快照不保证订单行到通知、销售出库行的关联；执行查询接线占位。',
    fields: [], filterSpecs: ['dateFrom', 'dateTo', 'salesOrganization', 'customer', 'salesperson', 'materialNumber', 'status', 'dueDate'],
    sourceContracts: [source('SAL_SaleOrder', null, [], '本地K3表单目录记录销售订单候选身份；只证明FormId候选，不证明当前账套字段Key。', ['entity Key与字段Key未由本地契约给出；不同环节不可混用。'], '销售订单'), source('SAL_DELIVERYNOTICE', null, [], '本地K3表单目录中的链路候选身份，目标账套及字段未验证。', ['entity Key/字段Key未由本地契约给出；通知量不等于实际出库量。'], '发货通知单'), source('SAL_OUTSTOCK', null, [], '本地K3表单目录记录销售出库候选身份；只证明FormId候选，不证明当前账套字段Key。', ['entity Key/字段Key未由本地契约给出；不可用 STK_MisDelivery 代替销售出库。'], '销售出库单')],
    filterContracts: ['dateFrom', 'dateTo', 'salesOrganization', 'customer', 'salesperson', 'materialNumber', 'status', 'dueDate'].map(name => filter(name, null, '筛选概念候选；无当前账套字段Key。')),
    metricSpecs: [metric('发货通知进度候选', '若订货数量 > 0：(关联发货通知数量 / 订货数量) × 100；同订单行/同单位；分母为0/负数不计算；通知不代表实际出库', '%', '独立通知进度条暂不可出值', 'unsupported', ['订单行键', '通知行关联', '撤销/拆分规则']), metric('实际交付进度', '若订货数量 > 0：(销售出库数量 / 订货数量) × 100；同一订单行、同计量单位；分母为0/负数不计算', '%', '订单行进度条暂不可出值', 'unsupported', ['订单行键', 'SAL_OUTSTOCK 行关联', '同单位数量及退货口径'])],
    fieldSpecs: [field('salesOrganization', '销售组织', true, '组织范围隔离'), field('customer', '客户', true, '客户分组与筛选'), field('salesperson', '销售员', true, '销售员维度'), field('dateFrom', '开始日期', true, '须确认按下单/交期/出库哪类日期筛选'), field('dateTo', '结束日期', true, '日期范围'), field('dueDate', '要求交期', true, '逾期判断需交期与截点'), field('status', '订单状态', true, '关闭、作废与反审核处理'), field('materialNumber', '物料编码', true, '物料分组'), field('orderLineId', '订单行键', false, '逐行关联及去重'), field('orderQty', '订货数量', false, '订单进度分母'), field('shipmentNoticeQty', '发货通知数量', false, '通知进度，不等于实际销售出库'), field('outboundQty', '销售出库数量', false, '实际履约须来自销售出库 SAL_OUTSTOCK'), field('openQty', '未交付数量', false, '须确认退货、关闭、超交口径'), field('unit', '计量单位', false, '订单和出库单位需一致或有可靠换算'), field('currency', '币别', true, '禁止跨币别直接累加金额'), field('amount', '订单金额', false, '未交付金额候选=未交付数量×已核验单位行价；确认税/折扣/币别，按币别分组；不是会计收入')],
    chartPrerequisites: ['交付进度条：需逐行销售订单、发货通知、销售出库的可靠关联与数量', '发货通知和销售出库各自展示，其他出库 STK_MisDelivery 不当销售出库', '未交付金额需行价/税/币别；订单额不代表会计收入，收款需核销数据'],
  },
  {
    ...publicGuidance['inventory-aging'],
    id: 'inventory-aging', name: '库存账龄', status: 'unsupported',
    description: '缺少可靠的库存层/历史入库分配及截止日结存来源；不能从当前库存余额推算账龄。',
    fields: [], filterSpecs: ['stockOrganization', 'warehouse', 'materialNumber', 'unit', 'stockStatus', 'asOfDate', 'agingBucket'],
    sourceContracts: unknownSources('没有明确的库存层、剩余层关联与截止日结存来源FormId/entity/字段Key。'),
    filterContracts: ['stockOrganization', 'warehouse', 'materialNumber', 'unit', 'stockStatus', 'asOfDate', 'agingBucket'].map(name => filter(name, null, '筛选概念候选；无当前账套字段Key。')),
    metricSpecs: [metric('库存账龄分桶数量', 'FIFO关联截止日剩余层；ageDays=截止日-入库日期，分桶互斥无遗漏；参考价金额≠账面估值', '同物料同单位数量', '分段堆叠图暂不支持', 'unsupported', ['层级分配、时区/日期口径、桶边界、截止日结存勾稽']), metric('库存账龄', '截止日 - 已关联剩余库存层的入库日期', '天', '分段堆叠图暂不支持', 'unsupported', ['库存层剩余数量分配', '可关联入库日期', '截止日结存勾稽']), metric('长库龄金额Top 10', '仅同币别且同金额口径分组后汇总参考金额并排序；不跨币别换算/合计' , '币别金额', '暂不支持', 'unsupported', ['账龄层', '参考金额/币别口径'])],
    fieldSpecs: [...dimensions, field('asOfDate', '账龄截止日', true, '计算截点'), field('agingBucket', '账龄区间', true, '区间边界配置，避免重叠和遗漏'), field('inventoryLayer', '库存层/入库层', false, 'FIFO分配来源，不等于批次追溯'), field('receiptDate', '来源入库日期', false, '需能关联到剩余库存层'), field('remainingQty', '层剩余数量', false, '与截止日当前结存勾稽'), field('referenceAmount', '参考金额', false, '金额需成本/参考价来源、币别和口径'), field('ageDays', '账龄天数', false, '日期和库存层关联均验证后才可计算')],
    chartPrerequisites: ['账龄堆叠图：需可靠历史入库层、剩余量分配、截止日和分段规则', 'FIFO账龄是分配推算，不等于批次追溯；不按当前余额臆造入库日期', '长库龄金额Top 10还需参考金额与币别口径；跨单位数量不直接合计'],
  },
] as const
/** Placeholder for historical evidence intentionally removed from the public source tree. */
export const INVENTORY_LIVE_SAMPLE_EVIDENCE = {
  status: 'historical_evidence_removed', reportId: 'instant-inventory',
  runtimeScopeBinding: 'not_configured',
  existingAllowedFieldKeys: [] as string[], newlyAllowedFieldKeys: [] as string[],
  request: null, queryAttempts: null, queryHttp: null, returnedCount: null,
  limitation: '无公开保留的历史实测响应、账户映射或业务行；字段和调用状态均须重新核验。',
  protocolBoundary: '表单查询与独立库存 action 不可互相替代；未验证前保持锁定。',
} as const
export const OPERATIONAL_REPORT_METADATA_PREFLIGHT = {
  metadataConfirmed: false, confirmedFields: [] as string[], source: 'offline-no-persisted-metadata',
  reason: '规范字段仍为候选概念，不是当前运行范围已确认的 K3 字段Key。历史实测、账户映射和业务行均未保留；fixture 和字段目录不作为确认依据。',
  verificationMethod: '后续验证须在明确授权的专用环境完成，并且仅记录非敏感的契约状态。',
  liveBusinessQueriesAllowed: false, stockOrganizationMapping: 'pending',
  reportCandidates: REPORT_CANDIDATES.map(candidate => ({
    ...candidate,
    targetAccountReadOnlyObservation: TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS[candidate.formId as keyof typeof TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS] ?? null,
    parameterConcepts: candidate.parameterFields.map(item => `${item.label}：${item.key}${item.requiredCandidate ? '（附件标注必填）' : ''}`),
    candidateFieldKeys: candidate.fieldCandidates.map(item => item.key),
  })),
  inventoryGetInventoryDataReadOnlyObservation: GET_INVENTORY_DATA_READ_ONLY_OBSERVATION,
  arSummaryPlaceholder: AR_SUMMARY_PLACEHOLDER,
  instantInventoryCandidate: {
    method: '/k3cloud/Kingdee.K3.SCM.WebApi.ServicesStub.InventoryQueryService.GetInventoryData,Kingdee.K3.SCM.WebApi.ServicesStub.common.kdsvc',
    status: 'candidate_unverified_locked', executionStatus: 'locked', liveCallsAllowed: false,
    directoryScope: 'outside_12_formids', sourceAttachment: null,
    parameters: ['fstockorgnumbers', 'fstocknumbers', 'fmaterialnumbers', 'isshowauxprop', 'isshowstockloc', 'pageindex', 'pagerows'],
    limitations: ['仅作为独立库存能力候选，不属于 FormId 报表目录。', '未保留历史请求值、响应结构或业务行。', '接口实现、scope 映射、响应结构和查询授权均待确认；不得由库存表单元数据接口替代。'],
  },
  stockOrganizationBlocker: '库存组织映射未验证；不查询外部组织目录、不修改 allowlist，也不解锁实时读取。',
} as const
export type OperationalReportId = typeof OPERATIONAL_REPORTS[number]['id']
type FixtureRow = { id: string; warehouse: string; materialNumber: string; materialName: string; unit: string; quantity: number }
export type OperationalInventoryFixture = { source: 'fixture'; status: 'fixture'; scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>; generatedAt: string; rows: FixtureRow[] }
const scopeKey = (scope: WorkspaceScope) => `operational-reporting-fixture:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
const validRows = (rows: unknown): rows is FixtureRow[] => Array.isArray(rows) && rows.length <= 10000 && new Set(rows.map(row => row?.id)).size === rows.length && rows.every(row => row && ['id', 'warehouse', 'materialNumber', 'materialName', 'unit'].every(key => typeof row[key] === 'string' && row[key].trim().length > 0 && row[key].length <= 200) && Number.isFinite(row.quantity))
const sanitizeRow = (row: FixtureRow): FixtureRow => ({ id: row.id, warehouse: row.warehouse, materialNumber: row.materialNumber, materialName: row.materialName, unit: row.unit, quantity: row.quantity })
/** Pure fixture builder. No credentials, integration call, or HTTP write endpoint. */
export function buildOperationalInventoryFixture(scope: WorkspaceScope, generatedAt: string, rows: FixtureRow[]): OperationalInventoryFixture {
  if (!Number.isFinite(Date.parse(generatedAt)) || !validRows(rows)) throw new TypeError('Invalid fixture inventory snapshot.')
  return { source: 'fixture', status: 'fixture', scope: { tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId }, generatedAt, rows: rows.map(sanitizeRow) }
}
function actorScope(req: Request): WorkspaceScope | undefined {
  const u = req.authUser
  return u ? { tenantId: u.tenantId, tenantName: u.tenantName, organizationId: u.organizationId, organizationName: u.organizationName, accountId: u.accountId, accountName: u.accountName, role: u.role, isPlatformAdmin: u.isPlatformAdmin } : undefined
}
function fixture(scope: WorkspaceScope): OperationalInventoryFixture | undefined {
  if (process.env.NODE_ENV !== 'test') return undefined
  const raw = getAppState<unknown>(scopeKey(scope), null)
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as OperationalInventoryFixture
  if (candidate.source !== 'fixture' || candidate.status !== 'fixture' || !Number.isFinite(Date.parse(candidate.generatedAt)) || !validRows(candidate.rows) || candidate.scope?.tenantId !== scope.tenantId || candidate.scope?.organizationId !== scope.organizationId || candidate.scope?.accountId !== scope.accountId) return undefined
  return { ...candidate, rows: candidate.rows.map(sanitizeRow) }
}
function allowed(scope: WorkspaceScope, req: Request): boolean {
  if (req.authUser?.role !== 'admin' && req.authUser?.role !== 'plm_manager') return false
  const access = getDailyReportingAccess(scope, req.authUser.id, req.authUser.role)
  return access.sales || access.purchase
}
const reportWithState = (report: typeof OPERATIONAL_REPORTS[number], data?: OperationalInventoryFixture) => ({ ...report, status: data ? 'fixture' : report.status, metadataConfirmed: false, requiresBusinessRows: true, snapshotAt: data?.generatedAt ?? null, source: data ? 'fixture' : 'not-connected', sourceLabel: data ? '本地示例（非实时、非真实业务数据）' : '采集接线占位；未接入K3业务数据' })
export function createOperationalReportsRouter(): Router {
  const router = Router()
  router.use('/operational-reports', (req, res, next) => {
    const scope = actorScope(req)
    if (!scope) return res.status(401).json({ error: 'unauthorized' })
    if (!allowed(scope, req)) return res.status(403).json({ error: 'operational_reports_access_denied' })
    return next()
  })
  router.get('/operational-reports', (req, res) => {
    const scope = actorScope(req)!
    return res.json({ metadataPreflight: OPERATIONAL_REPORT_METADATA_PREFLIGHT, reports: OPERATIONAL_REPORTS.map(report => reportWithState(report, report.id === 'instant-inventory' ? fixture(scope) : undefined)) })
  })
  router.get('/operational-reports/:reportId/demo', (req, res) => {
    const kinds: Record<string, SecondPhaseReportKind> = { 'purchase-execution': 'purchase', 'sales-execution': 'sales' }
    const kind = kinds[req.params.reportId]
    if (!kind) return res.status(404).json({ error: 'report_not_found' })
    const query: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) query[key] = value.map(item => String(item))
      else if (typeof value === 'string' && (key === 'page' || key === 'pageSize')) {
        query[key] = /^\d+$/.test(value) ? Number(value) : Number.NaN
      } else query[key] = value
    }
    try {
      const demo = buildSecondPhaseReportDemo(kind, query)
      return res.json(demo)
    } catch {
      return res.status(400).json({ error: 'invalid_second_phase_report_query' })
    }
  })
  router.get('/operational-reports/:reportId', (req, res) => {
    const scope = actorScope(req)!
    const report = OPERATIONAL_REPORTS.find(item => item.id === req.params.reportId)
    if (!report) return res.status(404).json({ error: 'report_not_found' })
    if (['q', 'warehouse', 'unit'].some(key => req.query[key] !== undefined && (typeof req.query[key] !== 'string' || String(req.query[key]).length > 200))) return res.status(400).json({ error: 'invalid_report_filter' })
    const data = report.id === 'instant-inventory' ? fixture(scope) : undefined
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase() : ''
    const warehouse = typeof req.query.warehouse === 'string' ? req.query.warehouse : ''
    const unit = typeof req.query.unit === 'string' ? req.query.unit : ''
    const filters = { q: q || null, warehouse: warehouse || null, unit: unit || null }
    if (!data) return res.json({ metadataPreflight: OPERATIONAL_REPORT_METADATA_PREFLIGHT, report: reportWithState(report), rows: [], total: null, filters, unavailableReason: report.description })
    const rows = data.rows.filter(row => (!warehouse || row.warehouse === warehouse) && (!unit || row.unit === unit) && (!q || [row.materialNumber, row.materialName, row.warehouse].some(value => value.toLocaleLowerCase().includes(q))))
    return res.json({ metadataPreflight: OPERATIONAL_REPORT_METADATA_PREFLIGHT, report: reportWithState(report, data), rows, total: rows.length, filters })
  })
  router.get('/operational-reports/:reportId/rows/:rowId', (req, res) => {
    if (req.params.reportId !== 'instant-inventory') return res.status(404).json({ error: 'row_not_found' })
    const data = fixture(actorScope(req)!)
    const row = data?.rows.find(item => item.id === req.params.rowId)
    return row ? res.json({ row, source: 'fixture', snapshotAt: data!.generatedAt, metadataConfirmed: false }) : res.status(404).json({ error: 'row_not_found' })
  })
  return router
}
