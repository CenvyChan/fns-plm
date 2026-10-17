import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Archive, Check, Coins, Database, Link2, RefreshCw, Save, Users } from 'lucide-react'
import { apiFetch } from './api'
import LegacyDailyReportMigration from './LegacyDailyReportMigration'
import './daily-reporting-admin.css'

type PartyKind = 'customer' | 'supplier'
type Party = { id: string; kind: PartyKind; name: string; aliases: string[]; active: boolean; k3Number: string; legacyCompanyCode: string; legacyId: string; source: 'manual' | 'legacy-import'; updatedAt: string }
type Rate = { id: string; month: string; currency: 'USD'; targetCurrency: 'CNY'; rate: string; source: 'manual' | 'legacy-import'; legacyCompanyCode?: string; updatedAt: string }
type Assignment = { id: string; kind: PartyKind; partyId: string | null; userId: string | null; legacyCompanyCode: string; legacyPartyId: string; legacyUserId: string; legacyUsername: string; legacyUserName: string; status: 'unmapped' | 'party-unmapped' | 'member-unmapped' | 'mapped'; updatedAt: string }
type PartyMapping = { id: string; kind: PartyKind; k3Number: string; k3Name: string; partyId: string | null; status: 'PENDING' | 'MANUAL' | 'UNMATCHED'; legacyStatus: string; legacyPartyId: string; legacyCompanyCode: string; candidates: Array<{ legacyId?: string; name: string; score?: number }>; updatedAt: string; updatedBy: string }
type Member = { id: string; displayName: string; role: string; disabled: boolean }
type LegacyMembership = { id: string; legacyCompanyCode: string; legacyUserId: string; legacyUsername: string; legacyUserName: string; legacyGroups: string[]; legacyActive: boolean; legacyMustChangePassword: boolean; status: 'member-unmapped'; updatedAt: string }
type ImportBatch = { id: string; category: string; sourceCompanyCode: string; rowCount: number; inserted: number; skipped: number; conflicts: number; digest: string; createdAt: string; createdBy: string }
type MirrorRecord = { number: string; name: string; status: string }
type Management = { masterDataConfigured: boolean; parties: Party[]; exchangeRates: Rate[]; assignments: Assignment[]; partyMappings: PartyMapping[]; legacyMemberships: LegacyMembership[]; importBatches: ImportBatch[]; members: Member[]; k3Parties: { customerCount: number; supplierCount: number; lastSyncedAt: string | null }; migrationScope: { tenantId: string; tenantName: string; organizationId: string; organizationName: string; accountId: string; accountName: string; accountCode: string } }
type Tab = 'parties' | 'rates' | 'assignments' | 'mappings'

const KIND_LABEL: Record<PartyKind, string> = { customer: '客户', supplier: '供应商' }
const roleLabel = (value: string) => ({ admin: '管理员', plm_manager: 'PLM 经理', member: '成员', reviewer: '审阅者' } as Record<string, string>)[value] ?? value
const dateTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '—'

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path)
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
  if (!response.ok) { const error = new Error(body?.message || body?.error || `请求失败（HTTP ${response.status}）`) as Error & { status?: number }; error.status = response.status; throw error }
  return body as T
}
async function writeJson<T>(path: string, method: string, payload: unknown): Promise<T> {
  const response = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
  if (!response.ok) throw new Error(body?.message || body?.error || `保存失败（HTTP ${response.status}）`)
  return body as T
}

