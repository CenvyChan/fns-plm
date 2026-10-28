import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from './api'

type Props = { formKey: string; versions: number[]; activeVersion?: number | null; onChange: () => void }
type VersionRecord = { definition?: Record<string, unknown>; bindingKey?: string | null; [key: string]: unknown }
type Binding = { nodeKey: string; version: number; processKey: string; bindingKey: string; [key: string]: unknown }
type DiffLine = { kind: '新增' | '删除' | '修改'; area: string; name: string; detail: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  let payload: any = null
  try { payload = await response.json() } catch { /* handled below */ }
  if (!response.ok) {
    const detail = payload?.message || payload?.error
    throw new Error(response.status === 403 ? `权限不足（HTTP 403）${detail ? `：${detail}` : '，请联系管理员'}` : detail || `请求失败（HTTP ${response.status}）`)
  }
  return payload as T
}
const label = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback
const pretty = (value: unknown) => JSON.stringify(value ?? null)
function makeDiff(left?: VersionRecord, right?: VersionRecord): DiffLine[] {
  if (!left || !right) return []
  const a = left.definition ?? {}, b = right.definition ?? {}, lines: DiffLine[] = []
  const fieldsA = Array.isArray(a.fields) ? a.fields as Record<string, unknown>[] : []
  const fieldsB = Array.isArray(b.fields) ? b.fields as Record<string, unknown>[] : []
  const keyed = (items: Record<string, unknown>[]) => new Map(items.map((field, index) => [String(field.id ?? field.key ?? `#${index + 1}`), field]))
  const ma = keyed(fieldsA), mb = keyed(fieldsB)
  for (const [id, field] of ma) {
    const next = mb.get(id), name = label(field.label, id)
    if (!next) lines.push({ kind: '删除', area: '字段', name, detail: `移除字段「${name}」` })
    else if (pretty(field) !== pretty(next)) {
      const changes = Object.keys({ ...field, ...next }).filter(key => pretty(field[key]) !== pretty(next[key]))
      const parts = changes.map(key => `${key}: ${pretty(field[key])} → ${pretty(next[key])}`)
      lines.push({ kind: '修改', area: '字段', name, detail: `「${name}」${parts.join('；')}` })
    }
  }
  for (const [id, field] of mb) if (!ma.has(id)) { const name = label(field.label, id); lines.push({ kind: '新增', area: '字段', name, detail: `新增字段「${name}」（${label(field.type, '未指定类型')}）` }) }
  if (pretty(fieldsA.map(f => f.id)) !== pretty(fieldsB.map(f => f.id)) && fieldsA.length === fieldsB.length && [...ma.keys()].every(id => mb.has(id))) lines.push({kind:'修改',area:'布局',name:'字段顺序',detail:'字段展示顺序已调整'})
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'fields') continue
    const x = a[key], y = b[key]
    if (pretty(x) === pretty(y)) continue
    if (key === 'sections' || key === 'events') {
      const aa = Array.isArray(x) ? x as any[] : [], bb = Array.isArray(y) ? y as any[] : []
      const identity = (v: any, i: number) => String(v?.id ?? v?.key ?? v?.name ?? v?.event ?? `第${i + 1}项`)
      const oldMap = new Map(aa.map((v, i) => [identity(v, i), v])), newMap = new Map(bb.map((v, i) => [identity(v, i), v]))
      for (const [id, old] of oldMap) {
        const newer = newMap.get(id)
        if (newer === undefined) lines.push({ kind: '删除', area: key === 'sections' ? '分区' : '事件', name: id, detail: `移除${key === 'sections' ? '分区' : '事件'}「${id}」` })
        else if (pretty(old) !== pretty(newer)) lines.push({ kind: '修改', area: key === 'sections' ? '分区' : '事件', name: id, detail: `「${id}」配置发生变化：${pretty(old)} → ${pretty(newer)}` })
      }
      for (const [id, value] of newMap) if (!oldMap.has(id)) lines.push({ kind: '新增', area: key === 'sections' ? '分区' : '事件', name: id, detail: `新增${key === 'sections' ? '分区' : '事件'}「${id}」${key === 'events' ? `（${label(value?.type, label(value?.event, '事件规则'))}）` : ''}` })
    } else lines.push({ kind: '修改', area: '表单配置', name: key, detail: `配置「${key}」由 ${pretty(x)} 改为 ${pretty(y)}` })
  }
  return lines
}

