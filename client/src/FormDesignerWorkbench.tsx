import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch } from './api'
import './form-designer.css'
import { applyEvents, conditionMatches, isEmptyValue, normalizeEvents, type Condition, type FormDefinition } from './formRules'

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'customer' | 'user'
export type FormField = { id: string; label: string; type: FieldType; required?: boolean; min?: number; max?: number; pattern?: string; options?: { value: string; label: string }[]; requiredWhen?: Condition; visibleWhen?: Condition; enabledWhen?: Condition }
export type { Condition, FormDefinition }
export type FormDetail = { key: string; name: string; revision: number; latestVersion?: number; definition: FormDefinition }
export interface FormRendererAdapter { render(definition: FormDefinition, values: Record<string, unknown>, onChange: (field: string, value: unknown) => void): ReactNode }
export interface FormApiAdapter {
  list(): Promise<{ forms: FormDetail[] }>; get(key: string): Promise<FormDetail>
  save(key: string, name: string, definition: FormDefinition, revision?: number): Promise<FormDetail>
  publish(key: string, revision: number): Promise<{ key: string; version: number; definition: FormDefinition }>
  versions(key: string): Promise<{ versions: { version: number }[] }>
  version(key: string, v: number): Promise<{ key: string; version: number; definition: FormDefinition }>
  lookup(kind: 'users' | 'customers'): Promise<{ value: string; label: string }[]>
  submit(key: string, v: number, values: Record<string, unknown>, taskId: string): Promise<{ id: string }>
}
async function checkedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<T>
}
async function responseError(response: Response): Promise<string> {
  try { const body = await response.json(); return body.message || body.error || `HTTP ${response.status}` }
  catch { return `HTTP ${response.status}` }
}
export const httpFormApiAdapter: FormApiAdapter = {
  list: () => checkedJson('/api/forms'),
  get: key => checkedJson(`/api/forms/${encodeURIComponent(key)}`),
  save: (key, name, definition, revision) => revision === undefined
    ? checkedJson('/api/forms', { method: 'POST', body: JSON.stringify({ key, name, definition }) })
    : checkedJson(`/api/forms/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ name, definition, revision }) }),
  publish: (key, revision) => checkedJson(`/api/forms/${encodeURIComponent(key)}/publish`, { method: 'POST', body: JSON.stringify({ revision }) }),
  versions: key => checkedJson(`/api/forms/${encodeURIComponent(key)}/versions`),
  version: (key, version) => checkedJson(`/api/forms/${encodeURIComponent(key)}/versions/${version}`),
  lookup: async kind => (await checkedJson<{ options: { value: string; label: string }[] }>(`/api/forms/lookups/${kind}`)).options,
  submit: (key, version, values, taskId) => checkedJson(`/api/forms/${encodeURIComponent(key)}/versions/${version}/submissions`, { method: 'POST', body: JSON.stringify({ values, taskId }) }),
}
const defaultApi = httpFormApiAdapter
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败'

export function DefaultFormRenderer({ definition, values, onChange, disabledReasons = {} }: { definition: FormDefinition; values: Record<string, unknown>; onChange: (field: string, value: unknown) => void; disabledReasons?: Record<string, string> }) {
  return <>{(definition.fields as FormField[]).filter(field => conditionMatches(field.visibleWhen, values)).map(field => {
    const required = !!field.required || (!!field.requiredWhen && conditionMatches(field.requiredWhen, values))
    const disabled = !!field.enabledWhen && !conditionMatches(field.enabledWhen, values)
    const reason = disabledReasons[field.id] || (disabled ? '当前条件不满足，字段已禁用' : '')
    const value = values[field.id]
    const change = (next: unknown) => onChange(field.id, next)
    let input: ReactNode
    if (field.type === 'customer' || field.type === 'user') input = <LookupSelect type={field.type} value={value} onChange={change} disabled={disabled} />
    else if (field.type === 'textarea') input = <textarea disabled={disabled} value={String(value ?? '')} onChange={event => change(event.target.value)} />
    else if (field.type === 'select' || field.type === 'multiselect') input = <select disabled={disabled} multiple={field.type === 'multiselect'} value={field.type === 'multiselect' ? (Array.isArray(value) ? value as string[] : []) : String(value ?? '')} onChange={event => change(field.type === 'multiselect' ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}><option value="">请选择</option>{(field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    else input = <input disabled={disabled} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} min={field.min} max={field.max} pattern={field.pattern} value={String(value ?? '')} onChange={event => change(field.type === 'number' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} />
    return <label className="fd-render-field" key={field.id}>{field.label}{required && <em> 必填</em>}{input}{reason && <small role="note">{reason}</small>}</label>
  })}</>
}

export default function FormDesignerWorkbench({ api = defaultApi, renderer = DefaultFormRenderer }: { api?: FormApiAdapter; renderer?: (props: { definition: FormDefinition; values: Record<string, unknown>; onChange: (field: string, value: unknown) => void; disabledReasons?: Record<string, string> }) => ReactNode }) {
  const [forms, setForms] = useState<FormDetail[]>([]), [selected, setSelected] = useState<FormDetail | null>(null)
  const [name, setName] = useState(''), [key, setKey] = useState(''), [definition, setDefinition] = useState<FormDefinition>({ dslVersion: 1, fields: [] })
  const [revision, setRevision] = useState<number>(), [jsonMode, setJsonMode] = useState(false), [json, setJson] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>({}), [version, setVersion] = useState(0), [versions, setVersions] = useState<number[]>([]), [preview, setPreview] = useState<FormDefinition | null>(null), [taskId, setTaskId] = useState('')
  const refresh = async () => { try { setForms((await api.list()).forms) } catch (e) { setError(message(e)) } }
  useEffect(() => { void refresh() }, [])
  const reset = () => { setSelected(null); setKey(''); setName(''); setRevision(undefined); setDefinition({ dslVersion: 1, fields: [] }); setJson('{\n  "dslVersion": 1,\n  "fields": []\n}'); setJsonMode(false); setVersions([]); setVersion(0); setPreview(null); setTaskId(''); setValues({}); setDirty(false); setError(''); setNotice('') }
  const load = async (formKey: string) => {
    setError(''); setNotice('')
    try { const detail = await api.get(formKey); const list = await api.versions(formKey); setSelected(detail); setKey(detail.key); setName(detail.name); setRevision(detail.revision); setDefinition(detail.definition); setJson(JSON.stringify(detail.definition, null, 2)); setJsonMode(false); setVersions(list.versions.map(item => item.version)); setVersion(0); setPreview(null); setTaskId(''); setValues({}); setDirty(false) }
    catch (e) { setError(message(e)) }
  }
  const update = (fn: (current: FormDefinition) => FormDefinition) => { setDefinition(current => { const next = fn(current); setJson(JSON.stringify(next, null, 2)); return next }); setDirty(true) }
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); setNotice(''); try { await fn() } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  const rendered = preview ?? definition
  const setValue = (field: string, value: unknown) => setValues(current => applyEvents(rendered, field, value, current))
  const disabledReasons = Object.fromEntries((rendered.fields as FormField[]).filter(field => field.enabledWhen && !conditionMatches(field.enabledWhen, values)).map(field => [field.id, '当前条件不满足，字段已禁用']))
  const invalidRequired = (rendered.fields as FormField[]).some(field => conditionMatches(field.visibleWhen, values) && (!field.enabledWhen || conditionMatches(field.enabledWhen, values)) && (!!field.required || (!!field.requiredWhen && conditionMatches(field.requiredWhen, values))) && isEmptyValue(values[field.id]))
  const addField = () => update(current => ({ ...current, fields: [...current.fields, { id: `field_${Date.now()}`, label: '新字段', type: 'text' }] }))
  const fieldEditor = (field: FormField) => <article className="fd-field" key={field.id}><div className="fd-fields">
    <label>字段 ID<input value={field.id} onChange={e => update(d => ({ ...d, fields: d.fields.map(x => x === field ? { ...x, id: e.target.value } : x) }))} /></label>
    <label>标签<input value={field.label} onChange={e => update(d => ({ ...d, fields: d.fields.map(x => x === field ? { ...x, label: e.target.value } : x) }))} /></label>
    <label>类型<select value={field.type} onChange={e => update(d => ({ ...d, fields: d.fields.map(x => { if (x !== field) return x; const type = e.target.value as FieldType; return { ...x, type, ...(type === 'select' || type === 'multiselect' ? { options: x.options ?? [] } : { options: undefined }) } }) }))}>{['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'customer', 'user'].map(type => <option key={type}>{type}</option>)}</select></label>
    <label className="fd-check"><input type="checkbox" checked={!!field.required} onChange={e => update(d => ({ ...d, fields: d.fields.map(x => x === field ? { ...x, required: e.target.checked } : x) }))} />必填</label>
  </div>{['select', 'multiselect'].includes(field.type) && <label>选项（每行 value|label）<textarea value={(field.options ?? []).map(o => `${o.value}|${o.label}`).join('\n')} onChange={e => update(d => ({ ...d, fields: d.fields.map(x => x === field ? { ...x, options: e.target.value.split('\n').filter(Boolean).map(line => { const [value, ...label] = line.split('|'); return { value, label: label.join('|') || value } }) } : x) }))} /></label>}<button type="button" className="fd-link danger" onClick={() => update(d => ({ ...d, fields: d.fields.filter(x => x !== field) }))}>删除字段</button></article>
  const parseJson = (): FormDefinition => { const parsed = JSON.parse(json) as FormDefinition; if (parsed.dslVersion !== 1 || !Array.isArray(parsed.fields)) throw new Error('DSL 必须为 dslVersion:1 且 fields 为数组'); return parsed }
  return <main className="fd-page"><header className="fd-head"><div><small>WORKFLOW / FORM DESIGN</small><h1>表单设计</h1><p>第一阶段独立于流程画布：编辑 DSL、保存版本并预览已发布定义。</p></div><button onClick={() => void refresh()} disabled={busy}>刷新表单</button></header><div className="fd-grid"><aside className="fd-panel"><h2>表单列表</h2><button onClick={reset}>新建表单</button>{forms.map(form => <button className="fd-list-item" key={form.key} onClick={() => { if (dirty && !window.confirm('当前草稿尚未保存，仍要切换吗？')) return; void load(form.key) }}>{form.name}<small>{form.key} · r{form.revision} · v{form.latestVersion ?? '未发布'}</small></button>)}</aside>
  <section className="fd-panel"><h2>{selected ? '编辑表单' : '新建表单'}</h2>{(error || notice) && <div role="status" className={error ? 'fd-error' : 'fd-notice'}>{error || notice}</div>}<div className="fd-fields"><label>Key<input value={key} disabled={!!selected} onChange={e => { setKey(e.target.value); setDirty(true) }} /></label><label>名称<input value={name} onChange={e => { setName(e.target.value); setDirty(true) }} /></label></div>
  <div className="fd-toolbar"><button onClick={() => setJsonMode(false)}>可视化字段</button><button onClick={() => { setJsonMode(true); setJson(JSON.stringify(definition, null, 2)) }}>高级 JSON DSL</button>{!jsonMode && <button onClick={addField}>添加字段</button>}</div>{jsonMode ? <textarea className="fd-json" value={json} onChange={e => { setJson(e.target.value); setDirty(true) }} /> : (definition.fields as FormField[]).map(fieldEditor)}
  <div className="fd-toolbar"><button disabled={busy || !name.trim() || !key.trim()} onClick={() => void run(async () => { const candidate = jsonMode ? parseJson() : definition; const saved = await api.save(key, name, candidate, revision); setDefinition(candidate); setJson(JSON.stringify(candidate, null, 2)); setSelected(saved); setKey(saved.key); setRevision(saved.revision); setDirty(false); setNotice('草稿已保存'); await refresh() })}>保存</button><button disabled={busy || !selected || dirty} title={dirty ? '请先保存草稿再发布' : undefined} onClick={() => void run(async () => { if (dirty) throw new Error('请先保存当前草稿再发布'); const published = await api.publish(key, revision!); setVersion(published.version); setPreview(published.definition); setValues({}); setVersions((await api.versions(key)).versions.map(item => item.version)); setNotice(`已发布版本 ${published.version}`) })}>发布版本</button></div>
  <h3>运行预览</h3><div className="fd-preview">{renderer({ definition: rendered, values, onChange: setValue, disabledReasons })}</div><div className="fd-toolbar"><select value={version || ''} onChange={async e => { const chosen = Number(e.target.value); setVersion(chosen); setError(''); setNotice(''); try { if (chosen) { const loaded = await api.version(key, chosen); setPreview(loaded.definition); setValues({}) } else { setPreview(null); setValues({}) } } catch (err) { setError(message(err)) } }}><option value="">当前草稿预览</option>{versions.map(item => <option key={item} value={item}>固定版本 {item}</option>)}</select><button disabled={!selected} onClick={() => void run(async () => { if (!version) throw new Error('请选择固定发布版本'); setPreview((await api.version(key, version)).definition); setValues({}); setNotice('预览已加载发布版本') })}>读取发布版本</button></div>
  {selected && <section className="fd-submit"><h3>提交表单（授权上下文）</h3><p>流程实例由服务端根据授权任务解析；未连接 Flowable adapter 时服务端会拒绝提交。</p><label>已授权任务 ID<input value={taskId} onChange={e => setTaskId(e.target.value)} required /></label><button disabled={busy || !version || !preview || !taskId.trim() || invalidRequired} onClick={() => void run(async () => { if (!preview || !version) throw new Error('须选择固定发布版本'); if (!taskId.trim()) throw new Error('任务 ID 必填'); const normalized = omitInactiveValues(rendered, normalizeAll(rendered, values), values); const result = await api.submit(key, version, normalized, taskId.trim()); setNotice(`真实提交记录 ID：${result.id}`) })}>{busy ? '提交中…' : '提交已发布表单'}</button></section>}</section></div></main>
}
function normalizeAll(definition: FormDefinition, initial: Record<string, unknown>) { return normalizeEvents(definition, initial) }
function omitInactiveValues(definition: FormDefinition, normalized: Record<string, unknown>, values: Record<string, unknown>) {
  const result = { ...normalized }
  for (const field of definition.fields as FormField[]) {
    if (!conditionMatches(field.visibleWhen, values) || (field.enabledWhen && !conditionMatches(field.enabledWhen, values))) delete result[field.id]
  }
  return result
}
function LookupSelect({ type, value, onChange, disabled }: { type: 'customer' | 'user'; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]), [error, setError] = useState('')
  useEffect(() => { let alive = true; setOptions([]); setError(''); defaultApi.lookup(type === 'customer' ? 'customers' : 'users').then(result => { if (alive) setOptions(result) }).catch(err => { if (alive) setError(message(err)) }); return () => { alive = false } }, [type])
  if (error) return <span>{error}</span>
  if (!options.length) return <span>暂无可用{type === 'user' ? '用户' : '客户'}数据</span>
  return <select disabled={disabled} value={String(value ?? '')} onChange={event => onChange(event.target.value)}><option value="">请选择</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
}