export default function DailyReportingManagement({ onChanged }: { onChanged: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Management | null>(null)
  const [tab, setTab] = useState<Tab>('parties')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [partyKind, setPartyKind] = useState<PartyKind>('customer')
  const [partyName, setPartyName] = useState('')
  const [partyAliases, setPartyAliases] = useState('')
  const [partyK3, setPartyK3] = useState('')
  const [legacyCompanyCode, setLegacyCompanyCode] = useState('')
  const [legacyId, setLegacyId] = useState('')
  const [editingPartyId, setEditingPartyId] = useState('')

  const [rateMonth, setRateMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rateValue, setRateValue] = useState('')
  const [assignmentKind, setAssignmentKind] = useState<PartyKind>('customer')
  const [assignmentPartyId, setAssignmentPartyId] = useState('')
  const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([])
  const [assignmentSelections, setAssignmentSelections] = useState<Record<string, { partyId: string; userId: string }>>({})
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({})
  const [mirrorByMapping, setMirrorByMapping] = useState<Record<string, { records: MirrorRecord[]; total: number; lastSyncedAt: string | null }>>({})

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const [management, batchResult] = await Promise.all([
        readJson<Omit<Management, 'importBatches'>>('/api/daily-reporting/management'),
        readJson<{ batches: ImportBatch[] }>('/api/daily-reporting/migration/batches'),
      ])
      setData({ ...management, importBatches: batchResult.batches })
      setAllowed(true)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '日报业务设置加载失败'
      if ((caught as { status?: number })?.status === 403) setAllowed(false)
      else { setAllowed(true); setError(message) }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!data) return
    setAssignmentSelections(current => {
      const next = { ...current }
      for (const item of data.assignments) if (!next[item.id]) next[item.id] = { partyId: item.partyId ?? '', userId: item.userId ?? '' }
      return next
    })
    setMappingSelections(current => {
      const next = { ...current }
      for (const item of data.partyMappings) if (!(item.id in next)) next[item.id] = item.partyId ?? ''
      return next
    })
  }, [data])

  const activeParties = useMemo(() => data?.parties.filter(item => item.active) ?? [], [data])
  const partyList = useMemo(() => [...(data?.parties ?? [])].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh-CN')), [data])
  const members = useMemo(() => data?.members.filter(item => !item.disabled) ?? [], [data])
  const partyNameById = useMemo(() => new Map((data?.parties ?? []).map(item => [item.id, item.name])), [data])
  const memberById = useMemo(() => new Map((data?.members ?? []).map(item => [item.id, item])), [data])

  const submitParty = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const prior = data?.parties.find(item => item.id === editingPartyId)
    const payload = { kind: partyKind, name: partyName.trim(), aliases: partyAliases.split(/[\n,;；，]/).map(item => item.trim()).filter(Boolean), k3Number: partyK3.trim(), legacyCompanyCode: legacyCompanyCode.trim().toUpperCase(), legacyId: legacyId.trim(), ...(editingPartyId ? { active: prior?.active ?? true } : {}) }
    try {
      await writeJson(editingPartyId ? `/api/daily-reporting/masters/${encodeURIComponent(editingPartyId)}` : '/api/daily-reporting/masters', editingPartyId ? 'PATCH' : 'POST', payload)
      setNotice(editingPartyId ? '客商主档已更新。' : '客商主档已新增。')
      resetPartyForm(); await load(true); onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '主档保存失败') }
    finally { setBusy(false) }
  }
  const resetPartyForm = () => { setEditingPartyId(''); setPartyName(''); setPartyAliases(''); setPartyK3(''); setLegacyCompanyCode(''); setLegacyId('') }
  const editParty = (party: Party) => { setTab('parties'); setEditingPartyId(party.id); setPartyKind(party.kind); setPartyName(party.name); setPartyAliases(party.aliases.join('，')); setPartyK3(party.k3Number); setLegacyCompanyCode(party.legacyCompanyCode); setLegacyId(party.legacyId) }
  const toggleParty = async (party: Party) => {
    setBusy(true); setError(''); setNotice('')
    try {
      await writeJson(`/api/daily-reporting/masters/${encodeURIComponent(party.id)}`, 'PATCH', { ...party, active: !party.active })
      setNotice(`${KIND_LABEL[party.kind]}「${party.name}」已${party.active ? '停用' : '启用'}。`); await load(true); onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '主档状态更新失败') }
    finally { setBusy(false) }
  }
  const saveRate = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await writeJson('/api/daily-reporting/exchange-rates', 'PUT', { month: rateMonth, rate: rateValue })
      setNotice(`${rateMonth} USD→CNY 月汇率已保存；既有日报记录中的历史汇率不变。`); setRateValue(''); await load(true); onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '月汇率保存失败') }
    finally { setBusy(false) }
  }
  const saveAssignments = async (event: FormEvent) => {
    event.preventDefault(); if (!assignmentPartyId) return
    setBusy(true); setError(''); setNotice('')
    try {
      await writeJson('/api/daily-reporting/assignments', 'POST', { kind: assignmentKind, partyId: assignmentPartyId, userIds: assignmentUserIds })
      setNotice(`已保存 ${KIND_LABEL[assignmentKind]}归属：${assignmentUserIds.length} 位当前账套成员。`); await load(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '人员归属保存失败') }
    finally { setBusy(false) }
  }
  const mapLegacyAssignment = async (item: Assignment) => {
    const selected = assignmentSelections[item.id]
    if (!selected?.partyId || !selected?.userId) { setError('请同时选择 PLM 客商和当前账套成员。'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await writeJson(`/api/daily-reporting/assignments/${encodeURIComponent(item.id)}`, 'PUT', selected)
      setNotice(`已将旧归属关系映射到「${partyNameById.get(selected.partyId) ?? '客商'}」与所选 PLM 成员。`); await load(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '旧归属映射失败') }
    finally { setBusy(false) }
  }
  const verifyMirror = async (item: PartyMapping) => {
    setError('')
    try {
      const result = await readJson<{ records: MirrorRecord[]; total: number; lastSyncedAt: string | null }>(`/api/daily-reporting/k3-party-mirror?kind=${item.kind}&q=${encodeURIComponent(item.k3Number)}`)
      setMirrorByMapping(current => ({ ...current, [item.id]: result }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'K3 客商核验失败') }
  }
  const confirmMapping = async (item: PartyMapping) => {
    const partyId = mappingSelections[item.id]
    if (!partyId) { setError('请先选择 PLM 中的目标客户/供应商。'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await writeJson(`/api/daily-reporting/party-mappings/${encodeURIComponent(item.id)}`, 'PUT', { partyId })
      setNotice(`K3 ${item.k3Number} 已人工映射到「${partyNameById.get(partyId) ?? '所选客商'}」。`); await load(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '客商映射保存失败') }
    finally { setBusy(false) }
  }

  if (allowed === false || allowed === null) return null
  return <section className="iw-card dr-admin" aria-label="日报业务设置">
    <div className="iw-card-head"><div><div className="iw-eyebrow">DAILY REPORTING / ADMIN</div><h2>日报业务设置</h2><p>按当前 tenant / organization / account 隔离。只有管理员和 PLM 经理能维护主档、汇率、归属与 K3 映射；不会创建用户或扩大权限。</p></div><button className="iw-button iw-secondary iw-small" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={13}/>刷新</button></div>
    {error && <div className="iw-alert iw-error" role="alert">{error}</div>}{notice && <div className="iw-alert iw-success" role="status">{notice}</div>}
    {data && <>
      <LegacyDailyReportMigration scope={data.migrationScope} onChanged={() => { void load(true); onChanged() }}/>
      <div className="dr-admin-tabs" role="tablist" aria-label="日报业务设置功能">
        <button className={tab === 'parties' ? 'is-active' : ''} onClick={() => setTab('parties')}><Database size={14}/>客户 / 供应商</button>
        <button className={tab === 'rates' ? 'is-active' : ''} onClick={() => setTab('rates')}><Coins size={14}/>月汇率</button>
        <button className={tab === 'assignments' ? 'is-active' : ''} onClick={() => setTab('assignments')}><Users size={14}/>人员归属</button>
        <button className={tab === 'mappings' ? 'is-active' : ''} onClick={() => setTab('mappings')}><Link2 size={14}/>K3 客商映射</button>
      </div>

      {tab === 'parties' && <div className="dr-admin-grid">
        <form className="dr-admin-form" onSubmit={submitParty}>
          <h3>{editingPartyId ? '编辑客商主档' : '新增客户 / 供应商'}</h3>
          <label>主档类型<select value={partyKind} onChange={event => setPartyKind(event.target.value as PartyKind)}><option value="customer">客户</option><option value="supplier">供应商</option></select></label>
          <label>名称<input value={partyName} onChange={event => setPartyName(event.target.value)} maxLength={120} required/></label>
          <label className="dr-admin-wide">别名（逗号分隔）<input value={partyAliases} onChange={event => setPartyAliases(event.target.value)} placeholder="用于人工查找，不会自动合并"/></label>
          <label>K3 编码（可选）<input value={partyK3} onChange={event => setPartyK3(event.target.value)} maxLength={128}/></label>
          <label>旧公司代码<input value={legacyCompanyCode} onChange={event => setLegacyCompanyCode(event.target.value)} placeholder="如 FNS / NBHH" maxLength={32}/></label>
          <label className="dr-admin-wide">旧主键<input value={legacyId} onChange={event => setLegacyId(event.target.value)} maxLength={128}/></label>
          <div className="dr-admin-form-actions"><button className="iw-button iw-approve iw-small" disabled={busy}><Save size={13}/>{editingPartyId ? '保存修改' : '新增主档'}</button>{editingPartyId && <button type="button" className="iw-button iw-secondary iw-small" onClick={resetPartyForm}>取消编辑</button>}</div>
          <p className="dr-admin-help">名称、别名、K3 编码和旧系统主键均会做账套内重复检查。旧系统导入记录只作为 PLM 日报主档，不写入 K3Cloud 镜像。</p>
        </form>
        <div className="dr-admin-table-block"><h3>当前账套主档 · {partyList.length} 条</h3><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>类型 / 状态</th><th>名称 / 别名</th><th>K3 / 旧系统键</th><th>来源</th><th>操作</th></tr></thead><tbody>{partyList.map(item => <tr key={item.id}><td>{KIND_LABEL[item.kind]}<small>{item.active ? '启用' : '停用'}</small></td><td><b>{item.name}</b><small>{item.aliases.join('、') || '—'}</small></td><td>{item.k3Number || '—'}<small>{item.legacyCompanyCode && item.legacyId ? `${item.legacyCompanyCode} / ${item.legacyId}` : '—'}</small></td><td>{item.source === 'legacy-import' ? '旧系统候选' : 'PLM 手工'}</td><td><div className="dr-admin-actions"><button className="iw-button iw-secondary iw-small" onClick={() => editParty(item)}>编辑</button><button className="iw-button iw-secondary iw-small" onClick={() => void toggleParty(item)} disabled={busy}>{item.active ? '停用' : '启用'}</button></div></td></tr>)}</tbody></table>{!partyList.length && <div className="iw-empty">尚无客户或供应商主档。可先手工新增，或由管理员后续导入旧系统候选数据。</div>}</div></div>
      </div>}

      {tab === 'rates' && <div className="dr-admin-grid dr-admin-rates-grid">
        <form className="dr-admin-form" onSubmit={saveRate}><h3>维护 USD → CNY 月汇率</h3><label>月份<input type="month" value={rateMonth} onChange={event => setRateMonth(event.target.value)} required/></label><label>汇率<input type="number" min="0.0001" step="0.0001" value={rateValue} onChange={event => setRateValue(event.target.value)} placeholder="例如 7.1234" required/></label><div className="dr-admin-form-actions"><button className="iw-button iw-approve iw-small" disabled={busy}><Save size={13}/>保存月汇率</button></div><p className="dr-admin-help">月汇率保存后，录入 USD 日报时按业务日期自动带入；表单仍允许逐笔调整。日报中已保存的历史汇率与人民币金额不会被改写。</p></form>
        <div className="dr-admin-table-block"><h3>月汇率历史 · {data.exchangeRates.length} 个月</h3><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>月份</th><th>汇率方向</th><th>汇率</th><th>来源 / 公司</th><th>更新</th></tr></thead><tbody>{[...data.exchangeRates].sort((a, b) => b.month.localeCompare(a.month)).map(item => <tr key={item.id}><td><b>{item.month}</b></td><td>USD → CNY</td><td>{item.rate}</td><td>{item.source === 'legacy-import' ? `旧系统${item.legacyCompanyCode ? ` · ${item.legacyCompanyCode}` : ''}` : 'PLM 手工'}</td><td>{dateTime(item.updatedAt)}</td></tr>)}</tbody></table>{!data.exchangeRates.length && <div className="iw-empty">尚无月汇率；新增后将用于对应月份新录入的 USD 日报。</div>}</div></div>
      </div>}

      {tab === 'assignments' && <div className="dr-admin-stack">
        <form className="dr-admin-inline-form" onSubmit={saveAssignments}><b>新建客商归属</b><label>类型<select value={assignmentKind} onChange={event => { setAssignmentKind(event.target.value as PartyKind); setAssignmentPartyId('') }}><option value="customer">客户</option><option value="supplier">供应商</option></select></label><label>客商<select value={assignmentPartyId} onChange={event => setAssignmentPartyId(event.target.value)} required><option value="">选择启用客商</option>{activeParties.filter(item => item.kind === assignmentKind).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="dr-admin-members">PLM 成员（可多选）<select multiple value={assignmentUserIds} onChange={event => setAssignmentUserIds([...event.currentTarget.selectedOptions].map(option => option.value))}>{members.map(item => <option key={item.id} value={item.id}>{item.displayName} · {roleLabel(item.role)}</option>)}</select></label><button className="iw-button iw-approve iw-small" disabled={busy || !assignmentPartyId}><Save size={13}/>保存归属</button></form>
        <p className="dr-admin-help">只能从当前账套中选择已启用成员；新建归属不会邀请用户或扩大 PLM 权限。成员日报表单只显示分配给该成员的客商。</p>
        <div className="dr-admin-table-block"><h3>旧系统归属映射 · {data.assignments.filter(item => item.legacyUserId).length} 条待核对关系</h3><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>旧关系</th><th>PLM 客商</th><th>PLM 成员</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.assignments.map(item => {
          const selected = assignmentSelections[item.id] ?? { partyId: item.partyId ?? '', userId: item.userId ?? '' }
          const unresolved = !item.partyId || !item.userId
          return <tr key={item.id}><td>{KIND_LABEL[item.kind]} · {item.legacyCompanyCode || 'PLM'} / {item.legacyPartyId || '—'}<small>{item.legacyUserName || item.legacyUsername || item.legacyUserId || '当前 PLM 归属'}</small></td><td>{unresolved ? <select value={selected.partyId} onChange={event => setAssignmentSelections(current => ({ ...current, [item.id]: { ...selected, partyId: event.target.value } }))}><option value="">选择匹配客商</option>{activeParties.filter(party => party.kind === item.kind).map(party => <option key={party.id} value={party.id}>{party.name}</option>)}</select> : partyNameById.get(item.partyId!) ?? '已关联客商'}</td><td>{unresolved ? <select value={selected.userId} onChange={event => setAssignmentSelections(current => ({ ...current, [item.id]: { ...selected, userId: event.target.value } }))}><option value="">选择当前账套成员</option>{members.map(member => <option key={member.id} value={member.id}>{member.displayName} · {roleLabel(member.role)}</option>)}</select> : memberById.get(item.userId!)?.displayName ?? '成员不可用'}</td><td><span className={`dr-admin-status ${item.status}`}>{item.status === 'mapped' ? '已映射' : item.status === 'party-unmapped' ? '待匹配客商' : '待匹配成员'}</span></td><td>{unresolved && <button className="iw-button iw-secondary iw-small" onClick={() => void mapLegacyAssignment(item)} disabled={busy}>确认映射</button>}</td></tr>
        })}</tbody></table>{!data.assignments.length && <div className="iw-empty">暂无归属记录。可在上方按客商直接分配现有 PLM 成员。</div>}</div></div>
        <div className="dr-admin-table-block"><h3>旧系统成员待核对 · {data.legacyMemberships.length} 条</h3><p className="dr-admin-help">只保留身份、旧群组和密码策略事实；不迁移密码、会话或 MFA，不自动创建 PLM 账号，也不授予任何 PLM 角色。需人工确认身份后另行处理。</p><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>旧身份 / 公司</th><th>旧群组（未转成 PLM 权限）</th><th>旧状态</th><th>密码策略留痕</th><th>PLM 状态</th></tr></thead><tbody>{data.legacyMemberships.map(item => <tr key={item.id}><td><b>{item.legacyUserName || item.legacyUsername || item.legacyUserId}</b><small>{item.legacyCompanyCode} · {item.legacyUserId}{item.legacyUsername ? ` · ${item.legacyUsername}` : ''}</small></td><td>{item.legacyGroups.join('、') || '—'}</td><td>{item.legacyActive ? '旧系统启用' : '旧系统停用'}<small>{dateTime(item.updatedAt)}</small></td><td>{item.legacyMustChangePassword ? '旧系统曾要求首次改密' : '无首次改密标记'}<small>口令本身未迁移</small></td><td><span className="dr-admin-status party-unmapped">待人工确认</span><small>未建立 PLM 用户或角色</small></td></tr>)}</tbody></table>{!data.legacyMemberships.length && <div className="iw-empty">暂无旧成员映射清单。</div>}</div></div>
      </div>}

      {tab === 'mappings' && <div className="dr-admin-stack">
        <div className="dr-admin-banner"><Database size={15}/><span>当前 K3Cloud 镜像：客户 {data.k3Parties.customerCount} 条、供应商 {data.k3Parties.supplierCount} 条；最近同步 {dateTime(data.k3Parties.lastSyncedAt ?? '')}。下方每条映射均需人工确认，不按名称自动合并。</span></div>
        <div className="iw-table-wrap dr-admin-table dr-mapping-table"><table><thead><tr><th>旧 M13 / K3 客商</th><th>PLM 当前客商</th><th>K3 镜像核验</th><th>状态 / 旧候选</th><th>操作</th></tr></thead><tbody>{data.partyMappings.map(item => {
          const mirror = mirrorByMapping[item.id]
          const exact = mirror?.records.find(record => record.number === item.k3Number)
          const selectedId = mappingSelections[item.id] ?? item.partyId ?? ''
          return <tr key={item.id}><td><b>{KIND_LABEL[item.kind]} · {item.k3Number}</b><small>{item.k3Name} · 旧 {item.legacyCompanyCode}/{item.legacyPartyId || '—'}</small></td><td><select value={selectedId} onChange={event => setMappingSelections(current => ({ ...current, [item.id]: event.target.value }))}><option value="">选择当前 PLM 客商</option>{activeParties.filter(party => party.kind === item.kind).map(party => <option key={party.id} value={party.id}>{party.name}{party.k3Number ? ` · ${party.k3Number}` : ''}</option>)}</select></td><td><button className="iw-button iw-secondary iw-small" onClick={() => void verifyMirror(item)}><RefreshCw size={12}/>核验 K3 编码</button>{mirror && <small className={exact ? 'dr-admin-match' : 'dr-admin-no-match'}>{exact ? `命中：${exact.number} · ${exact.name} · ${exact.status}` : `未命中编码 ${item.k3Number}`} · 检索 ${mirror.records.length}/${mirror.total} 条{mirror.lastSyncedAt ? ` · ${dateTime(mirror.lastSyncedAt)}` : ''}</small>}</td><td><span className={`dr-admin-status ${item.status}`}>{item.status === 'MANUAL' ? 'PLM 人工确认' : item.status === 'PENDING' ? '待人工确认' : '旧系统未匹配'}</span><small>旧状态：{item.legacyStatus}{item.candidates.length ? ` · 候选：${item.candidates.slice(0, 3).map(candidate => candidate.name).join('、')}` : ''}</small></td><td><button className="iw-button iw-approve iw-small" onClick={() => void confirmMapping(item)} disabled={busy || !selectedId}><Check size={12}/>确认映射</button></td></tr>
        })}</tbody></table>{!data.partyMappings.length && <div className="iw-empty">暂无待复核的 K3 客商映射。导入旧系统候选后会显示在此处；旧 AUTO/MANUAL 状态不会被直接信任。</div>}</div>
      </div>}

      <details className="dr-admin-batches"><summary><Archive size={13}/> 旧数据导入批次审计 · {data.importBatches.length} 批</summary><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>类别 / 公司</th><th>行数</th><th>新增 / 跳过 / 冲突</th><th>时间</th></tr></thead><tbody>{data.importBatches.slice(0, 20).map(batch => <tr key={batch.id}><td>{batch.category} · {batch.sourceCompanyCode}</td><td>{batch.rowCount}</td><td>{batch.inserted} / {batch.skipped} / {batch.conflicts}</td><td>{dateTime(batch.createdAt)}</td></tr>)}</tbody></table>{!data.importBatches.length && <div className="iw-empty">暂无旧系统主数据、汇率、归属或映射导入批次。</div>}</div></details>
    </>}
    {loading && <div className="iw-empty">正在加载日报业务设置…</div>}
  </section>
}
