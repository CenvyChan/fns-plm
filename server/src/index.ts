import 'dotenv/config'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import multer from 'multer'
import * as archiver from 'archiver'
import { createAuthRouter, requireRole, sameOriginGuard, sessionGate } from './auth.js'
import { databaseHealth, db, StateConflictError } from './database.js'
import { createIntegrationRouter, stopIntegrationServices } from './integration-api.js'
import { createDailyReportRouter } from './daily-reporting.js'
import { createDailyReportingAdminRouter } from './daily-reporting-admin.js'
import { createDailyReportingIsolationRepairRouter } from './daily-reporting-isolation-repair.js'
import { closeCache } from './integrations/cache.js'
import { createReportDefinitionsRouter } from './report-definitions.js'
import { createFormsRouter } from './forms.js'
import { currentWorkspaceScope, runWithWorkspaceScope, type WorkspaceScope } from './scope.js'
import { loadScopedWorkspace, persistScopedWorkspace, type BomKind, type Entity, type Project, type Task, type Workspace } from './workspace-store.js'
import { builtInProjectTemplates } from './project-templates.js'
import { parseProjectPlanFile, projectTaskCsv, projectWorkbook } from './project-planning.js'

type CollectionKey = 'kpiRules' | 'reviews' | 'materials' | 'boms' | 'documents' | 'salesBomSnapshots' | 'projectPhases' | 'projectMilestones' | 'projectEvents' | 'projectReports' | 'projectTemplates'

const here = dirname(fileURLToPath(import.meta.url))
type WorkspaceContext = ReturnType<typeof loadScopedWorkspace>
const workspaceStorage = new AsyncLocalStorage<WorkspaceContext>()
function activeWorkspace(): WorkspaceContext {
  const current = workspaceStorage.getStore()
  if (!current) throw new Error('No verified tenant workspace is active for this request.')
  return current
}
const data = new Proxy({} as Workspace, {
  get: (_target, property) => (activeWorkspace().value as unknown as Record<PropertyKey, unknown>)[property],
  set: (_target, property, value) => { (activeWorkspace().value as unknown as Record<PropertyKey, unknown>)[property] = value; return true },
  ownKeys: () => Reflect.ownKeys(activeWorkspace().value),
  getOwnPropertyDescriptor: (_target, property) => property in activeWorkspace().value ? { configurable: true, enumerable: true, writable: true, value: (activeWorkspace().value as unknown as Record<PropertyKey, unknown>)[property] } : undefined,
})
const persist = () => persistScopedWorkspace(activeWorkspace())

function currentAccountHasUser(userId: string): boolean {
  const scope = currentWorkspaceScope()
  if (!scope || !userId) return false
  return Boolean(db.prepare(`SELECT 1 FROM tenant_memberships m
    JOIN users u ON u.id=m.user_id JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id
    JOIN organizations o ON o.id=a.organization_id AND o.tenant_id=a.tenant_id JOIN tenants t ON t.id=a.tenant_id
    WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?
      AND m.disabled=0 AND u.disabled=0 AND a.status='active' AND o.status='active' AND t.status='active'`)
    .get(userId, scope.tenantId, scope.organizationId, scope.accountId))
}

function validateTaskReferences(candidate: Record<string, unknown>, validateAssignee = true): string | undefined {
  const projectId = typeof candidate.projectId === 'string' && candidate.projectId ? candidate.projectId : undefined
  if (candidate.projectId !== undefined && candidate.projectId !== null && candidate.projectId !== '' && typeof candidate.projectId !== 'string') return 'projectId must be a string'
  if (projectId && !data.projects.some(project => project.id === projectId)) return 'projectId must belong to the current account'
  for (const key of ['phaseId', 'milestoneId'] as const) {
    const id = candidate[key]
    if (id !== undefined && id !== null && id !== '' && typeof id !== 'string') return `${key} must be a string`
    if (typeof id === 'string' && id) {
      const records = key === 'phaseId' ? data.projectPhases : data.projectMilestones
      if (!projectId || !records.some(record => record.id === id && record.projectId === projectId)) return `${key} must belong to the selected project`
    }
  }
  if (validateAssignee && candidate.assigneeId !== undefined && candidate.assigneeId !== null && candidate.assigneeId !== '') {
    if (typeof candidate.assigneeId !== 'string' || !currentAccountHasUser(candidate.assigneeId)) return 'assigneeId must identify an active user in the current account'
  }
  if (candidate.dependencyIds === undefined || candidate.dependencyIds === null) return undefined
  if (!Array.isArray(candidate.dependencyIds) || candidate.dependencyIds.length > 50 || candidate.dependencyIds.some(id => typeof id !== 'string' || !id)) return 'dependencyIds must contain at most 50 task IDs'
  const dependencies = candidate.dependencyIds as string[]
  if (new Set(dependencies).size !== dependencies.length) return 'dependencyIds cannot contain duplicates'
  const taskId = String(candidate.id ?? '')
  const existing = new Map<string, Record<string, unknown>>(data.tasks.map(task => [task.id, task as Record<string, unknown>]))
  if (taskId) existing.set(taskId, candidate)
  for (const dependencyId of dependencies) {
    if (dependencyId === taskId) return 'a task cannot depend on itself'
    const dependency = existing.get(dependencyId)
    if (!dependency) return 'dependencyIds must reference existing tasks'
    const dependencyProjectId = typeof dependency.projectId === 'string' && dependency.projectId ? dependency.projectId : undefined
    if (dependencyProjectId !== projectId) return 'task dependencies must belong to the same project'
  }
  const reachesTask = (id: string, visited: Set<string>): boolean => {
    if (id === taskId) return true
    if (visited.has(id)) return false
    visited.add(id)
    const task = existing.get(id)
    const next = Array.isArray(task?.dependencyIds) ? task.dependencyIds : []
    return next.some(reference => typeof reference === 'string' && reachesTask(reference, visited))
  }
  if (taskId && dependencies.some(id => reachesTask(id, new Set()))) return 'task dependencies cannot contain a cycle'
  return undefined
}

const app = express()
app.disable('x-powered-by')
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)
const nativeOrigins = ['capacitor://localhost', 'http://localhost', 'https://localhost']
const allowedOrigins = [...new Set([...(process.env.CORS_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean), ...nativeOrigins])]
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) callback(null, true); else callback(null, false) }, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Organization-ID', 'X-Account-ID'] }))
app.use(express.json({ limit: '2mb' }))
app.use('/api/auth', createAuthRouter())
app.use('/api', sameOriginGuard, sessionGate)
app.use('/api', (req: Request, res: Response, next) => {
  const user = req.authUser
  if (!user) return next()
  const scope: WorkspaceScope = { tenantId: user.tenantId, tenantName: user.tenantName, organizationId: user.organizationId, organizationName: user.organizationName, accountId: user.accountId, accountName: user.accountName, role: user.role, isPlatformAdmin: user.isPlatformAdmin }
  try {
    const workspace = loadScopedWorkspace(scope)
    return runWithWorkspaceScope(scope, () => workspaceStorage.run(workspace, next))
  } catch (error) {
    if (error instanceof StateConflictError) return res.status(409).json({ error: 'workspace_conflict', message: '工作区刚被其他操作更新，请刷新后重试。' })
    console.error('Failed to load tenant workspace.', error)
    return res.status(500).json({ error: 'workspace_load_failed', message: '无法加载当前组织/账套工作区。' })
  }
})
app.get('/api/health', (_req: Request, res: Response) => {
  try { return res.json({ ok: true, service: 'momentum-api', dataStore: 'sqlite', database: databaseHealth() }) }
  catch { return res.status(503).json({ ok: false, service: 'momentum-api', dataStore: 'sqlite', database: { ok: false } }) }
})
app.get('/api/workspace', (_req: Request, res: Response) => res.json(data))

