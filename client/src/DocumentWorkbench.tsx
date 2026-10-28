import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { unzipSync } from 'fflate'
import { ArrowRight, Download, Eye, FileSearch, FileText, MoreHorizontal, Plus, Search, ShieldCheck, X } from 'lucide-react'
import { createId, requestWorkspace } from './data'
import { apiFetch, apiJson, jsonRequest } from './api'
import type { LifecycleStatus, PlmDocument, WorkspaceData } from './types'
import './document-preview.css'
import MaterialSelect from './MaterialSelect'
import { matchesDocumentMaterial } from './material-search'

const now = () => new Date().toISOString()
const lifecycleLabels: Record<LifecycleStatus, string> = { draft: '草稿', review: '审批中', released: '已发布', obsolete: '已作废' }
const nextState = (state: LifecycleStatus): LifecycleStatus => state === 'draft' ? 'review' : state === 'review' ? 'released' : state === 'released' ? 'obsolete' : 'draft'
const allowedExtensions = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt,.dwg,.dxf,.step,.stp,.stl,.iges,.igs'
type DocumentFile = { id: string; documentId: string; originalName: string; mimeType: string; byteSize: number; revision: string; uploadedBy: string; createdAt: string }
type Preview = { file: DocumentFile; kind: 'loading' | 'pdf' | 'image' | 'text' | 'docx' | 'xlsx' | 'unsupported' | 'error'; url?: string; text?: string; rows?: string[][]; message?: string }
const previewExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.csv', '.txt'])
function extensionOf(name: string): string { const index = name.lastIndexOf('.'); return index < 0 ? '' : name.slice(index).toLowerCase() }
function unzipOffice(bytes: Uint8Array, accept: (path: string) => boolean): Record<string, Uint8Array> {
  let entries = 0, expandedBytes = 0
  return unzipSync(bytes, { filter: file => {
    entries += 1; expandedBytes += file.originalSize
    if (entries > 4096 || file.originalSize > 16 * 1024 * 1024 || expandedBytes > 64 * 1024 * 1024) throw new Error('Office 压缩包超过本地预览安全上限，请下载原文件。')
    return accept(file.name)
  } })
}
function xmlDocument(bytes: Uint8Array): Document {
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Office XML 内容超过本地预览安全上限。')
  const source = new TextDecoder().decode(bytes)
  if (/<!DOCTYPE/i.test(source)) throw new Error('Office 文件包含不支持的 DTD 声明。')
  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('Office 文件结构无法解析。')
  return xml
}
function nodeText(element: Element): string { return Array.from(element.getElementsByTagNameNS('*', 't')).map(item => item.textContent ?? '').join('') }
function docxText(files: Record<string, Uint8Array>): string {
  const content = files['word/document.xml']
  if (!content) throw new Error('DOCX 文件缺少正文内容。')
  const xml = xmlDocument(content)
  const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p')).map(nodeText).filter(Boolean)
  return paragraphs.slice(0, 1500).join('\n') || '该文档没有可显示的正文文本。'
}
function xlsxRows(files: Record<string, Uint8Array>): string[][] {
  const sharedStrings = files['xl/sharedStrings.xml']
  const shared = sharedStrings ? Array.from(xmlDocument(sharedStrings).getElementsByTagNameNS('*', 'si')).map(nodeText) : []
  const sheetPath = Object.keys(files).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort()[0]
  if (!sheetPath) throw new Error('XLSX 文件中未找到工作表。')
  const xml = xmlDocument(files[sheetPath]!)
  return Array.from(xml.getElementsByTagNameNS('*', 'row')).slice(0, 300).map(row => {
    const values: string[] = []
    for (const cell of Array.from(row.getElementsByTagNameNS('*', 'c'))) {
      const reference = cell.getAttribute('r')?.match(/^[A-Z]+/i)?.[0] ?? ''
      const column = [...reference.toUpperCase()].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0) - 1
      if (column < 0 || column >= 40) continue
      const value = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent ?? ''
      const inline = cell.getElementsByTagNameNS('*', 'is')[0]
      values[column] = cell.getAttribute('t') === 's' ? shared[Number(value)] ?? '' : inline ? nodeText(inline) : value
    }
    return Array.from({ length: Math.min(values.length, 40) }, (_, index) => values[index] ?? '')
  })
}
function DocumentModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}><motion.div className="modal-card plm-modal" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}><div className="modal-heading"><div><span className="modal-eyebrow">DOCUMENT CONTROL · REVISION TRACEABILITY</span><h2>{title}</h2><p>文档记录关联物料身份及修订；附件由受保护的工作区文件服务管理。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div>{children}</motion.div></motion.div> }
function DocField({ label, children }: { label: string; children: ReactNode }) { return <label className="form-label plm-field"><span>{label}</span>{children}</label> }
function DocPill({ state }: { state: LifecycleStatus }) { return <span className={`plm-pill state-${state}`}><i/>{lifecycleLabels[state]}</span> }
async function responseError(response: Response): Promise<Error> { let body: unknown; try { body = await response.json() } catch { /* non-JSON error */ }; const data = body as { message?: string; error?: string } | null; return new Error(data?.message || data?.error || `请求失败（HTTP ${response.status}）`) }

