import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from './api'
import { groupInventoryRows, inventoryBarPercent, operationalFieldLabel, operationalRoutes, operationalStatusLabel, reportCandidateLockedStatusLabel, reportCandidateEntryRoutes, reportCandidateRoutes, reportCandidateRouteForPage, reportCandidateRouteForFormId, reportCandidatePlaceholderRoute, specificationModelFilter, summarizeInventoryFixture } from './operational-report-model'
import { PURCHASE_ARRAY_FIELD_KEYS, parsePurchaseDemoMock } from './purchase-array-response'
import { createCandidateReportFixture, type CandidateFixture } from './candidate-report-fixtures'
import './operational-reports.css'

type FieldSpec = { name: string; label?: string; use?: string; status?: string; filterable?: boolean }
type Report = {
  id: string; name: string; description: string; status: string; fields: string[]
  filterSpecs: string[]; fieldSpecs: FieldSpec[]; chartPrerequisites: string[]
  sourceContracts?: { formId: string | null; entity: string | null; label?: string | null; fieldKeys: string[]; status: string; evidence: string; limitations: string[] }[]
  filterContracts?: { name: string; key: string | null; status: string; classification?: string; evidence: string }[]
  metricSpecs?: { name: string; formula: string; unit: string; chart: string; status: string; requires: string[] }[]
  interfaceLanes?: { name: string; service: string | null; method: string | null; formId: string | null; parameters: string[]; status: string; provenance: string; limitations: string[] }[]
  publicGuidanceNote?: string
  snapshotAt?: string | null; sourceLabel?: string
}
type Row = Record<string, unknown> & { id: string }
type CandidateReadOnlyObservation =
  | { kind: 'array_response'; rowCount: number; requestLimit: number; returnedPageRows?: number; arrayWidth: number; fieldKeyOrder?: string[]; httpStatus?: number; resultIsSuccess?: boolean; excludedRuntimeFieldKeys?: string[]; exclusionCode?: string; rowsPersisted: false; liveCallsAllowed: false; executionStatus: 'locked' }
  | { kind: 'parameter_parse_error'; errorClass: string; successfulResponseObserved: false; remainingEnumsUnknown: true; rowsPersisted: false; liveCallsAllowed: false; executionStatus: 'locked' }
type InventoryReadOnlyObservation = { kind: 'object_response'; method: string; catalogScope: string; httpStatus: number; resultIsSuccess: true; rowCount: number; requestedPageRows: number; returnedObjectCount: number; objectKeyCount: number; examplePredicateMatchCount: number; examplePredicateOnly: true; rowsPersisted: false; liveCallsAllowed: false; executionStatus: 'locked' }
type Preflight = {
  metadataConfirmed: boolean; confirmedFields: string[]; reason: string; source: string
  verificationMethod?: string; stockOrganizationBlocker?: string
  inventoryGetInventoryDataReadOnlyObservation?: InventoryReadOnlyObservation | null
  reportCandidates?: ReportCandidate[]
  arSummaryPlaceholder?: { id: string; name: string; status: string; formId: null; method: null; sourceAttachment: null; fieldCandidates: []; modelFieldKeys: []; blocker: string }
  instantInventoryCandidate?: { method: string; status: string; executionStatus: string; liveCallsAllowed: false; directoryScope: string; sourceAttachment: string | null; parameters: string[]; limitations: string[] }
}
type ReportCandidate = {
  id: string; name: string; formId: string; method: string; status: string; publicApiClassification: string; schemeId: null; selectedFieldKeys: null
  sourceAttachment: string | null; requestedAttachment: string | null; sourceAttachmentMatchesRequestedPath: boolean | null
  sourceReportedFormId: string | null; sourceMatchesRequestedFormId: boolean
  parameterFields: { label: string; key: string; requiredCandidate: boolean }[]; modelFieldKeys: string[]; modelNestedFieldPaths: string[]
  fieldCandidates: { label: string; key: string }[]; localRowsAvailable?: boolean
  targetAccountReadOnlyObservation?: CandidateReadOnlyObservation | null
  validation: { source: string; targetLedgerValidated: false; schemeIdValidated: false; fieldKeysSelected: false; requiredEnumsValidated: false; responseEnvelopeValidated: false; rowGrainValidated: false; liveCallAllowed: false }
  blockers: string[]
}
type Envelope = {
  reports?: Report[]; report?: Report; rows?: Row[]; total?: number | null
  metadataPreflight?: Preflight; unavailableReason?: string
}
type SecondPhaseReportId = 'purchase-execution' | 'sales-execution'
type SecondPhaseDemoEnvelope = {
  formId: string; source: 'local_demo_fixture_not_k3_tested'; label: string; status: 'fixture'; liveCallsAllowed: false
  page: number; pageSize: number; total: number; rows: Array<Record<string, unknown>>
}
const secondPhaseContracts = {
  'purchase-execution': {
    title: '采购订单执行明细', formId: 'PUR_PurchaseOrderDetailRpt', candidateFilterKeys: ['FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID'], enabledFilterKeys: ['FBillNo', 'FDate', 'FMATERIALID'], disabledFilterKey: 'FSUPPLIERID', disabledFilterLabel: '供应商',
    defaultColumns: [...PURCHASE_ARRAY_FIELD_KEYS],
    unitKey: 'FUnitId', currencyKey: 'FCurrencyId', quantityKeys: ['FOrderQty', 'FReceiveQty', 'FImportQty', 'FReturnQty'], amountKeys: ['FOrderAmount', 'FReceiveAmount', 'FImportAmount', 'FPAYAMOUNT'],
  },
  'sales-execution': {
    title: '销售执行明细', formId: 'SAL_DetailReport', candidateFilterKeys: ['FBILLNO', 'FDate', 'FCUSTID', 'FMATERIALID'], enabledFilterKeys: ['FBILLNO', 'FDate', 'FMATERIALID'], disabledFilterKey: 'FCUSTID', disabledFilterLabel: '客户',
    defaultColumns: ['FBILLNO', 'FDate', 'FCUSTID', 'FMATERIALID', 'FSPECIFICATION', 'FORDERQTY', 'FDELIQTY', 'FOUTQTY'],
    unitKey: 'FUNIT', currencyKey: 'FCURRENCYID', quantityKeys: ['FORDERQTY', 'FDELIQTY', 'FOUTQTY', 'FRETURNQTY'], amountKeys: ['FORDERAMOUNT', 'FDELIAMOUNT', 'FOUTAMOUNT', 'FRECAMOUNT'],
  },
} as const
const isSecondPhaseReport = (id: string | undefined): id is SecondPhaseReportId => id === 'purchase-execution' || id === 'sales-execution'
function normalizeSecondPhaseDemo(reportId: SecondPhaseReportId, payload: unknown): SecondPhaseDemoEnvelope {
  if (reportId === 'purchase-execution') return parsePurchaseDemoMock(payload)
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('Sales demo response must be a local fixture envelope')
  const envelope = payload as Record<string, unknown>
  if (envelope.formId !== 'SAL_DetailReport' || envelope.source !== 'local_demo_fixture_not_k3_tested' || envelope.status !== 'fixture' || envelope.liveCallsAllowed !== false || !Array.isArray(envelope.rows)) {
    throw new TypeError('Sales demo response must remain a local fixture envelope')
  }
  return envelope as unknown as SecondPhaseDemoEnvelope
}
const columns = [['warehouse', '仓库'], ['materialNumber', '物料编码'], ['materialName', '物料名称'], ['unit', '库存单位'], ['quantity', '现存数量']] as const
const text = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value)
const candidateFieldLabel = (candidate: ReportCandidate | undefined, key: string) => candidate?.fieldCandidates.find(field => field.key === key)?.label || key
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
function groupRawFixtureValues(rows: Array<Record<string, unknown>>, groupKey: string, valueKeys: readonly string[]) {
  const groups = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const group = String(row[groupKey] ?? '').trim()
    if (!group) continue
    const sums = groups.get(group) || Object.fromEntries(valueKeys.map(key => [key, 0]))
    for (const key of valueKeys) if (typeof row[key] === 'number' && Number.isFinite(row[key])) sums[key] = (sums[key] || 0) + Number(row[key])
    groups.set(group, sums)
  }
  return [...groups].map(([group, values]) => ({ group, values }))
}