app.get('/api/tasks', (_req: Request, res: Response) => res.json(data.tasks))
app.post('/api/tasks', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const { title, dueDate, priority = 'medium', status = 'todo', projectId, description } = body
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' })
  if (body.projectId !== undefined && body.projectId !== null && body.projectId !== '' && typeof body.projectId !== 'string') return res.status(400).json({ error: 'projectId must be a string' })
  for (const key of ['phaseId', 'milestoneId', 'assigneeId'] as const) if (body[key] !== undefined && body[key] !== null && body[key] !== '' && typeof body[key] !== 'string') return res.status(400).json({ error: `${key} must be a string` })
  if (body.dependencyIds !== undefined && !Array.isArray(body.dependencyIds)) return res.status(400).json({ error: 'dependencyIds must be an array' })
  for (const key of ['estimateHours', 'actualHours'] as const) if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0)) return res.status(400).json({ error: `${key} must be a non-negative finite number` })
  if (typeof projectId === 'string' && projectId && !data.projects.some(project => project.id === projectId)) return res.status(400).json({ error: 'projectId must belong to the current account' })
  if (typeof body.phaseId === 'string' && body.phaseId && !data.projectPhases.some(phase => phase.id === body.phaseId && phase.projectId === projectId)) return res.status(400).json({ error: 'phaseId must belong to the selected project' })
  if (typeof body.milestoneId === 'string' && body.milestoneId && !data.projectMilestones.some(item => item.id === body.milestoneId && item.projectId === projectId)) return res.status(400).json({ error: 'milestoneId must belong to the selected project' })
  const task: Task = { id: typeof body.id === 'string' ? body.id : nanoid(), title: title.trim(), dueDate: typeof dueDate === 'string' ? dueDate : new Date().toISOString().slice(0, 10), priority: ['low', 'medium', 'high'].includes(String(priority)) ? priority as Task['priority'] : 'medium', status: ['todo', 'in-progress', 'done'].includes(String(status)) ? status as Task['status'] : 'todo', ...(typeof projectId === 'string' && projectId ? { projectId } : {}), ...(typeof description === 'string' ? { description: description.slice(0,2000) } : {}), createdAt: new Date().toISOString(), ...Object.fromEntries(['startDate','assignee','assigneeId','department','phaseId','milestoneId','wbsCode','acceptanceCriteria'].filter(key => typeof body[key] === 'string').map(key => [key, String(body[key]).slice(0,2000)])), ...(['progress','estimateHours','actualHours'].filter(key => Number.isFinite(Number(body[key]))).length ? Object.fromEntries(['progress','estimateHours','actualHours'].filter(key => Number.isFinite(Number(body[key]))).map(key => [key, Number(body[key])])) : {}), ...(Array.isArray(body.dependencyIds) ? { dependencyIds: body.dependencyIds.filter((value: unknown) => typeof value === 'string').slice(0,50) } : {}) }
  if (typeof task.progress === 'number' && (task.progress < 0 || task.progress > 100)) return res.status(400).json({ error: 'progress must be between 0 and 100' })
  if (data.tasks.some(item => item.id === task.id)) return res.status(409).json({ error: 'task id already exists' })
  const referenceError = validateTaskReferences({ ...task, dependencyIds: body.dependencyIds })
  if (referenceError) return res.status(400).json({ error: referenceError })
  data.tasks.unshift(task); persist(); return res.status(201).json(task)
})
app.patch('/api/tasks/:id', (req: Request, res: Response) => {
  const index = data.tasks.findIndex(task => task.id === req.params.id)
  if (index === -1) return res.status(404).json({ error: 'task not found' })
  const allowed = ['title', 'description', 'dueDate', 'priority', 'status', 'projectId', 'startDate', 'assignee', 'assigneeId', 'department', 'phaseId', 'milestoneId', 'wbsCode', 'progress', 'estimateHours', 'actualHours', 'dependencyIds', 'acceptanceCriteria'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in (req.body ?? {})) patch[key] = req.body[key]
  if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) return res.status(400).json({ error: 'title cannot be empty' })
  if (patch.priority !== undefined && !['low', 'medium', 'high'].includes(String(patch.priority))) return res.status(400).json({ error: 'invalid priority' })
  if (patch.status !== undefined && !['todo', 'in-progress', 'done'].includes(String(patch.status))) return res.status(400).json({ error: 'invalid status' })
  if (patch.progress !== undefined && (!Number.isFinite(Number(patch.progress)) || Number(patch.progress) < 0 || Number(patch.progress) > 100)) return res.status(400).json({ error: 'progress must be between 0 and 100' })
  for (const key of ['estimateHours', 'actualHours'] as const) if (patch[key] !== undefined) { if (!Number.isFinite(Number(patch[key])) || Number(patch[key]) < 0) return res.status(400).json({ error: `${key} must be a non-negative finite number` }); patch[key] = Number(patch[key]) }
  if (patch.projectId !== undefined && patch.projectId !== '' && typeof patch.projectId !== 'string') return res.status(400).json({ error: 'projectId must be a string' })
  for (const key of ['phaseId', 'milestoneId', 'assigneeId'] as const) if (patch[key] !== undefined && patch[key] !== '' && typeof patch[key] !== 'string') return res.status(400).json({ error: `${key} must be a string` })
  if (patch.dependencyIds !== undefined && (!Array.isArray(patch.dependencyIds) || patch.dependencyIds.length > 50 || patch.dependencyIds.some(value => typeof value !== 'string' || !value))) return res.status(400).json({ error: 'dependencyIds must contain at most 50 task IDs' })
  if (patch.projectId === '') patch.projectId = undefined
  if (patch.phaseId === '') patch.phaseId = undefined
  if (patch.milestoneId === '') patch.milestoneId = undefined
  if (typeof patch.projectId === 'string' && patch.projectId && !data.projects.some(project => project.id === patch.projectId)) return res.status(400).json({ error: 'projectId must belong to the current account' })
  const finalProjectId = typeof patch.projectId === 'string' ? patch.projectId : data.tasks[index]!.projectId
  if (typeof patch.phaseId === 'string' && patch.phaseId && !data.projectPhases.some(phase => phase.id === patch.phaseId && phase.projectId === finalProjectId)) return res.status(400).json({ error: 'phaseId must belong to the selected project' })
  if (typeof patch.milestoneId === 'string' && patch.milestoneId && !data.projectMilestones.some(item => item.id === patch.milestoneId && item.projectId === finalProjectId)) return res.status(400).json({ error: 'milestoneId must belong to the selected project' })
  const candidate = { ...data.tasks[index]!, ...patch } as Task
  const referenceError = validateTaskReferences(candidate as Record<string, unknown>, patch.assigneeId !== undefined)
  if (referenceError) return res.status(400).json({ error: referenceError })
  data.tasks[index] = candidate; persist(); return res.json(data.tasks[index])
})
app.delete('/api/tasks/:id', (req: Request, res: Response) => {
  if (data.tasks.some(task => task.id !== req.params.id && Array.isArray(task.dependencyIds) && task.dependencyIds.includes(req.params.id))) return res.status(409).json({ error: 'task_has_dependents', message: '该任务仍是其他任务的前置依赖，请先移除依赖关系后再删除。' })
  const before = data.tasks.length; data.tasks = data.tasks.filter(task => task.id !== req.params.id)
  if (before === data.tasks.length) return res.status(404).json({ error: 'task not found' })
  persist(); return res.status(204).end()
})
app.get('/api/projects', (_req: Request, res: Response) => res.json(data.projects))
app.post('/api/projects', (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ error: 'name is required' })
  const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId.trim() : req.authUser!.id
  if (!currentAccountHasUser(ownerId)) return res.status(400).json({ error: 'ownerId must identify an active user in the current account' })
  const now = new Date().toISOString(), today = now.slice(0,10), dueDate = typeof body.dueDate === 'string' && body.dueDate ? body.dueDate : today
  const projectId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : nanoid()
  if (data.projects.some(project => project.id === projectId)) return res.status(409).json({ error: 'id already exists' })
  const status = ['draft','active','on-hold','completed','cancelled'].includes(String(body.status)) ? String(body.status) : 'active'
  const priority = ['low','medium','high'].includes(String(body.priority)) ? String(body.priority) : 'medium'
  const progress = Number.isFinite(Number(body.progress)) ? Math.max(0,Math.min(100,Number(body.progress))) : 0
  const project: Project = {
    id: projectId, code: typeof body.code === 'string' && body.code.trim() ? body.code.trim().slice(0,40) : `PRJ-${today.slice(0,4)}-${nanoid(5).toUpperCase()}`,
    name: body.name.trim().slice(0,120), description: typeof body.description === 'string' ? body.description.trim().slice(0,2000) : '', color: typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#8d7cf6',
    type: typeof body.type === 'string' ? body.type.slice(0,80) : '通用项目', department: typeof body.department === 'string' ? body.department.slice(0,120) : '', owner: typeof body.owner === 'string' ? body.owner.slice(0,120) : req.authUser!.displayName, ownerId,
    sponsor: typeof body.sponsor === 'string' ? body.sponsor.slice(0,120) : '', startDate: typeof body.startDate === 'string' ? body.startDate : today, dueDate, status, priority, progress, stage: typeof body.stage === 'string' ? body.stage.slice(0,100) : '', scope: typeof body.scope === 'string' ? body.scope.slice(0,4000) : '', goal: typeof body.goal === 'string' ? body.goal.slice(0,4000) : '', successCriteria: typeof body.successCriteria === 'string' ? body.successCriteria.slice(0,4000) : '', createdAt: now, updatedAt: now,
  }
  data.projects.push(project); persist(); return res.status(201).json(project)
})
app.post('/api/projects/from-template', requireRole('admin','plm_manager'), (req: Request, res: Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}, templateId = String(body.templateId ?? '')
  const custom = data.projectTemplates.find(item => item.id === templateId)
  const template = builtInProjectTemplates.find(item => item.id === templateId) ?? custom
  if (!template || !Array.isArray(template.phases) || template.phases.length < 1 || template.phases.length > 12) return res.status(400).json({ error: '项目模板不存在或阶段数量无效。' })
  if (typeof body.name !== 'string' || !body.name.trim()) return res.status(400).json({ error: '项目名称必填。' })
  const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim() ? body.ownerId.trim() : req.authUser!.id
  if (!currentAccountHasUser(ownerId)) return res.status(400).json({ error: 'ownerId must identify an active user in the current account' })
  const now = new Date().toISOString(), startDate = typeof body.startDate === 'string' ? body.startDate : now.slice(0,10)
  const shiftDate = (base: string, days: number) => { const date = new Date(`${base}T12:00:00`); date.setDate(date.getDate()+Math.max(0,days)); return date.toISOString().slice(0,10) }
  const phases = template.phases as Array<Record<string, unknown>>, duration = phases.reduce((sum, phase) => sum + Math.max(1, Number(phase.durationDays ?? 1)), 0)
  const dueDate = typeof body.dueDate === 'string' ? body.dueDate : shiftDate(startDate, duration-1)
  const user = req.authUser!, project: Project = { id: nanoid(), code: `PRJ-${startDate.slice(0,4)}-${nanoid(5).toUpperCase()}`, name: body.name.trim().slice(0,120), description: typeof body.description === 'string' ? body.description.slice(0,2000) : String(template.description ?? ''), color: typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#8d7cf6', type: String(body.type ?? template.type ?? '通用项目').slice(0,80), department: typeof body.department === 'string' ? body.department.slice(0,120) : '', owner: typeof body.owner === 'string' ? body.owner.slice(0,120) : user.displayName, ownerId, sponsor: typeof body.sponsor === 'string' ? body.sponsor.slice(0,120) : '', startDate, dueDate, status: 'active', priority: ['low','medium','high'].includes(String(body.priority)) ? String(body.priority) : 'medium', progress: 0, stage: String(phases[0]?.name ?? ''), scope: typeof body.scope === 'string' ? body.scope.slice(0,4000) : '', goal: typeof body.goal === 'string' ? body.goal.slice(0,4000) : '', successCriteria: typeof body.successCriteria === 'string' ? body.successCriteria.slice(0,4000) : '', createdAt: now, updatedAt: now }
  const createdPhases: Entity[] = [], milestones: Entity[] = [], tasks: Task[] = []
  let offset = 0
  phases.forEach((phase, phaseIndex) => {
    const durationDays = Math.max(1,Math.min(365,Number(phase.durationDays ?? 1))), phaseId = nanoid(), phaseStart = shiftDate(startDate,offset), phaseDue = shiftDate(startDate,offset+durationDays-1)
    const phaseRecord: Entity = { id: phaseId, projectId: project.id, code: `${phaseIndex+1}`, name: String(phase.name ?? `阶段 ${phaseIndex+1}`).slice(0,120), order: phaseIndex+1, startDate: phaseStart, dueDate: phaseDue, owner: project.owner, status: 'not-started', progress: 0, deliverables: String(phase.deliverables ?? '').slice(0,2000), acceptanceCriteria: String(phase.acceptanceCriteria ?? '').slice(0,2000), updatedAt: now }
    createdPhases.push(phaseRecord)
    const phaseMilestones = Array.isArray(phase.milestones) ? phase.milestones as Array<Record<string, unknown>> : []
    phaseMilestones.slice(0,20).forEach((milestone, milestoneIndex) => milestones.push({ id:nanoid(), projectId:project.id, phaseId, code:`M${phaseIndex+1}.${milestoneIndex+1}`, title:String(milestone.title ?? '阶段里程碑').slice(0,160), dueDate:shiftDate(startDate,offset+Math.min(durationDays-1,Number(milestone.offsetDays ?? 0))), owner:project.owner, status:'planned', acceptanceCriteria:String(milestone.acceptanceCriteria ?? '').slice(0,2000), updatedAt:now }))
    const phaseTasks = Array.isArray(phase.tasks) ? phase.tasks as Array<Record<string, unknown>> : []
    phaseTasks.slice(0,50).forEach((task, taskIndex) => tasks.push({ id:nanoid(), title:String(task.title ?? '项目任务').slice(0,160), description:String(task.acceptanceCriteria ?? '').slice(0,2000), startDate:phaseStart, dueDate:shiftDate(startDate,offset+Math.min(durationDays-1,Number(task.offsetDays ?? 0))), priority:['low','medium','high'].includes(String(task.priority)) ? String(task.priority) as Task['priority'] : 'medium', status:'todo', projectId:project.id, phaseId, wbsCode:`${phaseIndex+1}.${taskIndex+1}`, progress:0, estimateHours:Number(task.estimateHours ?? 0), acceptanceCriteria:String(task.acceptanceCriteria ?? '').slice(0,2000), createdAt:now }))
    offset += durationDays
  })
  data.projects.push(project); data.projectPhases = [...createdPhases,...data.projectPhases]; data.projectMilestones = [...milestones,...data.projectMilestones]; data.tasks = [...tasks,...data.tasks]; persist()
  return res.status(201).json({ project, phases: createdPhases, milestones, tasks, template: { id: template.id, name: template.name }, counts: { phases: createdPhases.length, milestones: milestones.length, tasks: tasks.length } })
})
app.get('/api/project-template-library', (_req: Request, res: Response) => res.json([...builtInProjectTemplates, ...data.projectTemplates]))
app.patch('/api/projects/:id', (req: Request, res: Response) => {
  const index = data.projects.findIndex(project => project.id === req.params.id)
  if (index === -1) return res.status(404).json({ error: 'project not found' })
  const allowed = ['name','description','color','dueDate','code','type','department','owner','ownerId','sponsor','startDate','actualStartDate','actualEndDate','status','priority','progress','stage','scope','goal','successCriteria'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in (req.body ?? {})) patch[key] = req.body[key]
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) return res.status(400).json({ error: 'name cannot be empty' })
  if (patch.ownerId !== undefined && (typeof patch.ownerId !== 'string' || !currentAccountHasUser(patch.ownerId))) return res.status(400).json({ error: 'ownerId must identify an active user in the current account' })
  if (patch.color !== undefined && (typeof patch.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(patch.color))) return res.status(400).json({ error: 'invalid color' })
  if (patch.status !== undefined && !['draft','active','on-hold','completed','cancelled'].includes(String(patch.status))) return res.status(400).json({ error: 'invalid project status' })
  if (patch.priority !== undefined && !['low','medium','high'].includes(String(patch.priority))) return res.status(400).json({ error: 'invalid project priority' })
  if (patch.progress !== undefined && (!Number.isFinite(Number(patch.progress)) || Number(patch.progress) < 0 || Number(patch.progress) > 100)) return res.status(400).json({ error: 'project progress must be between 0 and 100' })
  patch.updatedAt = new Date().toISOString()
  data.projects[index] = { ...data.projects[index]!, ...patch } as Project; persist(); return res.json(data.projects[index])
})
app.delete('/api/projects/:id', requireRole('admin','plm_manager'), (req: Request, res: Response) => {
  const id = req.params.id
  if (!data.projects.some(project => project.id === id)) return res.status(404).json({ error: 'project not found' })
  const scope = currentWorkspaceScope()!
  const attachments = db.prepare(`SELECT stored_name AS storedName FROM project_files WHERE tenant_id=? AND organization_id=? AND account_id=? AND project_id=?`)
    .all(scope.tenantId, scope.organizationId, scope.accountId, id) as Array<{ storedName: string }>
  const eventIds = data.projectEvents.filter(event => event.projectId === id).map(event => event.id)
  const before = { projects: data.projects, tasks: data.tasks, phases: data.projectPhases, milestones: data.projectMilestones, events: data.projectEvents, reviews: data.projectEventReviews, reports: data.projectReports }
  try {
    db.transaction(() => {
      data.projects = data.projects.filter(project => project.id !== id)
      data.tasks = data.tasks.filter(task => task.projectId !== id)
      data.projectPhases = data.projectPhases.filter(phase => phase.projectId !== id)
      data.projectMilestones = data.projectMilestones.filter(item => item.projectId !== id)
      data.projectEvents = data.projectEvents.filter(event => event.projectId !== id)
      data.projectEventReviews = data.projectEventReviews.filter(review => review.projectId !== id && !eventIds.includes(String(review.eventId)))
      data.projectReports = data.projectReports.filter(report => report.projectId !== id)
      db.prepare(`DELETE FROM project_files WHERE tenant_id=? AND organization_id=? AND account_id=? AND project_id=?`).run(scope.tenantId, scope.organizationId, scope.accountId, id)
      persist()
    })()
  } catch (error) {
    data.projects = before.projects; data.tasks = before.tasks; data.projectPhases = before.phases; data.projectMilestones = before.milestones
    data.projectEvents = before.events; data.projectEventReviews = before.reviews; data.projectReports = before.reports
    throw error
  }
  for (const file of attachments) {
    try { const target = resolve(documentStorageDir, file.storedName); if (existsSync(target)) unlinkSync(target) }
    catch (error) { console.error('Project attachment cleanup failed after scoped metadata deletion.', error) }
  }
  return res.status(204).end()
})

