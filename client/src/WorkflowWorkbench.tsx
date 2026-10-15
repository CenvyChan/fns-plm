import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, Plus, RefreshCw, Send, X } from 'lucide-react'
import { apiFetch } from './api'

type BusinessType = 'material' | 'bom' | 'document' | 'performance'
type WorkflowTask = {
  id: string; title: string; businessType: string; businessId: string; requester: string; assignee: string;
  createdAt: string; dueAt: string; status: string; preview: unknown; processInstanceId?: string; taskDefinitionKey?: string
}
type WorkflowResponse = { mode?: 'demo' | 'flowable'; engine?: { connected?: boolean; configured?: boolean; message?: string }; tasks?: WorkflowTask[] }
type AuditEntry = { id: string; taskId: string; actor: string; decision: 'approved' | 'rejected'; comment: string; createdAt: string; mode: string; title?: string; businessType?: string; businessId?: string }
const labels: Record<BusinessType, string> = { material: '物料主数据', bom: 'BOM 修订', document: '图文档修订', performance: 'KPI 绩效评审' }
const processKeys: Record<BusinessType, string> = { material: 'materialApproval', bom: 'bomReleaseApproval', document: 'documentReleaseApproval', performance: 'performanceReviewApproval' }
const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const date = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
async function errorMessage(response: Response) {
  try { const data = await response.json() as { error?: string }; return data.error || `请求失败（HTTP ${response.status}）` }
  catch { return `请求失败（HTTP ${response.status}）` }
}