function CandidateReadOnlyObservationNote({ observation }: { observation?: CandidateReadOnlyObservation | null }) {
  if (!observation) return null
  return <article className="op-contract op-readonly-observation" aria-label="目标账套只读观察（不含业务行）">
    <h3>目标账套只读结构观察（无行值）</h3>
    {observation.kind === 'array_response' ? <>
      <p>观察到 RowCount={observation.rowCount}；请求 Limit={observation.requestLimit}；Rows 为数组，每行宽度 {observation.arrayWidth}。本候选仅保留结构 metadata，不保存或渲染任何行值；此观察不解锁实时请求。</p>
      {observation.returnedPageRows !== undefined && <p>该次只读页返回 {observation.returnedPageRows} 行；HTTP {observation.httpStatus}；Result.IsSuccess={String(observation.resultIsSuccess)}。</p>}
      {observation.fieldKeyOrder && <p>采购数组映射依附件/响应 FieldKeys 顺序：{observation.fieldKeyOrder.map(key => <code key={key}>{key} </code>)}</p>}
      {!!observation.excludedRuntimeFieldKeys?.length && <p className="op-source-conflict">目标账套行字段排除：{observation.excludedRuntimeFieldKeys.map(key => <code key={key}>{key} </code>)}；实测返回 {observation.exclusionCode}。这只影响目标账套运行列，不改写附件原始 FieldKeys 候选；其他候选字段不据此推断无效。</p>}
    </> : <p className="op-blocker">只读参数尝试仍在解析阶段失败；未观察到成功响应或行数据。剩余枚举未知、不猜测；状态继续锁定。</p>}
  </article>
}

function InventoryResponseObservationNote({ observation }: { observation?: InventoryReadOnlyObservation | null }) {
  if (!observation) return null
  return <aside className="op-preflight-note" aria-label="GetInventoryData 只读结构观察（目录外、仍锁定）">
    <b>GetInventoryData 独立只读响应结构（不含行值）</b>
    <p>HTTP {observation.httpStatus}；Result.IsSuccess=true；RowCount={observation.rowCount}。请求页行数 {observation.requestedPageRows}，返回 {observation.returnedObjectCount} 个对象，每个对象 {observation.objectKeyCount} 个键；指定示例筛选命中 {observation.examplePredicateMatchCount} 行。</p>
    <p>仅记录响应结构和数量，不保存或渲染对象内容；这是目录外的接口观察，不是 fixture，也不授权新的 live 请求。</p>
  </aside>
}

function CandidateEvidenceStatusStrip({ candidate }: { candidate?: ReportCandidate }) {
  const observation = candidate?.targetAccountReadOnlyObservation
  const interfaceStatus = observation?.kind === 'array_response'
    ? `接口已实测 · 只读结构 RowCount ${observation.rowCount} / 数组宽度 ${observation.arrayWidth}`
    : observation?.kind === 'parameter_parse_error' ? '只读尝试已实测 · 参数解析失败' : '接口未实测 · live call 锁定'
  return <div className="op-evidence-status" aria-label="接口实测与当前页面数据来源区分">
    <article className={observation?.kind === 'array_response' ? 'observed' : observation?.kind === 'parameter_parse_error' ? 'blocked' : 'unverified'}>
      <b>接口 / 目标账套状态</b><strong>{interfaceStatus}</strong>
      <p>{observation?.kind === 'array_response' ? '只记录响应结构和数量；不保存或显示实测行，亦不开放实时查询。' : observation?.kind === 'parameter_parse_error' ? '未获得成功响应；不猜参数枚举、不开放查询。' : '没有可用的只读结构观察；live 查询保持锁定。'}</p>
    </article>
    <article className={candidate?.localRowsAvailable ? 'fixture' : 'locked'}>
      <b>当前页面行数据</b><strong>{candidate?.localRowsAvailable ? '本地 synthetic fixture · 非 K3' : '无业务行 · 锁定空结果'}</strong>
      <p>{candidate?.localRowsAvailable ? '仅用于筛选、分页、表格和明细交互；与接口只读观察分开，不是实测行，也不写入真实行。' : '本候选不提供演示行；附件 FieldKeys 未选定，查询、翻页与行明细不可用。'}</p>
    </article>
  </div>
}

function CandidateLockedWorkbench({ candidate }: { candidate: ReportCandidate }) {
  const observation = candidate.targetAccountReadOnlyObservation
  const responseNote = observation?.kind === 'array_response'
    ? `只读观察 RowCount=${observation.rowCount}，每行数组宽度 ${observation.arrayWidth}；不导入响应行。`
    : observation?.kind === 'parameter_parse_error' ? '只读参数尝试在解析阶段失败，没有成功响应或行数。' : '历史观察已移除；接口未验证，查询保持锁定。'
  return <section className="op-locked-workbench" aria-label={`${candidate.name}锁定结果工作区`}>
    <div className="op-locked-workbench-heading"><div><b>独立结果工作区</b><span>输入来自本项附件 Model；输出候选来自本项 FieldKeys。</span></div><span className="op-pending">查询 / 分页 / 明细均锁定</span></div>
    <div className="op-table-wrap"><table><caption>{candidate.name} · 锁定空结果；附件 FieldKeys 尚未选定</caption><thead><tr><th>结果状态</th></tr></thead><tbody><tr className="op-empty-state-row" aria-label="空状态说明，非业务数据"><td>当前显示 0 行。{responseNote}真实响应行不持久化、不渲染，且不以本地 fixture 代替。</td></tr></tbody></table></div>
    <div className="op-locked-workbench-controls"><button className="op-action" type="button" disabled>查询（未验证）</button><button className="op-action" type="button" disabled>上一页</button><span>0 行 · 第 0 页 · live call 锁定</span><button className="op-action" type="button" disabled>下一页</button><button className="op-action" type="button" disabled>查看行明细</button></div>
  </section>
}