const writable: Record<CollectionKey, string[]> = {
  kpiRules: ['code', 'name', 'category', 'formula', 'unit', 'target', 'direction', 'weight', 'cycle', 'owner', 'status', 'updatedAt', 'revision', 'effectiveFrom', 'updatedBy'],
  reviews: ['employee', 'department', 'period', 'reviewer', 'status', 'score', 'note', 'scoreLines', 'updatedAt'],
  materials: ['partNo', 'name', 'category', 'specification', 'unit', 'revision', 'lifecycle', 'owner', 'createdAt', 'updatedAt', 'family', 'groupNodeId', 'proposedGroupNumber', 'erpGroupId', 'erpGroupNumber', 'erpSyncState', 'classificationPath', 'dimensions', 'specificationFields', 'codePreview', 'codeState', 'templateSourceId'],
  boms: ['bomNo', 'parentMaterialId', 'kind', 'revision', 'lifecycle', 'effectiveDate', 'lines', 'updatedAt', 'scope', 'sourceBomId', 'sourceRevision', 'configAttributes', 'configGroups', 'salesRules'],
  documents: ['docNo', 'title', 'type', 'materialId', 'revision', 'lifecycle', 'owner', 'updatedAt', 'fileName', 'fileUrl'],
  salesBomSnapshots: ['orderNo', 'parentMaterialId', 'bomId', 'bomNo', 'bomRevision', 'quantity', 'attributes', 'lines', 'createdAt'],
  projectPhases: ['projectId', 'code', 'name', 'order', 'startDate', 'dueDate', 'actualStartDate', 'actualEndDate', 'owner', 'status', 'progress', 'deliverables', 'acceptanceCriteria', 'updatedAt'],
  projectMilestones: ['projectId', 'phaseId', 'code', 'title', 'dueDate', 'actualDate', 'owner', 'status', 'acceptanceCriteria', 'updatedAt'],
  projectEvents: ['projectId', 'phaseId', 'milestoneId', 'taskId', 'code', 'type', 'title', 'description', 'owner', 'ownerId', 'department', 'startDate', 'dueDate', 'actualDate', 'status', 'projectWeight', 'createdBy', 'createdById', 'createdAt', 'updatedAt'],
  projectReports: ['projectId', 'period', 'progress', 'achievements', 'blockers', 'risks', 'decisionsNeeded', 'nextSteps', 'author', 'authorId', 'createdAt', 'updatedAt'],
  projectTemplates: ['code', 'name', 'type', 'description', 'phases', 'builtIn'],
}
const required: Record<CollectionKey, string[]> = {
  kpiRules: ['code', 'name', 'formula', 'target', 'weight', 'direction', 'status'],
  reviews: ['employee', 'department', 'period', 'reviewer', 'status'],
  materials: ['partNo', 'name', 'unit', 'lifecycle'],
  boms: ['bomNo', 'parentMaterialId', 'kind', 'revision', 'lifecycle'],
  documents: ['docNo', 'title', 'type', 'revision', 'lifecycle'],
  salesBomSnapshots: ['orderNo', 'parentMaterialId', 'bomId', 'bomNo', 'bomRevision', 'quantity', 'attributes', 'lines'],
  projectPhases: ['projectId', 'code', 'name', 'order', 'startDate', 'dueDate', 'owner', 'status', 'progress'],
  projectMilestones: ['projectId', 'code', 'title', 'dueDate', 'owner', 'status', 'acceptanceCriteria'],
  projectEvents: ['projectId', 'code', 'type', 'title', 'description', 'owner', 'department', 'startDate', 'dueDate', 'status', 'projectWeight'],
  projectReports: ['projectId', 'period', 'progress', 'achievements', 'blockers', 'risks', 'decisionsNeeded', 'nextSteps'],
  projectTemplates: ['code', 'name', 'type', 'description', 'phases'],
}
function currentMaterial(id: unknown): boolean { return typeof id === 'string' && Boolean(id) && data.materials.some(material => material.id === id) }
function validateMaterialLines(lines: unknown, field: string): string | undefined {
  if (!Array.isArray(lines)) return `${field} must be an array`
  for (const [index, value] of lines.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${field}[${index}] must be an object`
    const line = value as Record<string, unknown>
    if (!currentMaterial(line.materialId)) return `${field}[${index}].materialId must identify a material in the current account`
    if (!(Number(line.quantity) > 0) || !Number.isFinite(Number(line.quantity))) return `${field}[${index}].quantity must be positive`
  }
  return undefined
}
const safeFields = (key: CollectionKey, body: unknown) => {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(source).filter(([field]) => writable[key].includes(field)))
}
const validateEntity = (key: CollectionKey, record: Record<string, unknown>, isPartial = false): string | undefined => {
  if (!isPartial) for (const field of required[key]) if (record[field] === undefined || record[field] === null || record[field] === '') return `${field} is required`
  if (key === 'materials') {
    if (record.codeState === 'synced' || record.erpSyncState === 'synced') return 'ERP sync is unavailable in this prototype; official codes cannot be marked synced'
    if (record.unit !== undefined && typeof record.unit !== 'string') return 'unit must be a string'
  }
  if (key === 'kpiRules') {
    if (record.target !== undefined && (!(Number(record.target) > 0) || !Number.isFinite(Number(record.target)))) return 'target must be a positive number'
    if (record.weight !== undefined && (!(Number(record.weight) > 0) || Number(record.weight) > 100 || !Number.isFinite(Number(record.weight)))) return 'weight must be between 0 and 100'
    if (record.direction !== undefined && !['higher', 'lower'].includes(String(record.direction))) return 'invalid KPI direction'
    if (record.status !== undefined && !['active', 'draft'].includes(String(record.status))) return 'invalid KPI status'
  }
  if (key === 'projectPhases') {
    if (record.status !== undefined && !['not-started', 'in-progress', 'completed', 'blocked'].includes(String(record.status))) return 'invalid project phase status'
    if (record.progress !== undefined && (!Number.isFinite(Number(record.progress)) || Number(record.progress) < 0 || Number(record.progress) > 100)) return 'phase progress must be between 0 and 100'
  }
  if (key === 'projectMilestones' && record.status !== undefined && !['planned', 'completed', 'missed'].includes(String(record.status))) return 'invalid project milestone status'
  if (key === 'projectEvents') {
    if (record.type !== undefined && !['meeting', 'decision', 'risk', 'issue', 'change', 'deliverable', 'other'].includes(String(record.type))) return 'invalid project event type'
    if (record.status !== undefined && !['open', 'in-progress', 'completed', 'blocked', 'cancelled'].includes(String(record.status))) return 'invalid project event status'
    if (record.projectWeight !== undefined && (!Number.isFinite(Number(record.projectWeight)) || Number(record.projectWeight) < 0 || Number(record.projectWeight) > 100)) return 'projectWeight must be between 0 and 100'
  }
  if (key === 'projectReports' && record.progress !== undefined && (!Number.isFinite(Number(record.progress)) || Number(record.progress) < 0 || Number(record.progress) > 100)) return 'report progress must be between 0 and 100'
  if (key === 'projectTemplates' && record.phases !== undefined && !Array.isArray(record.phases)) return 'template phases must be an array'
  if (key === 'boms') {
    if (record.kind !== undefined && !['design', 'manufacturing', 'sales'].includes(String(record.kind))) return 'invalid BOM kind'
    if (record.lines !== undefined && !Array.isArray(record.lines)) return 'lines must be an array'
    if (record.salesRules !== undefined && !Array.isArray(record.salesRules)) return 'salesRules must be an array'
    if (record.parentMaterialId !== undefined && !currentMaterial(record.parentMaterialId)) return 'parentMaterialId must identify a material in the current account'
    if (Array.isArray(record.lines)) {
      const error = validateMaterialLines(record.lines, 'lines'); if (error) return error
      if (record.lines.some(value => (value as Record<string, unknown>).materialId === record.parentMaterialId)) return 'a BOM cannot contain its own parent material as a component'
    }
    if (record.sourceBomId !== undefined && record.sourceBomId !== '') {
      const source = data.boms.find(item => item.id === record.sourceBomId)
      if (!source || source.id === record.id || source.parentMaterialId !== record.parentMaterialId) return 'sourceBomId must reference a compatible BOM in the current account'
      if (record.sourceRevision !== undefined && record.sourceRevision !== '' && record.sourceRevision !== source.revision) return 'sourceRevision must match the referenced BOM'
    }
    if (Array.isArray(record.salesRules)) for (const [index, value] of record.salesRules.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `salesRules[${index}] must be an object`
      const rule = value as Record<string, unknown>
      if (!currentMaterial(rule.materialId)) return `salesRules[${index}].materialId must identify a material in the current account`
      if (!(Number(rule.quantity) > 0) || !Number.isFinite(Number(rule.quantity))) return `salesRules[${index}].quantity must be positive`
    }
  }
  if (key === 'salesBomSnapshots') {
    if (record.quantity !== undefined && !(Number(record.quantity) > 0)) return 'quantity must be positive'
    if (record.lines !== undefined && !Array.isArray(record.lines)) return 'lines must be an array'
    if (!currentMaterial(record.parentMaterialId)) return 'parentMaterialId must identify a material in the current account'
    const sourceBom = data.boms.find(item => item.id === record.bomId)
    if (!sourceBom || sourceBom.kind !== 'sales') return 'bomId must identify a sales BOM in the current account'
    if (sourceBom.parentMaterialId !== record.parentMaterialId || sourceBom.bomNo !== record.bomNo || sourceBom.revision !== record.bomRevision) return 'snapshot BOM, parent material, number, and revision must match a current account record'
    if (Array.isArray(record.lines)) {
      const error = validateMaterialLines(record.lines, 'lines'); if (error) return error
      for (const [index, value] of record.lines.entries()) {
        const line = value as Record<string, unknown>
        if (line.sourceBomId !== undefined && line.sourceBomId !== sourceBom.id) return `lines[${index}].sourceBomId must match the snapshot BOM`
        if (line.sourceRevision !== undefined && line.sourceRevision !== sourceBom.revision) return `lines[${index}].sourceRevision must match the snapshot BOM revision`
      }
    }
  }
  if (key === 'documents' && record.materialId !== undefined && record.materialId !== null && record.materialId !== '' && !currentMaterial(record.materialId)) return 'materialId must identify a material in the current account'
  return undefined
}

function validateBomRelease(bom: Entity): string | undefined {
  const kind = String(bom.kind) as BomKind
  const lines = Array.isArray(bom.lines) ? bom.lines as Entity[] : []
  if (kind !== 'sales' && !lines.length) return 'A design or manufacturing BOM needs at least one line before release.'
  if (kind !== 'design') {
    const source = data.boms.find(item => item.id === bom.sourceBomId)
    if (!source) return 'A released BOM requires a source baseline.'
    if (source.lifecycle !== 'released') return 'The source BOM must be released.'
    if (source.revision !== bom.sourceRevision) return 'The source revision does not match the referenced BOM.'
    if (kind === 'manufacturing' && source.kind !== 'design') return 'A manufacturing BOM must reference a design BOM.'
    if (kind === 'sales' && source.kind !== 'design' && source.kind !== 'manufacturing') return 'A sales BOM must reference an engineering or manufacturing baseline.'
  }
  if (kind === 'sales') {
    const attributes = Array.isArray(bom.configAttributes) ? bom.configAttributes as Entity[] : []
    const groups = Array.isArray(bom.configGroups) ? bom.configGroups as Entity[] : []
    const rules = Array.isArray(bom.salesRules) ? bom.salesRules as Entity[] : []
    if (!attributes.length || !groups.length) return 'A sales BOM needs configurable order attributes and selection groups.'
    const combinations: Record<string, string>[] = [{}]
    for (const attribute of attributes) {
      const key = String(attribute.key ?? '')
      const values = Array.isArray(attribute.values) ? (attribute.values as Entity[]).map(option => String(option.value ?? '')) : []
      if (!key || !values.length) return 'Every order attribute must have a key and at least one allowed value.'
      if (attribute.required === true && !values.length) return `Required attribute ${String(attribute.label)} has no allowed values.`
      if (combinations.length * values.length > 5000) return 'Configuration space exceeds 5,000 combinations; split the sales BOM before release.'
      const next: Record<string, string>[] = []
      for (const combination of combinations) for (const value of values) next.push({ ...combination, [key]: value })
      combinations.splice(0, combinations.length, ...next)
    }
    if (!rules.length) return 'A sales BOM needs rules for its option groups before release.'
    for (const group of groups) {
      for (const combination of combinations) {
        const matches = rules.filter(rule => rule.groupKey === group.key && Array.isArray(rule.conditions) && (rule.conditions as Entity[]).every(condition => combination[String(condition.attributeKey)] === String(condition.value)))
        if (group.required === true && matches.length !== 1) return `${String(group.label)} does not have exactly one rule for every allowed order combination.`
        if (matches.length > 1) return `${String(group.label)} has overlapping rules for an allowed order combination.`
      }
    }
  }
  return undefined
}

function registerCollection(path: string, key: CollectionKey, immutable = false) {
  const list = () => data[key]
  const memberWritable = key === 'projectEvents' || key === 'projectReports'
  const writeAccess = key === 'reviews' ? requireRole('admin', 'plm_manager', 'reviewer') : memberWritable ? requireRole('admin', 'plm_manager', 'reviewer', 'member') : requireRole('admin', 'plm_manager')
  app.get(`/api/${path}`, (_req: Request, res: Response) => res.json(list()))
  app.post(`/api/${path}`, writeAccess, (req: Request, res: Response) => {
    const body = safeFields(key, req.body)
    const error = validateEntity(key, body)
    if (error) return res.status(400).json({ error })
    if (key === 'boms' && body.lifecycle === 'released') { const releaseError = validateBomRelease(body as Entity); if (releaseError) return res.status(409).json({ error: releaseError }) }
    if (key === 'kpiRules' && body.status !== 'draft') return res.status(400).json({ error: 'new KPI rules must begin as draft' })
    if (key !== 'projectTemplates' && ['projectPhases','projectMilestones','projectEvents','projectReports'].includes(key)) {
      if (!data.projects.some(project => project.id === body.projectId)) return res.status(404).json({ error: 'project not found in current account' })
    }
    if (key === 'projectMilestones' && body.phaseId && !data.projectPhases.some(phase => phase.id === body.phaseId && phase.projectId === body.projectId)) return res.status(400).json({ error: 'phaseId does not belong to this project' })
    if (key === 'projectEvents') {
      const user = req.authUser!, projectId = String(body.projectId)
      if (body.phaseId && !data.projectPhases.some(phase => phase.id === body.phaseId && phase.projectId === projectId)) return res.status(400).json({ error: 'phaseId must belong to this project' })
      if (body.milestoneId && !data.projectMilestones.some(item => item.id === body.milestoneId && item.projectId === projectId)) return res.status(400).json({ error: 'milestoneId must belong to this project' })
      if (body.taskId && !data.tasks.some(task => task.id === body.taskId && task.projectId === projectId)) return res.status(400).json({ error: 'taskId must belong to this project' })
      if (user.role === 'member') { body.owner = user.displayName; body.ownerId = user.id }
      if (body.ownerId !== undefined && body.ownerId !== '' && (typeof body.ownerId !== 'string' || !currentAccountHasUser(body.ownerId))) return res.status(400).json({ error: 'ownerId must identify an active user in the current account' })
      body.createdBy = user.displayName; body.createdById = user.id
    }
    if (key === 'projectReports') { body.author = req.authUser!.displayName; body.authorId = req.authUser!.id }
    if (immutable && list().some(entity => entity.id === req.body?.id)) return res.status(409).json({ error: 'snapshot already exists and is immutable' })
    const id = typeof req.body?.id === 'string' ? req.body.id : nanoid()
    if (list().some(entity => entity.id === id)) return res.status(409).json({ error: 'id already exists' })
    const now = new Date().toISOString()
    const entity = { ...body, id } as Entity
    if (key === 'kpiRules') { entity.status = 'draft'; entity.revision = 1; entity.updatedAt = now; entity.updatedBy = req.authUser!.displayName }
    if (key === 'projectReports') entity.createdAt = now
    if (['projectPhases','projectMilestones','projectEvents','projectReports'].includes(key)) entity.updatedAt = now
    if (key === 'materials' && (entity.codeState === 'synced' || entity.erpSyncState === 'synced')) return res.status(400).json({ error: 'ERP sync is unavailable in this prototype' })
    list().unshift(entity); persist(); return res.status(201).json(entity)
  })
  app.patch(`/api/${path}/:id`, writeAccess, (req: Request, res: Response) => {
    if (immutable) return res.status(405).json({ error: 'sales BOM snapshots are immutable' })
    const index = list().findIndex(entity => entity.id === req.params.id)
    if (index < 0) return res.status(404).json({ error: 'record not found' })
    const patch = safeFields(key, req.body)
    if (patch.id !== undefined) delete patch.id
    if (key === 'projectEvents' && req.authUser?.role === 'member') {
      const current = list()[index]!
      if (current.ownerId !== req.authUser.id && current.createdById !== req.authUser.id) return res.status(403).json({ error: '仅可更新自己负责的项目事件。' })
      delete patch.ownerId; delete patch.createdById; delete patch.createdBy
    }
    const candidate = { ...list()[index], ...patch }
    if (['projectPhases', 'projectMilestones', 'projectEvents', 'projectReports'].includes(key)) {
      const currentProjectId = list()[index]!.projectId
      if (patch.projectId !== undefined && patch.projectId !== currentProjectId) return res.status(400).json({ error: 'projectId cannot be changed after the record is created' })
      if (!data.projects.some(project => project.id === candidate.projectId)) return res.status(404).json({ error: 'project not found in current account' })
    }
    if (key === 'projectMilestones' && candidate.phaseId && !data.projectPhases.some(phase => phase.id === candidate.phaseId && phase.projectId === candidate.projectId)) return res.status(400).json({ error: 'phaseId does not belong to this project' })
    if (key === 'projectEvents') {
      const projectId = String(candidate.projectId)
      if (candidate.phaseId && !data.projectPhases.some(phase => phase.id === candidate.phaseId && phase.projectId === projectId)) return res.status(400).json({ error: 'phaseId must belong to this project' })
      if (candidate.milestoneId && !data.projectMilestones.some(item => item.id === candidate.milestoneId && item.projectId === projectId)) return res.status(400).json({ error: 'milestoneId must belong to this project' })
      if (candidate.taskId && !data.tasks.some(task => task.id === candidate.taskId && task.projectId === projectId)) return res.status(400).json({ error: 'taskId must belong to this project' })
      if (candidate.ownerId !== undefined && candidate.ownerId !== '' && (typeof candidate.ownerId !== 'string' || !currentAccountHasUser(candidate.ownerId))) return res.status(400).json({ error: 'ownerId must identify an active user in the current account' })
      const review = data.projectEventReviews.find(item => item.eventId === candidate.id)
      if (review && candidate.status !== 'completed') return res.status(409).json({ error: 'event_with_review_cannot_be_reopened', message: '已进入绩效评审的事件不能重新打开；如需纠正，请保留评审记录并另行登记事件。' })
    }
    const error = validateEntity(key, candidate, true)
    if (error) return res.status(400).json({ error })
    if (key === 'kpiRules') {
      if (patch.status !== undefined && patch.status !== list()[index]!.status) return res.status(409).json({ error: 'use_atomic_kpi_rule_set', message: '状态变更请勾选目标生效规则后，通过“应用生效集”一次性提交；有效权重必须始终合计 100%。' })
      if (candidate.status === 'active') {
        const otherActiveWeight = list().filter(entity => entity.id !== req.params.id && entity.status === 'active').reduce((sum, entity) => sum + Number(entity.weight ?? 0), 0)
        if (Math.abs(otherActiveWeight + Number(candidate.weight ?? 0) - 100) > 0.001) return res.status(409).json({ error: 'active_kpi_weight_total', message: `启用后的有效 KPI 权重必须合计 100%；当前将为 ${otherActiveWeight + Number(candidate.weight ?? 0)}%。` })
      }
      candidate.revision = Number(list()[index]!.revision ?? 1) + 1
      candidate.updatedAt = new Date().toISOString(); candidate.updatedBy = req.authUser!.displayName
    }
    if (['projectPhases','projectMilestones','projectEvents','projectReports'].includes(key)) candidate.updatedAt = new Date().toISOString()
    if (key === 'materials' && (candidate.codeState === 'synced' || candidate.erpSyncState === 'synced')) return res.status(400).json({ error: 'ERP sync is unavailable in this prototype' })
    if (key === 'boms' && patch.lifecycle === 'released') { const releaseError = validateBomRelease(candidate); if (releaseError) return res.status(409).json({ error: releaseError }) }
    list()[index] = candidate; persist(); return res.json(candidate)
  })
}

registerCollection('kpi-rules', 'kpiRules')
registerCollection('reviews', 'reviews')
registerCollection('materials', 'materials')
registerCollection('boms', 'boms')
registerCollection('documents', 'documents')
registerCollection('sales-bom-snapshots', 'salesBomSnapshots', true)
registerCollection('project-phases', 'projectPhases')
registerCollection('project-milestones', 'projectMilestones')
registerCollection('project-events', 'projectEvents')
registerCollection('project-reports', 'projectReports')
registerCollection('project-templates', 'projectTemplates')
app.delete('/api/kpi-rules/:id', requireRole('admin','plm_manager'), (req: Request, res: Response) => {
  const rule = data.kpiRules.find(item => item.id === req.params.id)
  if (!rule) return res.status(404).json({ error: 'kpi_rule_not_found', message: 'KPI 规则不存在或不属于当前账套。' })
  if (rule.status === 'active') return res.status(409).json({ error: 'active_kpi_rule_cannot_delete', message: '生效中的规则不能删除；请先通过“应用生效集”将规则替换出当前生效集。' })
  const projectReferenced = data.projectEventReviews.some(review => Array.isArray(review.rulesSnapshot) && review.rulesSnapshot.some(snapshot => snapshot.kpiRuleId === rule.id))
  const reviewReferenced = data.reviews.some(review => Array.isArray(review.scoreLines) && review.scoreLines.some(line => line.kpiRuleId === rule.id))
  if (projectReferenced || reviewReferenced) return res.status(409).json({ error: 'referenced_kpi_rule', message: '此规则已被绩效记录或审计快照引用，不能删除；请将其保留为草稿以维持历史可追溯性。' })
  const before = data.kpiRules
  data.kpiRules = before.filter(item => item.id !== rule.id)
  try { persist() } catch (error) { data.kpiRules = before; throw error }
  return res.status(204).end()
})
app.post('/api/kpi-rules/activate-set', requireRole('admin','plm_manager'), (req: Request, res: Response) => {
  const raw = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).ids : undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100 || raw.some(id => typeof id !== 'string')) return res.status(400).json({ error: '请提供 1–100 个 KPI 规则 ID。' })
  const ids = [...new Set(raw as string[])], selected = new Set(ids), missing = ids.filter(id => !data.kpiRules.some(rule => rule.id === id))
  if (missing.length) return res.status(404).json({ error: '部分 KPI 规则不存在或不属于当前账套。' })
  const total = data.kpiRules.filter(rule => selected.has(rule.id)).reduce((sum, rule) => sum + Number(rule.weight ?? 0), 0)
  if (Math.abs(total - 100) > 0.001) return res.status(409).json({ error: 'active_kpi_weight_total', message: `目标生效规则权重必须合计 100%；当前为 ${total}%。` })
  const before = data.kpiRules.map(rule => ({ ...rule })), now = new Date().toISOString()
  data.kpiRules = data.kpiRules.map(rule => { const status = selected.has(rule.id) ? 'active' : 'draft'; return rule.status === status ? rule : { ...rule, status, revision: Number(rule.revision ?? 1) + 1, updatedAt: now, updatedBy: req.authUser!.displayName } })
  try { persist() } catch (error) { data.kpiRules = before; throw error }
  return res.json({ rules: data.kpiRules, activeWeight: 100 })
})

const roundScore = (value: number) => Math.round(Math.max(0, Math.min(120, value)) * 10) / 10
function scoreAgainstRule(rule: Entity, actual: number): number {
  const target = Number(rule.target)
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return 0
  const ratio = rule.direction === 'higher' ? actual / target : target / Math.max(actual, 0.0001)
  return roundScore(ratio * 100)
}
function weightedEventScore(lines: Array<Record<string, unknown>>, rules: Entity[]): number {
  const byId = new Map(lines.map(line => [String(line.kpiRuleId), Number(line.score)]))
  const totalWeight = rules.reduce((sum, rule) => sum + Number(rule.weight ?? 0), 0)
  if (!totalWeight) return 0
  return Math.round(rules.reduce((sum, rule) => sum + (byId.get(String(rule.kpiRuleId)) ?? 0) * Number(rule.weight ?? 0), 0) / totalWeight * 10) / 10
}
app.get('/api/project-event-reviews', (_req: Request, res: Response) => res.json(data.projectEventReviews))
app.post('/api/project-events/:id/start-review', requireRole('admin', 'plm_manager', 'reviewer'), (req: Request, res: Response) => {
  const event = data.projectEvents.find(item => item.id === req.params.id)
  if (!event) return res.status(404).json({ error: 'project event not found' })
  if (event.status !== 'completed') return res.status(409).json({ error: '事件需先标记完成，才能启动绩效自评。' })
  if (typeof event.ownerId !== 'string' || !currentAccountHasUser(event.ownerId)) return res.status(409).json({ error: '事件必须指定当前账套内的有效负责人，才能启动绩效自评。' })
  const activeRules = data.kpiRules.filter(rule => rule.status === 'active')
  const totalWeight = activeRules.reduce((sum, rule) => sum + Number(rule.weight ?? 0), 0)
  if (!activeRules.length || Math.abs(totalWeight - 100) > 0.001) return res.status(409).json({ error: 'effective KPI rules must be configured and total exactly 100% before an event review can start' })
  if (data.projectEventReviews.some(review => review.eventId === event.id && review.status !== 'approved')) return res.status(409).json({ error: '该事件已有进行中的绩效评审。' })
  const now = new Date().toISOString(), body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const rulesSnapshot = activeRules.map(rule => ({ kpiRuleId: rule.id, code: String(rule.code), name: String(rule.name), formula: String(rule.formula), unit: String(rule.unit ?? ''), target: Number(rule.target), direction: String(rule.direction), weight: Number(rule.weight), revision: Number(rule.revision ?? 1), category: String(rule.category ?? '') }))
  const review: Entity = { id: nanoid(), projectId: event.projectId, eventId: event.id, employee: String(event.owner ?? ''), department: String(event.department ?? ''), reviewer: typeof body.reviewer === 'string' ? body.reviewer.trim().slice(0,120) : '待指定主管', period: typeof body.period === 'string' ? body.period.trim().slice(0,80) : new Date().toISOString().slice(0,7), status: 'self-review', rulesSnapshot, selfScores: [], managerScores: [], selfComment: '', managerComment: '', selfReviewerId: event.ownerId, selfScore: 0, finalScore: 0, eventWeight: Number(event.projectWeight ?? 0), createdAt: now, updatedAt: now }
  data.projectEventReviews.unshift(review); persist(); return res.status(201).json(review)
})
app.patch('/api/project-event-reviews/:id/self', (req: Request, res: Response) => {
  const review = data.projectEventReviews.find(item => item.id === req.params.id)
  if (!review) return res.status(404).json({ error: 'project event review not found' })
  if (review.status !== 'self-review') return res.status(409).json({ error: 'self-review is not open' })
  const event = data.projectEvents.find(item => item.id === review.eventId), user = req.authUser!
  if (!event || typeof event.ownerId !== 'string' || event.ownerId !== user.id) return res.status(403).json({ error: '项目事件仅允许指定负责人提交自评。' })
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}, rawLines = Array.isArray(body.scores) ? body.scores as Record<string, unknown>[] : []
  const rules = Array.isArray(review.rulesSnapshot) ? review.rulesSnapshot as Entity[] : []
  if (rawLines.length !== rules.length) return res.status(400).json({ error: '每条有效 KPI 规则都必须填写实际值。' })
  const scores: Array<Record<string, unknown>> = []
  for (const rule of rules) {
    const raw = rawLines.find(line => line.kpiRuleId === rule.kpiRuleId)
    const actual = Number(raw?.actual), comment = typeof raw?.comment === 'string' ? raw.comment.trim().slice(0,1000) : ''
    if (!raw || !Number.isFinite(actual)) return res.status(400).json({ error: `请填写“${String(rule.name)}”的有效实际值。` })
    scores.push({ kpiRuleId: rule.kpiRuleId, actual, score: scoreAgainstRule(rule, actual), comment })
  }
  const selfComment = typeof body.comment === 'string' ? body.comment.trim().slice(0,4000) : ''
  if (!selfComment) return res.status(400).json({ error: '自评意见必填。' })
  review.selfScores = scores; review.selfScore = weightedEventScore(scores, rules); review.selfComment = selfComment; review.selfReviewerId = user.id; review.selfSubmittedAt = new Date().toISOString(); review.status = 'manager-review'; review.updatedAt = review.selfSubmittedAt
  persist(); return res.json(review)
})
app.patch('/api/project-event-reviews/:id/manager', requireRole('admin', 'plm_manager', 'reviewer'), (req: Request, res: Response) => {
  const review = data.projectEventReviews.find(item => item.id === req.params.id)
  if (!review) return res.status(404).json({ error: 'project event review not found' })
  if (review.status !== 'manager-review') return res.status(409).json({ error: 'manager review is not open' })
  const user = req.authUser!
  if (review.selfReviewerId === user.id) return res.status(403).json({ error: '自评人与主管评审人必须为不同人员。' })
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}, rawLines = Array.isArray(body.scores) ? body.scores as Record<string, unknown>[] : []
  const rules = Array.isArray(review.rulesSnapshot) ? review.rulesSnapshot as Entity[] : []
  if (rawLines.length !== rules.length) return res.status(400).json({ error: '每条 KPI 规则都必须有主管评分。' })
  const selfScores = Array.isArray(review.selfScores) ? review.selfScores as Array<Record<string, unknown>> : [], scores: Array<Record<string, unknown>> = []
  for (const rule of rules) {
    const raw = rawLines.find(line => line.kpiRuleId === rule.kpiRuleId), self = selfScores.find(line => line.kpiRuleId === rule.kpiRuleId)
    const actual = raw?.actual === undefined ? Number(self?.actual ?? 0) : Number(raw.actual)
    const score = raw?.score === undefined ? scoreAgainstRule(rule, actual) : Number(raw.score)
    const comment = typeof raw?.comment === 'string' ? raw.comment.trim().slice(0,1000) : ''
    if (!raw || !Number.isFinite(actual) || !Number.isFinite(score) || score < 0 || score > 120) return res.status(400).json({ error: `请填写“${String(rule.name)}”的有效主管评分（0–120）。` })
    scores.push({ kpiRuleId: rule.kpiRuleId, actual, score: roundScore(score), comment })
  }
  const managerComment = typeof body.comment === 'string' ? body.comment.trim().slice(0,4000) : ''
  if (!managerComment) return res.status(400).json({ error: '主管评审意见必填。' })
  review.managerScores = scores; review.managerComment = managerComment; review.managerReviewerId = user.id; review.managerReviewedAt = new Date().toISOString(); review.reviewer = user.displayName; review.finalScore = weightedEventScore(scores, rules); review.status = 'approved'; review.updatedAt = review.managerReviewedAt
  persist(); return res.json(review)
})

const documentStorageDir = resolve(process.env.DOCUMENT_STORAGE_DIR?.trim() || resolve(here, '../data/documents'))
mkdirSync(documentStorageDir, { recursive: true, mode: 0o750 })
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
const allowedDocumentExtensions = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.csv', '.txt', '.dwg', '.dxf', '.step', '.stp', '.stl', '.iges', '.igs'])
const knownMime: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv', '.txt': 'text/plain',
  '.dwg': 'application/acad', '.dxf': 'application/dxf', '.step': 'model/step', '.stp': 'model/step', '.stl': 'model/stl', '.iges': 'model/iges', '.igs': 'model/iges',
}
function validDocumentBytes(extension: string, bytes: Buffer): boolean {
  if (extension === '.pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-'
  if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (['.docx', '.xlsx'].includes(extension)) return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))
  if (['.csv', '.txt', '.dxf', '.step', '.stp', '.iges', '.igs'].includes(extension)) return !bytes.subarray(0, 1024).includes(0)
  if (extension === '.dwg') return bytes.subarray(0, 4).toString('ascii') === 'AC10'
  if (extension === '.stl') return bytes.length >= 84
  return false
}
function documentFileRows(documentId: string) {
  const scope = currentWorkspaceScope()!
  return db.prepare(`SELECT id,document_id AS documentId,original_name AS originalName,mime_type AS mimeType,byte_size AS byteSize,sha256,revision,uploaded_by AS uploadedBy,created_at AS createdAt
    FROM document_files WHERE tenant_id=? AND organization_id=? AND account_id=? AND document_id=? ORDER BY created_at DESC`).all(scope.tenantId, scope.organizationId, scope.accountId, documentId)
}
app.get('/api/documents/:id/files', (req: Request, res: Response) => {
  const documentId = String(req.params.id)
  if (!data.documents.some(document => document.id === documentId)) return res.status(404).json({ error: 'document not found' })
  return res.json({ files: documentFileRows(documentId) })
})
app.post('/api/documents/:id/files', requireRole('admin', 'plm_manager'), documentUpload.single('file'), (req: Request, res: Response) => {
  const document = data.documents.find(item => item.id === req.params.id)
  if (!document) return res.status(404).json({ error: 'document not found' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file_required', message: '请选择要上传的受控文件。' })
  const originalName = file.originalname.replace(/[\\/\r\n\0]/g, '_').trim().slice(0, 240)
  const extension = originalName.includes('.') ? `.${originalName.split('.').pop()!.toLowerCase()}` : ''
  if (!allowedDocumentExtensions.has(extension) || !validDocumentBytes(extension, file.buffer)) return res.status(415).json({ error: 'unsupported_file', message: '文件类型不支持或文件内容签名与扩展名不一致。' })
  const id = randomUUID()
  const storedName = `${id}${extension}`
  const mimeType = knownMime[extension] ?? 'application/octet-stream'
  const createdAt = new Date().toISOString()
  const sha256 = createHash('sha256').update(file.buffer).digest('hex')
  const target = resolve(documentStorageDir, storedName)
  const previous = { fileName: document.fileName, fileUrl: document.fileUrl, updatedAt: document.updatedAt }
  try {
    writeFileSync(target, file.buffer, { flag: 'wx', mode: 0o640 })
    const save = db.transaction(() => {
      const scope = currentWorkspaceScope()!
      db.prepare(`INSERT INTO document_files(id,tenant_id,organization_id,account_id,document_id,original_name,stored_name,mime_type,byte_size,sha256,revision,uploaded_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, scope.tenantId, scope.organizationId, scope.accountId, document.id, originalName, storedName, mimeType, file.size, sha256, document.revision, req.authUser!.id, createdAt)
      document.fileName = originalName
      document.fileUrl = `/api/documents/${encodeURIComponent(document.id)}/files/${encodeURIComponent(id)}/content`
      document.updatedAt = createdAt
      persist()
    })
    save()
    return res.status(201).json({ file: { id, documentId: document.id, originalName, mimeType, byteSize: file.size, sha256, revision: document.revision, uploadedBy: req.authUser!.id, createdAt } })
  } catch (error) {
    Object.assign(document, previous)
    try { if (existsSync(target)) unlinkSync(target) } catch { /* preserve original failure */ }
    console.error('Document upload failed.', error)
    return res.status(500).json({ error: 'document_upload_failed', message: '文件保存失败，请检查存储目录权限。' })
  }
})
app.get('/api/documents/:id/files/:fileId/content', (req: Request, res: Response) => {
  const scope = currentWorkspaceScope()!
  const row = db.prepare(`SELECT original_name AS originalName,stored_name AS storedName,mime_type AS mimeType FROM document_files WHERE id=? AND document_id=? AND tenant_id=? AND organization_id=? AND account_id=?`).get(req.params.fileId, req.params.id, scope.tenantId, scope.organizationId, scope.accountId) as { originalName: string; storedName: string; mimeType: string } | undefined
  if (!row) return res.status(404).json({ error: 'file not found' })
  const path = resolve(documentStorageDir, row.storedName)
  if (!path.startsWith(`${documentStorageDir}/`) || !existsSync(path)) return res.status(404).json({ error: 'file not found' })
  const safeName = row.originalName.replace(/[\r\n"\\]/g, '_')
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, '_')
  res.setHeader('Content-Type', row.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  const stream = createReadStream(path)
  stream.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'file_read_failed' }); else res.destroy() })
  stream.pipe(res)
})
type ProjectFileRow = { id:string; projectId:string; name:string; title:string; storedName:string; mimeType:string; size:number; sha256:string; uploadedBy:string; createdAt:string }
function projectFileRows(projectId: string): ProjectFileRow[] {
  const scope = currentWorkspaceScope()!
  return db.prepare(`SELECT pf.id,pf.project_id AS projectId,pf.original_name AS name,pf.title,pf.stored_name AS storedName,pf.mime_type AS mimeType,pf.byte_size AS size,pf.sha256,u.display_name AS uploadedBy,pf.created_at AS createdAt
    FROM project_files pf LEFT JOIN users u ON u.id=pf.uploaded_by
    WHERE pf.tenant_id=? AND pf.organization_id=? AND pf.account_id=? AND pf.project_id=? ORDER BY pf.created_at DESC`).all(scope.tenantId,scope.organizationId,scope.accountId,projectId) as ProjectFileRow[]
}
function publicProjectFile(file: ProjectFileRow) { const { storedName: _storedName, ...visible } = file; return visible }
function safeFileSegment(value: string): string { return value.replace(/[\\/\r\n\0<>:"|?*]/g,'_').replace(/\.\.+/g,'_').trim().slice(0,140) || 'project' }
function archiveAttachmentName(projectCode: string, file: ProjectFileRow): string {
  const created = new Date(file.createdAt), timestamp = Number.isNaN(created.getTime()) ? 'UNKNOWN-TIME' : created.toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1Z')
  return `${safeFileSegment(projectCode)}_NA_NA_${safeFileSegment(file.uploadedBy)}_${timestamp}_${safeFileSegment(file.id)}_${safeFileSegment(file.name)}`
}
app.get('/api/projects/:id/files', (req: Request, res: Response) => {
  if (!data.projects.some(project => project.id === req.params.id)) return res.status(404).json({ error: 'project not found' })
  return res.json(projectFileRows(String(req.params.id)).map(publicProjectFile))
})
app.post('/api/projects/:id/files', requireRole('admin','plm_manager','reviewer','member'), documentUpload.single('file'), (req: Request, res: Response) => {
  const project = data.projects.find(item => item.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file_required', message: '请选择要上传的项目附件。' })
  const originalName = file.originalname.replace(/[\\/\r\n\0]/g,'_').trim().slice(0,240)
  const extension = originalName.includes('.') ? `.${originalName.split('.').pop()!.toLowerCase()}` : ''
  if (!allowedDocumentExtensions.has(extension) || !validDocumentBytes(extension,file.buffer)) return res.status(415).json({ error: 'unsupported_file', message: '文件类型不支持，或文件内容签名与扩展名不一致。' })
  const id=randomUUID(), storedName=`project-${id}${extension}`, mimeType=knownMime[extension] ?? 'application/octet-stream', createdAt=new Date().toISOString(), sha256=createHash('sha256').update(file.buffer).digest('hex'), target=resolve(documentStorageDir,storedName), scope=currentWorkspaceScope()!
  const title=typeof req.body?.title==='string'?req.body.title.trim().slice(0,160):''
  try {
    writeFileSync(target,file.buffer,{flag:'wx',mode:0o640})
    const save=db.transaction(()=>{ db.prepare(`INSERT INTO project_files(id,tenant_id,organization_id,account_id,project_id,original_name,title,stored_name,mime_type,byte_size,sha256,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,scope.tenantId,scope.organizationId,scope.accountId,project.id,originalName,title,storedName,mimeType,file.size,sha256,req.authUser!.id,createdAt); persist() })
    save()
    const row=projectFileRows(project.id).find(item=>item.id===id)!
    return res.status(201).json({file:publicProjectFile(row)})
  } catch (error) {
    try { if(existsSync(target)) unlinkSync(target) } catch { /* preserve the original failure */ }
    console.error('Project file upload failed.',error)
    return res.status(500).json({error:'project_file_upload_failed',message:'项目附件保存失败，请检查存储目录权限。'})
  }
})
app.get('/api/projects/:id/files/:fileId/content', (req: Request,res: Response)=>{
  const scope=currentWorkspaceScope()!, row=db.prepare(`SELECT original_name AS originalName,stored_name AS storedName,mime_type AS mimeType FROM project_files WHERE id=? AND project_id=? AND tenant_id=? AND organization_id=? AND account_id=?`).get(req.params.fileId,req.params.id,scope.tenantId,scope.organizationId,scope.accountId) as {originalName:string;storedName:string;mimeType:string}|undefined
  if(!row) return res.status(404).json({error:'file not found'})
  const path=resolve(documentStorageDir,row.storedName)
  if(!path.startsWith(`${documentStorageDir}/`)||!existsSync(path)) return res.status(404).json({error:'file not found'})
  const safeName=row.originalName.replace(/[\r\n"\\]/g,'_'),fallbackName=safeName.replace(/[^\x20-\x7E]/g,'_')
  res.setHeader('Content-Type',row.mimeType);res.setHeader('Content-Disposition',`attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store')
  const stream=createReadStream(path);stream.on('error',()=>{if(!res.headersSent)res.status(500).json({error:'file_read_failed'});else res.destroy()});stream.pipe(res)
})
app.delete('/api/projects/:id/files/:fileId', requireRole('admin','plm_manager'), (req:Request,res:Response)=>{
  const scope=currentWorkspaceScope()!,row=db.prepare(`SELECT stored_name AS storedName FROM project_files WHERE id=? AND project_id=? AND tenant_id=? AND organization_id=? AND account_id=?`).get(req.params.fileId,req.params.id,scope.tenantId,scope.organizationId,scope.accountId) as {storedName:string}|undefined
  if(!row)return res.status(404).json({error:'file not found'})
  const target=resolve(documentStorageDir,row.storedName)
  if(!target.startsWith(`${documentStorageDir}/`))return res.status(400).json({error:'invalid stored path'})
  try { if(existsSync(target))unlinkSync(target);db.prepare(`DELETE FROM project_files WHERE id=? AND tenant_id=? AND organization_id=? AND account_id=?`).run(req.params.fileId,scope.tenantId,scope.organizationId,scope.accountId);return res.status(204).end() }
  catch(error){console.error('Project file delete failed.',error);return res.status(500).json({error:'project_file_delete_failed'})}
})
function projectExportRows(projectId:string){
  const project=data.projects.find(item=>item.id===projectId)
  if(!project)return undefined
  const phases=data.projectPhases.filter(item=>item.projectId===projectId),milestones=data.projectMilestones.filter(item=>item.projectId===projectId),tasks=data.tasks.filter(item=>item.projectId===projectId),events=data.projectEvents.filter(item=>item.projectId===projectId),eventIds=new Set(events.map(item=>item.id)),reviews=data.projectEventReviews.filter(item=>eventIds.has(String(item.eventId))),reports=data.projectReports.filter(item=>item.projectId===projectId),files=projectFileRows(projectId)
  return {project,phases,milestones,tasks,events,reviews,reports,files}
}
app.get('/api/projects/:id/export.csv',(req:Request,res:Response)=>{
  const rows=projectExportRows(String(req.params.id));if(!rows)return res.status(404).json({error:'project not found'})
  const buffer=projectTaskCsv(rows.phases,rows.milestones,rows.tasks),filename=`${safeFileSegment(String(rows.project.code??'project'))}-tasks.csv`
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);res.setHeader('Cache-Control','private, no-store');return res.send(buffer)
})
app.get('/api/projects/:id/export.xlsx',async(req:Request,res:Response)=>{
  const rows=projectExportRows(String(req.params.id));if(!rows)return res.status(404).json({error:'project not found'})
  try { const buffer=await projectWorkbook(rows.project,rows.phases,rows.milestones,rows.tasks,rows.events,rows.reviews,rows.reports,rows.files.map(publicProjectFile)),filename=`${safeFileSegment(String(rows.project.code??'project'))}-workspace.xlsx`;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);res.setHeader('Cache-Control','private, no-store');return res.send(buffer) }
  catch(error){console.error('Project Excel export failed.',error);return res.status(500).json({error:'project_export_failed',message:'项目 Excel 工作簿生成失败。'})}
})
app.post('/api/projects/:id/import-plan',requireRole('admin','plm_manager'),documentUpload.single('file'),async(req:Request,res:Response)=>{
  const project=data.projects.find(item=>item.id===req.params.id);if(!project)return res.status(404).json({error:'project not found'})
  const file=req.file;if(!file)return res.status(400).json({error:'file_required',message:'请选择 CSV 或 XLSX 文件。'})
  if(file.size>10*1024*1024)return res.status(413).json({error:'import_file_too_large',message:'计划表导入上限为 10 MB。'})
  try {
    if(file.originalname.toLowerCase().endsWith('.xlsx')&&!file.buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw new Error('XLSX 文件内容签名无效。')
    if(file.originalname.toLowerCase().endsWith('.csv')&&file.buffer.subarray(0,1024).includes(0))throw new Error('CSV 文件包含不支持的二进制内容。')
    const imported=await parseProjectPlanFile(file.originalname,file.buffer),now=new Date().toISOString()
    const phaseRows=data.projectPhases.filter(item=>item.projectId===project.id),phaseByCode=new Map(phaseRows.map(item=>[String(item.code),item])),nextPhases:Entity[]=[]
    for(const phase of imported.phases){if(nextPhases.some(item=>item.code===phase.code))throw new Error(`阶段编码重复：${phase.code}`);const prior=phaseByCode.get(phase.code);const item:Entity={...(prior??{}),id:prior?.id??nanoid(),projectId:project.id,...phase,updatedAt:now};phaseByCode.set(phase.code,item);nextPhases.push(item)}
    const effectivePhases=new Map([...phaseRows.filter(item=>!nextPhases.some(next=>next.id===item.id)),...nextPhases].map(item=>[String(item.code),item]))
    const milestoneRows=data.projectMilestones.filter(item=>item.projectId===project.id),milestoneByCode=new Map(milestoneRows.map(item=>[String(item.code),item])),nextMilestones:Entity[]=[]
    for(const milestone of imported.milestones){if(nextMilestones.some(item=>item.code===milestone.code))throw new Error(`里程碑编码重复：${milestone.code}`);const phase=milestone.phaseCode?effectivePhases.get(milestone.phaseCode):undefined;if(milestone.phaseCode&&!phase)throw new Error(`里程碑“${milestone.title}”引用了不存在的阶段编码 ${milestone.phaseCode}`);const prior=milestoneByCode.get(milestone.code);const item:Entity={...(prior??{}),id:prior?.id??nanoid(),projectId:project.id,...milestone,phaseId:phase?.id,updatedAt:now};milestoneByCode.set(milestone.code,item);nextMilestones.push(item)}
    const effectiveMilestones=new Map([...milestoneRows.filter(item=>!nextMilestones.some(next=>next.id===item.id)),...nextMilestones].map(item=>[String(item.code),item]))
    if(new Set(imported.tasks.map(task=>task.wbsCode)).size!==imported.tasks.length)throw new Error('导入任务中存在重复的 WBS 编码。')
    for(const task of imported.tasks){if(task.phaseCode&&!effectivePhases.has(task.phaseCode))throw new Error(`任务“${task.title}”引用了不存在的阶段编码 ${task.phaseCode}`);if(task.milestoneCode&&!effectiveMilestones.has(task.milestoneCode))throw new Error(`任务“${task.title}”引用了不存在的里程碑编码 ${task.milestoneCode}`)}
    const taskRows=data.tasks.filter(item=>item.projectId===project.id),taskByWbs=new Map(taskRows.filter(item=>item.wbsCode).map(item=>[String(item.wbsCode),item])),nextTasks:Task[]=[]
    imported.tasks.forEach((task,index)=>{const prior=taskByWbs.get(task.wbsCode),phase=task.phaseCode?effectivePhases.get(task.phaseCode):undefined,milestone=task.milestoneCode?effectiveMilestones.get(task.milestoneCode):undefined;nextTasks.push({...prior,id:prior?.id??nanoid(),title:task.title,description:task.description||prior?.description,dueDate:task.dueDate,startDate:task.startDate||prior?.startDate,priority:task.priority,status:task.status,projectId:project.id,phaseId:phase?.id,milestoneId:milestone?.id,wbsCode:task.wbsCode,assignee:task.assignee||prior?.assignee,assigneeId:prior?.assigneeId,progress:task.status==='done'?100:task.progress,estimateHours:task.estimateHours,acceptanceCriteria:task.acceptanceCriteria,createdAt:prior?.createdAt??now,updatedAt:now})})
    const oldPhases=data.projectPhases,oldMilestones=data.projectMilestones,oldTasks=data.tasks
    data.projectPhases=[...nextPhases,...phaseRows.filter(item=>!nextPhases.some(next=>next.id===item.id)),...data.projectPhases.filter(item=>item.projectId!==project.id)]
    data.projectMilestones=[...nextMilestones,...milestoneRows.filter(item=>!nextMilestones.some(next=>next.id===item.id)),...data.projectMilestones.filter(item=>item.projectId!==project.id)]
    data.tasks=[...nextTasks,...taskRows.filter(item=>!nextTasks.some(next=>next.id===item.id)),...data.tasks.filter(item=>item.projectId!==project.id)]
    try{persist()}catch(error){data.projectPhases=oldPhases;data.projectMilestones=oldMilestones;data.tasks=oldTasks;throw error}
    return res.json({ok:true,counts:{phases:imported.phases.length,milestones:imported.milestones.length,tasks:imported.tasks.length}})
  }catch(error){const message=error instanceof Error?error.message:'计划表解析失败。';return res.status(400).json({error:'project_import_rejected',message})}
})
app.get('/api/projects/:id/archive.zip',async(req:Request,res:Response)=>{
  const rows=projectExportRows(String(req.params.id));if(!rows)return res.status(404).json({error:'project not found'})
  try{
    const code=safeFileSegment(String(rows.project.code??rows.project.name??'project')),files=rows.files.filter(file=>existsSync(resolve(documentStorageDir,file.storedName)))
    const workbook=await projectWorkbook(rows.project,rows.phases,rows.milestones,rows.tasks,rows.events,rows.reviews,rows.reports,rows.files.map(publicProjectFile))
    const archiveNames=new Map(files.map(file=>[file.id,`${code}/attachments/${archiveAttachmentName(code,file)}`]))
    const attachments=rows.files.map(file=>({...publicProjectFile(file),originalName:file.name,archiveName:archiveNames.get(file.id)??null,linkedRecord:{type:'project',projectId:rows.project.id,eventId:null,taskId:null},creator:file.uploadedBy,createdAt:file.createdAt,sha256:file.sha256,archived:archiveNames.has(file.id)}))
    const manifest={exportedAt:new Date().toISOString(),scope:{tenantId:currentWorkspaceScope()!.tenantId,organizationId:currentWorkspaceScope()!.organizationId,accountId:currentWorkspaceScope()!.accountId},project:rows.project,phases:rows.phases,milestones:rows.milestones,tasks:rows.tasks,events:rows.events,eventReviews:rows.reviews,reports:rows.reports,attachments}
    res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="${code}-archive.zip"`);res.setHeader('Cache-Control','private, no-store')
    const archive=new archiver.ZipArchive({zlib:{level:6}});archive.on('error',error=>{console.error('Project archive generation failed.',error);if(!res.headersSent)res.status(500).end();else res.destroy(error)});archive.pipe(res)
    archive.append(JSON.stringify(manifest,null,2),{name:`${code}/project-data.json`});archive.append(workbook,{name:`${code}/project-workbook.xlsx`})
    for(const file of files){archive.file(resolve(documentStorageDir,file.storedName),{name:archiveNames.get(file.id)!})}
    await archive.finalize()
  }catch(error){console.error('Project archive generation failed.',error);if(!res.headersSent)return res.status(500).json({error:'project_archive_failed',message:'项目归档包生成失败。'});res.destroy(error as Error)}
})
app.post('/api/boms/:id/lines', requireRole('admin', 'plm_manager'), (req: Request, res: Response) => {
  const bom = data.boms.find(item => item.id === req.params.id)
  if (!bom) return res.status(404).json({ error: 'BOM not found' })
  if (bom.kind === 'sales') return res.status(409).json({ error: 'Use configurable sales rules instead of static BOM lines.' })
  const source = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  if (!currentMaterial(source.materialId) || source.materialId === bom.parentMaterialId || !(Number(source.quantity) > 0) || !Number.isFinite(Number(source.quantity))) return res.status(400).json({ error: 'materialId must be a current-account component distinct from the BOM parent, and quantity must be positive' })
  const lines = Array.isArray(bom.lines) ? bom.lines as unknown[] : []
  const lineId = typeof source.id === 'string' && source.id ? source.id : nanoid()
  if (lines.some(line => (line as Record<string, unknown>).id === lineId)) return res.status(409).json({ error: 'BOM line already exists' })
  const nextLines = [...lines, { ...source, id: lineId }]
  bom.lines = nextLines
  bom.updatedAt = new Date().toISOString(); persist(); return res.status(201).json(nextLines[nextLines.length - 1])
})
app.delete('/api/boms/:id/lines/:lineId', requireRole('admin', 'plm_manager'), (req: Request, res: Response) => {
  const bom = data.boms.find(item => item.id === req.params.id)
  if (!bom) return res.status(404).json({ error: 'BOM not found' })
  const lines = Array.isArray(bom.lines) ? bom.lines as Entity[] : []
  const next = lines.filter(line => line.id !== req.params.lineId)
  if (next.length === lines.length) return res.status(404).json({ error: 'BOM line not found' })
  bom.lines = next; bom.updatedAt = new Date().toISOString(); persist(); return res.status(204).end()
})
app.use('/api', createDailyReportRouter())
app.use('/api', createDailyReportingAdminRouter())
app.use('/api', createDailyReportingIsolationRepairRouter())
app.use('/api', createIntegrationRouter())
app.use('/api', createReportDefinitionsRouter())
app.use('/api', createFormsRouter())
app.use('/api', (error: unknown, _req: Request, res: Response, _next: (error?: unknown) => void) => {
  if (error instanceof StateConflictError) return res.status(409).json({ error: 'workspace_conflict', message: '工作区刚被其他操作更新，请刷新后重试。' })
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return res.status(status).json({ error: 'upload_rejected', message: error.code === 'LIMIT_FILE_SIZE' ? '附件不能超过 25 MB。' : '附件上传请求格式无效。' })
  }
  const candidate = error as { status?: number; type?: string }
  if (candidate?.type === 'entity.too.large') return res.status(413).json({ error: 'request_too_large', message: '请求体超过 2 MB 限制。' })
  console.error('Unhandled API request error.', error)
  return res.status(500).json({ error: 'internal_error', message: '服务暂时无法完成请求，请稍后重试。' })
})
app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: 'API route not found' }))
const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST?.trim() || '0.0.0.0'
const server = app.listen(port, host, () => console.log(`Momentum API listening on http://${host}:${port}`))
let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Momentum API received ${signal}; draining requests.`)
  stopIntegrationServices()
  const hardStop = setTimeout(() => { server.closeAllConnections?.(); process.exit(1) }, 15_000)
  hardStop.unref()
  server.close(() => {
    void closeCache().finally(() => { clearTimeout(hardStop); process.exit(0) })
  })
  server.closeIdleConnections?.()
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
