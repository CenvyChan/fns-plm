import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { apiFetch, apiJson, jsonRequest, type AuthUser } from './api'
import type { Task } from './types'
import type { CollaborationMode, CollaborationRecurrence, CollaborationTask, TaskReport } from './task-collaboration'
import './task-collaboration.css'

type Member = { id: string; displayName: string; role: string }
type Props = { user: AuthUser; task?: Task | null }
const asCollab = (task: Task): CollaborationTask => task as CollaborationTask
const localDate = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

export function TaskCollaborationFields({ user, task }: Props) {
  const editing = !!task
  const current = task ? asCollab(task) : undefined
  const [members, setMembers] = useState<Member[]>([])
  const [mode, setMode] = useState<CollaborationMode>(current?.collaborationMode ?? 'personal')
  const [assigneeId, setAssigneeId] = useState(current?.assigneeId ?? user.id)
  const [receiverId, setReceiverId] = useState(current?.receiverId ?? user.id)
  const [recurrence, setRecurrence] = useState<CollaborationRecurrence>(current?.recurrence ?? 'none')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    apiJson<{ members: Member[] }>('/api/task-members').then(data => { if (alive) setMembers(Array.isArray(data.members) ? data.members : []) }).catch(e => { if (alive) setError(e instanceof Error ? e.message : '无法加载协作成员') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!task) { setMode('personal'); setAssigneeId(user.id); setReceiverId(user.id); setRecurrence('none'); return }
    const t = asCollab(task); setMode(t.collaborationMode ?? 'personal'); setAssigneeId(t.assigneeId ?? user.id); setReceiverId(t.receiverId ?? user.id); setRecurrence(t.recurrence ?? 'none')
  }, [task?.id, user.id])
  const locked = editing
  const people = useMemo(() => members.some(m => m.id === user.id) ? members : [{ id: user.id, displayName: `${user.displayName}（我）`, role: user.role }, ...members], [members, user.id, user.displayName, user.role])
  const memberName = (id?: string) => id === user.id ? `${user.displayName}（我）` : people.find(member => member.id === id)?.displayName ?? id ?? '未设置'
  return <section className="tc-fields" aria-label="任务协作设置">
    <input type="hidden" name="collaborationMode" value={mode}/><input type="hidden" name="assigneeId" value={mode === 'report' && !editing ? user.id : assigneeId}/><input type="hidden" name="receiverId" value={mode === 'assignment' && !editing ? user.id : receiverId}/><input type="hidden" name="recurrence" value={mode === 'personal' ? 'none' : recurrence}/>
    <h3>协作设置</h3><label>任务类型<select name="collaborationMode-display" value={mode} disabled={locked} onChange={e => { const value = e.target.value as CollaborationMode; setMode(value); if (value === 'assignment') setReceiverId(user.id); if (value === 'report') setAssigneeId(user.id) }}><option value="personal">个人待办</option><option value="assignment">指派任务</option><option value="report">主动汇报</option></select></label>
    {mode !== 'personal' && <>
      {mode === 'assignment' ? <><label>汇报接收人<span className="tc-readonly">{memberName(editing ? current?.receiverId : user.id)}</span>{!editing && <small>由你指派并接收汇报；负责人确认接手，2 小时未确认自动接收。</small>}</label><label>负责人<select name="assigneeId-display" value={assigneeId} disabled={locked} onChange={e => setAssigneeId(e.target.value)}>{people.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label></> : <><label>汇报人<span className="tc-readonly">{memberName(editing ? current?.assigneeId : user.id)}</span></label><label>接收人<select name="receiverId-display" value={receiverId} disabled={locked} onChange={e => setReceiverId(e.target.value)}>{people.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label></>}
      <label>汇报周期<select name="recurrence-display" value={recurrence} disabled={locked} onChange={e => setRecurrence(e.target.value as CollaborationRecurrence)}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><p className="tc-note">主动/周期汇报用于提醒并记录进度与附件；销售、采购日报仍在原业务页面维护，不会自动拉取业务数据。</p>
    </>}{error && <p className="tc-error" role="alert">成员列表加载失败：{error}</p>}
  </section>
}

export function TaskCollaborationPanel({ task, user, onChange }: { task: Task; user: AuthUser; onChange: (task: Task) => void }) {
  const t = asCollab(task)
  const generation = useRef(0)
  useEffect(() => { generation.current += 1; return () => { generation.current += 1 } }, [task.id])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [due, setDue] = useState(t.committedDueDate ?? t.dueDate ?? localDate()); const [content, setContent] = useState(''); const [progress, setProgress] = useState(String(t.progress ?? 0)); const [files, setFiles] = useState<File[]>([]); const [comment, setComment] = useState('')
  const [remaining, setRemaining] = useState('')
  useEffect(() => { setDue(t.committedDueDate ?? t.dueDate ?? localDate()); setContent(''); setProgress(String(t.progress ?? 0)); setFiles([]); setComment(''); setError(''); setBusy(false) }, [task.id])
  useEffect(() => { if (!t.acceptBy || t.acceptanceStatus !== 'pending') { setRemaining(''); return }
    const deadline = new Date(t.acceptBy).getTime()
    const tick = () => { const ms = Math.max(0, deadline - Date.now()); setRemaining(ms ? `${Math.floor(ms / 3600000)}小时${Math.floor(ms % 3600000 / 60000)}分` : '已到自动接收时间'); return ms }
    const first = tick()
    if (first <= 0) {
      let alive = true
      apiJson<{ tasks?: Task[] }>('/api/workspace').then(data => { const latest = data.tasks?.find(item => item.id === task.id); if (alive && latest && JSON.stringify(latest) !== JSON.stringify(task)) onChange(latest) }).catch(() => { /* list-level refresh can update task later */ })
      return () => { alive = false }
    }
    const timer = window.setInterval(() => { if (tick() <= 0) { window.clearInterval(timer); apiJson<{ tasks?: Task[] }>('/api/workspace').then(data => { const latest = data.tasks?.find(item => item.id === task.id); if (latest) onChange(latest) }).catch(() => { /* list-level refresh can update task later */ }) } }, Math.min(first, 30000))
    return () => window.clearInterval(timer)
  }, [task.id, task, t.acceptBy, t.acceptanceStatus, onChange])
  const apply = async (path: string, init: RequestInit) => {
    if (busy) return
    const requestGeneration = generation.current
    setBusy(true); setError('')
    try { const value = await apiJson<CollaborationTask>(path, init); if (generation.current === requestGeneration) onChange(value) }
    catch (e) { if (generation.current === requestGeneration) setError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { if (generation.current === requestGeneration) setBusy(false) }
  }
  const submitReport = async (event: FormEvent) => { event.preventDefault(); if (!content.trim()) { setError('请填写汇报内容'); return } if (files.length > 5 || files.some(file => file.size > 10 * 1024 * 1024)) { setError('最多上传 5 个附件，每个附件不超过 10 MB'); return } const form = new FormData(); form.set('content', content); form.set('progress', progress); files.forEach(file => form.append('attachments', file)); await apply(`/api/tasks/${encodeURIComponent(task.id)}/reports`, { method: 'POST', body: form }) }
  const download = async (report: TaskReport, attachment: TaskReport['attachments'][number]) => { if (busy) return; setBusy(true); setError(''); try { const response = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/reports/${encodeURIComponent(report.id)}/attachments/${encodeURIComponent(attachment.id)}`); if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = attachment.name; a.click(); URL.revokeObjectURL(url) } catch (e) { setError(e instanceof Error ? e.message : '附件下载失败') } finally { setBusy(false) } }
  const canAccept = t.acceptanceStatus === 'pending' && t.assigneeId === user.id
  const canReport = !!t.collaborationMode && t.assigneeId === user.id && t.acceptanceStatus !== 'pending' && !!t.committedDueDate && t.reportStatus !== 'submitted' && t.reportStatus !== 'approved' && t.status !== 'done'
  const canReview = t.reportStatus === 'submitted' && t.receiverId === user.id
  if (!t.collaborationMode) return <section className="tc-panel"><h3>协作信息</h3><p>个人待办</p></section>
  return <section className="tc-panel" aria-label="任务协作信息">
    <header><div><h3>协作信息</h3><span className="tc-pill">{t.collaborationMode === 'assignment' ? '指派任务' : '主动汇报'}</span></div>{t.recurrence && t.recurrence !== 'none' && <span>周期：{({ daily: '每天', weekly: '每周', monthly: '每月' } as Record<string, string>)[t.recurrence]}</span>}</header>
    <div className="tc-status"><b>接收状态</b><span>{t.acceptanceStatus === 'accepted' ? `已接收${t.acceptedAt ? ` · ${new Date(t.acceptedAt).toLocaleString()}` : ''}` : t.acceptanceStatus === 'auto-accepted' ? '已自动接收' : '待接收'}</span>{t.acceptanceStatus === 'pending' && remaining && <span>自动接收倒计时：{remaining}</span>}{t.acceptanceStatus === 'auto-accepted' && <span>已自动接手，请负责人回复完成期限。</span>}</div>
    {canAccept && <form className="tc-action" onSubmit={e => { e.preventDefault(); void apply(`/api/tasks/${encodeURIComponent(task.id)}/accept`, jsonRequest('POST', { committedDueDate: due })) }}><h4>接手任务并回复完成期限</h4><label>预计完成日期<input type="date" required value={due} onChange={e => setDue(e.target.value)}/></label><button disabled={busy}>确认接手</button></form>}
    {t.acceptanceStatus !== 'pending' && t.acceptanceStatus !== undefined && <div className="tc-status"><b>回复完成期限</b><span>{t.committedDueDate ?? '尚未回复'}</span>{t.assigneeId === user.id && t.status !== 'done' && t.reportStatus !== 'submitted' && <form className="tc-inline" onSubmit={e => { e.preventDefault(); void apply(`/api/tasks/${encodeURIComponent(task.id)}/commit-deadline`, jsonRequest('POST', { committedDueDate: due })) }}><input aria-label="完成期限" type="date" required value={due} onChange={e => setDue(e.target.value)}/><button disabled={busy}>提交期限</button></form>}</div>}
    {canReport && <form className="tc-action" onSubmit={submitReport}><h4>提交完成情况 / 进度</h4><label>进度（%）<input type="number" min="0" max="100" required value={progress} onChange={e => setProgress(e.target.value)}/></label><label>完成情况<textarea value={content} onChange={e => setContent(e.target.value)} placeholder="填写本周期进展、结果或遇到的问题…" required/></label><label>附件（最多 5 个，每个不超过 10 MB）<input type="file" multiple onChange={(e: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(e.target.files ?? []))}/></label>{files.length > 0 && <small>{files.map(f => f.name).join('、')}</small>}<button disabled={busy}>提交汇报</button></form>}
    {t.reports?.length ? <div className="tc-history"><h4>历史汇报</h4>{[...t.reports].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(report => <article key={report.id}><div className="tc-report-head"><b>{report.progress}% 进度</b><time>{new Date(report.createdAt).toLocaleString()}</time><span>汇报人：{report.authorId === user.id ? '我' : report.authorId}</span></div><p>{report.content}</p>{report.review && <div className="tc-report-review"><b>{report.review.decision === 'approve' ? '已确认' : '已退回'}</b><span>{report.review.comment || '未填写意见'}</span><time>{new Date(report.review.at).toLocaleString()}</time></div>}{report.attachments?.length > 0 && <ul>{report.attachments.map(file => <li key={file.id}><button type="button" disabled={busy} onClick={() => void download(report, file)}>{file.name}</button><small>（{Math.ceil(file.size / 1024)} KB）</small></li>)}</ul>}</article>)}</div> : null}
    {canReview && <form className="tc-action" onSubmit={e => { e.preventDefault(); void apply(`/api/tasks/${encodeURIComponent(task.id)}/review`, jsonRequest('POST', { decision: 'approve', comment })) }}><h4>审核汇报</h4><label>评语（可选）<textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="填写审批意见…"/></label><div className="tc-buttons"><button disabled={busy}>批准</button><button type="button" className="tc-secondary" disabled={busy} onClick={() => void apply(`/api/tasks/${encodeURIComponent(task.id)}/review`, jsonRequest('POST', { decision: 'return', comment }))}>退回修改</button></div></form>}
    {t.reviewComment && <div className="tc-status"><b>接收人意见</b><span>{t.reviewComment}</span></div>}{t.reportStatus && t.reportStatus !== 'none' && <div className="tc-status"><b>汇报状态</b><span>{({ submitted: '待审核', approved: '已批准', returned: '已退回' } as Record<string, string>)[t.reportStatus]}</span></div>}{error && <p className="tc-error" role="alert">{error}</p>}
  </section>
}
