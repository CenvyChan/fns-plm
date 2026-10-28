import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Check, ChevronDown, ChevronRight, CirclePlus, FileText, LoaderCircle, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { apiFetch, type AuthUser } from './api'
import './form-version-panel.css'

type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'user' | 'customer'
type Field = { id: string; label: string; type: FieldType; required?: boolean; options?: { value: string; label: string }[] }
type Definition = { dslVersion: 1; fields: Field[] }
type FormRow = { key: string; name: string; revision: number; latestVersion: number }
type VersionRow = { version: number; createdAt: string; createdBy: string }
type Detail = FormRow & { definition: Definition }
const newDefinition = (): Definition => ({ dslVersion: 1, fields: [{ id: 'title', label: '名称', type: 'text', required: true }] })
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await apiFetch(url, init); const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string; message?: string }).message || (body as { error?: string }).error || `请求失败 (${r.status})`)
  return body as T
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
const idFromLabel = (label: string, n: number) => `${(label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^\d+/, '').replace(/^_+|_+$/g, '').slice(0, 40) || 'field')}_${n}`

export default function FormVersionPanel({ currentUser, onVersionsChanged }: { currentUser?: AuthUser; onVersionsChanged?: () => void }) {
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'plm_manager'
  const [forms, setForms] = useState<FormRow[]>([]), [selected, setSelected] = useState(''), [detail, setDetail] = useState<Detail | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([]), [viewVersion, setViewVersion] = useState<{ version: number; definition: Definition } | null>(null)
  const [name, setName] = useState(''), [key, setKey] = useState(''), [definition, setDefinition] = useState<Definition>(newDefinition()), [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const refresh = useCallback(async (keep = selected) => {
    setLoading(true); setError('')
    try { const result = await request<{ forms: FormRow[] }>('/api/forms'); setForms(result.forms); if (keep && result.forms.some(x => x.key === keep)) setSelected(keep); else { setSelected(''); setDetail(null); setVersions([]) } }
    catch (e) { setError(e instanceof Error ? e.message : '表单列表加载失败') } finally { setLoading(false) }
  }, [selected])
  useEffect(() => { void refresh('') }, [])
  useEffect(() => {
    if (!selected) return
    let live = true; setViewVersion(null); setLoading(true)
    Promise.all([request<Detail>(`/api/forms/${encodeURIComponent(selected)}`), request<{ versions: VersionRow[] }>(`/api/forms/${encodeURIComponent(selected)}/versions`)]).then(([d, v]) => { if (live) { setDetail(d); setDefinition(d.definition); setName(d.name); setVersions(v.versions) } }).catch(e => live && setError(e instanceof Error ? e.message : '表单读取失败')).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [selected])
  const updateField = (index: number, patch: Partial<Field>) => setDefinition(d => ({ ...d, fields: d.fields.map((f, i) => i === index ? { ...f, ...patch, ...(patch.type && patch.type !== 'select' ? { options: undefined } : {}) } : f) }))
  const addField = () => setDefinition(d => ({ ...d, fields: [...d.fields, { id: idFromLabel('', d.fields.length + 1), label: `新字段 ${d.fields.length + 1}`, type: 'text' }] }))
  const removeField = (index: number) => setDefinition(d => ({ ...d, fields: d.fields.filter((_, i) => i !== index) }))
  const addForm = async () => {
    if (!name.trim() || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) { setError('请填写名称；key 须以英文字母开头，只能包含字母、数字、_、-，最多 64 位。'); return }
    setBusy(true); setError(''); try { await request('/api/forms', json('POST', { name: name.trim(), key, definition })); setCreating(false); setNotice('表单已创建为草稿'); await refresh(key) } catch (e) { setError(e instanceof Error ? e.message : '创建失败') } finally { setBusy(false) }
  }
  const save = async () => {
    if (!detail) return; setBusy(true); setError('')
    try { const saved = await request<Detail>(`/api/forms/${encodeURIComponent(detail.key)}`, json('PUT', { name: name.trim(), definition, revision: detail.revision })); setDetail(saved); setNotice('草稿已保存'); await refresh(detail.key) }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }
  const publish = async () => {
    if (!detail) return; setBusy(true); setError('')
    try { await request(`/api/forms/${encodeURIComponent(detail.key)}/publish`, json('POST', { revision: detail.revision })); setNotice('不可变版本已发布'); await refresh(detail.key); const [d,v]=await Promise.all([request<Detail>(`/api/forms/${encodeURIComponent(detail.key)}`),request<{versions:VersionRow[]}>(`/api/forms/${encodeURIComponent(detail.key)}/versions`)]); setDetail(d);setVersions(v.versions); onVersionsChanged?.() }
    catch (e) { setError(e instanceof Error ? e.message : '发布失败') } finally { setBusy(false) }
  }
  const openVersion = async (v: number) => { setViewVersion(null); try { setViewVersion(await request(`/api/forms/${encodeURIComponent(selected)}/versions/${v}`)) } catch (e) { setError(e instanceof Error ? e.message : '版本加载失败') } }
  const dirty = useMemo(() => detail && (detail.name !== name || JSON.stringify(detail.definition) !== JSON.stringify(definition)), [detail, name, definition])
  return <section className="fvp" aria-label="表单版本管理">
    <header className="fvp-head"><div className="fvp-title"><span className="fvp-mark"><FileText size={19}/></span><div><h2>表单与版本</h2><p>管理流程可绑定的业务表单</p></div></div><button className="fvp-iconbtn" aria-label="刷新" onClick={() => void refresh()}><RefreshCw size={16}/></button></header>
    {error && <div className="fvp-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭"><X size={15}/></button></div>}{notice && <div className="fvp-notice"><Check size={15}/>{notice}<button onClick={() => setNotice('')} aria-label="关闭"><X size={14}/></button></div>}
    <div className="fvp-layout"><aside className="fvp-list"><div className="fvp-listtop"><span>表单目录 <i>{forms.length}</i></span>{canEdit && <button className="fvp-smallprimary" onClick={() => { if(dirty&&!window.confirm('表单有未保存更改，继续新建将丢弃。继续？'))return; setCreating(true); setName(''); setKey(''); setDefinition(newDefinition()); setError('') }}><Plus size={15}/> 新建</button>}</div>
      {loading && !detail && <div className="fvp-muted"><LoaderCircle className="fvp-spin" size={16}/> 正在加载</div>}{!loading && !forms.length && <div className="fvp-empty">暂无表单</div>}
      <div className="fvp-items">{forms.map(f => <button key={f.key} className={`fvp-item ${selected === f.key ? 'active' : ''}`} onClick={() => { if(dirty&&!window.confirm('表单有未保存更改，切换将丢弃。继续？'))return; setSelected(f.key); setCreating(false) }}><span className="fvp-itemicon"><FileText size={16}/></span><span className="fvp-itemtext"><b>{f.name}</b><small>{f.key}</small></span><span className="fvp-vtag">{f.latestVersion ? `v${f.latestVersion}` : '草稿'}</span></button>)}</div>
      <div className="fvp-runtime-note"><b>运行时提示</b><span>表单定义与版本绑定已支持；Flowable 真实任务适配器尚未接入。任务提交接口会返回 501，不表示已可运行提交。</span></div>
    </aside>
    <main className="fvp-main">
      {creating ? <><div className="fvp-detailhead"><div><small>新表单</small><h3>创建业务表单</h3></div><button className="fvp-iconbtn" onClick={() => setCreating(false)} aria-label="取消"><X size={17}/></button></div><div className="fvp-meta"><label>表单名称<input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="例如：采购申请"/></label><label>唯一 key<input value={key} onChange={e => setKey(e.target.value)} placeholder="purchase_request"/><small>创建后不可更改，用于流程绑定</small></label></div><FieldEditor fields={definition.fields} onChange={updateField} onAdd={addField} onRemove={removeField}/><div className="fvp-actions"><button className="fvp-primary" disabled={busy} onClick={() => void addForm()}>{busy ? <LoaderCircle className="fvp-spin" size={16}/> : <CirclePlus size={16}/>}创建草稿</button></div></>
      : detail ? <><div className="fvp-detailhead"><div><small>表单 · {detail.key}</small><h3>{viewVersion ? `版本 v${viewVersion.version}` : name}</h3></div><div className="fvp-headtags"><span className="fvp-status">修订版 {detail.revision}</span><span className="fvp-status">当前 v{detail.latestVersion || '—'}</span></div></div>
        {viewVersion ? <div className="fvp-versionview"><div className="fvp-versionbanner"><Archive size={17}/><span>发布版本不可修改，仅供查看与绑定</span></div><FieldPreview fields={viewVersion.definition.fields}/><button className="fvp-secondary" onClick={() => setViewVersion(null)}><ChevronDown size={15}/>返回草稿</button></div>
        : <><div className="fvp-meta"><label>表单名称<input disabled={!canEdit} value={name} maxLength={120} onChange={e => setName(e.target.value)}/></label><label>唯一 key<input disabled value={detail.key}/></label></div><FieldEditor fields={definition.fields} readOnly={!canEdit} onChange={updateField} onAdd={addField} onRemove={removeField}/>{canEdit && <div className="fvp-actions"><span>{dirty ? '有未保存更改' : '草稿已同步'}</span><button className="fvp-secondary" disabled={busy || !dirty} onClick={() => void save()}><Save size={16}/>保存草稿</button><button className="fvp-primary" disabled={busy || !!dirty || !detail.revision} onClick={() => void publish()}><Archive size={16}/>发布新版本</button></div>}
          <section className="fvp-versions"><div className="fvp-sectionhead"><div><h4>已发布版本</h4><p>版本冻结后可在 BPMN 流程属性中绑定</p></div><span>{versions.length}</span></div>{versions.length ? versions.map(v => <button className="fvp-version" key={v.version} onClick={() => void openVersion(v.version)}><span className="fvp-versionbadge">v{v.version}</span><span className="fvp-versionmeta"><b>不可变版本</b><small>{new Date(v.createdAt).toLocaleString()}</small></span><span className="fvp-creator">{v.createdBy}</span><ChevronRight size={16}/></button>) : <div className="fvp-empty">保存草稿后发布第一个版本</div>}</section></>}
      </> : <div className="fvp-welcome"><span><FileText size={25}/></span><h3>{loading ? '正在读取…' : '选择一个表单'}</h3><p>在此管理字段、编辑草稿并发布供流程绑定的固定版本。</p>{canEdit && <button className="fvp-primary" onClick={() => setCreating(true)}><Plus size={16}/>创建表单</button>}</div>}
    </main></div>
  </section>
}
function FieldEditor({ fields, readOnly, onChange, onAdd, onRemove }: { fields: Field[]; readOnly?: boolean; onChange: (i: number, p: Partial<Field>) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  return <section className="fvp-fields"><div className="fvp-sectionhead"><div><h4>表单字段</h4><p>字段 ID 仅用安全字母与数字生成</p></div><span>{fields.length}</span></div>{fields.map((f, i) => <article className="fvp-field" key={i}><div className="fvp-fieldtop"><span className="fvp-num">{String(i + 1).padStart(2, '0')}</span><input aria-label="字段标签" disabled={readOnly} value={f.label} maxLength={120} onChange={e => onChange(i, { label: e.target.value })}/><button type="button" className="fvp-iconbtn danger" aria-label="删除字段" disabled={readOnly || fields.length <= 1} onClick={() => onRemove(i)}><Trash2 size={16}/></button></div><div className="fvp-fieldopts"><label>类型<select disabled={readOnly} value={f.type} onChange={e => onChange(i, { type: e.target.value as FieldType, ...(e.target.value === 'select' ? { options: [{ value: 'option_1', label: '选项一' }, { value: 'option_2', label: '选项二' }] } : {}) })}><option value="text">单行文本</option><option value="textarea">多行文本</option><option value="number">数字</option><option value="date">日期</option><option value="select">下拉选择</option><option value="user">用户</option><option value="customer">客户</option></select></label><label className="fvp-required"><input type="checkbox" disabled={readOnly} checked={!!f.required} onChange={e => onChange(i, { required: e.target.checked || undefined })}/>必填</label></div>{f.type === 'select' && <p className="fvp-inline-note">包含默认选项；复杂选项配置暂未提供。</p>}<small className="fvp-fieldid">ID: {f.id}</small></article>)}{!readOnly && <button className="fvp-addfield" type="button" onClick={onAdd}><Plus size={16}/>添加字段</button>}</section>
}
function FieldPreview({ fields }: { fields: Field[] }) { return <div className="fvp-preview">{fields.map(f => <div key={f.id}><label>{f.label}{f.required && <em>必填</em>}</label>{f.type === 'textarea' ? <div className="fvp-placeholder tall"/> : f.type === 'select' ? <div className="fvp-placeholder">请选择 <ChevronDown size={14}/></div> : <div className="fvp-placeholder"/>}<small>{f.type}</small></div>)}</div> }