export default function WorkflowWorkbench() {
  const [data, setData] = useState<WorkflowResponse>({ tasks: [] })
  const [selected, setSelected] = useState<WorkflowTask | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [businessType, setBusinessType] = useState<BusinessType>('material')
  const [businessId, setBusinessId] = useState('')
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [previewText, setPreviewText] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await apiFetch('/api/workflow/tasks')
      if (!response.ok) throw new Error(await errorMessage(response))
      const result = await response.json() as WorkflowResponse
      const requestedId = new URLSearchParams(window.location.search).get('approval')
      setData(result)
      setSelected(current => result.tasks?.find(task => task.id === requestedId || task.processInstanceId === requestedId || task.businessId === requestedId) ?? result.tasks?.find(task => task.id === current?.id) ?? result.tasks?.[0] ?? null)
      try {
        const auditResponse = await apiFetch('/api/workflow/audit')
        if (auditResponse.ok) { const audit = await auditResponse.json() as { entries?: AuditEntry[] }; setAuditEntries(audit.entries ?? []) }
        else setAuditEntries([])
      } catch { setAuditEntries([]) }
    } catch (e) { setError(e instanceof Error ? e.message : '无法加载流程待办') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const flowable = data.mode === 'flowable'

  const complete = async (decision: 'approved' | 'rejected') => {
    if (!selected || !comment.trim()) { setError('请填写审批意见后再提交'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch(`/api/workflow/tasks/${encodeURIComponent(selected.id)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, comment: comment.trim() }) })
      if (!response.ok) throw new Error(await errorMessage(response))
      setNotice(decision === 'approved' ? '审批意见已记录：同意' : '审批意见已记录：驳回'); setComment(''); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : '审批提交失败') }
    finally { setBusy(false) }
  }

  const startProcess = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const id = businessId.trim(), name = title.trim()
    const preview = { 类型: labels[businessType], 业务编号: id, 摘要: previewText.trim() || '未填写摘要' }
    try {
      const path = flowable ? '/api/workflow/instances' : '/api/workflow/demo-tasks'
      const body = flowable
        ? { processDefinitionKey: processKeys[businessType], businessKey: id, variables: { businessType, businessId: id, title: name, assignee: assignee.trim(), requester: '当前发起人' } }
        : { businessType, businessId: id, title: name, requester: '发起人（演示）', assignee: assignee.trim() || '审批人（演示）', preview }
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(await errorMessage(response))
      const result = await response.json() as { notification?: { ok?: boolean; message?: string } }
      setNotice(flowable ? (result.notification?.ok ? 'Flowable 流程已发起，钉钉待办通知已发送' : 'Flowable 流程已发起；钉钉通知尚未配置或未发送') : '本地演示流程已创建；不会触发真实审批或 ERP 写入')
      setCreateOpen(false); setBusinessId(''); setTitle(''); setAssignee(''); setPreviewText(''); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : '流程发起失败') }
    finally { setBusy(false) }
  }

  return <main className="iw-page">
    <header className="iw-heading"><div><div className="iw-eyebrow">流程协同 / WORKFLOW</div><h1>流程待办</h1><p>查看业务上下文、发起流程并提交必填审批意见。</p></div><div className="iw-heading-actions"><button className="iw-button iw-primary" onClick={() => { setCreateOpen(value => !value); setError(''); setNotice('') }}><Plus size={15}/>{createOpen ? '收起表单' : '发起流程'}</button><button className="iw-button iw-secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15}/>刷新</button></div></header>
    <div className={`iw-banner ${flowable ? 'iw-live' : 'iw-demo'}`}><span className="iw-status-dot"/><div><b>{flowable ? 'Flowable 已连接' : '本地演示 / Flowable 未连接'}</b><small>{flowable ? (data.engine?.message || '流程引擎连接正常；身份由可信代理校验。') : '当前任务及操作仅写入本地演示记录，不代表真实审批或流程引擎操作。'}</small></div></div>
    {(error || notice) && <div className={`iw-alert ${error ? 'iw-error' : 'iw-success'}`} role="status">{error || notice}</div>}

    {createOpen && <section className="iw-card iw-start-form"><div className="iw-card-head"><div><h2>{flowable ? '发起 Flowable 流程' : '发起本地演示流程'}</h2><p>{flowable ? '流程实例会进入独立 Flowable 引擎；用户身份必须由可信代理提供。' : '本地演示记录会进入下方待办队列，用于演练预览、意见留痕与审计。'}</p></div></div>
      <form className="iw-start-grid" onSubmit={startProcess}><label>业务类型<select value={businessType} onChange={e => setBusinessType(e.target.value as BusinessType)}>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>业务编号<input value={businessId} onChange={e => setBusinessId(e.target.value)} placeholder="例如 MAT-2026-001" maxLength={120} required/></label><label>流程标题<input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：传感器支架物料评审" maxLength={120} required/></label><label>审批人 / Flowable assignee<input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder={flowable ? '请输入已在流程引擎授权的 assignee' : '演示审批人（可选）'} maxLength={100} required={flowable}/></label><label className="iw-start-summary">业务摘要<textarea rows={2} value={previewText} onChange={e => setPreviewText(e.target.value)} maxLength={400} placeholder="将作为业务预览摘要"/></label><div className="iw-start-actions"><button className="iw-button iw-approve" disabled={busy || !businessId.trim() || !title.trim()}><Send size={14}/>{busy ? '提交中…' : flowable ? '启动真实流程' : '创建演示流程'}</button></div></form>
    </section>}

    <section className="iw-stats"><div><span>待办数量</span><strong>{data.tasks?.length ?? 0}</strong></div><div><span>当前选择</span><strong className="iw-stat-text">{selected?.businessType || '—'}</strong></div><div><span>流程状态</span><strong className="iw-stat-text">{flowable ? 'Flowable' : '本地演示'}</strong></div></section>
    <div className="iw-columns"><section className="iw-card iw-list"><div className="iw-card-head"><div><h2>待处理事项</h2><p>选择一项查看业务预览</p></div><span className="iw-count">{data.tasks?.length ?? 0}</span></div>{loading ? <div className="iw-empty">正在加载…</div> : data.tasks?.length ? <div className="iw-task-list">{data.tasks.map(task => <button key={task.id} className={`iw-task ${selected?.id === task.id ? 'iw-task-selected' : ''}`} onClick={() => { setSelected(task); setComment(''); setError('') }}><span className="iw-task-top"><b>{task.title}</b><i>{task.status === 'pending' ? '待处理' : task.status}</i></span><span className="iw-task-meta">{labels[task.businessType as BusinessType] || task.businessType} · {task.businessId || '无业务编号'}</span><span className="iw-task-meta">发起人 {task.requester || '—'}　·　处理人 {task.assignee || '—'}</span><span className="iw-task-meta">到期 {date(task.dueAt)}</span></button>)}</div> : <div className="iw-empty">暂无流程待办</div>}</section>
    <section className="iw-card iw-detail"><div className="iw-card-head"><div><h2>业务预览</h2><p>{selected ? `${labels[selected.businessType as BusinessType] || selected.businessType} · ${selected.businessId || selected.id}` : '选择待办以查看详情'}</p></div></div>{selected ? <><div className="iw-detail-grid"><div><span>事项</span><b>{selected.title}</b></div><div><span>发起人</span><b>{selected.requester || '—'}</b></div><div><span>处理人</span><b>{selected.assignee || '—'}</b></div><div><span>创建时间</span><b>{date(selected.createdAt)}</b></div></div><div className="iw-preview"><div className="iw-preview-head"><b>业务数据</b><span>{labels[selected.businessType as BusinessType] || selected.businessType || '业务预览'}</span></div><pre>{pretty(selected.preview ?? '暂无业务预览内容')}</pre></div>{selected.processInstanceId && <div className="iw-process">流程实例 {selected.processInstanceId}{selected.taskDefinitionKey ? ` · ${selected.taskDefinitionKey}` : ''}</div>}<label className="iw-comment">审批意见 <em>必填</em><textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="请填写审批意见；意见将与审批记录一同保存" required/></label><div className="iw-actions"><button className="iw-button iw-reject" disabled={busy || !comment.trim()} onClick={() => void complete('rejected')}><X size={15}/>驳回</button><button className="iw-button iw-approve" disabled={busy || !comment.trim()} onClick={() => void complete('approved')}><Check size={15}/>同意</button></div></> : <div className="iw-empty">暂无可展示的业务预览</div>}</section></div>
    <section className="iw-card iw-audit"><div className="iw-card-head"><div><h2>审批审计</h2><p>{flowable ? '仅展示当前登录审批人的操作记录；Flowable 任务评论同时写入流程引擎。' : '本地演示审批意见与结论会持久化保存。'}</p></div><span className="iw-count">{auditEntries.length}</span></div>{auditEntries.length ? <div className="iw-audit-list">{auditEntries.map(entry => <article className="iw-audit-entry" key={entry.id}><span className={`iw-audit-decision ${entry.decision === 'approved' ? 'is-approved' : 'is-rejected'}`}>{entry.decision === 'approved' ? '同意' : '驳回'}</span><div className="iw-audit-copy"><b>{entry.title || entry.businessId || entry.taskId}</b><small>{entry.mode === 'flowable' ? 'Flowable' : '本地演示'} · {labels[entry.businessType as BusinessType] || entry.businessType || '审批流程'} · {entry.businessId || entry.taskId} · {entry.actor}</small><p>{entry.comment}</p></div><time>{date(entry.createdAt)}</time></article>)}</div> : <div className="iw-empty">暂无已处理审批。完成一项待办后，意见、结论与操作人会显示在这里。</div>}</section>
  </main>
}