function CandidateFixtureWorkbench({ candidate, fixture }: { candidate: ReportCandidate; fixture: CandidateFixture }) {
  const [filterValue, setFilterValue] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(fixture.pageSize)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filteredRows = useMemo(() => {
    const query = filterValue.trim().toLocaleLowerCase()
    if (!query) return fixture.rows
    return fixture.rows.filter(row => fixture.filter.outputKeys.some(key => String(row.values[key] ?? '').toLocaleLowerCase().includes(query)))
  }, [fixture, filterValue])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const activePage = Math.min(page, pageCount)
  const pageRows = filteredRows.slice((activePage - 1) * pageSize, activePage * pageSize)
  const selectedRow = fixture.rows.find(row => row.id === selectedId)
  const firstDisplayed = filteredRows.length ? (activePage - 1) * pageSize + 1 : 0
  const lastDisplayed = Math.min(activePage * pageSize, filteredRows.length)
  return <section className="op-fixture-workbench" aria-label={`${candidate.name}本地合成 fixture 工作区`} data-form-id={fixture.formId}>
    <div className="op-fixture-workbench-heading"><div><b>{fixture.label}</b><strong>独立于接口观察 · {candidate.formId}</strong></div><span className="op-fixture-lock">只在本页内存 · live call 锁定</span></div>
    <p className="op-fixture-boundary">下面的 4 行均为本报表专属合成示例，不来自任何 K3 响应，不复用其他 FormId 的行或汇总；不计算 KPI、不向接口发送筛选值。展示列仅从本项附件 FieldKeys 候选中选取，附件 SchemeId / 请求 FieldKeys 仍未选定。</p>
    <div className="op-fixture-filters">
      <label>本地筛选 · {fixture.filter.label}<small>附件 Model 输入候选：<code>{fixture.filter.modelPath}</code>（仅在本地匹配，不发送）</small>
        <input className="op-fixture-filter" type="search" value={filterValue} data-model-path={fixture.filter.modelPath} aria-label={`本地 fixture 筛选 ${fixture.filter.modelPath}`} placeholder="输入合成往来单位/客户关键字" onChange={event => { setFilterValue(event.currentTarget.value); setPage(1); setSelectedId(null) }}/>
      </label>
      <button className="op-action" type="button" onClick={() => { setFilterValue(''); setPage(1); setSelectedId(null) }}>清空本地筛选</button>
    </div>
    <div className="op-table-wrap op-fixture-table-wrap"><table className="op-fixture-table">
      <caption>{candidate.name} · {fixture.label} · 非实测行</caption>
      <thead><tr>{fixture.columns.map(key => <th key={key}><span>{candidateFieldLabel(candidate, key)}</span><small><code>{key}</code></small></th>)}<th>本地交互</th></tr></thead>
      <tbody>{pageRows.length ? pageRows.map(row => <tr key={row.id} data-fixture-id={row.id} data-fixture-filter-token={fixture.filter.outputKeys.map(key => String(row.values[key] ?? '')).join(' ')}>
        {fixture.columns.map(key => <td key={key} data-field-key={key}>{text(row.values[key])}</td>)}
        <td><button className="op-action op-row-detail-button" type="button" aria-label={`查看本地 fixture 明细 ${row.id}`} onClick={() => setSelectedId(row.id)}>查看明细</button></td>
      </tr>) : <tr aria-label="本地筛选无匹配 fixture 行"><td colSpan={fixture.columns.length + 1}>本地筛选无匹配的合成 fixture 行；没有执行查询。</td></tr>}</tbody>
    </table></div>
    <div className="op-fixture-pagination" aria-label="本地 fixture 分页">
      <label>每页行数<select aria-label="本地 fixture 每页行数" value={pageSize} onChange={event => { setPageSize(Number(event.currentTarget.value)); setPage(1); setSelectedId(null) }}><option value={2}>2</option><option value={4}>4</option></select></label>
      <span role="status" aria-live="polite">本地合成行 {firstDisplayed}–{lastDisplayed} / {filteredRows.length} · 第 {activePage} / {pageCount} 页</span>
      <button className="op-action" type="button" aria-label="上一页（本地 fixture）" disabled={activePage <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</button>
      <button className="op-action" type="button" aria-label="下一页（本地 fixture）" disabled={activePage >= pageCount} onClick={() => setPage(current => Math.min(pageCount, current + 1))}>下一页</button>
    </div>
    {selectedRow && <aside className="op-fixture-detail" role="region" aria-label={`${candidate.name}本地合成 fixture 明细`}>
      <div className="op-fixture-detail-heading"><div><b>本地合成 fixture 明细 · 非实测行</b><code>{fixture.formId}</code></div><button className="op-action" type="button" aria-label="关闭本地 fixture 明细" onClick={() => setSelectedId(null)}>关闭明细</button></div>
      <dl>{fixture.columns.map(key => <div key={key}><dt><span>{candidateFieldLabel(candidate, key)}</span><code>{key}</code></dt><dd>{text(selectedRow.values[key])}</dd></div>)}</dl>
      <p>详情只读取当前报表的本地合成行；不会调用 API，不等于实测业务行。</p>
    </aside>}
  </section>
}

export function ReportPreparation({ report }: { report: Report }) {
  return <section className="op-contracts" aria-label={`${report.name}来源与指标预检`}>
    {report.interfaceLanes && <>
      <h3>接口通道分开核验</h3>
      <p>{report.publicGuidanceNote || '公开文档 / 用户契约仅作接线指导，不代表当前部署和目标账套验证。'}</p>
      <div className="op-contract-grid">{report.interfaceLanes.map(lane => <article className="op-contract" key={lane.name}>
        <b>{lane.name}</b><span className="op-pending">文档 / 契约指导 · 部署未验证</span>
        <dl><div><dt>服务 / 方法</dt><dd><code>{lane.service || 'API 类型未知'}{lane.method ? `.${lane.method}` : ''}</code></dd></div>
          <div><dt>报表 FormId</dt><dd><code>{lane.formId || '未确认，不能套用其他报表标识'}</code></dd></div>
          <div><dt>参数 / 方案约束</dt><dd>{lane.parameters.length ? lane.parameters.join('；') : '精确参数未确认'}</dd></div></dl>
        <p>来源边界：{lane.provenance}</p><ul>{lane.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </article>)}</div>
    </>}
    <h3>来源身份与精确字段 Key</h3>
    <p>下列代码 / 历史目录候选不是当前账套元数据认证；一次库存实采只在上方独立证据范围内成立。</p>
    <div className="op-contract-grid">{report.sourceContracts?.map((source, index) => <article className="op-contract" key={`${source.formId}-${index}`}>
      <span className="op-pending">当前运行范围待核验</span>
      {source.label && <b>{source.label}</b>}
      <dl><div><dt>FormId</dt><dd><code>{source.formId || '未知 / 缺少来源'}</code></dd></div>
        <div><dt>精确实体 Key</dt><dd><code>{source.entity || '未知，不能用单据名称代替'}</code></dd></div>
        <div><dt>已有字段 Key</dt><dd><code>{source.fieldKeys.length ? source.fieldKeys.join(', ') : '无可确认的精确 Key；业务字段仍为候选'}</code></dd></div></dl>
      <p>{source.evidence}</p><ul>{source.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </article>)}</div>
    <h3>筛选条件与字段映射</h3>
    <p>候选条件不会发送到 K3；本地示例的搜索、仓库和单位筛选只处理本地行。</p>
    <div className="op-contract-grid">{report.filterContracts?.map(filter => <article className="op-contract" key={filter.name}>
      <b>{operationalFieldLabel[filter.name] || filter.name}</b>
      <span className="op-pending">{filter.classification === 'ui_only_local' ? '仅本地界面筛选' : filter.classification === 'code_contract_candidate' ? '代码 / 历史请求候选，非当前范围认证' : 'K3 候选，未确认'}</span>
      <span className="op-contract-key">候选 Key：<code>{filter.key || (filter.classification === 'ui_only_local' ? '不适用' : '未确认')}</code></span>
      <p>{filter.evidence}</p>
    </article>)}<article className="op-contract op-specification-contract">
      <b>{specificationModelFilter.label}</b><span className="op-pending">待接线 · 不可查询</span>
      <span className="op-contract-key">精确 FieldKey：未确认</span>
      <p>候选来源：{specificationModelFilter.candidateSource}</p><p>{specificationModelFilter.reason}</p>
    </article></div>
    <h3>图表、公式与量纲</h3>
    <p>图表是基于已验证业务行的展示建议，不是 API 承诺返回的字段；当前不出具真实指标。</p>
    <div className="op-contract-grid">{report.metricSpecs?.map(metric => <article className="op-contract" key={metric.name}>
      <b>{metric.name}</b><span className="op-badge">{metric.status === 'needs_real_data' ? '需真实数据，暂不出值' : '缺少来源，暂不支持出值'}</span>
      <dl><div><dt>公式 / 口径候选</dt><dd>{metric.formula}</dd></div><div><dt>单位</dt><dd>{metric.unit}</dd></div><div><dt>展示</dt><dd>{metric.chart}</dd></div></dl>
      <p>出值前提：{metric.requires.join('；')}</p>
    </article>)}</div>
  </section>
}

export function UserReportCandidates({ preflight, onNavigate }: { preflight: Preflight; onNavigate?: (page: string) => void }) {
  const candidates = preflight.reportCandidates || []
  const inventory = preflight.instantInventoryCandidate
  return <section className="op-contracts" aria-label="用户提供的 K3 报表候选目录">
    <h2>12 项 FormId 报表候选目录</h2>
    <p>每项独立展示指定附件的 Model 筛选字段、FieldKeys 显示范围、方法、验证状态与阻塞。全部只作附件候选；不代表目标账套存在/验证。只有明确标记的七项销售汇总及 AR/AP 页面显示本报表独立的本地合成 fixture / 非实测行，用来验证筛选、分页、表格和详情；不复用其他报表、不计算 KPI。所有 live call 仍锁定。</p>
    <div className="op-candidate-grid">{candidates.map(candidate => {
      const route = reportCandidateEntryRoutes.find(item => item.candidateId === candidate.id)
      return <article className="op-contract op-candidate-card" key={candidate.formId}>
        <b>{candidate.name}</b><span className="op-pending">{reportCandidateLockedStatusLabel}</span>
        <dl><div><dt>FormId</dt><dd><code>{candidate.formId}</code></dd></div>
          <div><dt>方法 / 验证</dt><dd><code>{candidate.method}</code> · 目标账套未验证</dd></div>
          <div><dt>附件字段范围</dt><dd>{candidate.fieldCandidates.length} 个 FieldKeys 候选；{candidate.modelFieldKeys.length} 个 Model 字段候选</dd></div>
          <div><dt>当前页面数据</dt><dd>{candidate.localRowsAvailable ? '本地合成 fixture / 非实测行' : '无 fixture · live call 锁定'}</dd></div></dl>
        {candidate.targetAccountReadOnlyObservation?.kind === 'array_response' && <p>只读结构观察：RowCount {candidate.targetAccountReadOnlyObservation.rowCount} · Limit {candidate.targetAccountReadOnlyObservation.requestLimit} · 数组宽度 {candidate.targetAccountReadOnlyObservation.arrayWidth}；不含行值，仍锁定。</p>}
        {candidate.targetAccountReadOnlyObservation?.kind === 'parameter_parse_error' && <p className="op-blocker">只读参数解析失败；无成功响应，仍锁定且不猜剩余枚举。</p>}
        {candidate.sourceAttachment && candidate.sourceMatchesRequestedFormId ? <p>字段来源附件标识：<code>{candidate.sourceAttachment}</code>；候选未验证。</p> : <p>来源附件标识已移除；字段仅为未验证候选。</p>}
        {candidate.requestedAttachment && !candidate.sourceAttachmentMatchesRequestedPath && <p className="op-attachment-path-warning">原始附件路径与字段来源不一致；源路径和附件标识已移除，字段仍未验证。</p>}
        <button className="op-action" type="button" onClick={() => route && onNavigate?.(route.page)}>查看本项字段与阻塞 →</button>
      </article>
    })}</div>
    <article className="op-contract op-placeholder-card"><b>AR汇总待定义</b><span className="op-pending">待定义 · 无 FormId</span><p>不猜测 FormId、字段或接口；不显示行数据 / KPI。</p><button className="op-action" type="button" onClick={() => onNavigate?.(reportCandidatePlaceholderRoute.page)}>查看占位状态 →</button></article>
    <aside className="op-preflight-note"><b>报表接口发现能力阻塞</b>
      <p>当前 <code>/api/k3cloud/metadata/discover</code> 调用 <code>DynamicFormService.QueryBusinessInfo</code> 并按动态表单元数据解析；它不能发现 <code>GetSysReportData</code> 的报表方案字段。项目目前没有 <code>GetSysReportData</code>、<code>StockReportQueryService.GetReportData</code> 或报表方案/选中 FieldKeys 发现实现。</p>
      <p>此前出现的“元数据响应中没有可用字段”是 PLM 适配层的解析错误，不证明 K3Cloud 返回 HTTP 502，也不证明 FormId 无效。此处只整理候选；不发起查询、不改 allowlist、不解锁业务读取。</p>
    </aside>
    {inventory && <article className="op-contract">
      <b>目录外独立能力：即时库存 GetInventoryData</b><span className="op-pending">独立接口候选 · 当前未接线/未启用</span>
      <p><code>{inventory.method}</code></p>
      <p>历史附件标识与筛选值已移除。参数名称仅作候选：<code>{inventory.parameters.map(item => item.split('=')[0]).join('；')}</code>；当前没有可用的实测响应。</p>
      <ul>{inventory.limitations.map(item => <li key={item}>{item}</li>)}</ul>
    </article>}
    <InventoryResponseObservationNote observation={preflight.inventoryGetInventoryDataReadOnlyObservation}/>
    <p>目录边界：<code>GetInventoryData</code> 独立于以上 12 项；<code>STK_Inventory</code>、收发存、库存账龄、<code>BD_STOCK</code> 仓库选择均不挂入上述 FormId。AR 与 AP 账龄分别保留为独立候选。</p>
  </section>
}

const fixedInventorySample = [
  ['库存组织代码', 'fstockorgnumbers'], ['仓库编码', 'fstocknumbers'],
  ['物料编码', 'fmaterialnumbers'], ['显示辅助属性', 'isshowauxprop'],
  ['显示仓位', 'isshowstockloc'], ['页码', 'pageindex'], ['每页行数', 'pagerows'],
] as const

export function InventoryFixedSampleAction({ observation }: { observation?: InventoryReadOnlyObservation | null }) {
  return <section className="op-fixed-sample" aria-label="GetInventoryData 只读契约状态">
    <div className="op-fixed-heading"><div><span className="op-eyebrow">INDEPENDENT QUERY CAPABILITY</span><h3>即时库存 GetInventoryData</h3></div><span className="op-pending">本候选中未接线 · 未启用</span></div>
    <p>这是目录外独立库存查询能力，不属于 FormId 报表。本页只展示本地 fixture；action 默认关闭，历史观察已移除，不发起真实 K3 请求。参数名仅为候选。</p>
    <div className="op-evidence-status" aria-label="GetInventoryData 接口观察与库存本地演示数据来源区分">
      <article className="unverified"><b>接口 / GetInventoryData</b><strong>{observation ? '只读观察 · 调用仍锁定' : '未验证 · 调用锁定'}</strong><p>{observation ? `HTTP ${observation.httpStatus}；RowCount ${observation.rowCount}；对象键数 ${observation.objectKeyCount}。` : '历史观察已移除；当前没有可显示的接口结构验证。'}</p></article>
      <article className="fixture"><b>本页库存行 / 图表</b><strong>本地 synthetic fixture · 非 GetInventoryData</strong><p>若页面显示库存表格/图表，只是本地样例，绝不代表实测接口返回；真实行值未持久化或展示。</p></article>
    </div>
    <dl className="op-fixed-grid">{fixedInventorySample.map(([label, key]) => <div key={key}><dt>{label}<small><code>{key}</code></small></dt><dd>值不在页面展示</dd></div>)}</dl>
    <InventoryResponseObservationNote observation={observation}/>
    <p className="op-blocker">方法候选：<code>/k3cloud/Kingdee.K3.SCM.WebApi.ServicesStub.InventoryQueryService.GetInventoryData</code>。只读结构观察不构成组织绑定或调用授权；不与 <code>BD_STOCK</code> 仓库选择混用。</p>
  </section>
}

export function SecondPhaseDemoPanel({ reportId, candidate }: { reportId: SecondPhaseReportId; candidate?: ReportCandidate }) {
  const contract = secondPhaseContracts[reportId]
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1), [pageSizeText, setPageSizeText] = useState('50')
  const [result, setResult] = useState<SecondPhaseDemoEnvelope | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [selectedColumns, setSelectedColumns] = useState<string[]>([...contract.defaultColumns])
  const [tab, setTab] = useState<'data' | 'metrics'>('data')
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setFilters({}); setPage(1); setPageSizeText('50'); setSelectedColumns([...contract.defaultColumns]); setTab('data'); setDetailRow(null); setLoading(true); setError('')
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    apiJson<unknown>(`/api/operational-reports/${reportId}/demo?${params}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(normalizeSecondPhaseDemo(reportId, value)) })
      .catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : '演示数据读取失败') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reportId, contract])

  async function runDemo(nextPage: number, values: Record<string, string> = filters, pageSize = Number(pageSizeText)) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) { setError('本地演示分页大小必须为 1–200。'); return }
    setLoading(true); setError('')
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) })
    for (const key of contract.enabledFilterKeys) if (values[key]?.trim()) params.set(key, values[key]!.trim())
    try {
      const value = await apiJson<unknown>(`/api/operational-reports/${reportId}/demo?${params}`)
      setResult(normalizeSecondPhaseDemo(reportId, value)); setPage(nextPage); setPageSizeText(String(pageSize))
    } catch (value) { setError(value instanceof Error ? value.message : '演示数据读取失败') }
    finally { setLoading(false) }
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1
  const currentRows = result?.rows || []
  const quantityRows = groupRawFixtureValues(currentRows, contract.unitKey, contract.quantityKeys)
  const amountRows = groupRawFixtureValues(currentRows, contract.currencyKey, contract.amountKeys)
  function exportLocalSnapshot() {
    if (!result || loading || !currentRows.length) return
    const csv = [selectedColumns.map(csvCell).join(','), ...currentRows.map(row => selectedColumns.map(key => csvCell(row[key])).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${contract.formId}-local-fixture-page-${page}.csv`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="op-second-phase-demo" aria-label={`${contract.title}本地演示查询`}>
    <div className="op-fixture-note"><b>本地演示 fixture · 非 K3 输出</b><span>报表候选：<code>{contract.formId}</code>；响应来源固定为 <code>local_demo_fixture_not_k3_tested</code>、<code>liveCallsAllowed=false</code>。{reportId === 'purchase-execution' ? <>采购本地 mock 用六个结构字段按 FieldKeys 顺序映射数组行；值均为本地 synthetic fixture，不是实测行值。</> : null}附件候选的 SchemeId / FieldKeys 仍未选择；必填枚举与行粒度未验证；live call 锁定。</span></div>
    <p className="op-demo-source-boundary">本页的本地筛选白名单是独立界面候选参数，不是附件 Model 输入字段映射；附件完整 Model 字段在上方“附件字段范围、来源与验证阻塞”中单独列示。列选择只改变本地显示列，不参与筛选。</p>
    <div className="op-demo-tabs" role="tablist" aria-label={`${contract.title}演示视图`}><button role="tab" aria-selected={tab === 'data'} className={tab === 'data' ? 'selected' : ''} onClick={() => setTab('data')}>数据</button><button role="tab" aria-selected={tab === 'metrics'} className={tab === 'metrics' ? 'selected' : ''} onClick={() => setTab('metrics')}>指标（原始字段）</button></div>
    {tab === 'data' ? <>
      <form className="op-demo-filters" onSubmit={event => { event.preventDefault(); void runDemo(1) }}>
        {contract.enabledFilterKeys.map(key => <label key={key}>{candidateFieldLabel(candidate, key)}<small><code>{key}</code> · 界面候选参数 · 未验证 · 仅本地 fixture</small><input aria-label={`${candidateFieldLabel(candidate, key)}筛选`} type={key === 'FDate' ? 'date' : 'text'} value={filters[key] || ''} onChange={event => setFilters(previous => ({ ...previous, [key]: event.target.value }))}/></label>)}
        <label className="op-disabled-field">{contract.disabledFilterLabel}筛选<small><code>{contract.disabledFilterKey}</code> · 候选参数 · 未验证 · 已禁用</small><input aria-label={`${contract.disabledFilterLabel}筛选（已禁用）`} value="" disabled placeholder="暂不可筛选"/></label>
        <label className="op-disabled-field">规格/型号筛选<small>字段来源未验证 · 禁用</small><input aria-label="规格/型号筛选" value="" disabled placeholder="不发送筛选参数"/></label>
        <label>本地每页行数<small>仅 fixture；最大 200</small><input aria-label="本地每页行数" type="number" min={1} max={200} step={1} value={pageSizeText} onChange={event => setPageSizeText(event.target.value)}/></label>
        <div className="op-demo-actions"><button className="op-action" type="submit" disabled={loading}>查询本地演示记录</button><button className="op-action" type="button" disabled={loading} onClick={() => { const defaults = {}; setFilters(defaults); setPageSizeText('50'); void runDemo(1, defaults, 50) }}>清空筛选</button></div>
      </form>
      <label className="op-column-picker">选择显示列 <small>只改变本地表格显示；不改变请求参数、FormId、FieldKeys 或查询行为。</small><select aria-label="选择显示列" multiple size={4} value={selectedColumns} onChange={event => setSelectedColumns(Array.from(event.currentTarget.selectedOptions, option => option.value))}>{(candidate?.fieldCandidates || []).map(field => <option key={field.key} value={field.key}>{field.label} · {field.key}（未验证候选）</option>)}</select></label>
      {error && <div className="op-alert" role="alert">{error}</div>}
      <div className="op-table-wrap" aria-live="polite">{loading ? <div className="op-empty">正在读取本地演示 fixture…</div> : currentRows.length ? <table>
        <caption>{contract.title} · {result?.label} · 字段来源均为未验证附件候选；本地 fixture，不是 K3 输出</caption><thead><tr>{selectedColumns.map(key => <th key={key}>{candidateFieldLabel(candidate, key)}<small>{key} · 未验证候选</small></th>)}<th scope="col">操作</th></tr></thead>
        <tbody>{currentRows.map((row, index) => <tr key={`${String(row[contract.enabledFilterKeys[0]!])}-${index}`}>{selectedColumns.map(key => <td key={key}>{text(row[key])}</td>)}<td><button className="op-action op-row-detail-button" type="button" aria-label={`查看${text(row[contract.enabledFilterKeys[0]!])}本地演示明细`} onClick={() => setDetailRow(row)}>查看明细</button></td></tr>)}</tbody>
      </table> : <div className="op-empty"><b>{result?.total === 0 ? '没有匹配的演示记录' : '尚无演示记录'}</b><span>空结果只代表本地 fixture 匹配情况，不代表 K3 结果。</span></div>}</div>
      <div className="op-demo-export"><button className="op-action" type="button" disabled={loading || !currentRows.length} onClick={exportLocalSnapshot}>导出当前页本地 fixture 快照 CSV</button><span>只生成当前筛选页的本地示例文件；不调用服务端或 K3。</span></div>
      {result && <div className="op-demo-pagination"><span>本地匹配 {result.total} 行 · 第 {page} / {totalPages} 页 · pageSize ≤ 200</span><div><button className="op-action" type="button" disabled={loading || page <= 1} onClick={() => void runDemo(page - 1)}>上一页</button><button className="op-action" type="button" disabled={loading || page >= totalPages} onClick={() => void runDemo(page + 1)}>下一页</button></div></div>}
    </> : <section className="op-raw-metrics" aria-label="本地 fixture 原始字段分组视图">
      <div className="op-preflight-note"><b>原始字段视图 · 不是经营 KPI</b><p>仅对当前页本地 fixture 已有数值按单位或币别分组；不把不同单位/币别混加，也不从不同业务阶段相减或推导经营指标。FieldKey 及金额/数量语义尚未目标账套验证。</p></div>
      <h3>数量字段（按单位分组）</h3>{quantityRows.length ? <div className="op-field-table-wrap"><table className="op-field-table"><thead><tr><th>单位</th>{contract.quantityKeys.map(key => <th key={key}>{candidateFieldLabel(candidate, key)}<small>{key}</small></th>)}</tr></thead><tbody>{quantityRows.map(row => <tr key={row.group}><td>{row.group}</td>{contract.quantityKeys.map(key => <td key={key}>{row.values[key] || 0}</td>)}</tr>)}</tbody></table></div> : <div className="op-empty">当前页没有可分组的数量样例。</div>}
      <h3>金额字段（按币别分组）</h3>{amountRows.length ? <div className="op-field-table-wrap"><table className="op-field-table"><thead><tr><th>币别</th>{contract.amountKeys.map(key => <th key={key}>{candidateFieldLabel(candidate, key)}<small>{key}</small></th>)}</tr></thead><tbody>{amountRows.map(row => <tr key={row.group}><td>{row.group}</td>{contract.amountKeys.map(key => <td key={key}>{row.values[key] || 0}</td>)}</tr>)}</tbody></table></div> : <div className="op-empty">当前页没有可分组的金额样例。</div>}
      <p>以上是字段阶段值的本地样例合计，不标记为经营 KPI；没有跨单位/币别的总计。</p>
    </section>}
    {detailRow && <div className="op-scrim" onClick={() => setDetailRow(null)}><aside className="op-drawer" role="dialog" aria-modal="true" aria-label="本地演示行明细" onClick={event => event.stopPropagation()}><button className="op-close" type="button" onClick={() => setDetailRow(null)}>关闭演示明细</button><span className="op-badge fixture">本地 fixture · 非 K3</span><h2>本地演示行明细</h2><p>仅显示当前报告自己的 synthetic fixture；字段 Key 是未验证附件候选，不是 K3 返回值。</p>{Object.entries(detailRow).map(([key, value]) => <div className="op-detail-field" key={key}><b>{candidateFieldLabel(candidate, key)}<small><code>{key}</code></small></b><span>{text(value)}</span></div>)}</aside></div>}
  </section>
}

function FieldSurvey({ report }: { report: Report }) {
  return <div className="op-survey">
    <ReportPreparation report={report}/>
    <div className="op-filter-chips" aria-label={`${report.name}候选筛选条件`}>
      {report.filterSpecs.map(key => <span key={key}>{operationalFieldLabel[key] || key}<small>待验证</small></span>)}
    </div>
    <div className="op-field-table-wrap"><table className="op-field-table">
      <caption>候选返回字段与图表 / 指标用途（不是已确认的 K3 字段 Key）</caption>
      <thead><tr><th>业务字段</th><th>确认状态</th><th>可筛选性</th><th>图表 / 指标用途与限制</th></tr></thead>
      <tbody>{report.fieldSpecs.map(field => <tr key={field.name}>
        <td><b>{field.label || field.name}</b><code>{field.name}</code></td>
        <td><span className="op-pending">待元数据验证</span></td>
        <td>{field.filterable ? '候选筛选项' : '返回 / 计算依赖'}<small>实际可筛选性待验证</small></td>
        <td>{field.use || '待业务口径确认'}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="op-indicator"><b>需要真实业务行后才能确认的图表与指标</b>
      <ul>{report.chartPrerequisites.map(item => <li key={item}>{item}</li>)}</ul>
    </div>
  </div>
}

function CandidateReportDetails({ candidate }: { candidate: ReportCandidate }) {
  const observation = candidate.targetAccountReadOnlyObservation
  const excludedKeys = observation?.kind === 'array_response' ? observation.excludedRuntimeFieldKeys || [] : []
  return <section className="op-contracts op-candidate-details" aria-label={`${candidate.name}附件候选契约`}>
    <div className="op-fixture-note"><b>{reportCandidateLockedStatusLabel}</b><span>此页不请求 K3、不显示实测行或 KPI；若本页提供合成 fixture，仅用于本地交互并与接口观察分开。方法候选为 <code>{candidate.method}</code>。</span></div>
    <CandidateReadOnlyObservationNote observation={observation}/>
    <div className="op-candidate-summary"><div><span>FormId</span><code>{candidate.formId}</code></div><div><span>SchemeId</span><b>示例参数值为空 / 未验证</b></div><div><span>已选 FieldKeys</span><b>示例参数值为空；未选定</b></div><div><span>方法 / 目标账套验证</span><b>未验证 / 锁定</b></div></div>
    <article className="op-contract"><h3>字段来源边界</h3><p>{candidate.sourceAttachment ? <>来源附件标识：<code>{candidate.sourceAttachment}</code></> : '来源附件标识已移除；仅保留未验证字段候选。'}</p>
      {candidate.requestedAttachment && !candidate.sourceAttachmentMatchesRequestedPath && <p className="op-attachment-path-warning">原始附件路径与字段来源不一致；路径标识已移除，字段仍未验证。</p>}
      {candidate.sourceMatchesRequestedFormId ? <p>附件正文 FormId：<code>{candidate.sourceReportedFormId}</code>，与本目录项相同；这里只记录附件候选，仍不代表目标账套验证。</p> : <p className="op-source-conflict"><b>来源冲突：字段不得归属给本 FormId。</b>指定附件正文声明 FormId <code>{candidate.sourceReportedFormId || '未声明'}</code>，而本项目录 FormId 是 <code>{candidate.formId}</code>。下方完整保留附件原始候选范围仅供核对，不作为本项可用字段契约。</p>}
    </article>
    <article className="op-contract"><h3>候选筛选：附件 Model 字段</h3><p>以下键来自附件 JSON 的 <code>Model</code>，不是已允许的查询参数；每项仍未在目标账套核验。</p>
      <div className="op-key-cloud">{candidate.modelFieldKeys.map(key => <span key={key}><code>{key}</code><small>未验证候选</small></span>)}</div>
      {!!candidate.modelNestedFieldPaths.length && <p>附件 Model 嵌套路径：{candidate.modelNestedFieldPaths.map(path => <code key={path}>{path}（未验证候选） </code>)}</p>}
    </article>
    <article className="op-contract"><h3>Model 字段说明 / 必填候选</h3><p>“必填”仅复述附件标注，不代表目标账套枚举值可用。</p>
      {candidate.parameterFields.length ? <div className="op-field-table-wrap"><table className="op-field-table"><thead><tr><th>字段说明</th><th>附件 Key</th><th>附件标注</th></tr></thead><tbody>{candidate.parameterFields.map((item,index) => <tr key={`${item.key}-${index}`}><td>{item.label}</td><td><code>{item.key}</code></td><td>{item.requiredCandidate ? '必填候选，未验证' : '候选，未验证'}</td></tr>)}</tbody></table></div> : <p>附件中未解析到独立字段说明。</p>}
    </article>
    <article className="op-contract"><h3>候选返回字段范围：附件 FieldKeys</h3><p>下列 Key 与说明逐项取自指定附件；来源不匹配时不得套用到本项，也不能作为已选择的 FieldKeys。</p>
      {candidate.fieldCandidates.length ? <div className="op-field-table-wrap"><table className="op-field-table"><thead><tr><th>附件显示列标签</th><th>候选 FieldKey</th><th>来源状态</th></tr></thead><tbody>{candidate.fieldCandidates.map((item,index) => <tr key={`${item.key}-${index}`}><td>{item.label}</td><td><code>{item.key}</code></td><td>{excludedKeys.includes(item.key) ? `附件候选；目标账套 ${observation?.kind === 'array_response' ? observation.exclusionCode : ''} 已排除该运行列` : `附件候选 · 未验证${candidate.sourceMatchesRequestedFormId ? '' : ' · FormId 冲突，不采用'}`}</td></tr>)}</tbody></table></div> : <p>指定附件未包含可解析的 FieldKeys 列表。</p>}
    </article>
    <article className="op-contract"><h3>方法、验证状态与阻塞</h3><p>方法候选：<code>{candidate.method}</code>；附件示例传入的 SchemeId / FieldKeys 参数值为空；下方候选字段说明不代表已选 FieldKeys。没有发现接口、发送报表请求或验证响应。</p>
      <ul>{candidate.blockers.map((blocker,index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
      <p>验证标记：来源=附件示例候选；公开 API 分类={candidate.publicApiClassification === 'unverified' ? '未验证' : candidate.publicApiClassification}；目标账套={candidate.validation.targetLedgerValidated ? '已验证' : '未验证'}；必填枚举={candidate.validation.requiredEnumsValidated ? '已验证' : '未验证'}；响应结构/行粒度=未验证；liveCallsAllowed=false。</p>
    </article>
  </section>
}

function CandidateStatusPage({ candidate, placeholder, onNavigate }: { candidate?: ReportCandidate; placeholder: boolean; onNavigate?: (page: string) => void }) {
  if (placeholder) return <section className="op-candidate-page"><div className="op-title-row"><div><span className="op-badge">待定义 · 无 FormId</span><h2>AR汇总待定义</h2><p>无用户确认的 FormId、附件或字段定义；不推测、不查询。</p></div></div><div className="op-blocker"><b>数据与指标锁定</b><p>不展示行数据、数值或 KPI。无查询参数、输出列、结果表、分页或行详情；待用户定义 FormId 与字段来源后再单独预检。</p></div><button className="op-action" type="button" onClick={() => onNavigate?.('operational-preflight')}>返回字段与筛选预检</button></section>
  if (!candidate) return <div className="op-empty">候选目录尚未载入；没有发出 K3 请求。</div>
  const fixture = createCandidateReportFixture(candidate)
  return <section className="op-candidate-page"><div className="op-title-row"><div><span className="op-badge">{reportCandidateLockedStatusLabel}</span><h2>{candidate.name}</h2><p>独立候选状态页；不与其他报告套用字段、样例或数据。实时报表仍锁定。</p></div></div><CandidateEvidenceStatusStrip candidate={candidate}/>{fixture ? <CandidateFixtureWorkbench candidate={candidate} fixture={fixture}/> : <CandidateLockedWorkbench candidate={candidate}/>}<CandidateReportDetails candidate={candidate}/><button className="op-action" type="button" onClick={() => onNavigate?.('operational-preflight')}>返回完整候选目录</button></section>
}

export function LegacyOperationalReports({ pageId = 'operational-reports', onNavigate }: { pageId?: string; onNavigate?: (page: string) => void }) {
  const [directory, setDirectory] = useState<Envelope | null>(null)
  const [envelope, setEnvelope] = useState<Envelope | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('FIX-MAT-001'), [warehouse, setWarehouse] = useState('演示仓B'), [unit, setUnit] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false), [detail, setDetail] = useState<Row | null>(null), [detailError, setDetailError] = useState('')
  const listSequence = useRef(0), detailSequence = useRef(0), detailController = useRef<AbortController | null>(null)
  const route = operationalRoutes.find(item => item.page === pageId)
  const candidatePage = reportCandidateRouteForPage(pageId)
  const active = route?.id
  const reports = directory?.reports || []
  const report = envelope?.report || reports.find(item => item.id === active)
  const candidate = directory?.metadataPreflight?.reportCandidates?.find(item => item.id === candidatePage?.candidateId)
  const arSummaryPlaceholder = directory?.metadataPreflight?.arSummaryPlaceholder
  const rows = envelope?.rows || []
  const preflight = envelope?.metadataPreflight || directory?.metadataPreflight
  const confirmedCount = preflight?.confirmedFields.length
  const fixture = report?.status === 'fixture'
  const chart = useMemo(() => active === 'instant-inventory' && fixture ? groupInventoryRows(rows) : [], [active, fixture, rows])
  const inventoryKpis = useMemo(() => active === 'instant-inventory' && fixture ? summarizeInventoryFixture(rows) : null, [active, fixture, rows])

  useEffect(() => {
    const controller = new AbortController()
    setDirectoryLoading(true)
    apiJson<Envelope>('/api/operational-reports', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDirectory(result) })
      .catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : '报表目录不可用') })
      .finally(() => { if (!controller.signal.aborted) setDirectoryLoading(false) })
    return () => { controller.abort(); detailSequence.current++; detailController.current?.abort() }
  }, [])

  useEffect(() => {
    if (!active || isSecondPhaseReport(active)) return
    const sequence = ++listSequence.current, controller = new AbortController()
    setLoading(true); setEnvelope(null); setError('')
    detailSequence.current++; detailController.current?.abort(); setDrawerOpen(false); setDetail(null)
    const filters = new URLSearchParams({ q, warehouse, unit })
    apiJson<Envelope>(`/api/operational-reports/${active}?${filters}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && sequence === listSequence.current) setEnvelope(result) })
      .catch(value => { if (!controller.signal.aborted && sequence === listSequence.current) setError(value instanceof Error ? value.message : '报表读取失败') })
      .finally(() => { if (!controller.signal.aborted && sequence === listSequence.current) setLoading(false) })
    return () => controller.abort()
  }, [active, q, warehouse, unit])

  function closeDetail() { detailSequence.current++; detailController.current?.abort(); setDrawerOpen(false); setDetail(null) }
  async function openDetail(rowId: string) {
    const sequence = ++detailSequence.current
    detailController.current?.abort()
    const controller = new AbortController(); detailController.current = controller
    setDrawerOpen(true); setDetail(null); setDetailError('')
    try {
      const result = await apiJson<{ row: Row }>(`/api/operational-reports/${active}/rows/${encodeURIComponent(rowId)}`, { signal: controller.signal })
      if (!controller.signal.aborted && sequence === detailSequence.current) setDetail(result.row)
    } catch (value) {
      if (!controller.signal.aborted && sequence === detailSequence.current) setDetailError(value instanceof Error ? value.message : '明细不可用')
    }
  }

  const title = pageId === 'operational-reports' ? 'K3 报表' : pageId === 'operational-preflight' ? '字段与筛选预检' : candidatePage?.title || route?.title
  return <section className="op-report">
    <header className="op-hero"><div><span className="op-eyebrow">K3 REPORTS · 隔离候选</span><h1>{title}</h1>
      <p>先确认字段，再定义指标。当前接线均为占位；本地示例不代表实时业务数据。</p>
    </div><span className="op-role-note">管理员 / PLM 经理</span></header>
    <nav className="op-report-nav" aria-label="K3 报表子菜单">
      <button className={pageId === 'operational-reports' ? 'selected' : ''} onClick={() => onNavigate?.('operational-reports')}>报表总览</button>
      {operationalRoutes.map(item => <button key={item.page} aria-current={pageId === item.page ? 'page' : undefined} className={pageId === item.page ? 'selected' : ''} onClick={() => onNavigate?.(item.page)}>{item.title}</button>)}
      <button className={pageId === 'operational-preflight' ? 'selected' : ''} onClick={() => onNavigate?.('operational-preflight')}>字段与筛选预检</button>
    </nav>
    {error && <div className="op-alert" role="alert">{error}</div>}

    {(pageId === 'operational-reports' || pageId === 'operational-preflight') && <>
      <div className="op-state-matrix">
        <div><span>当前运行范围元数据（仍待验证）</span><b>{confirmedCount === undefined ? '读取中' : `${confirmedCount} 个字段已确认`}</b><small>指定命名范围的实采说明不继承为当前范围认证</small></div>
        <div><span>实时业务采集</span><b>未接线 / 未验证</b><small>不发起真实 K3 业务行请求，不以零替代缺失指标</small></div>
        <div><span>独立 FormId 报表候选</span><b>{preflight?.reportCandidates?.length ?? 12} 项</b><small>另有 AR 汇总待定义占位；GetInventoryData 与其他库存页不计入</small></div>
      </div>
      <aside className="op-preflight-note"><b>预检边界</b><p>{preflight?.reason || '正在读取离线预检说明。'}</p>
        {preflight?.stockOrganizationBlocker && <p>库存组织范围映射仅作为只读观察 metadata；不展示编码、不构成当前运行范围绑定，也不解锁任何实时报表。</p>}
        {preflight?.verificationMethod && <p>{preflight.verificationMethod}</p>}
      </aside>
    </>}
    {pageId === 'operational-reports' && <>
      <div className="op-title-row"><div><h2>既有运营页面（独立能力）</h2><p>此组保留即时库存、收发存、采购/销售 demo 与库存账龄页面；不等于下方 12 项 FormId 报表目录。</p></div><button className="op-action" onClick={() => onNavigate?.('operational-preflight')}>查看 12 项字段预检 →</button></div>
      <div className="op-cards">{operationalRoutes.map((item, index) => {
        const entry = reports.find(report => report.id === item.id)
        return <button className="op-card" key={item.id} onClick={() => onNavigate?.(item.page)}>
          <span className="op-card-number">0{index + 1}</span><h3>{item.title}</h3>
          <span className={`op-badge ${entry?.status === 'fixture' ? 'fixture' : ''}`}>{operationalStatusLabel(entry?.status)}</span>
          <p>{entry?.description || (directoryLoading ? '正在读取目录…' : '目录暂不可用')}</p><strong>查看报表与准备条件 →</strong>
        </button>
      })}</div>
      <div className="op-title-row"><div><h2>12 项 FormId 报表目录</h2><p>每项可独立查看附件字段范围、方法/验证状态与阻塞；live 查询与 KPI 均锁定，获准的本地合成 fixture 只用于交互演示。</p></div></div>
      <div className="op-preflight-note"><b>附件路径核对</b><p>AP 与成本附件已按原文件名及正文 FormId 重新核对并正确对应；每份候选字段只取自对应附件的 Model / FieldKeys，不跨 FormId 套用。所有附件仍仅为未验证候选，实时报表保持锁定。</p></div>
      <div className="op-candidate-grid">{(preflight?.reportCandidates || []).map(item => {
        const target = reportCandidateEntryRoutes.find(entry => entry.candidateId === item.id)
        return <article className="op-contract op-candidate-card" key={item.formId}>
          <b>{item.name}</b><span className="op-pending">{reportCandidateLockedStatusLabel}</span><code>{item.formId}</code>
          <p>{item.fieldCandidates.length} 个附件 FieldKeys 候选 · 正文 FormId={item.sourceReportedFormId || '未声明'} · 目标账套未验证</p>
          {item.targetAccountReadOnlyObservation?.kind === 'array_response' && <p>只读结构：RowCount {item.targetAccountReadOnlyObservation.rowCount} · Limit {item.targetAccountReadOnlyObservation.requestLimit} · 数组宽度 {item.targetAccountReadOnlyObservation.arrayWidth}；无行值，仍锁定。</p>}
          {item.targetAccountReadOnlyObservation?.kind === 'parameter_parse_error' && <p className="op-blocker">只读参数解析失败；无成功响应，剩余枚举未知；仍锁定。</p>}
          {item.requestedAttachment && item.sourceAttachmentMatchesRequestedPath === false && <p className="op-attachment-path-warning">原指定路径与正文 FormId 错位；本页按正文 FormId 归档并另列原路径。</p>}
          <button className="op-action" type="button" onClick={() => target && onNavigate?.(target.page)}>查看独立状态 →</button>
        </article>
      })}</div>
      <article className="op-contract op-placeholder-card"><b>AR汇总待定义</b><span className="op-pending">待定义 · 无 FormId</span><p>不推测 FormId 或字段。</p><button className="op-action" type="button" onClick={() => onNavigate?.(reportCandidatePlaceholderRoute.page)}>查看占位 →</button></article>
      <aside className="op-preflight-note"><b>库存能力不挂入上述目录</b><p><code>GetInventoryData</code> 是独立查询能力；<code>STK_Inventory</code>、收发存、库存账龄及 <code>BD_STOCK</code> 仓库选择均不属于 12 个 FormId 项目。</p></aside>
    </>}
    {pageId === 'operational-preflight' && <>
      {preflight && <UserReportCandidates preflight={preflight} onNavigate={onNavigate}/>}
      <h2>独立运营能力的当前状态（不在 12 项 FormId 目录）</h2>
      <div className="op-preflight-list">{reports.map(entry => <article key={entry.id}>
        <div className="op-title-row"><div><h2>{entry.name}</h2><p>{entry.description}</p></div><span className="op-badge">{operationalStatusLabel(entry.status)}</span></div>
        <FieldSurvey report={entry}/>
      </article>)}{directoryLoading && <div className="op-empty">正在读取字段准备清单…</div>}</div>
    </>}

    {isSecondPhaseReport(active) && <>
      <div className="op-title-row"><div><span className="op-badge fixture">本地演示</span><h2>{route?.title}</h2><p>输入条件返回对应的本地演示记录；字段 Key 仍是附件候选，未核验为目标账套输出。</p></div>
        <div className="op-source"><b>本地 fixture · 非 K3 输出</b><span>目标账套 live call：锁定</span><span>SchemeId / FieldKeys：待确认</span></div>
      </div>
      <CandidateEvidenceStatusStrip candidate={candidate}/>
      {candidate && <details className="op-fields-details"><summary>附件字段范围、来源与验证阻塞</summary><CandidateReportDetails candidate={candidate}/></details>}
      <SecondPhaseDemoPanel reportId={active} candidate={candidate}/>
    </>}
    {candidatePage && !isSecondPhaseReport(active) && <CandidateStatusPage candidate={candidate} placeholder={candidatePage.candidateId === 'ar-summary-placeholder'} onNavigate={onNavigate}/>}
    {active && !isSecondPhaseReport(active) && <>
      <div className="op-title-row"><div><span className={`op-badge ${fixture ? 'fixture' : ''}`}>{operationalStatusLabel(report?.status)}</span><h2>{report?.name || route?.title}</h2><p>{report?.description}</p></div>
        <div className="op-source"><b>{report?.sourceLabel || '采集接线占位'}</b><span>快照：{report?.snapshotAt ? new Date(report.snapshotAt).toLocaleString('zh-CN') : '无业务快照'}</span><span>元数据：{confirmedCount === undefined ? '待读取' : `${confirmedCount} 个字段已确认`}</span></div>
      </div>
      {fixture ? <aside className="op-fixture-note"><b>本地示例 · 非实时 · 非真实业务数据</b><span>仅用于验证导航、筛选、图表和明细交互，不证明目标账套字段或接口可用。</span></aside>
        : <aside className="op-blocker"><b>当前仅占位，不出具业务指标</b><p>{envelope?.unavailableReason || report?.description || '等待来源与字段确认'}</p></aside>}
      {active === 'instant-inventory' && <InventoryFixedSampleAction observation={preflight?.inventoryGetInventoryDataReadOnlyObservation}/>}
      {active === 'instant-inventory' && (inventoryKpis ? <section className="op-kpi-panel" aria-label="库存本地 fixture 指标">
        <div className="op-kpi-heading"><h3>指标 · 当前筛选的本地 fixture</h3><span className="op-badge fixture">演示口径</span></div>
        <div className="op-kpi-grid"><article><span>示例行数</span><b>{inventoryKpis.rowCount}</b><small>当前筛选后</small></article><article><span>物料数</span><b>{inventoryKpis.materialCount}</b><small>按物料编码去重</small></article><article><span>仓库数</span><b>{inventoryKpis.warehouseCount}</b><small>按仓库名称去重</small></article><article><span>现存数量（分单位）</span><b>{inventoryKpis.quantitiesByUnit.length ? inventoryKpis.quantitiesByUnit.map(item => `${item.quantity} ${item.unit}`).join(' / ') : '待接线'}</b><small>fixture.quantity；不跨单位求和</small></article><article><span>可用数量</span><b>待接线</b><small>没有已确认的直接字段，不由现存量推算</small></article></div>
      </section> : <section className="op-kpi-panel" aria-label="库存真实指标待接线"><div className="op-kpi-heading"><h3>真实库存指标 / 图表</h3><span className="op-pending">待接线</span></div><div className="op-kpi-grid"><article><span>现存数量</span><b>待接线</b><small>FBaseQty 是历史候选，语义/单位未确认</small></article><article><span>可用数量</span><b>待接线</b><small>不由现存量推算</small></article><article><span>库存金额</span><b>待接线</b><small>金额字段、币别和估值口径未知</small></article></div></section>)}
      <details className="op-fields-details"><summary>筛选条件、候选字段与指标依赖</summary>{report && <FieldSurvey report={report}/>}</details>
      {fixture ? <><p className="op-local-filter-note">以下可变筛选只作用于本地 fixture。目录外 GetInventoryData 当前未启用，不会随这些筛选发送请求。</p><div className="op-filters"><label>搜索物料 / 仓库<input aria-label="搜索物料或仓库" value={q} maxLength={200} placeholder="本地样本物料 / 仓库" onChange={event => setQ(event.target.value)}/></label>
        <label>仓库<input value={warehouse} maxLength={200} placeholder="全部示例仓库（精确匹配）" onChange={event => setWarehouse(event.target.value)}/></label>
        <label>单位<input value={unit} maxLength={200} placeholder="全部单位（精确匹配）" onChange={event => setUnit(event.target.value)}/></label>
        <button className="op-action" onClick={() => { setQ('FIX-MAT-001'); setWarehouse('演示仓B'); setUnit('') }}>恢复默认演示样本</button>
      </div></> : <div className="op-pending-filters"><b>计划筛选条件</b><div className="op-filter-chips">{report?.filterSpecs.map(key => <span key={key}>{operationalFieldLabel[key] || key}<small>未接线</small></span>)}</div><small>候选条件不发送到金蝶；实际可筛选性及字段 Key 均待元数据核验。</small></div>}
      <div className="op-unavailable-filter">
        <label>{specificationModelFilter.label}<input aria-label={specificationModelFilter.label} aria-describedby="op-specification-reason" disabled={specificationModelFilter.disabled} placeholder="待接线 · 不可查询"/></label>
        <p id="op-specification-reason">{specificationModelFilter.reason} 本地示例也未提供规格/型号，不以编码或名称匹配冒充规格搜索。</p>
      </div>
      {chart.length > 0 && <div className="op-chart-fixture"><h3>库存现存数量 · 本地 fixture 图表</h3><p>显式映射本地字段 materialNumber / materialName / unit / quantity；按物料编码 + 单位分组；每种单位独立标尺，不生成跨单位总量。</p>
        {chart.map(item => <div className="op-chart-row" key={JSON.stringify([item.materialNumber, item.unit])}>
          <span>{item.materialName}<small>{item.materialNumber} · {item.unit}</small></span><i><em className={item.quantity < 0 ? 'negative' : ''} style={{ width: `${inventoryBarPercent(item, chart)}%` }}/></i><strong>{item.quantity} {item.unit}</strong>
        </div>)}
      </div>}
      <div className="op-table-wrap" aria-live="polite">{loading ? <div className="op-empty">正在读取本地报表状态…</div> : fixture && rows.length ? <table>
        <caption>库存明细 · 本地 fixture，非实时业务数据；字段为规范化演示值，不是 K3 原始 FieldKeys</caption><thead><tr><th className="op-row-action">操作</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td className="op-row-action"><button className="op-link" onClick={() => void openDetail(row.id)}>查看明细</button></td>{columns.map(([key]) => <td key={key}>{text(row[key])}</td>)}</tr>)}</tbody>
      </table> : <div className="op-empty"><b>{fixture ? '没有匹配的示例行' : '等待来源和字段验证'}</b><span>{fixture ? '请调整筛选条件；空结果不代表真实库存为零。' : '尚不具备可出具指标的数据基础，不绘制虚构图表。'}</span></div>}</div>
      {fixture && !loading && <div className="op-result-count">匹配 {envelope?.total ?? rows.length} 条本地示例行 · 数量按各行单位独立解释</div>}
    </>}
    {drawerOpen && <div className="op-scrim" onClick={closeDetail}><aside className="op-drawer" role="dialog" aria-modal="true" aria-label="库存行明细" onClick={event => event.stopPropagation()}>
      <button className="op-close" aria-label="关闭明细" onClick={closeDetail}>关闭 ×</button><span className="op-badge fixture">本地示例 · 非实时</span><h2>库存行明细</h2>
      <p>每次明细读取均重新经过服务端角色与当前租户 / 组织 / 账套校验。</p>
      {detailError ? <div className="op-alert" role="alert">{detailError}</div> : detail ? columns.map(([key, label]) => <div className="op-detail-field" key={key}><b>{label}</b><span>{text(detail[key])}</span></div>) : <div className="op-empty">正在校验并读取明细…</div>}
    </aside></div>}
  </section>
}

export { default } from './OperationalReportsBusiness'
