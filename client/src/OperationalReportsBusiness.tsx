import { useEffect, useMemo, useState } from 'react'
import { apiJson } from './api'
import { operationalRoutes, reportCandidateRouteForPage, reportCandidatePlaceholderRoute, groupInventoryRows, inventoryBarPercent, summarizeInventoryFixture } from './operational-report-model'
import { createCandidateReportFixture, type CandidateFixture } from './candidate-report-fixtures'
import { PURCHASE_ARRAY_FIELD_KEYS, parsePurchaseDemoMock } from './purchase-array-response'
import { createDefaultReportTablePreferences, moveVisibleColumn, normalizeReportTablePreferences, orderedVisibleKeys, reportTableStorageKey, sortReportRows, type ReportColumnField, type ReportTablePreferences } from './report-table-preferences'

type Candidate = {
  id: string
  name: string
  formId: string
  method: string
  status: string
  localRowsAvailable: boolean
  sourceAttachment: string | null
  requestedAttachment: string | null
  sourceAttachmentMatchesRequestedPath: boolean | null
  sourceReportedFormId: string | null
  sourceMatchesRequestedFormId: boolean
  parameterFields: Array<{ label: string; key: string; requiredCandidate: boolean }>
  modelFieldKeys: string[]
  modelNestedFieldPaths: string[]
  fieldCandidates: Array<{ key: string; label: string }>
  targetAccountReadOnlyObservation?: {
    kind: string
    rowCount?: number
    requestLimit?: number
    arrayWidth?: number
    fieldKeyOrder?: string[]
    excludedRuntimeFieldKeys?: string[]
    exclusionCode?: string
    errorClass?: string
  } | null
  publicApiClassification: string
  validation: Record<string, boolean | string>
  blockers: string[]
}
type Report = {
  id: string
  name: string
  description: string
  status: string
  fields: string[]
  filterSpecs: string[]
  fieldSpecs: Array<{ name: string; label: string; use?: string }>
  chartPrerequisites: string[]
  sourceContracts?: Array<{ formId: string | null; entity: string | null; label?: string | null; fieldKeys: string[]; evidence: string; limitations: string[] }>
  filterContracts?: Array<{ name: string; key: string | null; evidence: string }>
  metricSpecs?: Array<{ name: string; formula: string; unit: string; requires: string[] }>
  interfaceLanes?: Array<{ name: string; service: string | null; method: string | null; formId: string | null; parameters: string[]; provenance: string; limitations: string[] }>
  publicGuidanceNote?: string
  snapshotAt?: string | null
  sourceLabel?: string
}
type Directory = {
  reports?: Report[]
  metadataPreflight?: {
    reason?: string
    confirmedFields?: string[]
    reportCandidates?: Candidate[]
    arSummaryPlaceholder?: { id: string; name: string; blocker: string }
    instantInventoryCandidate?: { method: string; sourceAttachment: string; parameters: string[]; limitations: string[] }
    inventoryGetInventoryDataReadOnlyObservation?: { httpStatus: number; rowCount: number; objectKeyCount: number; returnedObjectCount: number }
    stockOrganizationBlocker?: string
    verificationMethod?: string
  }
}
type Row = Record<string, unknown> & { id: string }
type DemoEnvelope = { formId: string; source: string; label: string; status: 'fixture'; liveCallsAllowed: false; page: number; pageSize: number; total: number; rows: Array<Record<string, unknown>> }
type FilterState = { party: string; bill: string; material: string; from: string; to: string }

const toText = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)
const candidateLabel = (candidate: Candidate | undefined, key: string) => candidate?.fieldCandidates.find(field => field.key === key)?.label || ({
  FBillNo: '单据编号', FBILLNO: '单据编号', FDate: '日期', FSUPPLIERID: '供应商', FCUSTID: '客户', FMATERIALID: '物料',
  FOrderQty: '订货数量', FImportQty: '入库数量', FORDERQTY: '订货数量', FOUTQTY: '出库数量',
}[key] || key)

function readStoredTablePreferences(formId: string, fields: ReportColumnField[], defaults: string[], excluded: string[], ready: boolean): ReportTablePreferences {
  const fallback = createDefaultReportTablePreferences(fields.map(field => field.key), defaults, excluded)
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(reportTableStorageKey(formId))
    if (!stored) return fallback
    const raw = JSON.parse(stored) as Record<string, unknown>
    const storedKeys = [...(Array.isArray(raw.order) ? raw.order : []), ...(Array.isArray(raw.visibleKeys) ? raw.visibleKeys : []), ...(typeof raw.sortKey === 'string' ? [raw.sortKey] : [])].filter((key): key is string => typeof key === 'string')
    const catalog = ready ? fields.map(field => field.key) : [...new Set([...fields.map(field => field.key), ...storedKeys])]
    return normalizeReportTablePreferences(raw, catalog, defaults, excluded)
  } catch {
    return fallback
  }
}

function useReportTablePreferences(candidate: Candidate | undefined, formId: string, defaults: string[]) {
  const fields = candidate?.fieldCandidates?.length
    ? [...new Map(candidate.fieldCandidates.map(field => [field.key, field])).values()]
    : [...new Map(defaults.map(key => [key, { key, label: candidateLabel(candidate, key) }])).values()]
  const excluded = candidate?.targetAccountReadOnlyObservation?.kind === 'array_response'
    ? candidate.targetAccountReadOnlyObservation.excludedRuntimeFieldKeys || []
    : []
  const ready = Boolean(candidate?.fieldCandidates?.length)
  const fieldSignature = fields.map(field => field.key).join('\u001f')
  const defaultSignature = defaults.join('\u001f')
  const excludedSignature = excluded.join('\u001f')
  const [tableState, setTableState] = useState(() => ({ formId, preferences: readStoredTablePreferences(formId, fields, defaults, excluded, ready) }))
  const preferences = tableState.formId === formId
    ? tableState.preferences
    : readStoredTablePreferences(formId, fields, defaults, excluded, ready)
  useEffect(() => {
    if (tableState.formId !== formId) {
      setTableState({ formId, preferences })
      return
    }
    if (!ready) return
    const normalized = normalizeReportTablePreferences(preferences, fields.map(field => field.key), defaults, excluded)
    try { window.localStorage.setItem(reportTableStorageKey(formId), JSON.stringify(normalized)) } catch { /* Storage is optional; settings remain usable in memory. */ }
    if (JSON.stringify(normalized) !== JSON.stringify(preferences)) setTableState({ formId, preferences: normalized })
  }, [ready, formId, fieldSignature, defaultSignature, excludedSignature, preferences, tableState.formId])
  const update = (next: ReportTablePreferences) => setTableState({ formId, preferences: normalizeReportTablePreferences(next, fields.map(field => field.key), defaults, excluded) })
  const reset = () => update(createDefaultReportTablePreferences(fields.map(field => field.key), defaults, excluded))
  const visibleKeys = orderedVisibleKeys(preferences, fields.map(field => field.key))
  return { fields, excluded, preferences, update, reset, visibleKeys }
}

