import { useWorkspacePortal } from './WorkspacePortal'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './material-modal-overrides.css'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Boxes, Check, ChevronDown, CircleHelp, FileSearch, Layers3, Plus, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import { createId, syncMutation } from './data'
import { displayNode, dimensionNodes, dimensionRequirements, familyNodes, getNode, isCatalogLeaf, materialDraftBlockers, primaryFamilies } from './material-catalog'
import { getMaterialSpecTemplate, materialSpecTemplates, type MaterialSpecField } from './material-specs'
import type { LifecycleStatus, Material, MaterialCatalogNode, WorkspaceData } from './types'

const now = () => new Date().toISOString()
const lifecycleLabels: Record<LifecycleStatus, string> = { draft: '草稿', review: '审批中', released: '已发布', obsolete: '已作废' }
const nextLifecycle = (value: LifecycleStatus): LifecycleStatus => value === 'draft' ? 'review' : value === 'review' ? 'released' : value === 'released' ? 'obsolete' : 'draft'
const shortPath = (path?: string[]) => path?.join(' / ') || '未关联分类路径'
const labelForDimension = (family: string, value: string) => { const node = getNode(value); return node ? `${family}：${node.path.at(-1)} (${node.code})` : value }

function MaterialModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { portalHost } = useWorkspacePortal()
  return createPortal(
    <motion.div className="modal-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal-card material-modal" role="dialog" aria-modal="true" aria-labelledby="material-modal-title" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}>
        <div className="modal-heading"><div><span className="modal-eyebrow">MATERIAL MASTER · DRAFT</span><h2 id="material-modal-title">{title}</h2><p>分类与规格先结构化保存；未批准规则不会分配正式 ERP 物料号。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div>
        {children}
      </motion.div>
    </motion.div>,
    portalHost!,
  )
}
function FormField({ label, children, help }: { label: string; children: ReactNode; help?: string }) { return <label className="form-label material-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label> }
function BlockerBox({ blockers }: { blockers: string[] }) { return <div className="material-blockers"><div className="blocker-title"><ShieldAlert size={16}/>正式编码状态：阻断</div><ul>{blockers.slice(0, 4).map((item, index) => <li key={index}>{item}</li>)}</ul><small>这表示“当前不可发布”，不影响保存草稿或维护结构化主数据。</small></div> }
function StatePill({ state }: { state: LifecycleStatus }) { return <span className={`plm-pill state-${state}`}><i/>{lifecycleLabels[state]}</span> }

export default function MaterialWorkbench({ workspace, onChange, onToast }: { workspace: WorkspaceData; onChange: (data: WorkspaceData) => void; onToast: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [family, setFamily] = useState('成品')
  const [nodeId, setNodeId] = useState('')
  const [templateNumber, setTemplateNumber] = useState('')
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const [specValues, setSpecValues] = useState<Record<string, string>>({})
  const [boardType, setBoardType] = useState('kraft')
  const [statusFilter, setStatusFilter] = useState<'all' | LifecycleStatus>('all')
  const [saving, setSaving] = useState(false)
  const [advancingId, setAdvancingId] = useState<string | null>(null)
  const selectedNode = getNode(nodeId)
  const specTemplate = getMaterialSpecTemplate(templateNumber)
  const requiredDimensions = dimensionRequirements(selectedNode)
  const filteredMaterials = useMemo(() => workspace.materials.filter(material => {
    const haystack = [material.partNo, material.name, material.category, material.specification, material.proposedGroupNumber, ...(material.classificationPath ?? [])].join(' ').toLowerCase()
    return haystack.includes(query.toLowerCase()) && (statusFilter === 'all' || material.lifecycle === statusFilter)
  }), [workspace.materials, query, statusFilter])
  const blockers = materialDraftBlockers({ family, groupNodeId: nodeId, proposedGroupNumber: templateNumber, dimensions })

  const beginCreate = () => { setEditing(null); setFamily('成品'); setNodeId(''); setTemplateNumber(''); setDimensions({}); setSpecValues({}); setBoardType('kraft'); setModal(true) }
  const beginEdit = (material: Material) => { setEditing(material); setFamily(material.family ?? '成品'); setNodeId(material.groupNodeId ?? ''); setTemplateNumber(material.proposedGroupNumber ?? ''); setDimensions(material.dimensions ?? {}); setSpecValues(material.specificationFields ?? {}); setBoardType(material.specificationFields?.boardType ?? 'kraft'); setModal(true) }
  const changeFamily = (value: string) => { setFamily(value); setNodeId(''); setDimensions({}); setTemplateNumber(''); setSpecValues({}) }
  const changeTemplate = (value: string) => {
    setTemplateNumber(value)
    const template = getMaterialSpecTemplate(value)
    setSpecValues(Object.fromEntries((template?.fields ?? []).filter(field => field.defaultValue).map(field => [field.key, field.defaultValue!])))
  }
  const setDimValue = (key: string, value: string) => setDimensions(prev => ({ ...prev, [key]: value }))
  const setSpecValue = (key: string, value: string) => setSpecValues(prev => ({ ...prev, [key]: value }))
  const onNodeChange = (value: string) => { setNodeId(value); setDimensions({}); setTemplateNumber(''); setSpecValues({}) }

  const saveMaterial = async (event: FormEvent<HTMLFormElement>) => {
    if (saving) return
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const selectedSpecFields = (specTemplate?.fields ?? []).filter(field => !field.dependsOn || specValues[field.dependsOn.key] === field.dependsOn.value)
    const finalSpecs = Object.fromEntries(selectedSpecFields.filter(field => specValues[field.key] !== undefined && specValues[field.key] !== '').map(field => [field.key, specValues[field.key]!]))
    const specification = Object.entries(finalSpecs).map(([key, value]) => { const field = selectedSpecFields.find(item => item.key === key); return `${field?.label ?? key}: ${value}${field?.unit ? ` ${field.unit}` : ''}` }).join(' / ') || String(form.get('description') || '').trim()
    if (editing) {
      const updated: Material = { ...editing, name: String(form.get('name')).trim(), category: selectedNode?.path.at(-1) ?? family, family, groupNodeId: nodeId || undefined, proposedGroupNumber: templateNumber || undefined, classificationPath: selectedNode?.path, dimensions, specificationFields: finalSpecs, specification, unit: String(form.get('unit')).trim(), owner: String(form.get('owner')).trim(), codePreview: '正式编码待规则批准', codeState: 'blocked', erpSyncState: 'unverified', updatedAt: now() }
      setSaving(true)
      try {
        await syncMutation(`/materials/${updated.id}`, 'PATCH', updated)
        onChange({ ...workspace, materials: workspace.materials.map(item => item.id === updated.id ? updated : item) })
        onToast('物料草稿已更新')
      } catch (error) {
        onToast(`保存物料失败：${error instanceof Error ? error.message : String(error)}`)
        return
      } finally { setSaving(false) }
    } else {
      const id = createId()
      const material: Material = { id, partNo: `DRAFT-${id.slice(0, 8).toUpperCase()}`, name: String(form.get('name')).trim(), category: selectedNode?.path.at(-1) ?? family, family, groupNodeId: nodeId || undefined, proposedGroupNumber: templateNumber || undefined, classificationPath: selectedNode?.path, dimensions, specificationFields: finalSpecs, specification, unit: String(form.get('unit')).trim(), revision: 'A', lifecycle: 'draft', owner: String(form.get('owner')).trim(), codePreview: '正式编码待规则批准', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now(), updatedAt: now() }
      setSaving(true)
      try {
        await syncMutation('/materials', 'POST', material)
        onChange({ ...workspace, materials: [material, ...workspace.materials] })
        onToast('物料草稿已建档；未分配正式编码')
      } catch (error) {
        onToast(`创建物料失败：${error instanceof Error ? error.message : String(error)}`)
        return
      } finally { setSaving(false) }
    }
    setModal(false); setEditing(null)
  }
  const advanceLifecycle = async (material: Material) => {
    if (advancingId) return
    const lifecycle = nextLifecycle(material.lifecycle)
    setAdvancingId(material.id)
    try {
      await syncMutation(`/materials/${material.id}`, 'PATCH', { lifecycle })
      onChange({ ...workspace, materials: workspace.materials.map(item => item.id === material.id ? { ...item, lifecycle, updatedAt: now() } : item) })
      onToast(`物料生命周期更新为${lifecycleLabels[lifecycle]}；编码仍待规则批准`)
    } catch (error) {
      onToast(`更新物料生命周期失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setAdvancingId(null) }
  }
  const renderField = (field: MaterialSpecField) => {
    if (field.dependsOn && specValues[field.dependsOn.key] !== field.dependsOn.value) return null
    if (field.kind === 'select') return <FormField key={field.key} label={field.label} help={field.key === 'mouldMaterial' ? field.help : undefined}><select name={`spec_${field.key}`} value={specValues[field.key] ?? field.defaultValue ?? ''} onChange={e => setSpecValue(field.key, e.target.value)} required={field.required}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}{option.verified === false ? ' · 待ERP核验' : ''}</option>)}</select></FormField>
    if (field.kind === 'boolean') return <FormField key={field.key} label={field.label}><select name={`spec_${field.key}`} value={specValues[field.key] ?? ''} onChange={e => setSpecValue(field.key, e.target.value)} required><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select></FormField>
    return <FormField key={field.key} label={field.label} help={field.unit ? `单位：${field.unit}` : undefined}><input name={`spec_${field.key}`} type={field.kind === 'number' ? 'number' : 'text'} min={field.min} step={field.step} value={specValues[field.key] ?? field.defaultValue ?? ''} onChange={e => setSpecValue(field.key, e.target.value)} placeholder={field.placeholder} required={field.required}/></FormField>
  }
  const domainSelect = (requirement: { family: string; required: boolean; reason: string }) => <FormField key={requirement.family} label={`${requirement.family}${requirement.required ? ' · 必填候选' : ' · 可选'}`} help={requirement.reason}><select value={dimensions[requirement.family] ?? ''} required={requirement.required} onChange={e => setDimValue(requirement.family, e.target.value)}><option value="">{requirement.required ? '请选择已确认值' : '不适用 / 未选择'}</option>{dimensionNodes(requirement.family).map(node => <option key={node.id} value={node.id} disabled={!node.confirmed}>{node.path.at(-1)} · {node.code}{node.confirmed ? '' : '（待确认/禁用）'}</option>)}</select></FormField>

  return <div className="plm-page material-workbench"><div className="module-banner material-banner"><div className="module-banner-icon"><Boxes size={22}/></div><div><span className="plm-overline">MATERIAL MASTER · CLASSIFICATION × DIMENSIONS</span><h2>物料主数据</h2><p>分类路径、共享维度、专属规格和 ERP 权威分组分层维护；编码在规则获批前保持阻断。</p></div><div className="banner-number"><b>{workspace.materials.length.toString().padStart(2, '0')}</b><small>物料档案</small></div></div>
    <div className="material-governance-strip"><span><i className="governance-dot amber"/><b>设计矩阵</b> 231 个节点 · 含 16 个待确认值</span><span><i className="governance-dot blue"/><b>共享维度</b> 注塑材质 / 五金材质 / 表面处理</span><span><i className="governance-dot red"/><b>ERP 权威树</b> 当前未绑定 · 禁止正式编码</span></div>
    <div className="plm-toolbar"><div className="toolbar-title"><b>物料档案</b><span>{filteredMaterials.length} 条记录 · 记录编码均为演示号或草稿号，非 ERP 正式物料号</span></div><div className="toolbar-actions"><label className="module-search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索编码、名称、分类…"/></label><label className="status-filter"><SlidersHorizontal size={14}/><select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="review">审批中</option><option value="released">已发布</option><option value="obsolete">已作废</option></select><ChevronDown size={13}/></label><button className="primary-button" onClick={beginCreate}><Plus size={15}/>新建物料</button></div></div>
    <section className="panel plm-panel no-top"><div className="plm-table-wrap"><table className="plm-table materials-table"><thead><tr><th>物料编号</th><th>物料名称 / 分类路径</th><th>共享维度</th><th>规格摘要</th><th>版本</th><th>生命周期</th><th>ERP / 编码状态</th><th>责任人</th></tr></thead><tbody>{filteredMaterials.map(material => { const node = getNode(material.groupNodeId); return <tr key={material.id} className="material-row" onClick={() => beginEdit(material)}><td><button className="table-link mono" onClick={e => { e.stopPropagation(); beginEdit(material) }}>{material.partNo}</button><small className="table-subtag">{material.codeState === 'blocked' ? '编码阻断' : '草稿'}</small></td><td><b>{material.name}</b><small>{node ? displayNode(node) : shortPath(material.classificationPath) || material.category}</small></td><td>{Object.entries(material.dimensions ?? {}).length ? Object.entries(material.dimensions ?? {}).map(([domain, value]) => <small key={domain}>{labelForDimension(domain, value)}</small>) : <span className="muted">—</span>}</td><td className="spec-cell">{material.specification || '未填写'}</td><td><span className="revision-tag">{material.revision}</span></td><td><button className="pill-button" onClick={e => { e.stopPropagation(); advanceLifecycle(material) }} title="点击推进草稿 / 审批 / 发布状态"><StatePill state={material.lifecycle}/></button></td><td><span className="material-code-state"><i/>{material.erpSyncState === 'synced' ? 'ERP 已同步' : 'ERP 未核验'}</span><small>{material.codePreview || '正式编码待批准'}</small></td><td>{material.owner}</td></tr> })}</tbody></table>{!filteredMaterials.length && <div className="plm-empty"><span><FileSearch size={20}/></span><b>没有匹配的物料</b><small>调整关键词或新建一条草稿。</small></div>}</div><div className="table-footnote"><span><ShieldCheck size={14}/>分类矩阵为设计参考；ERP 分组只有在线核验后才是权威数据</span><span>点击记录维护档案</span></div></section>
    <AnimatePresence>{modal && <MaterialModal title={editing ? '维护物料档案' : '新建物料档案'} onClose={() => { setModal(false); setEditing(null) }}><form className="form-stack material-form" onSubmit={saveMaterial}>
      <div className="material-section-heading"><span>01</span><div><b>物料身份与分类</b><small>分类描述物料身份；候选树与 ERP 权威分组分开保存。</small></div></div>
      {editing && <div className="draft-id-banner"><span>当前编号</span><b>{editing.partNo}</b><small>当前记录是演示号/草稿号，未向 ERP 申请正式编码。</small></div>}
      <div className="form-row"><FormField label="物料名称"><input name="name" required autoFocus defaultValue={editing?.name} maxLength={100} placeholder="名称应清晰、稳定、可检索"/></FormField><FormField label="物料族"><select value={family} onChange={e => changeFamily(e.target.value)} required>{primaryFamilies.map(value => <option key={value}>{value}</option>)}</select></FormField></div>
      <FormField label="设计分类路径（231 节点矩阵）" help="待确认的目录项置灰，不能参与正式规则或编码发布。"><select value={nodeId} onChange={e => onNodeChange(e.target.value)}><option value="">选择一个分类 / 叶节点</option>{familyNodes(family).filter(isCatalogLeaf).map(node => <option key={node.id} value={node.id} disabled={!node.confirmed}>{node.path.join(' / ')} · {node.code}{node.confirmed ? '' : ' · 待确认'}</option>)}</select></FormField>
      {selectedNode && <div className={`classification-preview ${selectedNode.confirmed ? '' : 'unconfirmed'}`}><Layers3 size={15}/><span><b>{selectedNode.path.join(' / ')}</b><small>{selectedNode.id} · {selectedNode.source} · {selectedNode.confirmed ? '原图可读，不等于正式规则已批准' : '待确认节点，禁止发布'}</small></span></div>}
      <div className="material-section-heading"><span>02</span><div><b>并行维度引用</b><small>共享字典不嵌入分类树；跨域值由规则校验。</small></div></div>
      {requiredDimensions.length ? <div className="form-row dimension-row">{requiredDimensions.map(domainSelect)}</div> : <div className="form-help-box"><CircleHelp size={15}/>该分类在本设计矩阵中没有可直接确认的并行维度配置；如业务需要额外维度，应先在规则配置中定义，不自由拼码。</div>}
      {family === '成品' && selectedNode?.path[0] === '五金件' && <div className="form-row dimension-row"><FormField label="表面处理 · 可选" help="复合工艺必须是字典中的单一原子值，不可任意拼接。"><select value={dimensions['表面处理'] ?? ''} onChange={e => setDimValue('表面处理', e.target.value)}><option value="">无 / 尚未确认适用</option>{dimensionNodes('表面处理').map(node => <option key={node.id} value={node.id} disabled={!node.confirmed}>{node.path.at(-1)} · {node.code}{node.confirmed ? '' : '（待确认）'}</option>)}</select></FormField></div>}
      <div className="material-section-heading"><span>03</span><div><b>分组规格模板</b><small>模板编号是候选配置，不代表已绑定 ERP group ID。</small></div></div>
      <FormField label="候选分组规格模板"><select value={templateNumber} onChange={e => changeTemplate(e.target.value)}><option value="">不选择 / 等待权威分组绑定</option>{materialSpecTemplates.map(template => <option key={template.groupNumber} value={template.groupNumber}>{template.groupNumber} · {template.name}</option>)}</select></FormField>
      {specTemplate && <div className="spec-template-card"><div className="spec-template-title"><b>{specTemplate.name} · {specTemplate.groupNumber}</b><span>草稿模板</span></div><p>{specTemplate.note}</p><div className="form-row spec-field-grid">{specTemplate.fields.map(renderField)}</div></div>}
      <div className="material-section-heading"><span>04</span><div><b>主数据与发布检查</b><small>ERP 单位编码、权威 group ID 和正式编号均需服务端核验。</small></div></div>
      <div className="form-row"><FormField label="计量单位（文本）"><input name="unit" required defaultValue={editing?.unit ?? '件'} placeholder="件 / 台 / 包等"/></FormField><FormField label="责任人 / 责任部门"><input name="owner" required defaultValue={editing?.owner ?? '工程部'} placeholder="物料负责人"/></FormField></div>
      <BlockerBox blockers={blockers}/>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => { setModal(false); setEditing(null) }}>取消</button><button type="submit" className="primary-button" disabled={saving}><Check size={15}/>{saving ? '保存中…' : editing ? '保存档案草稿' : '创建物料草稿'}</button></div>
    </form></MaterialModal>}</AnimatePresence>
  </div>
}