export default function DocumentWorkbench({ workspace, onChange, onToast }: { workspace: WorkspaceData; onChange: (data: WorkspaceData) => void; onToast: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<PlmDocument | null>(null)
  const [modal, setModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [chosenFile, setChosenFile] = useState<File | null>(null)
  const [fileHistory, setFileHistory] = useState<DocumentFile[]>([])
  const [fileHistoryLoading, setFileHistoryLoading] = useState(false)
  const [fileHistoryError, setFileHistoryError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewUrl = useRef<string | undefined>(undefined)
  const pendingCreated = useRef<PlmDocument | null>(null)
  const materialsById = useMemo(() => Object.fromEntries(workspace.materials.map(material => [material.id, material])), [workspace.materials])
  const documents = workspace.documents.filter(document => matchesDocumentMaterial(document, materialsById, query))
  const selected = documents.find(document => document.id === selectedId) ?? documents[0]
  useEffect(() => {
    if (!selected?.id) { setFileHistory([]); setFileHistoryError(''); return }
    let active = true
    setFileHistoryLoading(true); setFileHistoryError('')
    void apiJson<{ files: DocumentFile[] }>(`/api/documents/${encodeURIComponent(selected.id)}/files`).then(result => { if (active) setFileHistory(result.files ?? []) }).catch(value => { if (active) setFileHistoryError(value instanceof Error ? value.message : '附件历史读取失败。') }).finally(() => { if (active) setFileHistoryLoading(false) })
    return () => { active = false }
  }, [selected?.id])
  const closeModal = () => { if (busy) return; setModal(false); setEditing(null); setError(''); setUploadMessage(''); setChosenFile(null); pendingCreated.current = null }
  const create = () => { setEditing(null); setError(''); setChosenFile(null); pendingCreated.current = null; setModal(true) }
  const edit = () => { if (!selected) return; setEditing(selected); setError(''); setChosenFile(null); setModal(true) }
  const refresh = async (focusId?: string) => { const fresh = await requestWorkspace(); onChange(fresh); if (focusId) setSelectedId(focusId) }
  const upsertDocument = (document: PlmDocument) => onChange({ ...workspace, documents: workspace.documents.some(item => item.id === document.id) ? workspace.documents.map(item => item.id === document.id ? document : item) : [document, ...workspace.documents] })
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return
    const form = new FormData(event.currentTarget)
    const fields = { docNo: String(form.get('docNo')).trim(), title: String(form.get('title')).trim(), type: String(form.get('type')), materialId: String(form.get('materialId') || '') || undefined, revision: String(form.get('revision')).trim().toUpperCase(), owner: String(form.get('owner')).trim() }
    setBusy(true); setError(''); setUploadMessage('')
    try {
      let document: PlmDocument
      if (editing) {
        document = await apiJson<PlmDocument>(`/api/documents/${encodeURIComponent(editing.id)}`, jsonRequest('PATCH', { ...fields, updatedAt: now() }))
        upsertDocument(document)
      } else if (pendingCreated.current) {
        document = pendingCreated.current
      } else {
        document = await apiJson<PlmDocument>('/api/documents', jsonRequest('POST', { id: createId(), ...fields, lifecycle: 'draft', updatedAt: now() }))
        pendingCreated.current = document
        upsertDocument(document)
      }
      if (chosenFile) {
        setUploadMessage('正在上传附件…')
        const data = new FormData(); data.append('file', chosenFile)
        const response = await apiFetch(`/api/documents/${encodeURIComponent(document.id)}/files`, { method: 'POST', body: data })
        if (!response.ok) throw await responseError(response)
        const uploaded = await response.json() as { file: DocumentFile }
        setFileHistory(previous => [uploaded.file, ...previous.filter(file => file.id !== uploaded.file.id)])
        document = { ...document, fileName: uploaded.file.originalName, fileUrl: `/api/documents/${encodeURIComponent(document.id)}/files/${encodeURIComponent(uploaded.file.id)}/content`, updatedAt: uploaded.file.createdAt }
        upsertDocument(document)
      }
      await refresh(document.id)
      onToast(chosenFile ? '文档已保存，附件上传成功' : editing ? '图文档档案已更新' : '图文档已登记为草稿')
      setModal(false); setEditing(null); setChosenFile(null); setUploadMessage(''); pendingCreated.current = null
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。')
      if (chosenFile && pendingCreated.current) setUploadMessage('文档元数据已保存；附件上传失败，请重试上传。')
      else setUploadMessage('')
    } finally { setBusy(false) }
  }
  const advance = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const lifecycle = nextState(selected.lifecycle)
      await apiJson(`/api/documents/${encodeURIComponent(selected.id)}`, jsonRequest('PATCH', { lifecycle, updatedAt: now() }))
      await refresh(selected.id); onToast(`图文档状态已更新为${lifecycleLabels[lifecycle]}`)
    } catch (cause) { onToast(cause instanceof Error ? `状态更新失败：${cause.message}` : '状态更新失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  const download = async (file: DocumentFile) => {
    if (!selected || file.documentId !== selected.id || busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/documents/${encodeURIComponent(selected.id)}/files/${encodeURIComponent(file.id)}/content`)
      if (!response.ok) throw await responseError(response)
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.originalName || 'document'; anchor.click(); URL.revokeObjectURL(url)
    } catch (cause) { onToast(cause instanceof Error ? `下载失败：${cause.message}` : '下载失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  const closePreview = () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = undefined; setPreview(null) }
  const openPreview = async (file: DocumentFile) => {
    if (!selected || file.documentId !== selected.id || busy) return
    const extension = extensionOf(file.originalName)
    if (!previewExtensions.has(extension)) { onToast('该 CAD 格式暂不支持在线预览，请下载原始文件'); return }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = undefined; setPreview({ file, kind: 'loading' }); setBusy(true)
    try {
      const response = await apiFetch(`/api/documents/${encodeURIComponent(selected.id)}/files/${encodeURIComponent(file.id)}/content`)
      if (!response.ok) throw await responseError(response)
      const blob = await response.blob()
      if (extension === '.pdf' || ['.png', '.jpg', '.jpeg'].includes(extension)) {
        const url = URL.createObjectURL(blob); previewUrl.current = url
        setPreview({ file, kind: extension === '.pdf' ? 'pdf' : 'image', url })
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (extension === '.docx') setPreview({ file, kind: 'docx', text: docxText(unzipOffice(bytes, path => path === 'word/document.xml')) })
        else if (extension === '.xlsx') setPreview({ file, kind: 'xlsx', rows: xlsxRows(unzipOffice(bytes, path => path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(path))) })
        else setPreview({ file, kind: 'text', text: new TextDecoder().decode(bytes.subarray(0, 200_000)) + (bytes.length > 200_000 ? '\n\n…内容过长，预览已截断…' : '') })
      }
    } catch (cause) {
      setPreview({ file, kind: 'error', message: cause instanceof Error ? cause.message : '文件预览失败。' })
    } finally { setBusy(false) }
  }
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) }, [])

  return <div className="plm-page document-workbench"><div className="module-banner docs-banner"><div className="module-banner-icon"><FileText size={22}/></div><div><span className="plm-overline">DOCUMENT CONTROL · REVISION TRACEABILITY</span><h2>图文档中心</h2><p>集中检索工程图、规格书、工艺与标签文件，关联物料并维护修订与受控状态。</p></div><div className="banner-number"><b>{workspace.documents.length.toString().padStart(2, '0')}</b><small>文档记录</small></div></div>
    <div className="document-workspace"><div className="doc-list-column"><div className="plm-toolbar doc-toolbar"><div className="toolbar-title"><b>受控文档库</b><span>{documents.length} 条记录</span></div><div className="toolbar-actions"><label className="module-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文档号、标题、物料编码/名称/规格型号…"/></label><button className="primary-button" onClick={create}><Plus size={15}/>登记图文档</button></div></div><section className="panel plm-panel no-top"><div className="plm-table-wrap"><table className="plm-table docs-table"><thead><tr><th>文档编号 / 标题</th><th>类型</th><th>关联物料</th><th>修订</th><th>受控状态</th><th>更新时间</th><th>责任人</th></tr></thead><tbody>{documents.map(document => <tr key={document.id} className={selected?.id === document.id ? 'selected-row' : ''} onClick={() => setSelectedId(document.id)}><td><span className="doc-name-cell"><i className={`doc-type-icon ${document.type === '工程图' ? 'doc-drawing' : ''}`}><FileText size={15}/></i><span><b>{document.docNo}</b><small>{document.title}</small></span></span></td><td>{document.type}</td><td>{materialsById[document.materialId ?? '']?.partNo ?? '—'}<small>{materialsById[document.materialId ?? '']?.name}</small></td><td><span className="revision-tag">{document.revision}</span></td><td><DocPill state={document.lifecycle}/></td><td>{document.updatedAt.slice(0, 10)}</td><td>{document.owner}</td></tr>)}</tbody></table>{!documents.length && <div className="plm-empty"><span><FileSearch size={20}/></span><b>没有找到图文档</b><small>试试更短的关键词，或新建一条受控文档记录。</small></div>}</div><div className="table-footnote"><span><i className="status-dot"/>图文档与物料及修订关联</span><span>点击记录查看或维护</span></div></section></div>
      <aside className="panel doc-detail-card">{selected ? <><div className="doc-preview"><div className="paper-sheet"><span className="paper-grid"/><i/><i/><i/><b>{selected.type === '工程图' ? 'DRAWING' : 'DOCUMENT'}</b><small>{selected.docNo}</small></div><div className="doc-preview-actions"><span className="file-type-badge">{selected.fileName?.split('.').pop()?.toUpperCase() || 'FILE'}</span><button className="quiet-icon" aria-label="维护文档与附件" title="编辑文档或上传附件" onClick={edit}><MoreHorizontal size={17}/></button></div></div><div className="doc-detail-content"><div className="panel-kicker">CONTROLLED DOCUMENT</div><h3>{selected.title}</h3><span className="doc-code">{selected.docNo}</span><div className="doc-state-row"><DocPill state={selected.lifecycle}/><span>Rev {selected.revision}</span></div><dl className="doc-properties"><div><dt>文件类型</dt><dd>{selected.type}</dd></div><div><dt>关联物料</dt><dd>{materialsById[selected.materialId ?? '']?.name ?? '未关联'}</dd></div><div><dt>物料编号</dt><dd>{materialsById[selected.materialId ?? '']?.partNo ?? '—'}</dd></div><div><dt>责任人</dt><dd>{selected.owner}</dd></div><div><dt>最后更新</dt><dd>{selected.updatedAt.slice(0, 10)}</dd></div></dl><div className="attached-file"><span className="attached-icon"><FileText size={16}/></span><span><b>{selected.fileName || '尚未上传附件'}</b><small>{selected.fileUrl ? '受保护工作区文件' : '仅文档元数据'}</small></span>{selected.fileUrl && <button className="quiet-icon" onClick={() => { if (fileHistory[0]) void download(fileHistory[0]) }} disabled={busy || fileHistoryLoading || !fileHistory[0]} aria-label="下载最新修订文件"><Download size={15}/></button>}</div><DocumentFileHistory files={fileHistory} loading={fileHistoryLoading} error={fileHistoryError} busy={busy} onDownload={file => { void download(file) }} onPreview={file => { void openPreview(file) }}/><div className="doc-detail-actions"><button className="outline-button" onClick={edit}>编辑档案</button><button className="primary-button" onClick={advance} disabled={busy}>{selected.lifecycle === 'released' ? '发起修订' : '推进审批'}<ArrowRight size={14}/></button></div><div className="audit-note"><ShieldCheck size={14}/> 文档修订和状态按物料身份留痕；附件通过受保护的工作区文件端点存取。</div></div></> : <div className="plm-empty"><span><FileSearch size={20}/></span><b>选择一份图文档查看详情</b></div>}</aside></div>
    <AnimatePresence>{modal && <DocumentModal title={editing ? '维护图文档档案' : '登记图文档'} onClose={closeModal}><form className="form-stack" onSubmit={save}><div className="form-row"><DocField label="文档编号"><input name="docNo" placeholder="例如：DWG-MEC-2001" defaultValue={editing?.docNo} required autoFocus/></DocField><DocField label="文档类型"><select name="type" defaultValue={editing?.type ?? '工程图'}><option>工程图</option><option>规格书</option><option>工艺文件</option><option>检验标准</option><option>用户手册</option><option>标签文件</option><option>其他</option></select></DocField></div><DocField label="文档标题"><input name="title" placeholder="图纸 / 文件标题" defaultValue={editing?.title} required/></DocField><div className="form-row"><DocField label="关联物料"><MaterialSelect name="materialId" label="关联物料" materials={workspace.materials} defaultValue={editing?.materialId ?? ''} placeholder="暂不关联"/></DocField><DocField label="修订版"><input name="revision" defaultValue={editing?.revision ?? 'A'} required maxLength={6}/></DocField></div><div className="form-row"><DocField label="责任人"><input name="owner" placeholder="文控 / 工程负责人" defaultValue={editing?.owner ?? '文控中心'} required/></DocField><DocField label="选择附件（可选）"><input type="file" accept={allowedExtensions} onChange={e => { setChosenFile(e.target.files?.[0] ?? null); setError(''); setUploadMessage('') }}/></DocField></div>{chosenFile && <div className="form-tip">已选择：{chosenFile.name}（{(chosenFile.size / 1024 / 1024).toFixed(2)} MB）。服务端限制：单文件不超过 25 MB；支持 PDF、PNG/JPG、DOCX/XLSX、CSV/TXT、DWG/DXF、STEP/STP、STL、IGES/IGS，且文件内容需符合扩展名。</div>}{uploadMessage && <div className="form-tip" role="status">{uploadMessage}</div>}{error && <div className="form-tip" role="alert" style={{ color: '#b42318' }}>{error}</div>}<div className="form-tip"><ShieldCheck size={14}/>附件经受保护的工作区 API 上传和下载；未选择文件时仅保存文档元数据。</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? '处理中…' : chosenFile ? '保存并上传附件' : editing ? '保存档案' : '登记草稿'}</button></div></form></DocumentModal>}</AnimatePresence>
    <AnimatePresence>{preview && <motion.div className="modal-backdrop document-preview-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => event.target === event.currentTarget && closePreview()}><motion.section className="document-preview-modal" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" initial={{ opacity: 0, y: 14, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}><header className="document-preview-heading"><div><span className="modal-eyebrow">受保护文件 · 本地预览</span><h2 id="document-preview-title">{preview.file.originalName}</h2><small>Rev {preview.file.revision} · {(preview.file.byteSize / 1024).toFixed(0)} KB · 文件内容不会发送到第三方预览服务</small></div><div className="document-preview-actions"><button type="button" className="outline-button" onClick={() => void download(preview.file)} disabled={busy}><Download size={15}/>下载原文件</button><button type="button" className="icon-button" onClick={closePreview} aria-label="关闭预览"><X size={18}/></button></div></header><div className="document-preview-body">{preview.kind === 'loading' ? <div className="document-preview-message" role="status">正在从当前工作区安全读取文件…</div> : preview.kind === 'pdf' && preview.url ? <iframe className="document-pdf-frame" src={preview.url} title={`${preview.file.originalName} PDF 预览`}/> : preview.kind === 'image' && preview.url ? <div className="document-image-canvas"><img src={preview.url} alt={preview.file.originalName}/></div> : preview.kind === 'text' || preview.kind === 'docx' ? <pre className="document-text-preview">{preview.text}</pre> : preview.kind === 'xlsx' ? <div className="document-sheet-preview"><table><tbody>{(preview.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : preview.kind === 'unsupported' ? <div className="document-preview-message">此 CAD 格式暂不支持浏览器预览，请下载原始文件查看。</div> : <div className="document-preview-message document-preview-error" role="alert">{preview.message ?? '文件预览失败。'}</div>}</div></motion.section></motion.div>}</AnimatePresence>
  </div>
}
function DocumentFileHistory({ files, loading, error, busy, onDownload, onPreview }: { files: DocumentFile[]; loading: boolean; error: string; busy: boolean; onDownload: (file: DocumentFile) => void; onPreview: (file: DocumentFile) => void }) {
  const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
  return <section className="doc-file-history"><div className="doc-file-history-head"><b>附件修订历史</b><span>{files.length} 个版本</span></div>{loading ? <small>正在加载附件记录…</small> : error ? <small className="doc-file-error" role="alert">{error}</small> : files.length ? files.map(file => <div className="doc-file-version" key={file.id}><span><b>{file.originalName}</b><small>Rev {file.revision} · {formatSize(file.byteSize)} · {file.createdAt.slice(0, 10)}</small></span><div className="doc-file-actions">{previewExtensions.has(extensionOf(file.originalName)) && <button type="button" className="quiet-icon" disabled={busy} onClick={() => onPreview(file)} aria-label={`预览 ${file.originalName}`} title="预览此修订"><Eye size={14}/></button>}<button type="button" className="quiet-icon" disabled={busy} onClick={() => onDownload(file)} aria-label={`下载 ${file.originalName}`} title="下载此修订"><Download size={14}/></button></div></div>) : <small>尚无附件；编辑档案时可上传图纸或受控文件。</small>}</section>
}
