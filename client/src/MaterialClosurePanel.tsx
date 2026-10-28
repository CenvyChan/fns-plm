import { useEffect, useMemo, useState } from 'react'
import './material-closure.css'
import { apiJson, jsonRequest } from './api'
import { requestWorkspace } from './data'
import type { Material, WorkspaceData } from './types'
import MaterialSelect from './MaterialSelect'

type Kind = 'finished' | 'mould' | 'injection' | 'metal-blank' | 'metal-treated' | 'raw'
type SourceRow = { id: string; number: string; name: string; specification: string; unit: string; groupNumber: string; groupId: string }
type SourceResponse = { snapshot: { id: string; source: 'k3cloud'; syncedAt: string } | null; rows: SourceRow[]; notice: string }
type Preview = { blocked: boolean; reasons: string[]; code?: string; serialWidth?: number; notice: string }
type AuditResponse = { events: Array<Record<string, unknown>> }
const kinds: { id: Kind; label: string }[] = [{ id: 'raw', label: '原材料（当前可执行）' }, { id: 'finished', label: '成品（待确认）' }, { id: 'mould', label: '模具（待确认）' }, { id: 'injection', label: '注塑件（待确认）' }, { id: 'metal-blank', label: '五金毛坯（待确认）' }, { id: 'metal-treated', label: '五金表面处理（待确认）' }]