function ReportColumnSettings({ formId, title, fields, sampleKeys, excludedKeys, preferences, onChange, onReset }: {
  formId: string; title: string; fields: ReportColumnField[]; sampleKeys: string[]; excludedKeys: string[]
  preferences: ReportTablePreferences; onChange: (next: ReportTablePreferences) => void; onReset: () => void
}) {
  const [search, setSearch] = useState('')
  const visible = new Set(preferences.visibleKeys)
  const visibleOrder = orderedVisibleKeys(preferences, fields.map(field => field.key))
  const query = search.trim().toLocaleLowerCase()
  const filteredFields = fields.filter(field => !query || `${field.label} ${field.key}`.toLocaleLowerCase().includes(query))
  const maxFrozen = Math.min(5, visibleOrder.length)
  return <details className="op-business-table-settings" data-report-column-config={formId}>
    <summary>{title}表格设置 · 显示 {visibleOrder.length}/{fields.length} 列 · 冻结 {preferences.frozenCount} 列{preferences.sortKey ? ` · 排序 ${preferences.sortKey} ${preferences.sortDirection === 'asc' ? '升序' : '降序'}` : ''}</summary>
    <div className="op-business-table-settings-body">
      <p className="op-business-settings-note">字段目录来自本报表自己的附件 FieldKeys 候选，全部仍未验证；这些选项只改变本地表格视图，不会解锁查询或改写请求。当前本地合成样本没有提供的值显示为“—”。</p>
      <label className="op-business-field-search">搜索字段目录<input aria-label="搜索字段目录" type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder="按字段名或 Key 搜索"/><small>本报表完整候选目录：{fields.length} 项</small></label>
      <div className="op-business-column-picker" role="group" aria-label={`${title}可显示列`}>
        {filteredFields.map(field => {
          const excluded = excludedKeys.includes(field.key)
          return <label key={field.key} className={excluded ? 'locked' : ''}>
            <input type="checkbox" aria-label={`显示列 ${field.label} ${field.key}`} checked={visible.has(field.key)} disabled={excluded || (visible.has(field.key) && visibleOrder.length <= 1)} onChange={event => {
              const visibleKeys = event.currentTarget.checked ? [...preferences.visibleKeys, field.key] : preferences.visibleKeys.filter(key => key !== field.key)
              onChange({ ...preferences, visibleKeys })
            }}/>
            <span>{field.label}<code>{field.key}</code></span>
            <small>{excluded ? '目标账套运行列已排除' : sampleKeys.includes(field.key) ? '演示样本含值' : '演示样本无值'}</small>
          </label>
        })}
        {!filteredFields.length && <span className="op-business-no-fields">没有匹配的候选字段。</span>}
      </div>
      <div className="op-business-column-order" aria-label="显示列排列顺序">
        <b>显示列顺序（用上移/下移调整；最前面的列可冻结）</b>
        {visibleOrder.map((key, index) => {
          const field = fields.find(item => item.key === key)
          return <div key={key}><span><i>{index + 1}</i>{field?.label || key}<code>{key}</code></span>
            <button type="button" className="op-business-secondary" aria-label={`上移 ${key}`} disabled={index === 0} onClick={() => onChange(moveVisibleColumn(preferences, fields.map(item => item.key), key, -1))}>上移</button>
            <button type="button" className="op-business-secondary" aria-label={`下移 ${key}`} disabled={index === visibleOrder.length - 1} onClick={() => onChange(moveVisibleColumn(preferences, fields.map(item => item.key), key, 1))}>下移</button>
          </div>
        })}
      </div>
      <div className="op-business-table-options">
        <label>冻结前几列（按当前顺序）<select aria-label="冻结前几列" value={preferences.frozenCount} onChange={event => onChange({ ...preferences, frozenCount: Number(event.currentTarget.value) })}>{Array.from({ length: maxFrozen + 1 }, (_, count) => <option key={count} value={count}>{count} 列</option>)}</select></label>
        <label>允许排序字段<select aria-label="允许排序字段" value={preferences.sortKey} onChange={event => onChange({ ...preferences, sortKey: event.currentTarget.value })}><option value="">不排序</option>{fields.map(field => <option key={field.key} value={field.key} disabled={excludedKeys.includes(field.key)}>{field.label} · {field.key}{sampleKeys.includes(field.key) ? '' : '（演示样本无值）'}</option>)}</select></label>
        <label>排序方向<select aria-label="排序方向" value={preferences.sortDirection} onChange={event => onChange({ ...preferences, sortDirection: event.currentTarget.value === 'desc' ? 'desc' : 'asc' })}><option value="asc">升序</option><option value="desc">降序</option></select></label>
        <button type="button" className="op-business-secondary" onClick={onReset}>恢复本报表默认列</button>
      </div>
      <p className="op-business-settings-note">排序只作用于当前页面的本地合成行；未验证字段仍不能用于 K3 查询。冻结最多 5 列；调整列顺序后，冻结最前面的若干列。</p>
    </div>
  </details>
}

const fixtureFormIds = ['SAL_CollectReport', 'AR_PAYDETAILREPORT', 'AP_IVDetailReport', 'AP_PAYDETAILREPORT', 'AP_SumReport']
const secondPhase = {
  'purchase-execution': {
    title: '采购订单执行明细', formId: 'PUR_PurchaseOrderDetailRpt', kind: 'purchase' as const,
    partyKey: 'FSUPPLIERID', partyLabel: '供应商（演示）', billKey: 'FBillNo', materialKey: 'FMATERIALID', dateKey: 'FDate',
    columns: [...PURCHASE_ARRAY_FIELD_KEYS],
    options: { party: ['演示供应商-A', '演示供应商-B'], bill: ['演示采购单-001', '演示采购单-002'], material: ['演示物料-001', '演示物料-002'] },
  },
  'sales-execution': {
    title: '销售执行明细', formId: 'SAL_DetailReport', kind: 'sales' as const,
    partyKey: 'FCUSTID', partyLabel: '客户（演示）', billKey: 'FBILLNO', materialKey: 'FMATERIALID', dateKey: 'FDate',
    columns: ['FBILLNO', 'FDate', 'FCUSTID', 'FMATERIALID', 'FORDERQTY', 'FDELIQTY', 'FOUTQTY'],
    options: { party: ['演示客户-A', '演示客户-B'], bill: ['演示销售单-001', '演示销售单-002'], material: ['演示物料-001', '演示物料-003'] },
  },
} as const

type DemoMetric = { label: string; group: string; value: number }
type DemoMetricSummary = { rowCount: number; metrics: DemoMetric[]; note: string }
type GroupedFieldSpec = { key: string; label: string; groupKey: string; groupKind: 'currency' | 'unit' }

