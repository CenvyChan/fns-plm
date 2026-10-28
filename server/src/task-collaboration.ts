import { Router, type Request, type Response, type RequestHandler } from 'express'
import multer from 'multer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import type { Task, Workspace } from './workspace-store.js'

export type CollaborationTask = Task & {
  collaborationMode?: 'assignment' | 'report'; creatorId?: string; assigneeId?: string; receiverId?: string
  acceptanceStatus?: 'pending' | 'accepted' | 'auto-accepted'; acceptBy?: string; acceptedAt?: string; committedDueDate?: string
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly'; seriesId?: string; scheduledDueDate?: string; recurrenceAnchorDay?: number
  occurrenceKey?: string; nextOccurrenceId?: string; previousOccurrenceId?: string
  reportStatus?: 'none' | 'submitted' | 'approved' | 'returned'; reports?: TaskReport[]; reviewComment?: string
}
interface Attachment { id: string; name: string; size: number }
interface TaskReport { id: string; content: string; progress: number; createdAt: string; authorId: string; attachments: Attachment[]; review?: { decision: string; comment: string; by: string; at: string } }

export function validTaskDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function nextRecurringDate(due: string, recurrence: string, anchorDay = Number(due.slice(8, 10))): string {
  if (!validTaskDate(due)) throw new Error('无效周期日期')
  const date = new Date(`${due}T12:00:00Z`)
  if (recurrence === 'daily') date.setUTCDate(date.getUTCDate() + 1)
  else if (recurrence === 'weekly') date.setUTCDate(date.getUTCDate() + 7)
  else if (recurrence === 'monthly') {
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1)
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(Math.max(1, Math.min(31, anchorDay)), last))
  } else throw new Error('无效汇报周期')
  return date.toISOString().slice(0, 10)
}

// Fixed calendar recurrence, independent of approval. One occurrence per series per sweep;
// approval may prepare the immediate next occurrence early. Never iterate a mutating array.
export function ensureNextTask(workspace: Workspace, task: CollaborationTask, now: number, force = false): boolean {
  if (!task.collaborationMode || !task.recurrence || task.recurrence === 'none') return false
  const due = task.scheduledDueDate ?? task.dueDate
  if (!validTaskDate(due)) return false
  const seriesId = task.seriesId ?? task.id
  const anchor = task.recurrenceAnchorDay ?? Number(due.slice(8, 10))
  const nextDue = nextRecurringDate(due, task.recurrence, anchor)
  const key = `${seriesId}:${nextDue}`
  const existing = workspace.tasks.find(item => item.occurrenceKey === key || (item.seriesId === seriesId && (item.scheduledDueDate ?? item.dueDate) === nextDue))
  if (existing) {
    if (task.nextOccurrenceId !== existing.id) { task.nextOccurrenceId = existing.id; return true }
    return false
  }
  // Business reporting calendar defaults to China time; configurable for other deployments.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TASK_TIME_ZONE || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  if (!force && nextDue > today) return false
  const next: CollaborationTask = {
    id: nanoid(), title: task.title, description: task.description, dueDate: nextDue, priority: task.priority, status: 'todo', createdAt: new Date(now).toISOString(),
    projectId: task.projectId, creatorId: task.creatorId, assigneeId: task.assigneeId, receiverId: task.receiverId,
    collaborationMode: task.collaborationMode, acceptanceStatus: task.collaborationMode === 'assignment' ? 'pending' : 'accepted',
    ...(task.collaborationMode === 'assignment' ? { acceptBy: new Date(now + 7200000).toISOString() } : { acceptedAt: new Date(now).toISOString(), committedDueDate: nextDue }),
    recurrence: task.recurrence, seriesId, scheduledDueDate: nextDue, recurrenceAnchorDay: anchor, occurrenceKey: key,
    previousOccurrenceId: task.id, progress: 0, reportStatus: 'none', reports: [],
  }
  task.nextOccurrenceId = next.id
  workspace.tasks.unshift(next)
  return true
}
export function sweepTaskWorkspace(workspace: Workspace, now = Date.now()): boolean {
  if (!Array.isArray(workspace.tasks)) return false
  let changed = false
  const latest = new Map<string, CollaborationTask>()
  for (const raw of workspace.tasks.slice()) {
    const task = raw as CollaborationTask
    if (!task.collaborationMode) continue
    if (task.acceptanceStatus === 'pending' && task.acceptBy && Date.parse(task.acceptBy) <= now) {
      task.acceptanceStatus = 'auto-accepted'; task.acceptedAt = task.acceptBy; changed = true
    }
    if (task.recurrence && task.recurrence !== 'none') {
      const sid = task.seriesId ?? task.id
      const prior = latest.get(sid)
      if (!prior || (prior.scheduledDueDate ?? prior.dueDate) < (task.scheduledDueDate ?? task.dueDate)) latest.set(sid, task)
    }
  }
  for (const task of latest.values()) if (ensureNextTask(workspace, task, now)) changed = true
  return changed
}
export function publicTask(task: Task): Task {
  const copy = structuredClone(task) as CollaborationTask
  for (const report of copy.reports ?? []) for (const attachment of report.attachments ?? []) delete (attachment as Attachment & { path?: string }).path
  return copy
}
export function publicWorkspace(workspace: Workspace): Workspace {
  // Workspace may be an AsyncLocalStorage proxy; shallow spread before structuredClone.
  return { ...structuredClone({ ...workspace }), tasks: workspace.tasks.map(publicTask) }
}