export default function MaterialClosurePanel({ workspace, onChange, onToast }: { workspace: WorkspaceData; onChange: (data: WorkspaceData) => void; onToast: (message: string) => void }) {
  const [query, setQuery] = useState(''), [source, setSource] = useState<SourceResponse>({ snapshot: null, rows: [], notice: '' })
  const [selectedSource, setSelectedSource] = useState(''), [selectedDraft, setSelectedDraft] = useState(''), [kind, setKind] = useState<Kind>('raw'), [prefix, setPrefix] = useState('')
  const [name, setName] = useState(''), [specification, setSpecification] = useState(''), [unit, setUnit] = useState('件')
  const [preview, setPreview] = useState<Preview | null>(null), [audit, setAudit] = useState<AuditResponse | null>(null), [busy, setBusy] = useState(false)
  const drafts = useMemo(() => workspace.materials.filter(item => item.templateSourceId), [workspace.materials])
  const active = drafts.find(item => item.id === selectedDraft)
  useEffect(() => { setPrefix(kind === 'raw' && active?.erpGroupNumber ? `${active.erpGroupNumber}.` : ''); setPreview(null) }, [active?.id, active?.erpGroupNumber, kind])
  const dirty = !!active && (name !== active.name || specification !== active.specification || unit !== active.unit)
  const reserved = active?.codeState === 'reserved'
  const loadSource = async (refresh = false) => {
    if (busy) return
    setBusy(true)
    try { const result = await apiJson<SourceResponse>(refresh ? '/api/material-closure/source/refresh' : `/api/material-closure/source?q=${encodeURIComponent(query)}`, refresh ? jsonRequest('POST') : {}); setSource(result); onToast(refresh ? 'K3Cloud 只读刷新完成；未向 ERP 写入' : 'K3Cloud 来源已读取') }
    catch (e) { onToast(`读取 K3 来源失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }
  useEffect(() => { void loadSource() }, [])
  const chooseKind = (value: Kind) => { setKind(value); setPreview(null); setPrefix(value === 'raw' && active?.erpGroupNumber ? `${active.erpGroupNumber}.` : '') }
  const save = async () => {
    if (!active || busy) return
    setBusy(true)
    try { await apiJson(`/api/material-closure/drafts/${encodeURIComponent(active.id)}`, jsonRequest('PATCH', { name, specification, unit })); onChange(await requestWorkspace()); setPreview(null); onToast('草稿已保存并从工作区回读') }
    catch (e) { onToast(`保存失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }
  const create = async (rowId = selectedSource) => {
    if (busy) return
    if (!rowId) { onToast('请先选择 K3 来源物料'); return }
    setBusy(true)
    try { const material = await apiJson<Material>('/api/material-closure/drafts', jsonRequest('POST', { sourceId: rowId })); onChange(await requestWorkspace()); setSelectedDraft(material.id); setName(material.name); setSpecification(material.specification); setUnit(material.unit); setPreview(null); onToast('已复制为 PLM 本地草稿；ERP 未创建') }
    catch (e) { onToast(`复制草稿失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }
  const runPreview = async () => { if (!active || busy || dirty || reserved) { if (dirty) onToast('草稿有未保存修改，请先保存后再预览'); return } setBusy(true); try { setPreview(await apiJson<Preview>(`/api/material-closure/drafts/${encodeURIComponent(active.id)}/preview`, jsonRequest('POST', { kind, prefix }))) } catch (e) { onToast(`编码预览失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) } }
  const allocate = async () => { if (!active || kind !== 'raw' || !preview || preview.blocked || busy || dirty || reserved) { if (dirty) onToast('草稿有未保存修改，请先保存后再分配'); return } setBusy(true); try { await apiJson(`/api/material-closure/drafts/${encodeURIComponent(active.id)}/allocate`, jsonRequest('POST', { kind, prefix })); onChange(await requestWorkspace()); setPreview(null); onToast('正式编号已在 PLM 本地原子保留；未创建 ERP 物料') } catch (e) { onToast(`分配失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) } }
  const showAudit = async () => { if (!active || busy) return; setBusy(true); try { setAudit(await apiJson<AuditResponse>(`/api/material-closure/drafts/${encodeURIComponent(active.id)}/audit`)) } catch (e) { onToast(`读取审计失败：${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) } }
  const copySimilar = (row: SourceRow) => { setSelectedSource(row.id); void create(row.id) }
  const prefixHelp = kind === 'raw' ? '当前唯一可执行规则：原材料前缀由当前草稿来源 K3 分组完整编码 + “.” 自动计算，最后流水号 5 位。' : '该类别目前仅可查看后端预览及阻断原因，不可分配。示例 2.01.02.0317### 存在分段歧义，不能按未解释的固定文字直接出码；须先确认规则并建立本地目录唯一映射。'
  return <section className="panel plm-panel material-closure-panel"><div className="toolbar-title"><b>物料闭环 · K3 来源 → PLM 草稿 → 编码预览</b><span>分配仅在 PLM 本地保留，不等同 ERP 创建</span></div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索来源编码、名称、规格/型号"/><button className="secondary-button" disabled={busy} onClick={() => void loadSource()}>搜索来源</button><button className="secondary-button" disabled={busy} onClick={() => void loadSource(true)}>刷新来源（只读 K3，不写 ERP）</button></div>
    <small>{source.notice}{source.snapshot && ` · 快照 ${source.snapshot.id} · ${new Date(source.snapshot.syncedAt).toLocaleString()}`}</small>
    <div className="material-closure-columns"><div><b>来源物料 / 相似项</b><div style={{ maxHeight: 220, overflow: 'auto' }}>{source.rows.map(row => <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #ddd', padding: 8 }}><input type="radio" name="closure-source" checked={selectedSource === row.id} onChange={() => setSelectedSource(row.id)}/><span style={{ flex: 1 }}><b>{row.number} · {row.name}</b><small style={{ display: 'block' }}>{row.specification} · {row.unit} · {row.groupNumber}</small></span><button className="secondary-button" disabled={busy} onClick={() => copySimilar(row)}>复制草稿</button></div>)}</div><button className="primary-button" disabled={busy || !selectedSource} onClick={() => void create()}>从所选来源建 PLM 草稿</button></div>
    <div><b>草稿编辑与编码闭环</b><MaterialSelect label="来源复制草稿" materials={drafts} value={selectedDraft} disabled={busy} placeholder="选择来源复制产生的草稿" onChange={id => { const item = drafts.find(x => x.id === id); setSelectedDraft(id); setName(item?.name ?? ''); setSpecification(item?.specification ?? ''); setUnit(item?.unit ?? '件'); setPreview(null); setAudit(null) }}/>
    {active && <><input aria-label="名称" value={name} disabled={busy || reserved} onChange={e => setName(e.target.value)} placeholder="名称"/><input aria-label="规格" value={specification} disabled={busy || reserved} onChange={e => setSpecification(e.target.value)} placeholder="规格"/><input aria-label="单位" value={unit} disabled={busy || reserved} onChange={e => setUnit(e.target.value)} placeholder="单位"/><button className="secondary-button" disabled={busy || reserved || !dirty} onClick={() => void save()}>保存差异</button>{reserved && <small style={{ display: 'block' }}>该草稿编号已保留，禁止继续编辑、预览或分配；可查看审计。</small>}<div style={{ marginTop: 12 }}><select value={kind} disabled={busy || reserved} onChange={e => chooseKind(e.target.value as Kind)}>{kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select><input value={prefix} readOnly={kind === 'raw'} disabled={busy || reserved} onChange={e => { setPrefix(e.target.value); setPreview(null) }} placeholder="编码前缀"/><small style={{ display: 'block' }}>{prefixHelp}</small><small style={{ display: 'block' }}>半成品示例 2.01.02.0317### 的编号分段尚不明确；此处不预填、不视为已确认，也不能直接按字面出码。成品、模具、注塑件、五金毛坯及五金表面处理均须等待规则确认和本地目录唯一映射；后端在确认完成前拒绝分配，且不消耗流水。</small><button className="secondary-button" disabled={busy || dirty || reserved} onClick={() => void runPreview()}>后端预览（不占号）</button>{dirty && <small style={{ display: 'block' }}>草稿有未保存修改，请先保存后再预览或分配。</small>}{preview && <div role="status" style={{ margin: '8px 0' }}><b>{preview.blocked ? '阻断' : `可用预览：${preview.code ?? ''}`}</b><div>{preview.notice}</div>{preview.reasons.map((r, i) => <div key={i}>{r}</div>)}{preview.serialWidth && <small>流水号宽度：{preview.serialWidth}</small>}</div>}<button className="primary-button" disabled={busy || dirty || reserved || kind !== 'raw' || !preview || preview.blocked} onClick={() => void allocate()}>原子分配（PLM 本地保留）</button><button className="secondary-button" disabled={busy} onClick={() => void showAudit()}>查看审计</button></div></>}
    </div></div>{audit && <div style={{ marginTop: 12 }}><b>审计事件</b><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(audit.events, null, 2)}</pre></div>}</section>
}