const demoGroupedFieldSpecs: Record<string, { amounts?: GroupedFieldSpec[]; quantities?: GroupedFieldSpec[]; countOnlyNote?: string }> = {
  'PUR_PurchaseOrderDetailRpt': { amounts: [{ key: 'FOrderAmount', label: '订货金额', groupKey: 'FCurrencyId', groupKind: 'currency' }], quantities: [{ key: 'FOrderQty', label: '订货数量', groupKey: 'FUnitId', groupKind: 'unit' }] },
  'SAL_DetailReport': { amounts: [{ key: 'FORDERAMOUNT', label: '订单金额', groupKey: 'FCURRENCYID', groupKind: 'currency' }], quantities: [{ key: 'FORDERQTY', label: '订货数量', groupKey: 'FUNIT', groupKind: 'unit' }] },
  'SAL_CollectReport': { amounts: [{ key: 'FSOAMOUNT', label: '订单金额', groupKey: 'FCURRENCYID', groupKind: 'currency' }], quantities: [{ key: 'FSOQTY', label: '订单数量', groupKey: 'FUNITID', groupKind: 'unit' }] },
  'AR_PAYDETAILREPORT': { amounts: [{ key: 'FAMOUNTFOR', label: '本期应收', groupKey: 'FCURRENCYFORNAME', groupKind: 'currency' }] },
  'AP_IVDetailReport': { amounts: [{ key: 'FPRECAMOUNT', label: '本期应付', groupKey: 'FCURRENCYFORNAME', groupKind: 'currency' }], quantities: [{ key: 'FQty', label: '计价数量', groupKey: 'FUnit', groupKind: 'unit' }] },
  'AP_PAYDETAILREPORT': { amounts: [{ key: 'FAMOUNTFOR', label: '本期应付', groupKey: 'FCURRENCYFORNAME', groupKind: 'currency' }] },
  'AP_SumReport': { countOnlyNote: '演示汇总按期间口径尚未核验，仅显示记录数。' },
}

function summarizeDemoRows(formId: string, columns: readonly string[], rows: Array<Record<string, unknown>>): DemoMetricSummary {
  const specs = demoGroupedFieldSpecs[formId] || {}
  const available = new Set(columns)
  const metrics: DemoMetric[] = []
  if (specs.countOnlyNote) return { rowCount: rows.length, metrics, note: rows.length ? specs.countOnlyNote : '没有匹配的演示记录，金额/数量无可汇总值。' }
  let missingAmountFields = false
  let missingQuantityFields = false
  const collect = (spec: GroupedFieldSpec, kind: 'currency' | 'unit') => {
    if (!available.has(spec.key) || !available.has(spec.groupKey) || !rows.length) return false
    const grouped = new Map<string, number>()
    for (const row of rows) {
      const group = row[spec.groupKey]
      const value = row[spec.key]
      if (typeof group !== 'string' || !group.trim() || typeof value !== 'number' || !Number.isFinite(value)) return false
      const total = (grouped.get(group) || 0) + value
      if (!Number.isFinite(total)) return false
      grouped.set(group, total)
    }
    for (const [group, value] of grouped) metrics.push({ label: spec.label, group: `${kind === 'currency' ? '币别' : '单位'}：${group}`, value })
    return true
  }
  for (const spec of specs.amounts || []) if (!collect(spec, 'currency')) missingAmountFields = true
  for (const spec of specs.quantities || []) if (!collect(spec, 'unit')) missingQuantityFields = true
  const note = !rows.length
    ? '没有匹配的演示记录，金额/数量无可汇总值。'
    : missingAmountFields && missingQuantityFields
      ? '演示字段缺少币别/单位，金额和数量未汇总。'
      : missingAmountFields
        ? '演示字段缺少币别或金额口径，未汇总金额。'
        : missingQuantityFields
          ? '演示数量缺少计量单位，未汇总数量。'
          : ''
  return { rowCount: rows.length, metrics, note }
}

function DemoMetricSummaryView({ summary }: { summary: DemoMetricSummary }) {
  return <div className="op-business-demo-metrics" role="region" aria-label="演示指标">
    <div><span>演示记录</span><b>{summary.rowCount}</b></div>
    {summary.metrics.map((metric, index) => <div key={`${metric.label}-${metric.group}-${index}`}><span>演示{metric.label} · {metric.group}</span><b>{new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(metric.value)}</b></div>)}
    {summary.note && <p>{summary.note}</p>}
  </div>
}

const reportGroups = [
  { title: '库存', items: [
    { page: 'operational-inventory', name: '即时库存', purpose: '按仓库和单位查看演示库存。' },
    { page: 'operational-movements', name: '收发存', purpose: '查看期间收发与结存报表状态。' },
    { page: 'operational-aging', name: '库存账龄', purpose: '查看库存账龄配置状态。' },
  ] },
  { title: '采购', items: [
    { page: 'operational-purchase', candidateId: 'purchase-order-detail', name: '采购订单执行明细', purpose: '按日期、供应商和物料查看演示订单。' },
  ] },
  { title: '销售', items: [
    { page: 'operational-sales', candidateId: 'sales-detail', name: '销售执行明细', purpose: '按日期、客户和物料查看演示订单。' },
    { page: 'operational-candidate-sales-collect', candidateId: 'sales-collect', name: '销售执行汇总', purpose: '查看销售汇总演示记录。' },
  ] },
  { title: '应收', items: [
    { page: 'operational-candidate-ar-aging', candidateId: 'ar-aging', name: '应收账龄', purpose: '查看应收账龄参数配置状态。' },
    { page: 'operational-candidate-ar-detail', candidateId: 'ar-detail', name: '应收明细', purpose: '查看应收演示明细。' },
    { page: reportCandidatePlaceholderRoute.page, candidateId: 'ar-summary-placeholder', name: 'AR汇总待定义', purpose: '等待确认报表来源和定义。' },
  ] },
  { title: '应付', items: [
    { page: 'operational-candidate-ap-aging', candidateId: 'ap-aging', name: '应付账龄', purpose: '查看应付账龄参数配置状态。' },
    { page: 'operational-candidate-ap-uninvoiced-detail', candidateId: 'ap-uninvoiced-detail', name: '应付未开票明细', purpose: '查看应付未开票演示明细。' },
    { page: 'operational-candidate-ap-detail', candidateId: 'ap-detail', name: '应付明细', purpose: '查看应付演示明细。' },
    { page: 'operational-candidate-ap-summary', candidateId: 'ap-summary', name: '应付汇总', purpose: '查看应付汇总演示记录。' },
  ] },
  { title: '委外', items: [
    { page: 'operational-candidate-subcontract-detail', candidateId: 'subcontract-detail', name: '委外订单执行明细', purpose: '查看委外订单明细接入状态。' },
    { page: 'operational-candidate-subcontract-summary', candidateId: 'subcontract-summary', name: '委外订单执行汇总', purpose: '查看委外订单汇总接入状态。' },
  ] },
  { title: '成本', items: [
    { page: 'operational-candidate-cost-analysis', candidateId: 'cost-analysis', name: '成本分析', purpose: '查看成本分析接入状态。' },
  ] },
]