const moduleDir = dirname(fileURLToPath(import.meta.url))
const storageRoot = () => resolve(process.env.TASK_ATTACHMENT_STORAGE_DIR || resolve(process.env.DOCUMENT_STORAGE_DIR || resolve(moduleDir, '../data/documents'), 'task-reports'))
const scopeDirectory = (req: Request) => {
  const u = req.authUser!
  return resolve(storageRoot(), createHash('sha256').update(JSON.stringify([u.tenantId, u.organizationId, u.accountId])).digest('hex'))
}
const safeId = (id: string) => /^[A-Za-z0-9_-]{10,100}$/.test(id)
const filename = (raw: string) => {
  let name = raw
  // Multipart parsers default legacy filename parameters to Latin-1; recover valid UTF-8.
  if (/^[\u0000-\u00ff]*$/.test(name)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    if (!decoded.includes('\ufffd')) name = decoded
  }
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 200) || 'attachment'
}
function removeFiles(paths: string[]) { for (const path of paths) try { unlinkSync(path) } catch { /* best effort after rollback */ } }

export function createTaskCollaborationRouter(deps: { workspace: () => Workspace; persist: () => unknown }) {
  const router = Router()
  const getTask = (req: Request, res: Response): CollaborationTask | undefined => {
    const task = deps.workspace().tasks.find(t => t.id === req.params.id) as CollaborationTask | undefined
    if (!task) { res.status(404).json({ error: 'task_not_found', message: '任务不存在。' }); return }
    if (!task.collaborationMode) { res.status(409).json({ error: 'not_collaborative', message: '此任务是个人待办。' }); return }
    return task
  }
  const save = (original: CollaborationTask, updated: CollaborationTask) => {
    const workspace = deps.workspace(), index = workspace.tasks.findIndex(task => task.id === original.id)
    workspace.tasks[index] = updated
    try { deps.persist() } catch (error) { workspace.tasks[index] = original; throw error }
  }
  const owner: RequestHandler = (req, res, next) => {
    const task = getTask(req, res); if (!task) return
    if (task.assigneeId !== req.authUser!.id) { res.status(403).json({ error: 'owner_required', message: '仅负责人可操作。' }); return }
    next()
  }
  router.post('/:id/accept', owner, (req, res) => {
    const task = getTask(req, res)!
    if (task.acceptanceStatus !== 'pending') return res.status(409).json({ error: 'already_accepted', message: '任务已接收，请直接回复完成期限。' })
    if (!validTaskDate(req.body?.committedDueDate)) return res.status(400).json({ error: 'invalid_deadline', message: '请回复有效的完成期限。' })
    const now = Date.now()
    const updated = { ...task, status: 'in-progress' as const, acceptanceStatus: task.acceptBy && Date.parse(task.acceptBy) <= now ? 'auto-accepted' as const : 'accepted' as const, acceptedAt: task.acceptBy && Date.parse(task.acceptBy) <= now ? task.acceptBy : new Date(now).toISOString(), committedDueDate: req.body.committedDueDate }
    save(task, updated); return res.json(publicTask(updated))
  })
  router.post('/:id/commit-deadline', owner, (req, res) => {
    const task = getTask(req, res)!
    if (task.acceptanceStatus === 'pending' || task.status === 'done' || task.reportStatus === 'submitted') return res.status(409).json({ error: 'invalid_stage', message: '请先接手任务；已提交或完成的汇报不能变更期限。' })
    if (!validTaskDate(req.body?.committedDueDate)) return res.status(400).json({ error: 'invalid_deadline', message: '请回复有效的完成期限。' })
    const updated = { ...task, committedDueDate: req.body.committedDueDate }
    save(task, updated); return res.json(publicTask(updated))
  })
  const reportGate: RequestHandler = (req, res, next) => {
    const task = getTask(req, res)!
    if (!task) return
    const autoAccepted = task.acceptanceStatus === 'pending' && task.acceptBy && Date.parse(task.acceptBy) <= Date.now()
    if ((task.acceptanceStatus === 'pending' && !autoAccepted) || !validTaskDate(task.committedDueDate)) return res.status(409).json({ error: 'deadline_required', message: '请先接手并回复完成期限。' })
    if (task.status === 'done' || task.reportStatus === 'submitted' || task.reportStatus === 'approved') return res.status(409).json({ error: 'report_already_submitted', message: '已有待确认或已完成的汇报，不能重复提交。' })
    next()
  }
  const parseUpload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 10 * 1024 * 1024, fieldSize: 64 * 1024, fields: 4, parts: 9 } }).array('attachments', 5)
  router.post('/:id/reports', owner, reportGate, (req, res, next) => {
    parseUpload(req, res, error => {
      if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'invalid_upload', message: '最多上传 5 个附件，每个不超过 10 MB；请检查表单内容。' })
      const task = getTask(req, res)!, content = req.body?.content, progress = Number(req.body?.progress)
      if (typeof content !== 'string' || !content.trim() || content.length > 20000 || req.body?.progress === undefined || req.body.progress === '' || !Number.isFinite(progress) || progress < 0 || progress > 100) return res.status(400).json({ error: 'invalid_report', message: '请填写完成情况及 0–100 的有效进度。' })
      const paths: string[] = []
      try {
        const attachments: Attachment[] = []
        const files = (req.files ?? []) as Express.Multer.File[]
        if (files.length) mkdirSync(scopeDirectory(req), { recursive: true, mode: 0o700 })
        for (const file of files) {
          const id = nanoid(), path = resolve(scopeDirectory(req), id)
          paths.push(path); writeFileSync(path, file.buffer, { flag: 'wx', mode: 0o600 })
          attachments.push({ id, name: filename(file.originalname), size: file.size })
        }
        const report: TaskReport = { id: nanoid(), content: content.trim(), progress, createdAt: new Date().toISOString(), authorId: req.authUser!.id, attachments }
        const updated: CollaborationTask = { ...task, status: 'in-progress', progress, reportStatus: 'submitted', reports: [...(task.reports ?? []), report], reviewComment: undefined }
        save(task, updated); return res.status(201).json(publicTask(updated))
      } catch (error) { removeFiles(paths); next(error) }
    })
  })
  router.get('/:id/reports/:reportId/attachments/:attachmentId', (req, res) => {
    const task = getTask(req, res); if (!task) return
    if (![task.creatorId, task.assigneeId, task.receiverId].includes(req.authUser!.id)) return res.status(403).json({ error: 'participant_required', message: '仅任务参与者可下载附件。' })
    const attachment = task.reports?.find(r => r.id === req.params.reportId)?.attachments.find(a => a.id === req.params.attachmentId)
    if (!attachment || !safeId(attachment.id)) return res.status(404).json({ error: 'attachment_not_found', message: '附件不存在。' })
    const path = resolve(scopeDirectory(req), attachment.id)
    if (!existsSync(path)) return res.status(404).json({ error: 'attachment_not_found', message: '附件不存在。' })
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store')
    return res.download(path, filename(attachment.name))
  })
  router.post('/:id/review', (req, res) => {
    const task = getTask(req, res); if (!task) return
    if (task.receiverId !== req.authUser!.id) return res.status(403).json({ error: 'receiver_required', message: '仅接收人可确认或退回汇报。' })
    const decision = req.body?.decision, comment = req.body?.comment ?? ''
    if (!['approve', 'return'].includes(decision) || typeof comment !== 'string' || comment.length > 2000) return res.status(400).json({ error: 'invalid_review', message: '请提供有效确认结果，意见不超过 2000 字。' })
    if (task.reportStatus !== 'submitted' || !task.reports?.length) return res.status(409).json({ error: 'no_pending_report', message: '当前没有待确认的汇报。' })
    const updated = structuredClone(task)
    updated.reports![updated.reports!.length - 1].review = { decision, comment, by: req.authUser!.id, at: new Date().toISOString() }
    updated.reportStatus = decision === 'approve' ? 'approved' : 'returned'; updated.reviewComment = comment
    updated.status = decision === 'approve' ? 'done' : 'in-progress'
    const workspace = deps.workspace(), priorTasks = workspace.tasks.slice()
    const index = workspace.tasks.findIndex(t => t.id === task.id); workspace.tasks[index] = updated
    try { if (decision === 'approve') ensureNextTask(workspace, updated, Date.now(), true); deps.persist() }
    catch (error) { workspace.tasks = priorTasks; throw error }
    return res.json(publicTask(updated))
  })
  return router
}
