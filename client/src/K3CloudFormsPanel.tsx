import { useEffect, useMemo, useState } from 'react'
import { Search, ScanSearch, ShieldCheck } from 'lucide-react'
import './k3cloud-panels.css'

export type K3MappingTarget =
  | 'shipment' | 'purchase-receipt' | 'sales-order' | 'purchase-order'
  | 'receivable' | 'payable' | 'sales-invoice' | 'purchase-invoice'
  | 'customer' | 'supplier' | 'salesperson' | 'user'
export type K3FormCatalogItem = {
  formId: string
  name: string
  domain: string
  sourceCatalogMarkedVerified: boolean
  referencedAsExample: boolean
  downstream: string[]
  suggestedFor: K3MappingTarget[]
  notes: string
}
export type K3MetadataField = {
  key: string
  caption: string
  entity: string
  mustInput: boolean
  visible: boolean
  isCustom: boolean
  isFlexParent: boolean
  elementType: string | number | null
  fieldName: string
}
export type K3FormMetadata = {
  formId: string
  source: 'query_metadata'
  discoveredAt: string
  fieldCount: number
  customFieldCount: number
  fields: K3MetadataField[]
  requiredKeys: string[]
  usableCustomKeys: string[]
  hiddenCustomKeys: string[]
  flexParentKeys: string[]
  note: string
}
const targetGroups: { label: string; options: Array<{ value: K3MappingTarget; label: string; canonical: string[]; required: string[]; source: 'daily' | 'master' }> }[] = [
  { label: '日报业务单据', options: [
    { value: 'shipment', label: '销售出库 · shipment', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
    { value: 'purchase-receipt', label: '采购入库 · purchase-receipt', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
    { value: 'sales-order', label: '销售订单 · sales-order', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
    { value: 'purchase-order', label: '采购订单 · purchase-order', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
    { value: 'receivable', label: '应收单 · receivable', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'originalAmount', 'amountCny', 'settledAmountCny', 'status', 'upstreamId', 'upstreamBillNo'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny', 'settledAmountCny'] },
    { value: 'payable', label: '应付单 · payable', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'originalAmount', 'amountCny', 'settledAmountCny', 'status', 'upstreamId', 'upstreamBillNo'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny', 'settledAmountCny'] },
    { value: 'sales-invoice', label: '销项发票 · sales-invoice', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'taxAmount', 'taxAmountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
    { value: 'purchase-invoice', label: '采购收票 · purchase-invoice', source: 'daily', canonical: ['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'taxAmount', 'taxAmountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId'], required: ['id', 'billNo', 'date', 'partyName', 'originalAmount', 'amountCny'] },
  ] },
  { label: '主数据镜像', options: [
    { value: 'customer', label: '客户 · customer', source: 'master', canonical: ['id', 'number', 'name', 'status', 'category', 'department', 'ownerNumber', 'ownerName', 'modifiedAt'], required: ['id', 'name'] },
    { value: 'supplier', label: '供应商 · supplier', source: 'master', canonical: ['id', 'number', 'name', 'status', 'category', 'department', 'ownerNumber', 'ownerName', 'modifiedAt'], required: ['id', 'name'] },
    { value: 'salesperson', label: '业务员 · salesperson', source: 'master', canonical: ['id', 'number', 'name', 'status', 'category', 'department', 'ownerNumber', 'ownerName', 'modifiedAt'], required: ['id', 'name'] },
    { value: 'user', label: 'ERP 用户 · user', source: 'master', canonical: ['id', 'number', 'name', 'status', 'category', 'department', 'ownerNumber', 'ownerName', 'modifiedAt'], required: ['id', 'name'] },
  ] },
]
const canonicalLabels: Record<string, string> = {
  id: '稳定唯一键 / 行 ID', billNo: '单据编号', date: '业务日期', modifiedAt: '修改时间',
  partyNumber: '客商编码', partyName: '客商名称', materialName: '物料名称', quantity: '数量', unit: '单位', unitPrice: '单价', currency: '币种',
  originalAmount: '原币金额', amountCny: '人民币金额', settledAmountCny: '已收/已付人民币金额', status: '状态', upstreamId: '上游单据 ID', upstreamBillNo: '上游单据编号', upstreamLineId: '上游分录 ID', taxAmount: '原币税额', taxAmountCny: '人民币税额',
  number: '编码', name: '名称', category: '类别', department: '部门', ownerNumber: '负责人编码', ownerName: '负责人名称',
}
function parseMapping(text: string, target: K3MappingTarget, formId: string): Record<string, string> {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const raw = value[target]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const source = raw as Record<string, unknown>
    if (source.formId !== formId || !source.fields || typeof source.fields !== 'object' || Array.isArray(source.fields)) return {}
    return Object.fromEntries(Object.entries(source.fields as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch { return {} }
}
export function K3CloudFormsPanel({
  catalog,
  catalogNote,
  catalogLoading,
  catalogError,
  formId,
  onFormIdChange,
  metadata,
  metadataLoading,
  metadataError,
  onDiscover,
  authenticated,
  savedAllowlist,
  dailySourcesText,
  masterSourcesText,
  notice,
  onApply,
}: {
  catalog: K3FormCatalogItem[]
  catalogNote: string
  catalogLoading: boolean
  catalogError: string
  formId: string
  onFormIdChange: (value: string) => void
  metadata: K3FormMetadata | null
  metadataLoading: boolean
  metadataError: string
  onDiscover: () => void
  authenticated: boolean
  savedAllowlist: Record<string, string[]>
  dailySourcesText: string
  masterSourcesText: string
  notice: string
  onApply: (input: { formId: string; allowFields: string[]; target?: K3MappingTarget; mappingFields?: Record<string, string> }) => void
}) {
  const [catalogSearch, setCatalogSearch] = useState('')
  const [fieldSearch, setFieldSearch] = useState('')
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [target, setTarget] = useState<K3MappingTarget | ''>('')
  const [mappingFields, setMappingFields] = useState<Record<string, string>>({})
  useEffect(() => {
    setSelectedFields([])
    setFieldSearch('')
  }, [metadata?.formId, metadata?.discoveredAt])
  const selectedTarget = targetGroups.flatMap(group => group.options).find(option => option.value === target)
  const availableFields = useMemo(() => (metadata?.fields ?? []).filter(field => field.visible && !field.isFlexParent), [metadata])
  const visibleFields = useMemo(() => {
    const query = fieldSearch.trim().toLocaleLowerCase()
    return (metadata?.fields ?? []).filter(field => !query || [field.key, field.caption, field.entity].some(value => value.toLocaleLowerCase().includes(query)))
  }, [fieldSearch, metadata])
  const filteredCatalog = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase()
    return catalog.filter(item => !query || [item.formId, item.name, item.domain, item.notes].some(value => value.toLocaleLowerCase().includes(query)))
  }, [catalog, catalogSearch])
  const rawExistingMap = selectedTarget?.source === 'daily'
    ? parseMapping(dailySourcesText, target as K3MappingTarget, formId)
    : parseMapping(masterSourcesText, target as K3MappingTarget, formId)
  const availableKeys = new Set(availableFields.map(field => field.key))
  const existingMap = Object.fromEntries(Object.entries(rawExistingMap).filter(([key, value]) => availableKeys.has(value) && Boolean(key)))
  const requiredMissing = selectedTarget?.required.filter(key => !mappingFields[key] && !existingMap[key]) ?? []
  const mappingValues = { ...existingMap, ...mappingFields }
  const formWasSaved = (savedAllowlist[formId] ?? []).length > 0
  const toggleField = (key: string, checked: boolean) => setSelectedFields(current => checked ? [...new Set([...current, key])] : current.filter(field => field !== key))
  const chooseCatalogEntry = (entry: K3FormCatalogItem) => {
    onFormIdChange(entry.formId)
    setTarget(entry.suggestedFor[0] ?? '')
    setMappingFields({})
  }
  const changeTarget = (value: string) => {
    setTarget(value as K3MappingTarget | '')
    setMappingFields({})
  }
  const applyDraft = () => {
    if (!metadata) return
    const selectedMap = Object.fromEntries(Object.entries(mappingValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0))
    const fieldSet = new Set([...selectedFields, ...Object.values(selectedMap)])
    onApply({ formId: metadata.formId, allowFields: [...fieldSet], ...(target ? { target } : {}), ...(target ? { mappingFields: selectedMap } : {}) })
  }
  return (
    <section className="connector-workspace-panel k3-form-workbench" aria-label="K3Cloud 表单与字段发现">
      <div className="connector-section-heading">
        <div><h3>表单目录与字段发现</h3><p>静态目录用于定位候选表单；字段必须读取当前账套 QueryBusinessInfo 元数据后，由管理员逐项核验。</p></div>
      </div>
      <div className="connector-help k3-form-warning">
        <b><ShieldCheck size={15} /> 证据边界</b>
        <span>{catalogNote || '静态目录不是当前账套的权威清单。'} 源目录标记已核实仅对应上传包的原账套；本账套验证以本页动态发现和人工核验为准。此工作流只读，不提供 ERP 写入。</span>
      </div>
      <div className="k3-form-discovery-grid">
        <div className="k3-form-catalog">
          <div className="k3-form-subheading"><b>已知 FormId / 业务链缓存</b><span>{catalogLoading ? '读取中…' : `${filteredCatalog.length} 项`}</span></div>
          <label className="k3-form-search"><Search size={15} /><input value={catalogSearch} onChange={event => setCatalogSearch(event.target.value)} placeholder="按 FormId、名称或业务域筛选" /></label>
          {catalogError && <div className="connector-error" role="alert">{catalogError}</div>}
          <div className="k3-form-catalog-list">
            {filteredCatalog.map(entry => (
              <article className="k3-form-catalog-item" key={entry.formId}>
                <div className="k3-form-catalog-top"><button type="button" onClick={() => chooseCatalogEntry(entry)}><b>{entry.name}</b><code>{entry.formId}</code></button><span className="k3-form-badges">
                  {entry.sourceCatalogMarkedVerified && <i className="source-verified">源目录标已核实</i>}
                  {entry.referencedAsExample && <i className="source-example">示例</i>}
                  {!entry.sourceCatalogMarkedVerified && <i className="source-candidate">候选</i>}
                </span></div>
                {entry.notes && <small>{entry.notes}</small>}
                {entry.downstream.length > 0 && <small>已知下游：{entry.downstream.join(' → ')}</small>}
              </article>
            ))}
            {!catalogLoading && filteredCatalog.length === 0 && <div className="k3-form-empty">没有匹配的目录项。仍可手动输入目标账套中的 FormId 并发现元数据。</div>}
          </div>
        </div>
        <div className="k3-form-discovery">
          <div className="k3-form-subheading"><b>查询当前账套元数据</b><span>{authenticated ? '连接已测试' : '需先测试连接'}</span></div>
          <div className="k3-form-discovery-controls">
            <label className="connector-field"><span>FormId</span><input value={formId} onChange={event => { onFormIdChange(event.target.value); setTarget(''); setMappingFields({}) }} maxLength={128} placeholder="输入或从左侧目录选择" /></label>
            <button type="button" className="secondary-button" onClick={onDiscover} disabled={!authenticated || metadataLoading || !formId.trim()}>
              <ScanSearch size={15} />{metadataLoading ? '查询中…' : '只读查询元数据'}
            </button>
          </div>
          {!authenticated && <div className="k3-form-inline-note">先到“连接设置”保存凭据并成功测试连接；发现 API 只使用当前内部账套已保存的凭据。</div>}
          {metadataError && <div className="connector-error" role="alert">{metadataError}</div>}
          {metadata && (
            <>
              <div className="k3-form-meta-summary" role="status"><b>{metadata.formId}</b><span>{metadata.fieldCount} 个字段 · {metadata.customFieldCount} 个自定义字段</span><small>{new Date(metadata.discoveredAt).toLocaleString()}</small></div>
              <div className="k3-form-evidence-note">{metadata.note}</div>
              <div className="k3-form-field-toolbar"><label className="k3-form-search"><Search size={15} /><input value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="筛选字段 Key / 名称 / 实体" /></label><small>可选 {availableFields.length} 项 · 已选择 {selectedFields.length} 项</small></div>
              <div className="k3-form-field-list">
                {visibleFields.map(field => {
                  const disabled = !field.visible || field.isFlexParent
                  return <label className={`k3-form-field-row ${disabled ? 'unavailable' : ''}`} key={`${field.entity}-${field.key}`}>
                    <input type="checkbox" checked={selectedFields.includes(field.key)} disabled={disabled} onChange={event => toggleField(field.key, event.target.checked)} />
                    <span className="k3-form-field-main"><b>{field.caption || field.key}</b><code>{field.key}</code><small>{field.entity}</small></span>
                    <span className="k3-form-field-badges">{field.mustInput && <i className="required">必填</i>}{field.isCustom && <i className="custom">自定义</i>}{field.isFlexParent && <i className="unavailable-badge">弹性域父键</i>}{!field.visible && <i className="unavailable-badge">隐藏</i>}</span>
                  </label>
                })}
                {visibleFields.length === 0 && <div className="k3-form-empty">没有匹配字段。</div>}
              </div>
              <div className="k3-form-map-box">
                <div className="k3-form-subheading"><b>规范字段映射（可选）</b><span>从本次查询结果逐项选择</span></div>
                <label className="connector-field"><span>要配置的 PLM 数据源</span><select value={target} onChange={event => changeTarget(event.target.value)}><option value="">仅加入只读 allowlist，不设置业务映射</option>{targetGroups.map(group => <optgroup key={group.label} label={group.label}>{group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</select></label>
                {selectedTarget && <>
                  <div className="k3-form-map-caption">带 * 的规范字段为必要字段。映射中已选字段会同时加入 allowlist；其余查询字段请在上方单独勾选。</div>
                  <div className="k3-form-map-grid">{selectedTarget.canonical.map(key => <label className="connector-field" key={key}><span>{canonicalLabels[key] ?? key}{selectedTarget.required.includes(key) ? ' *' : ''}</span><select value={mappingValues[key] ?? ''} onChange={event => setMappingFields(current => ({ ...current, [key]: event.target.value }))}><option value="">不映射</option>{availableFields.map(field => <option key={`${field.entity}-${field.key}`} value={field.key}>{field.caption ? `${field.caption} · ` : ''}{field.key}</option>)}</select></label>)}</div>
                  {requiredMissing.length > 0 && <div className="k3-form-inline-note">尚缺必要映射：{requiredMissing.map(key => canonicalLabels[key] ?? key).join('、')}。可以先应用 allowlist 草稿，但完整业务同步仍不会就绪。</div>}
                </>}
              </div>
              <div className="k3-form-apply-row"><span>{formWasSaved ? `当前已保存 allowlist ${savedAllowlist[formId]?.length} 个字段；下面的变更仍是本地草稿。` : '首次应用后仍需点击页面上方“加密保存配置”才会写入当前账套。'}</span><button type="button" className="primary-button" onClick={applyDraft} disabled={!metadata || metadata.formId !== formId || (selectedFields.length === 0 && Object.values(mappingValues).every(value => !value))}>加入 allowlist / 应用映射草稿</button></div>
              {notice && <div className="connector-notice" role="status">{notice}</div>}
            </>
          )}
        </div>
      </div>
      {!metadata && !metadataLoading && !metadataError && <div className="k3-form-empty k3-form-discovery-placeholder">查询后将显示动态字段。字段前缀、字段名和目录条目都不会代替元数据发现。</div>}
    </section>
  )
}