function TechDetails({ candidate }: { candidate: Candidate }) {
  const observation = candidate.targetAccountReadOnlyObservation
  const excluded = observation?.kind === 'array_response' ? observation.excludedRuntimeFieldKeys || [] : []
  return <details className="op-business-tech">
    <summary>数据来源 / 技术详情</summary>
    <div className="op-business-tech-body">
      <dl className="op-business-tech-meta">
        <div><dt>FormId</dt><dd><code>{candidate.formId}</code></dd></div>
        <div><dt>方法</dt><dd><code>{candidate.method}</code></dd></div>
        <div><dt>方案编号</dt><dd>{candidate.status === 'not_defined' ? '未定义' : '未选择'}</dd></div>
        <div><dt>目标账套状态</dt><dd>未验证；实时查询锁定</dd></div>
        <div><dt>来源附件</dt><dd><code>{candidate.sourceAttachment}</code></dd></div>
      </dl>
      {observation?.kind === 'array_response' && <p>只读结构 metadata：RowCount {observation.rowCount}、请求 Limit {observation.requestLimit}、数组宽度 {observation.arrayWidth}。未保存或展示目标账套行值。</p>}
      {observation?.kind === 'array_response' && observation.fieldKeyOrder?.length ? <p>采购数组响应顺序：{observation.fieldKeyOrder.map(key => <code key={key}>{key} </code>)}</p> : null}
      {observation?.kind === 'parameter_parse_error' && <p>只读参数检查未得到成功响应；剩余枚举未知，不猜测、不显示账龄行。</p>}
      <h3>附件 Model 筛选候选</h3>
      <div className="op-business-code-list">{candidate.modelFieldKeys.map(key => <code key={key}>{key}</code>)}</div>
      {candidate.modelNestedFieldPaths.length > 0 && <p>嵌套路径：{candidate.modelNestedFieldPaths.map(key => <code key={key}>{key} </code>)}</p>}
      <h3>附件 FieldKeys 候选（尚未选定）</h3>
      <div className="op-business-field-list">{candidate.fieldCandidates.map(field => <span key={field.key}><b>{field.label}</b><code>{field.key}</code>{excluded.includes(field.key) && <small>目标账套运行列已排除；附件候选仍保留</small>}</span>)}</div>
      <h3>来源与验证说明</h3>
      <p>{candidate.sourceMatchesRequestedFormId ? `附件正文 FormId 与目录相符：${candidate.sourceReportedFormId || candidate.formId}。` : `附件正文 FormId 为 ${candidate.sourceReportedFormId || '未声明'}，与当前目录不匹配。`}</p>
      <p>SchemeId、已选 FieldKeys、必填枚举、响应结构和行粒度均未验证；liveCallsAllowed=false。</p>
      <ul>{candidate.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
    </div>
  </details>
}

function CandidateFixtureWorkbench({ candidate, fixture }: { candidate: Candidate; fixture: CandidateFixture }) {
  const [draft, setDraft] = useState({ party: '', from: '', to: '' })
  const [applied, setApplied] = useState<typeof draft | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(2)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const tableSettings = useReportTablePreferences(candidate, fixture.formId, fixture.columns)
  const partyKey = fixture.filter.outputKeys[0]
  const partyNameKey = fixture.filter.outputKeys[1] || partyKey
  const dateKey = fixture.columns.find(key => /^(FDate|FDATE|FORDERDATE|FEndDate)$/i.test(key) || /date/i.test(key))
  const options = [...new Map(fixture.rows.map(row => [String(row.values[partyKey] ?? ''), { value: String(row.values[partyKey] ?? ''), label: String(row.values[partyNameKey] ?? row.values[partyKey] ?? '') }])).values()].filter(item => item.value)
  const visibleColumns = tableSettings.visibleKeys
  const filtered = applied ? fixture.rows.filter(row => {
    if (applied.party && String(row.values[partyKey] ?? '') !== applied.party) return false
    const date = dateKey ? String(row.values[dateKey] ?? '') : ''
    if (applied.from && date && date < applied.from) return false
    if (applied.to && date && date > applied.to) return false
    return true
  }) : []
  const sorted = sortReportRows(filtered.map(row => row.values), tableSettings.preferences.sortKey, tableSettings.preferences.sortDirection)
  const sortedRows = sorted.map(values => fixture.rows.find(row => row.values === values)!).filter(Boolean)
  const pages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const activePage = Math.min(page, pages)
  const pageRows = sortedRows.slice((activePage - 1) * pageSize, activePage * pageSize)
  const selected = fixture.rows.find(row => row.id === selectedId)
  const query = () => { setApplied({ ...draft }); setPage(1); setSelectedId(null) }
  const clear = () => { setDraft({ party: '', from: '', to: '' }); setApplied(null); setPage(1); setSelectedId(null) }
  return <section className="op-business-workbench" aria-label={`${candidate.name}演示查询`} data-form-id={fixture.formId}>
    <div className="op-business-condition" role="group" aria-label="查询条件">
      <div className="op-business-section-title"><div><h2>查询条件</h2><p>先选择条件，再查询演示记录。</p></div><span className="op-business-demo-badge">演示数据</span></div>
      <div className="op-business-query-grid">
        <label>{fixture.filter.label}（演示）<select aria-label={`${fixture.filter.label}（演示）`} value={draft.party} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, party: selected })) }}><option value="">全部</option>{options.map(option => <option key={option.value} value={option.value}>演示 · {option.label}</option>)}</select></label>
        {dateKey && <>
          <label>开始日期<input aria-label="开始日期" type="date" value={draft.from} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, from: selected })) }}/></label>
          <label>结束日期<input aria-label="结束日期" type="date" value={draft.to} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, to: selected })) }}/></label>
        </>}
      </div>
      <div className="op-business-actions"><button className="op-business-primary" type="button" onClick={query}>查询</button><button className="op-business-secondary" type="button" onClick={clear}>清除条件</button></div>
    </div>
    <ReportColumnSettings formId={fixture.formId} title={candidate.name} fields={tableSettings.fields} sampleKeys={fixture.columns} excludedKeys={tableSettings.excluded} preferences={tableSettings.preferences} onChange={tableSettings.update} onReset={tableSettings.reset}/>
    {applied ? <section className="op-business-results" aria-label="演示查询结果">
      <div className="op-business-section-title"><div><h2>结果</h2><p>共 {filtered.length} 条演示记录 · 不代表实测业务数据</p></div><span className="op-business-demo-badge">演示数据</span></div>
      <DemoMetricSummaryView summary={summarizeDemoRows(fixture.formId, fixture.columns, filtered.map(row => row.values))}/>
      <div className="op-business-scroll-hint" role="note">可横向滚动查看宽报表；冻结 {tableSettings.preferences.frozenCount} 列。演示样本没有提供的候选字段值显示为“—”。</div>
      <div className="op-business-table-wrap"><table className="op-business-data-table" data-form-id={fixture.formId}><thead><tr>{visibleColumns.map((key, index) => {
        const frozen = index < tableSettings.preferences.frozenCount
        return <th key={key} data-field-key={key} aria-sort={tableSettings.preferences.sortKey === key ? tableSettings.preferences.sortDirection === 'asc' ? 'ascending' : 'descending' : undefined} className={frozen ? 'op-business-frozen-column' : ''} style={{ width: 160, left: frozen ? `${index * 160}px` : undefined }}><span>{candidateLabel(candidate, key)}<small>{key}</small></span></th>
      })}<th className="op-business-action-column">操作</th></tr></thead><tbody>{pageRows.length ? pageRows.map(row => <tr key={row.id}>{visibleColumns.map((key, index) => {
        const frozen = index < tableSettings.preferences.frozenCount
        return <td key={key} data-field-key={key} className={frozen ? 'op-business-frozen-column' : ''} style={{ width: 160, left: frozen ? `${index * 160}px` : undefined }} title={row.values[key] === undefined ? '本地合成样本没有提供此字段值' : undefined}>{toText(row.values[key])}</td>
      })}<td className="op-business-action-column"><button className="op-business-secondary op-row-detail-button" type="button" onClick={() => setSelectedId(row.id)}>查看明细</button></td></tr>) : <tr><td colSpan={visibleColumns.length + 1}>没有匹配的演示记录</td></tr>}</tbody></table></div>
      <div className="op-business-pagination"><span>第 {activePage} / {pages} 页</span><label>每页<select aria-label="每页行数" value={pageSize} onChange={event => { setPageSize(Number(event.currentTarget.value)); setPage(1); setSelectedId(null) }}><option value={2}>2</option><option value={4}>4</option></select></label><button className="op-business-secondary" type="button" disabled={activePage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><button className="op-business-secondary" type="button" disabled={activePage >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}>下一页</button></div>
      {selected && <aside className="op-business-detail" aria-label={`${candidate.name}演示明细`}><div className="op-business-section-title"><div><h3>演示明细</h3><p>仅显示当前报表的合成示例。</p></div><button className="op-business-secondary" type="button" onClick={() => setSelectedId(null)}>关闭</button></div><dl>{fixture.columns.map(key => <div key={key}><dt>{candidateLabel(candidate, key)}</dt><dd>{toText(selected.values[key])}</dd></div>)}</dl></aside>}
    </section> : <div className="op-business-prompt">选择条件后点击“查询”，再查看演示记录。</div>}
  </section>
}

