import { BadgeCheck, Building2, RefreshCw, Search, Truck, UserRound, Users } from 'lucide-react'
import './k3cloud-panels.css'

export type K3MasterDataKind = 'customer' | 'supplier' | 'salesperson' | 'user'
export type K3MasterDataRecord = {
  id: string
  kind: K3MasterDataKind
  erpId: string
  number: string
  name: string
  status: string
  category: string
  department: string
  ownerNumber: string
  ownerName: string
  modifiedAt: string
}
export type K3MasterDataPayload = {
  source?: string
  lastSyncedAt?: string | null
  configuredKinds?: K3MasterDataKind[]
  rowCounts?: Partial<Record<K3MasterDataKind, number>>
  records?: Partial<Record<K3MasterDataKind, K3MasterDataRecord[]>>
}
export type K3QueryResult = { fields?: string[]; rows?: Array<Record<string, unknown>>; cached?: boolean }

type KindMeta = {
  label: string
  icon: typeof Users
}

const kindMeta: Record<K3MasterDataKind, KindMeta> = {
  customer: { label: '客户', icon: Users },
  supplier: { label: '供应商', icon: Truck },
  salesperson: { label: '业务员', icon: UserRound },
  user: { label: 'ERP 用户', icon: BadgeCheck },
}
const kinds = Object.keys(kindMeta) as K3MasterDataKind[]

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function K3CloudDirectoryPanel({
  kind,
  onKindChange,
  search,
  onSearchChange,
  data,
  filteredRecords,
  loading,
  error,
  onRefresh,
}: {
  kind: K3MasterDataKind
  onKindChange: (kind: K3MasterDataKind) => void
  search: string
  onSearchChange: (value: string) => void
  data: K3MasterDataPayload | null
  filteredRecords: K3MasterDataRecord[]
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  const records = data?.records?.[kind] ?? []
  const total = data?.rowCounts?.[kind] ?? records.length
  const hasSnapshot = Boolean(data?.lastSyncedAt)

  return (
    <section className="connector-workspace-panel k3-directory" aria-label="K3Cloud 主数据只读目录">
      <header className="k3-directory-heading">
        <div className="k3-directory-title">
          <span className="k3-panel-eyebrow"><Building2 size={14} /> K3CLOUD · MASTER DATA</span>
          <h3>基础资料目录</h3>
        </div>
        <div className="k3-directory-actions">
          <span className={`k3-snapshot-indicator ${hasSnapshot ? 'ready' : ''}`}>
            <i />{hasSnapshot ? '只读快照' : '尚未同步'}
          </span>
          <button type="button" className="secondary-button k3-refresh-button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'k3-spinning' : ''} />
            {loading ? '读取中…' : '刷新'}
          </button>
        </div>
      </header>

      <nav className="k3-kind-grid" aria-label="基础资料类别">
        {kinds.map(value => {
          const Icon = kindMeta[value].icon
          const count = data?.rowCounts?.[value] ?? data?.records?.[value]?.length ?? 0
          return (
            <button
              type="button"
              key={value}
              className={`k3-kind-card ${kind === value ? 'selected' : ''}`}
              aria-pressed={kind === value}
              onClick={() => onKindChange(value)}
            >
              <span className="k3-kind-icon"><Icon size={16} /></span>
              <span className="k3-kind-copy"><b>{kindMeta[value].label}</b></span>
              <strong>{hasSnapshot ? count.toLocaleString() : '—'}</strong>
            </button>
          )
        })}
      </nav>

      <div className="k3-directory-tools">
        <label className="k3-search-field">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="搜索编号、名称、状态、部门或负责人"
            aria-label="搜索基础资料"
          />
          {search && <button type="button" onClick={() => onSearchChange('')} aria-label="清空搜索">清空</button>}
        </label>
        <span className="k3-result-count" role="status">
          {hasSnapshot ? <><b>{filteredRecords.length.toLocaleString()}</b> / {total.toLocaleString()} 条</> : '尚无快照'}
        </span>
      </div>

      {error && <div className="connector-error" role="alert">{error}</div>}
      {loading && <div className="k3-directory-state" role="status"><span className="k3-loading-mark" />正在读取{kindMeta[kind].label}只读快照…</div>}
      {!loading && !error && !hasSnapshot && (
        <div className="k3-directory-state k3-directory-empty" role="status">
          <span className="k3-empty-icon"><Building2 size={20} /></span>
          <b>当前账套尚无基础资料快照</b>
          <span>完成连接与映射配置后，手动或按计划同步即可在此浏览。</span>
        </div>
      )}
      {!loading && !error && hasSnapshot && (
        <>
          <div className="k3-directory-meta" role="status">
            <span>最近同步 <b>{formatDate(data!.lastSyncedAt!)}</b></span>
            <span>最多展示 100 条</span>
          </div>
          {filteredRecords.length === 0 ? (
            <div className="k3-directory-state k3-directory-empty">没有找到匹配的{kindMeta[kind].label}记录。试试其他关键词。</div>
          ) : (
            <div className="k3-table-wrap">
              <table>
                <thead>
                  <tr><th>资料</th><th>状态</th><th>类别</th><th>部门</th><th>负责人</th><th>修改时间</th></tr>
                </thead>
                <tbody>
                  {filteredRecords.slice(0, 100).map(row => (
                    <tr key={row.id}>
                      <td><div className="k3-record-main"><b>{row.name || '未命名'}</b><small>{row.number || '无编号'}</small></div></td>
                      <td><span className="k3-status-pill"><i />{row.status || '—'}</span></td>
                      <td>{row.category || '—'}</td>
                      <td>{row.department || '—'}</td>
                      <td>{[row.ownerName, row.ownerNumber].filter(Boolean).join(' / ') || '—'}</td>
                      <td>{row.modifiedAt || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <footer className="k3-table-footnote">
                {filteredRecords.length > 100 ? `当前筛选命中 ${filteredRecords.length.toLocaleString()} 条，仅展示前 100 条；请使用关键词缩小结果。` : `已显示全部 ${filteredRecords.length.toLocaleString()} 条只读记录。`}
              </footer>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function K3CloudQueryPanel({
  configured,
  availableForms,
  formId,
  onFormIdChange,
  selectedFields,
  queryFields,
  onFieldToggle,
  limit,
  onLimitChange,
  authenticated,
  loading,
  error,
  result,
  onRun,
}: {
  configured: boolean
  availableForms: string[]
  formId: string
  onFormIdChange: (formId: string) => void
  selectedFields: string[]
  queryFields: string[]
  onFieldToggle: (field: string, checked: boolean) => void
  limit: number
  onLimitChange: (limit: number) => void
  authenticated: boolean
  loading: boolean
  error: string
  result: K3QueryResult | null
  onRun: () => void
}) {
  const fields = result?.fields ?? queryFields

  return (
    <section className="connector-workspace-panel" aria-label="K3Cloud 手动只读查询">
      <div className="connector-section-heading">
        <div>
          <h3>手动只读查询</h3>
          <p>只使用已保存的 FormId 与字段 allowlist；不提供自由过滤表达式。</p>
        </div>
      </div>

      {!configured && <div className="connector-empty-state">K3Cloud 尚未配置，请先完成连接设置并保存。</div>}
      {configured && availableForms.length === 0 && <div className="connector-empty-state">当前服务端没有有效 allowlist，请在连接设置中配置并保存。</div>}
      {configured && availableForms.length > 0 && (
        <>
          {!authenticated && <div className="connector-inline-note" role="status">执行查询前，请先在连接设置中成功测试连接。</div>}
          <div className="connector-query-grid">
            <label className="connector-field">
              <span>FormId</span>
              <select value={formId} onChange={event => onFormIdChange(event.target.value)}>
                {availableForms.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="connector-field">
              <span>最大返回行数（1–200）</span>
              <input type="number" min={1} max={200} step={1} value={limit} onChange={event => onLimitChange(Number(event.target.value))} />
            </label>
            <fieldset className="connector-allowed-fields">
              <legend>允许字段</legend>
              {selectedFields.length === 0
                ? <span className="connector-field-empty">当前 FormId 没有可选字段。</span>
                : selectedFields.map(field => (
                  <label key={field}>
                    <input type="checkbox" checked={queryFields.includes(field)} onChange={event => onFieldToggle(field, event.target.checked)} />
                    {field}
                  </label>
                ))}
            </fieldset>
            <button type="button" className="secondary-button" onClick={onRun} disabled={loading || !authenticated || !queryFields.length}>
              {loading ? '查询中…' : '执行只读查询'}
            </button>
          </div>
          {error && <div className="connector-error" role="alert">{error}</div>}
          {result && <div className="connector-directory-meta" role="status">返回 {result.rows?.length ?? 0} 行{result.cached ? '（缓存结果）' : ''}</div>}
          {result?.rows && result.rows.length > 0 && (
            <div className="connector-table-wrap connector-query-results">
              <table>
                <thead><tr>{fields.map(field => <th key={field}>{field}</th>)}</tr></thead>
                <tbody>
                  {result.rows.slice(0, 20).map((row, index) => (
                    <tr key={index}>{fields.map(field => <td key={field}>{String(row[field] ?? '—').slice(0, 300)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <div className="connector-table-footnote">最多预览 20 行；单元格最多显示 300 个字符。</div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