export default function FormVersionManager({ formKey, versions, activeVersion, onChange }: Props) {
  const sorted = useMemo(() => [...new Set(versions)].sort((a, b) => a - b), [versions])
  const [base, setBase] = useState<number>(sorted.length > 1 ? sorted[sorted.length - 2] : sorted[0] ?? 0)
  const [target, setTarget] = useState<number>(sorted[sorted.length - 1] ?? 0)
  const [activation, setActivation] = useState<number>(activeVersion ?? sorted.at(-1) ?? 0)
  const [records, setRecords] = useState<Record<number, VersionRecord>>({})
  const [bindings, setBindings] = useState<Binding[]>([])
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [processKey, setProcessKey] = useState(''), [nodeKey, setNodeKey] = useState(''), [bindingVersion, setBindingVersion] = useState(sorted.at(-1) ?? 0)
  const path = `/api/forms/${encodeURIComponent(formKey)}`

  useEffect(() => {
    setBase(sorted.length > 1 ? sorted[sorted.length - 2] : sorted[0] ?? 0)
    setTarget(sorted[sorted.length - 1] ?? 0)
    setBindingVersion(sorted[sorted.length - 1] ?? 0)
    setActivation(activeVersion ?? sorted.at(-1) ?? 0)
  }, [formKey, sorted])
  useEffect(() => {
    let alive = true
    if (!formKey || !sorted.length) { setRecords({}); setBindings([]); return }
    setLoading(true); setError('')
    Promise.all([
      ...sorted.map(async v => [v, await request<VersionRecord>(`${path}/versions/${v}`)] as const),
      request<{ bindings?: Binding[] }>(`${path}/bindings`),
    ]).then(results => {
      if (!alive) return
      const next: Record<number, VersionRecord> = {}
      for (const item of results.slice(0, sorted.length) as (readonly [number, VersionRecord])[]) next[item[0]] = item[1]
      setRecords(next); setBindings((results[sorted.length] as { bindings?: Binding[] }).bindings ?? [])
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : '加载版本信息失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [formKey, path, sorted])
  const diffs = useMemo(() => makeDiff(records[base], records[target]), [records, base, target])
  const runSave = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true); setError(''); setNotice('')
    try { await action(); setNotice(success); onChange() }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请稍后重试') }
    finally { setSaving(false) }
  }
  const activate = () => void runSave(() => request(`${path}/activate`, { method: 'POST', body: JSON.stringify({ version: activation }) }), `已将 v${activation} 设为激活回滚指针；发布版本及其既有绑定均未修改。`)
  const addBinding = (event: React.FormEvent) => {
    event.preventDefault()
    if (!nodeKey.trim() || !processKey.trim() || !bindingVersion) { setError('请填写流程标识、节点标识并选择版本。'); return }
    void runSave(async () => {
      await request(`${path}/bindings/${encodeURIComponent(nodeKey.trim())}`, { method: 'PUT', body: JSON.stringify({ version: bindingVersion, processKey: processKey.trim() }) })
      const result = await request<{ bindings?: Binding[] }>(`${path}/bindings`)
      setBindings(result.bindings ?? []); setNodeKey('')
    }, 'PLM 绑定登记已保存（仅登记，未部署 Flowable 或完成真实任务）。')
  }
  return <section className="fd-version-manager fd-panel" aria-busy={loading || saving}>
    <header><h2>版本与流程绑定</h2><p>比较已发布版本、切换激活回滚指针，并登记节点绑定。</p></header>
    {(error || notice) && <div className={error ? 'fd-error' : 'fd-notice'} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    <div className="fd-two">
      <label>比较基准版本<select aria-label="比较基准版本" value={base || ''} disabled={loading} onChange={e => setBase(Number(e.target.value))}><option value="" disabled>请选择</option>{sorted.map(v => <option key={v} value={v}>v{v}</option>)}</select></label>
      <label>比较目标版本<select aria-label="比较目标版本" value={target || ''} disabled={loading} onChange={e => setTarget(Number(e.target.value))}><option value="" disabled>请选择</option>{sorted.map(v => <option key={v} value={v}>v{v}</option>)}</select></label>
    </div>
    <div className="fd-panel" aria-live="polite"><h3>结构差异摘要 {base && target ? `· v${base} → v${target}` : ''}</h3>
      {loading ? <p>正在读取版本结构…</p> : !base || !target ? <p>暂无可比较的发布版本。</p> : base === target ? <p>请选择两个不同版本以查看结构差异。</p> : diffs.length ? <ul>{diffs.map((item, i) => <li key={`${item.area}-${item.name}-${i}`}><strong>{item.kind}</strong> · {item.area}：{item.detail}</li>)}</ul> : <p>字段、分区、事件及表单配置均无差异。</p>}
    </div>
    <div className="fd-panel"><h3>激活历史版本</h3><p>当前激活版本：{activeVersion == null ? '未设置' : `v${activeVersion}`}。激活仅切换回滚指针，明确不会修改任何已发布版本或既有节点绑定。</p>
      <label>激活版本<select aria-label="激活版本" value={activation || ''} disabled={!sorted.length || saving} onChange={e => setActivation(Number(e.target.value))}><option value="" disabled>请选择版本</option>{sorted.map(v => <option key={v} value={v}>v{v}</option>)}</select></label> <button type="button" className="fd-primary" disabled={!activation || activation === activeVersion || saving} onClick={activate}>{saving ? '保存中…' : '激活所选版本'}</button>
    </div>
    <div className="fd-panel"><h3>登记流程节点绑定</h3><p>此操作只在 PLM 登记流程与表单版本关系，不会部署到 Flowable，也不会启动或完成真实流程任务。</p>
      <form className="fd-two" onSubmit={addBinding}>
        <label>流程标识 processKey<input value={processKey} onChange={e => setProcessKey(e.target.value)} placeholder="例如 change_request" /></label>
        <label>节点标识 nodeKey<input value={nodeKey} onChange={e => setNodeKey(e.target.value)} placeholder="例如 approval" /></label>
        <label>表单版本<select aria-label="节点绑定版本" value={bindingVersion || ''} disabled={!sorted.length || saving} onChange={e => setBindingVersion(Number(e.target.value))}><option value="" disabled>请选择版本</option>{sorted.map(v => <option key={v} value={v}>v{v}</option>)}</select></label>
        <div><button type="submit" className="fd-primary" disabled={saving || loading || !sorted.length}>{saving ? '保存中…' : '保存绑定登记'}</button></div>
      </form>
      <h4>现有绑定（bindingKey 为固定登记标识）</h4>
      {loading ? <p>正在加载绑定…</p> : bindings.length ? <ul>{bindings.map((item, i) => <li key={`${item.nodeKey}-${item.bindingKey}-${i}`}><strong>{item.processKey}</strong> / {item.nodeKey} · v{item.version} · bindingKey：<code>{item.bindingKey}</code></li>)}</ul> : <p>暂无已登记绑定。</p>}
    </div>
  </section>
}