function normalizeDemo(id: 'purchase-execution' | 'sales-execution', payload: unknown): DemoEnvelope {
  const spec = secondPhase[id]
  if (id === 'purchase-execution') {
    const parsed = parsePurchaseDemoMock(payload)
    return parsed as DemoEnvelope
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('invalid local demo envelope')
  const envelope = payload as Record<string, unknown>
  if (envelope.formId !== spec.formId || envelope.source !== 'local_demo_fixture_not_k3_tested' || envelope.status !== 'fixture' || envelope.liveCallsAllowed !== false || !Array.isArray(envelope.rows)) throw new TypeError('invalid local demo envelope')
  return envelope as unknown as DemoEnvelope
}

function SecondPhaseWorkbench({ id, candidate }: { id: 'purchase-execution' | 'sales-execution'; candidate?: Candidate }) {
  const spec = secondPhase[id]
  const [draft, setDraft] = useState<FilterState>({ party: '', bill: '', material: '', from: '', to: '' })
  const [applied, setApplied] = useState<FilterState | null>(null)
  const [data, setData] = useState<DemoEnvelope | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const tableSettings = useReportTablePreferences(candidate, spec.formId, [...spec.columns])
  const allRows = data?.rows || []
  const filtered = applied ? allRows.filter(row => {
    if (applied.party && String(row[spec.partyKey] ?? '') !== applied.party) return false
    if (applied.bill && String(row[spec.billKey] ?? '') !== applied.bill) return false
    if (applied.material && String(row[spec.materialKey] ?? '') !== applied.material) return false
    const date = String(row[spec.dateKey] ?? '')
    if (applied.from && date < applied.from) return false
    if (applied.to && date > applied.to) return false
    return true
  }) : []
  const sortedRows = sortReportRows(filtered, tableSettings.preferences.sortKey, tableSettings.preferences.sortDirection)
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const activePage = Math.min(page, pageCount)
  const pageRows = sortedRows.slice((activePage - 1) * pageSize, activePage * pageSize)
  async function runQuery() {
    setApplied({ ...draft }); setPage(1); setSelected(null); setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200' })
      const value = await apiJson<unknown>(`/api/operational-reports/${id}/demo?${params}`)
      setData(normalizeDemo(id, value))
    } catch {
      setData(null); setError('演示数据暂不可用，请检查本地 API。')
    } finally { setLoading(false) }
  }
  function clear() { setDraft({ party: '', bill: '', material: '', from: '', to: '' }); setApplied(null); setData(null); setPage(1); setSelected(null); setError('') }
  const columns = spec.columns
  const visibleColumns = tableSettings.visibleKeys
  const metricSummary = summarizeDemoRows(spec.formId, columns, filtered)
  return <section className="op-business-workbench" aria-label={`${spec.title}查询`}>
    <div className="op-business-condition" role="group" aria-label="查询条件">
      <div className="op-business-section-title"><div><h2>查询条件</h2><p>仅筛选本地合成记录；选择条件后点击查询。</p></div><span className="op-business-demo-badge">演示数据</span></div>
      <div className="op-business-query-grid">
        <label>开始日期<input aria-label="开始日期" type="date" value={draft.from} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, from: selected })) }}/></label>
        <label>结束日期<input aria-label="结束日期" type="date" value={draft.to} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, to: selected })) }}/></label>
        <label>{spec.partyLabel}<select aria-label={spec.partyLabel} value={draft.party} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, party: selected })) }}><option value="">全部</option>{spec.options.party.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>单据编号（演示）<select aria-label="单据编号（演示）" value={draft.bill} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, bill: selected })) }}><option value="">全部</option>{spec.options.bill.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>物料（演示）<select aria-label="物料（演示）" value={draft.material} onChange={event => { const selected = event.currentTarget.value; setDraft(value => ({ ...value, material: selected })) }}><option value="">全部</option>{spec.options.material.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <div className="op-business-actions"><button className="op-business-primary" type="button" onClick={() => void runQuery()} disabled={loading}>查询</button><button className="op-business-secondary" type="button" onClick={clear}>清除条件</button></div>
    </div>
    <ReportColumnSettings formId={spec.formId} title={spec.title} fields={tableSettings.fields} sampleKeys={[...spec.columns]} excludedKeys={tableSettings.excluded} preferences={tableSettings.preferences} onChange={tableSettings.update} onReset={tableSettings.reset}/>
    {error && <p className="op-business-error" role="alert">{error}</p>}
    {loading ? <div className="op-business-prompt">正在读取本地演示数据…</div> : applied && data ? <section className="op-business-results" aria-label="演示查询结果">
      <div className="op-business-section-title"><div><h2>结果</h2><p>共 {filtered.length} 条演示记录 · 非 K3 实测</p></div><span className="op-business-demo-badge">演示数据</span></div>
      <DemoMetricSummaryView summary={metricSummary}/>
      <div className="op-business-scroll-hint" role="note">可横向滚动查看宽报表；冻结 {tableSettings.preferences.frozenCount} 列。演示样本没有提供的候选字段值显示为“—”。</div>
      <div className="op-business-table-wrap"><table className="op-business-data-table" data-form-id={spec.formId}><thead><tr>{visibleColumns.map((key, index) => {
        const frozen = index < tableSettings.preferences.frozenCount
        return <th key={key} data-field-key={key} aria-sort={tableSettings.preferences.sortKey === key ? tableSettings.preferences.sortDirection === 'asc' ? 'ascending' : 'descending' : undefined} className={frozen ? 'op-business-frozen-column' : ''} style={{ width: 160, left: frozen ? `${index * 160}px` : undefined }}><span>{candidateLabel(candidate, key)}<small>{key}</small></span></th>
      })}<th className="op-business-action-column">操作</th></tr></thead><tbody>{pageRows.length ? pageRows.map((row, index) => <tr key={`${String(row[spec.billKey])}-${index}`}>{visibleColumns.map((key, columnIndex) => {
        const frozen = columnIndex < tableSettings.preferences.frozenCount
        return <td key={key} data-field-key={key} className={frozen ? 'op-business-frozen-column' : ''} style={{ width: 160, left: frozen ? `${columnIndex * 160}px` : undefined }} title={row[key] === undefined ? '本地合成样本没有提供此字段值' : undefined}>{toText(row[key])}</td>
      })}<td className="op-business-action-column"><button className="op-business-secondary op-row-detail-button" type="button" onClick={() => setSelected(row)}>查看明细</button></td></tr>) : <tr><td colSpan={visibleColumns.length + 1}>没有匹配的演示记录</td></tr>}</tbody></table></div>
      <div className="op-business-pagination"><span>第 {activePage} / {pageCount} 页</span><label>每页<select aria-label="每页行数" value={pageSize} onChange={event => { setPageSize(Number(event.currentTarget.value)); setPage(1); setSelected(null) }}><option value={1}>1</option><option value={2}>2</option></select></label><button className="op-business-secondary" type="button" disabled={activePage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><button className="op-business-secondary" type="button" disabled={activePage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>下一页</button></div>
      {selected && <aside className="op-business-detail" aria-label="演示单据明细"><div className="op-business-section-title"><div><h3>演示明细</h3><p>仅显示本地合成字段值。</p></div><button className="op-business-secondary" type="button" onClick={() => setSelected(null)}>关闭</button></div><dl>{columns.map(key => <div key={key}><dt>{candidateLabel(candidate, key)}</dt><dd>{toText(selected[key])}</dd></div>)}</dl></aside>}
    </section> : <div className="op-business-prompt">选择条件后点击“查询”，结果会先显示记录数，再显示明细行。</div>}
  </section>
}

function InventoryWorkbench({ report, onOpenDetail }: { report?: Report; onOpenDetail: (rowId: string) => void }) {
  const [warehouse, setWarehouse] = useState('')
  const [unit, setUnit] = useState('')
  const [applied, setApplied] = useState<{ warehouse: string; unit: string } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [queried, setQueried] = useState(false)
  const demoAvailable = report?.status === 'fixture'
  async function query() {
    if (!demoAvailable) return
    const filters = { warehouse, unit }
    setApplied(filters); setLoading(true); setQueried(true)
    try {
      const params = new URLSearchParams({ q: '', warehouse: filters.warehouse, unit: filters.unit })
      const result = await apiJson<{ rows?: Row[]; total?: number | null }>(`/api/operational-reports/instant-inventory?${params}`)
      setRows(result.rows || []); setTotal(result.total ?? result.rows?.length ?? 0)
    } catch { setRows([]); setTotal(0) }
    finally { setLoading(false) }
  }
  function clear() { setWarehouse(''); setUnit(''); setApplied(null); setRows([]); setTotal(0); setQueried(false) }
  const summary = useMemo(() => summarizeInventoryFixture(rows), [rows])
  const chart = useMemo(() => groupInventoryRows(rows), [rows])
  const inventoryMetricSummary: DemoMetricSummary = {
    rowCount: total,
    metrics: summary.quantitiesByUnit.map(value => ({ label: '现存数量', group: `单位：${value.unit}`, value: value.quantity })),
    note: !rows.length ? '没有匹配的演示记录，数量无可汇总值。' : !summary.quantitiesByUnit.length ? '演示库存缺少单位或数量，未汇总数量。' : '',
  }
  return <section className="op-business-workbench" aria-label="即时库存查询">
    <div className="op-business-condition" role="group" aria-label="查询条件">
      <div className="op-business-section-title"><div><h2>查询条件</h2><p>{demoAvailable ? '先选条件，再查询演示库存。' : '库存样例未准备，查询暂不可用。'}</p></div>{demoAvailable && <span className="op-business-demo-badge">演示数据</span>}</div>
      <div className="op-business-query-grid">
        <label>仓库{demoAvailable && <small>演示选项</small>}<select aria-label="仓库" disabled={!demoAvailable} value={warehouse} onChange={event => setWarehouse(event.currentTarget.value)}><option value="">全部</option>{demoAvailable && <><option value="演示仓A">演示仓A</option><option value="演示仓B">演示仓B</option></>}</select></label>
        <label>库存单位{demoAvailable && <small>演示选项</small>}<select aria-label="库存单位" disabled={!demoAvailable} value={unit} onChange={event => setUnit(event.currentTarget.value)}><option value="">全部</option>{demoAvailable && <><option value="件">件 · 演示</option><option value="套">套 · 演示</option><option value="箱">箱 · 演示</option></>}</select></label>
      </div>
      <div className="op-business-actions"><button className="op-business-primary" type="button" onClick={() => void query()} disabled={!demoAvailable || loading}>查询</button><button className="op-business-secondary" type="button" onClick={clear}>清除条件</button></div>
    </div>
    {!demoAvailable ? <div className="op-business-prompt">此页没有可展示的本地库存样例，未发出查询请求。</div> : !queried ? <div className="op-business-prompt">选择仓库或单位后点击“查询”，再查看记录总数和库存行。</div> : loading ? <div className="op-business-prompt">正在查询演示数据…</div> : <section className="op-business-results" aria-label="库存演示查询结果">
      <div className="op-business-section-title"><div><h2>结果</h2><p>共 {total} 条演示库存记录；按单位分别显示数量。</p></div><span className="op-business-demo-badge">演示数据</span></div>
      <DemoMetricSummaryView summary={inventoryMetricSummary}/>
      {chart.length > 0 && <div className="op-business-chart" aria-label="库存演示数量图表">{chart.map(item => <div key={`${item.materialNumber}-${item.unit}`}><span>{item.materialName}<small>{item.materialNumber} · {item.unit}</small></span><i><em style={{ width: `${inventoryBarPercent(item, chart)}%` }}/></i><b>{item.quantity} {item.unit}</b></div>)}</div>}
      <div className="op-business-table-wrap"><table><thead><tr><th>仓库</th><th>物料编码</th><th>物料名称</th><th>单位</th><th>数量</th><th>操作</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={row.id}><td>{toText(row.warehouse)}</td><td>{toText(row.materialNumber)}</td><td>{toText(row.materialName)}</td><td>{toText(row.unit)}</td><td>{toText(row.quantity)}</td><td><button className="op-business-secondary" type="button" onClick={() => onOpenDetail(row.id)}>查看明细</button></td></tr>) : <tr><td colSpan={6}>没有匹配的演示记录。</td></tr>}</tbody></table></div>
      <p className="op-business-footnote">{applied?.warehouse || applied?.unit ? '当前筛选仅作用于本地演示数据。' : '数量为本地演示值，不代表真实库存。'}</p>
    </section>}
  </section>
}

function TechnicalReportDetails({ report }: { report: Report }) {
  return <details className="op-business-tech"><summary>数据来源 / 技术详情</summary><div className="op-business-tech-body">
    <p>{report.description}</p>
    {report.interfaceLanes?.map(lane => <article key={lane.name}><h3>{lane.name}</h3><p><code>{lane.service || '服务未确认'}.{lane.method || '方法未确认'}</code> · FormId：<code>{lane.formId || '未知'}</code></p><p>{lane.provenance}</p><ul>{lane.limitations.map(item => <li key={item}>{item}</li>)}</ul></article>)}
    {report.sourceContracts?.map((source, index) => <article key={`${source.formId}-${index}`}><h3>{source.label || '数据来源候选'}</h3><p>FormId：<code>{source.formId || '未知'}</code> · 实体：<code>{source.entity || '未确认'}</code></p><p>FieldKeys：{source.fieldKeys.length ? source.fieldKeys.map(key => <code key={key}>{key} </code>) : '未确认'}</p><p>{source.evidence}</p><ul>{source.limitations.map(item => <li key={item}>{item}</li>)}</ul></article>)}
    {report.filterContracts?.length ? <article><h3>条件映射候选</h3>{report.filterContracts.map(item => <p key={item.name}>{item.name} → <code>{item.key || '未确认'}</code>；{item.evidence}</p>)}</article> : null}
    {report.metricSpecs?.length ? <article><h3>指标口径候选</h3>{report.metricSpecs.map(item => <p key={item.name}>{item.name}：{item.formula}（{item.unit}）；{item.requires.join('、')}</p>)}</article> : null}
    <p>未验证的接口、字段和筛选条件不会发送查询；本地页面不发起 K3 请求。</p>
  </div></details>
}

function CandidateTechnicalDirectory({ directory }: { directory: Directory | null }) {
  const candidates = directory?.metadataPreflight?.reportCandidates || []
  return <section className="op-business-tech-directory" aria-label="报表数据来源技术详情">
    <h2>数据来源与技术详情</h2><p>以下附件字段与只读观察仅供接线核对，默认收起；没有保存目标账套实测行值。</p>
    {candidates.map(candidate => <details className="op-business-tech" key={candidate.formId}><summary>{candidate.name}</summary><TechDetails candidate={candidate}/></details>)}
    <details className="op-business-tech"><summary>即时库存独立能力（目录外）</summary><div className="op-business-tech-body"><p>GetInventoryData 不属于 12 个 FormId 报表，当前未接线、不发起请求。</p>{directory?.metadataPreflight?.inventoryGetInventoryDataReadOnlyObservation && <p>只读结构 metadata：HTTP {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.httpStatus}；RowCount {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.rowCount}；对象数 {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.returnedObjectCount}；键数 {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.objectKeyCount}。无对象行值。</p>}</div></details>
  </section>
}

function Overview({ directory, onNavigate }: { directory: Directory | null; onNavigate: (page: string) => void }) {
  const candidates = directory?.metadataPreflight?.reportCandidates || []
  const reports = directory?.reports || []
  const statusFor = (item: (typeof reportGroups)[number]['items'][number]) => {
    const candidateId = 'candidateId' in item ? item.candidateId : undefined
    if (candidateId === 'ar-summary-placeholder') return '待定义；不显示数据。'
    const candidate = candidates.find(value => value.id === candidateId)
    if (candidate?.formId === 'AR_AgingAnalysis' || candidate?.formId === 'AP_AgingAnalysis') return '账龄参数尚待配置。'
    if (candidate) return candidate.localRowsAvailable ? '仅提供本地演示数据。' : '数据来源待配置；查询锁定。'
    const report = reports.find(value => value.id === item.page.replace('operational-', ''))
    if (item.page === 'operational-inventory') return report?.status === 'fixture' ? '仅提供本地演示数据。' : '库存样例未准备；查询暂不可用。'
    if (item.page === 'operational-aging') return '账龄参数尚待配置。'
    return '数据来源待接入；暂不可查询。'
  }
  return <div className="op-business-directory">
    {reportGroups.map(group => <section className="op-business-group" key={group.title} aria-label={`${group.title}报表`}>
      <h2>{group.title}</h2><div className="op-business-cards">{group.items.map(item => <button className="op-business-card" type="button" key={item.page} onClick={() => onNavigate(item.page)}>
        <strong>{item.name}</strong><span>{item.purpose}</span><small>{statusFor(item)}</small>
      </button>)}</div>
    </section>)}
  </div>
}

function AgingPlaceholder({ title }: { title: string }) {
  return <section className="op-business-workbench" aria-label={`${title}查询区`}><div className="op-business-condition"><div className="op-business-section-title"><div><h2>查询条件</h2><p className="op-business-aging-hint">账龄参数尚待配置</p></div><span className="op-business-status-badge">暂不可查询</span></div><div className="op-business-actions"><button className="op-business-primary" type="button" disabled>查询</button></div></div><div className="op-business-prompt">参数完成配置前不生成账龄数据或指标。</div></section>
}

export default function OperationalReportsBusiness({ pageId = 'operational-reports', onNavigate }: { pageId?: string; onNavigate?: (page: string) => void }) {
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [directoryError, setDirectoryError] = useState('')
  const [detail, setDetail] = useState<Row | null>(null)
  const [detailError, setDetailError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    apiJson<Directory>('/api/operational-reports', { signal: controller.signal }).then(setDirectory).catch(() => { if (!controller.signal.aborted) setDirectoryError('报表目录暂不可用。') })
    return () => controller.abort()
  }, [])
  const candidatePage = reportCandidateRouteForPage(pageId)
  const candidate = directory?.metadataPreflight?.reportCandidates?.find(item => item.id === candidatePage?.candidateId)
  const legacyRoute = operationalRoutes.find(item => item.page === pageId)
  const report = directory?.reports?.find(item => item.id === legacyRoute?.id)
  const candidateFixture = candidate && candidate.localRowsAvailable && fixtureFormIds.includes(candidate.formId) ? createCandidateReportFixture(candidate) : null
  const title = pageId === 'operational-reports' ? '报表总览' : pageId === 'operational-preflight' ? '数据来源说明' : candidatePage?.title || legacyRoute?.title || '报表'
  const sourceBadge = pageId === 'operational-reports' ? '12 项报表 + 库存' : candidatePage?.candidateId === 'ar-summary-placeholder' ? '待定义' : candidate?.formId === 'AR_AgingAnalysis' || candidate?.formId === 'AP_AgingAnalysis' || pageId === 'operational-aging' ? '参数待配置' : candidate?.formId === 'PUR_PurchaseOrderDetailRpt' || candidate?.formId === 'SAL_DetailReport' || candidateFixture || report?.status === 'fixture' ? '演示数据' : '数据源待接入'
  const navigate = onNavigate || (() => {})
  async function openInventoryDetail(rowId: string) {
    setDetail(null); setDetailError('')
    try { const result = await apiJson<{ row: Row }>(`/api/operational-reports/instant-inventory/rows/${encodeURIComponent(rowId)}`); setDetail(result.row) }
    catch { setDetailError('该演示明细暂不可用。') }
  }
  return <section className="op-report op-business-report">
    <header className="op-business-header"><div><span className="op-eyebrow">经营报表</span><h1>{title}</h1></div><span className={`op-business-status-badge ${sourceBadge === '演示数据' ? 'demo' : ''}`}>{sourceBadge}</span></header>
    <nav className="op-report-nav" aria-label="报表导航"><button type="button" className={pageId === 'operational-reports' ? 'selected' : ''} onClick={() => navigate('operational-reports')}>报表目录</button><button type="button" className={pageId === 'operational-preflight' ? 'selected' : ''} onClick={() => navigate('operational-preflight')}>数据来源说明</button></nav>
    {directoryError && <div className="op-business-error" role="alert">{directoryError}</div>}
    {pageId === 'operational-reports' && <Overview directory={directory} onNavigate={navigate}/>}
    {pageId === 'operational-preflight' && <CandidateTechnicalDirectory directory={directory}/>}
    {candidatePage && candidatePage.candidateId === 'ar-summary-placeholder' && <section className="op-business-workbench"><div className="op-business-condition"><div className="op-business-section-title"><div><h2>AR 汇总</h2><p>待定义 · 无 FormId</p></div></div></div><div className="op-business-prompt">数据来源和业务口径确认前，不显示查询条件、结果行或指标。</div></section>}
    {candidatePage && candidatePage.candidateId !== 'ar-summary-placeholder' && <>
      {candidate && candidate.formId === 'AR_AgingAnalysis' || candidate && candidate.formId === 'AP_AgingAnalysis' ? <AgingPlaceholder title={title}/> : null}
      {candidateFixture && candidate && (pageId === 'operational-candidate-sales-collect' || pageId === 'operational-candidate-ar-detail' || pageId === 'operational-candidate-ap-uninvoiced-detail' || pageId === 'operational-candidate-ap-detail' || pageId === 'operational-candidate-ap-summary') && <CandidateFixtureWorkbench key={candidate.formId} candidate={candidate} fixture={candidateFixture}/>}
      {!candidateFixture && candidate && candidate.formId !== 'AR_AgingAnalysis' && candidate.formId !== 'AP_AgingAnalysis' && candidate.formId !== 'PUR_PurchaseOrderDetailRpt' && candidate.formId !== 'SAL_DetailReport' && <section className="op-business-workbench"><div className="op-business-condition"><div className="op-business-section-title"><div><h2>查询条件</h2><p>当前没有可用的已验证筛选项。</p></div><span className="op-business-status-badge">查询锁定</span></div><div className="op-business-actions"><button className="op-business-primary" type="button" disabled>查询</button></div></div><div className="op-business-prompt">数据来源和筛选条件确认后再开放查询。</div></section>}
    </>}
    {legacyRoute?.id === 'purchase-execution' && <SecondPhaseWorkbench id="purchase-execution" candidate={candidate}/>}
    {legacyRoute?.id === 'sales-execution' && <SecondPhaseWorkbench id="sales-execution" candidate={candidate}/>}
    {legacyRoute?.id === 'instant-inventory' && <>
      <InventoryWorkbench report={report} onOpenDetail={rowId => void openInventoryDetail(rowId)}/>
      <details className="op-business-tech"><summary>数据来源 / 技术详情</summary><div className="op-business-tech-body"><p>库存结果只在本地演示 fixture 存在时显示；不会调用 GetInventoryData 或其他 K3 接口。</p><p>当前业务行数不作为目标账套实测指标。真实接口只读观察仅记录结构 metadata，不包含可展示行值。</p>{directory?.metadataPreflight?.inventoryGetInventoryDataReadOnlyObservation && <p>GetInventoryData 只读结构：RowCount {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.rowCount}，对象数 {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.returnedObjectCount}，对象键数 {directory.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation.objectKeyCount}。</p>}</div></details>
    </>}
    {legacyRoute && legacyRoute.id !== 'instant-inventory' && legacyRoute.id !== 'purchase-execution' && legacyRoute.id !== 'sales-execution' && <>
      {legacyRoute.id === 'inventory-aging' ? <AgingPlaceholder title={title}/> : <section className="op-business-workbench"><div className="op-business-condition"><div className="op-business-section-title"><div><h2>查询条件</h2><p>当前数据来源未接入，查询暂不可用。</p></div><span className="op-business-status-badge">暂不可查询</span></div><div className="op-business-actions"><button className="op-business-primary" type="button" disabled>查询</button></div></div><div className="op-business-prompt">报表来源确认后再展示对应条件与结果。</div></section>}
      {report && <TechnicalReportDetails report={report}/>}
    </>}
    {candidatePage && candidate && candidatePage.candidateId !== 'ar-summary-placeholder' && <TechDetails candidate={candidate}/>}
    {detail && <div className="op-scrim" onClick={() => setDetail(null)}><aside className="op-drawer" role="dialog" aria-modal="true" aria-label="库存演示明细" onClick={event => event.stopPropagation()}><button className="op-close" type="button" onClick={() => setDetail(null)}>关闭</button><span className="op-business-demo-badge">演示数据</span><h2>库存明细</h2>{[['仓库', detail.warehouse], ['物料编码', detail.materialNumber], ['物料名称', detail.materialName], ['单位', detail.unit], ['数量', detail.quantity]].map(([label, value]) => <div className="op-detail-field" key={String(label)}><b>{String(label)}</b><span>{toText(value)}</span></div>)}</aside></div>}
    {detailError && <p className="op-business-error" role="alert">{detailError}</p>}
  </section>
}
