import { Router, type Request } from 'express'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import cron from 'node-cron'
import { requireRole } from './auth.js'
import { db, getAppState, recordSecurityEvent, setAppState } from './database.js'
import { cacheDeleteIfValue, cacheHealth, cacheSetIfAbsent, initializeCache } from './integrations/cache.js'
import { k3cloudStatus, queryK3Cloud, testK3CloudConnection, type K3CloudConfig, type K3CloudQueryInput } from './integrations/k3cloud.js'
import { completeTask, flowableHealth, getTaskForActor, listTasksForActor, startProcess, type FlowableConfig } from './integrations/flowable.js'
import { buildApprovalPreviewUrl, dingtalkStatus, parseCardApprovalAction, sendMarkdown, verifyCardCallbackSignature, type DingTalkConfig } from './integrations/dingtalk.js'
import { connectorCredentialConfig, connectorSummary, listConnectorConfigs, saveConnectorConfig, type ConnectorConfig, type ConnectorProvider } from './integrations/configuration.js'
import { buildWorkspaceReport } from './reporting.js'
import { reportScheduleBucket, runWithReportLocks } from './report-scheduling.js'
import { currentWorkspaceScope, type WorkspaceScope } from './scope.js'
import { readScopedWorkspace } from './workspace-store.js'

type DemoTask = { id: string; title: string; businessType: string; businessId: string; requester: string; assignee: string; createdAt: string; dueAt: string; status: 'pending' | 'approved' | 'rejected'; preview: Record<string, unknown>; comment?: string; decision?: string; approvedBy?: string; approvedAt?: string; processInstanceId?: string }
type WorkflowState = { tasks: DemoTask[]; audit: Array<Record<string, unknown>> }
type ApprovalAuditEntry = { id: string; taskId: string; actor: string; decision: 'approved' | 'rejected'; comment: string; createdAt: string; mode: 'demo' | 'flowable'; title?: string; businessType?: string; businessId?: string }
type Cadence = 'daily' | 'weekly'
type ReportSchedule = { id: string; name: string; cadence: Cadence; time: string; dayOfWeek?: number; timezone: string; enabled: boolean; createdAt: string; updatedAt: string; lastRunAt?: string; lastResult?: string }

const moduleDir = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.env.INTEGRATION_DATA_DIR?.trim() || resolve(moduleDir, '../data'))
mkdirSync(dataDir, { recursive: true })
const seedPath = resolve(moduleDir, '../data/seed-workflow-demo.json')
function loadJson<T>(path: string, fallback: T): T { try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback } }
const workflowSeed = loadJson<WorkflowState>(seedPath, { tasks: [], audit: [] })
const activeCron = new Map<string, ReturnType<typeof cron.schedule>>()
const allowedProcessKeys = new Set(['materialApproval', 'bomReleaseApproval', 'documentReleaseApproval', 'performanceReviewApproval'])
const providerFields: Record<ConnectorProvider, Set<string>> = {
  flowable: new Set(['baseUrl', 'username', 'password', 'timeoutMs', 'userMap', 'groupMap', 'clearSecrets']),
  k3cloud: new Set(['baseUrl', 'accountId', 'username', 'organization', 'appId', 'appSecret', 'password', 'lcid', 'timeoutMs', 'formAllowlist', 'clearSecrets']),
  dingtalk: new Set(['webhookUrl', 'webhookSecret', 'cardCallbackSecret', 'appKey', 'appSecret', 'templateId', 'corpId', 'publicAppUrl', 'userMapping', 'clearSecrets']),
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function scopeForRequest(req: Request): WorkspaceScope {
  const user = req.authUser
  if (!user) throw new Error('Verified tenant scope is missing.')
  return { tenantId: user.tenantId, tenantName: user.tenantName, organizationId: user.organizationId, organizationName: user.organizationName, accountId: user.accountId, accountName: user.accountName, role: user.role, isPlatformAdmin: user.isPlatformAdmin }
}
function scopeKey(scope: WorkspaceScope, namespace: string): string { return `integration:${scope.tenantId}:${scope.organizationId}:${scope.accountId}:${namespace}` }
function workflowFor(scope: WorkspaceScope): WorkflowState {
  const state = getAppState<WorkflowState | null>(scopeKey(scope, 'workflow'), null) ?? structuredClone(workflowSeed)
  if (!Array.isArray(state.tasks)) state.tasks = []
  if (!Array.isArray(state.audit)) state.audit = []
  return state
}
function auditFor(scope: WorkspaceScope): ApprovalAuditEntry[] { const value = getAppState<ApprovalAuditEntry[]>(scopeKey(scope, 'workflow-audit'), []); return Array.isArray(value) ? value : [] }
function schedulesFor(scope: WorkspaceScope): ReportSchedule[] { const value = getAppState<ReportSchedule[]>(scopeKey(scope, 'report-schedules'), []); return Array.isArray(value) ? value : [] }
function persistWorkflow(scope: WorkspaceScope, value: WorkflowState): void { setAppState(scopeKey(scope, 'workflow'), value) }
function persistAudit(scope: WorkspaceScope, value: ApprovalAuditEntry[]): void { setAppState(scopeKey(scope, 'workflow-audit'), value) }
function persistSchedules(scope: WorkspaceScope, value: ReportSchedule[]): void { setAppState(scopeKey(scope, 'report-schedules'), value) }
function k3Config(scope: WorkspaceScope): Partial<K3CloudConfig> { return connectorCredentialConfig(scope, 'k3cloud') as Partial<K3CloudConfig> }
function flowableConfig(scope: WorkspaceScope): FlowableConfig { return connectorCredentialConfig(scope, 'flowable') as unknown as FlowableConfig }
function dingTalkConfig(scope: WorkspaceScope): DingTalkConfig { return connectorCredentialConfig(scope, 'dingtalk') as unknown as DingTalkConfig }
function internalScopeKey(scope: WorkspaceScope): string { return `${scope.tenantId}:${scope.organizationId}:${scope.accountId}` }
function flowableTenantId(scope: WorkspaceScope): string { return `tenant:${scope.tenantId}:organization:${scope.organizationId}:account:${scope.accountId}` }
function trustedActor(req: Request, config: ConnectorConfig): string | undefined {
  const user = req.authUser
  if (!user || user.disabled) return undefined
  const map = record(config.userMap), value = map[user.email]
  return typeof value === 'string' && value.length > 0 && value.length <= 160 ? value : undefined
}
function trustedCandidateGroups(config: FlowableConfig, actor: string): string[] {
  const value = record(config.groupMap)[actor]
  return Array.isArray(value) ? value.filter((group): group is string => typeof group === 'string' && Boolean(group.trim())).map(group => group.trim()).slice(0, 100) : []
}
function publicFlowableTask(row: Record<string, unknown>) {
  return { id: String(row.id ?? ''), title: String(row.name ?? 'Flowable 审批任务'), businessType: String(row.businessType ?? 'process'), businessId: String(row.businessKey ?? row.processInstanceId ?? row.id ?? ''), requester: String(row.owner ?? row.initiator ?? '—'), assignee: String(row.assignee ?? '待认领'), createdAt: String(row.createTime ?? ''), dueAt: String(row.dueDate ?? ''), status: 'pending', preview: { 流程定义: row.processDefinitionId, 环节: row.taskDefinitionKey, 描述: row.description, 优先级: row.priority }, processInstanceId: String(row.processInstanceId ?? ''), taskDefinitionKey: String(row.taskDefinitionKey ?? ''), tenantId: String(row.tenantId ?? '') }
}
function validateTimezone(value: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true } catch { return false } }
function cronExpression(schedule: ReportSchedule): string { const [hour, minute] = schedule.time.split(':').map(Number); return schedule.cadence === 'weekly' ? `${minute} ${hour} * * ${schedule.dayOfWeek ?? 1}` : `${minute} ${hour} * * *` }
function schedulerKey(scope: WorkspaceScope, id: string): string { return `${internalScopeKey(scope)}:${id}` }
function clearCron(scope: WorkspaceScope, id: string): void { const key = schedulerKey(scope, id); activeCron.get(key)?.stop(); activeCron.delete(key) }
function scheduleStatus(scope: WorkspaceScope, schedule: ReportSchedule) {
  const ready = dingtalkStatus(dingTalkConfig(scope)).configured
  return { ...schedule, deliveryConfigured: ready, schedulerState: !schedule.enabled ? 'disabled' : !ready ? 'blocked-missing-webhook' : activeCron.has(schedulerKey(scope, schedule.id)) ? 'scheduled' : 'inactive' }
}
function reportForScope(scope: WorkspaceScope, workflowTasks?: object[]) {
  const workspace = readScopedWorkspace(scope), state = workflowFor(scope)
  return buildWorkspaceReport({ ...workspace, workflowTasks: workflowTasks ?? state.tasks })
}
function recordScheduleRun(scope: WorkspaceScope, id: string, result: string): void {
  const schedules = schedulesFor(scope), current = schedules.find(item => item.id === id)
  if (!current) return
  current.lastRunAt = new Date().toISOString(); current.lastResult = result; current.updatedAt = current.lastRunAt
  persistSchedules(scope, schedules)
}
async function runScheduleDelivery(scope: WorkspaceScope, schedule: ReportSchedule, scheduled: boolean) {
  const connector = dingTalkConfig(scope)
  if (!dingtalkStatus(connector).configured) return { ok: false, status: 'blocked-missing-webhook' as const, message: '钉钉机器人未配置；报告只生成预览，没有发送。' }
  if (scheduled && !schedulesFor(scope).some(item => item.id === schedule.id && item.enabled)) return { ok: false, status: 'disabled' as const, message: '报告计划已停用；本次调度未执行。' }
  const locked = await runWithReportLocks({
    scope,
    scheduleId: schedule.id,
    ...(scheduled ? { scheduledBucket: reportScheduleBucket(schedule.timezone) } : {}),
    lockStore: { setIfAbsent: cacheSetIfAbsent, deleteIfValue: cacheDeleteIfValue },
    isSuccessful: result => result.ok,
    run: async () => {
      let generatedAt: string | undefined
      try {
        const report = reportForScope(scope)
        generatedAt = report.summary.generatedAt
        const preview = buildApprovalPreviewUrl('/?page=reports', {}, connector.publicAppUrl)
        const result = await sendMarkdown(schedule.name, `${report.markdown}${preview ? `\n\n[打开报告预览](${preview})` : ''}`, connector)
        recordScheduleRun(scope, schedule.id, result.ok ? 'sent' : `failed: ${result.message}`)
        return { ...result, status: result.ok ? 'sent' as const : 'failed' as const, ...(generatedAt ? { generatedAt } : {}) }
      } catch {
        recordScheduleRun(scope, schedule.id, 'failed: report generation or delivery failed')
        return { ok: false, status: 'failed' as const, message: '报告生成或发送失败。', ...(generatedAt ? { generatedAt } : {}) }
      }
    },
  })
  if (locked.status === 'busy') return { ok: false, status: 'already-running' as const, message: '此计划已有一次发送正在进行，请稍后重试。' }
  if (locked.status === 'duplicate') return { ok: false, status: 'duplicate' as const, message: '此计划当前调度分钟已执行，已跳过重复触发。' }
  if ('value' in locked) return locked.value
  return { ok: false, status: 'already-running' as const, message: '此计划已有一次发送正在进行，请稍后重试。' }
}
function installCron(scope: WorkspaceScope, schedule: ReportSchedule): void {
  clearCron(scope, schedule.id)
  const connector = dingTalkConfig(scope)
  if (!schedule.enabled || !dingtalkStatus(connector).configured) return
  const expression = cronExpression(schedule)
  if (!cron.validate(expression) || !validateTimezone(schedule.timezone)) return
  const key = schedulerKey(scope, schedule.id)
  const task = cron.schedule(expression, async () => { await runScheduleDelivery(scope, schedule, true) }, { timezone: schedule.timezone, name: `report-${key}` })
  activeCron.set(key, task)
}
function installAllCron(scope: WorkspaceScope): void { for (const schedule of schedulesFor(scope)) installCron(scope, schedule) }
function activeScopes(): WorkspaceScope[] {
  return db.prepare(`SELECT t.id AS tenantId,t.name AS tenantName,o.id AS organizationId,o.name AS organizationName,a.id AS accountId,a.name AS accountName
    FROM accounts a JOIN organizations o ON o.id=a.organization_id AND o.tenant_id=a.tenant_id JOIN tenants t ON t.id=a.tenant_id WHERE a.status='active' AND o.status='active' AND t.status='active'`).all() as WorkspaceScope[]
}
function providerFrom(value: unknown): ConnectorProvider | undefined { return value === 'flowable' || value === 'k3cloud' || value === 'dingtalk' ? value : undefined }
function safeIncoming(provider: ConnectorProvider, value: unknown): ConnectorConfig {
  const body = record(value), result: ConnectorConfig = {}
  for (const [key, item] of Object.entries(body)) if (providerFields[provider].has(key)) result[key] = item
  return result
}

export function createIntegrationRouter(): Router {
  const router = Router()

  router.get('/integrations/settings', requireRole('admin'), (req, res) => {
    const scope = scopeForRequest(req)
    return res.json({ providers: { flowable: connectorSummary(scope, 'flowable'), k3cloud: connectorSummary(scope, 'k3cloud'), dingtalk: connectorSummary(scope, 'dingtalk') } })
  })
  router.put('/integrations/settings/:provider', requireRole('admin'), (req, res) => {
    const scope = scopeForRequest(req), provider = providerFrom(req.params.provider)
    if (!provider) return res.status(404).json({ error: 'connector_not_found', message: '连接器类型无效。' })
    try {
      const config = safeIncoming(provider, req.body)
      const result = saveConnectorConfig(scope, provider, config, req.authUser!.id)
      recordSecurityEvent({ userId: req.authUser!.id, tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId, event: 'connector_config_updated', subject: provider, ip: req.ip, userAgent: req.get('user-agent') })
      if (provider === 'dingtalk') installAllCron(scope)
      return res.json({ ...result, settings: connectorSummary(scope, provider) })
    } catch (error) { return res.status(400).json({ error: 'invalid_connector_config', message: error instanceof Error ? error.message : '连接器配置无效。' }) }
  })
  router.post('/integrations/settings/:provider/test', requireRole('admin'), async (req, res) => {
    const scope = scopeForRequest(req), provider = providerFrom(req.params.provider)
    if (!provider) return res.status(404).json({ error: 'connector_not_found', message: '连接器类型无效。' })
    if (provider === 'flowable') {
      const status = await flowableHealth(flowableConfig(scope))
      return res.status(status.connected ? 200 : 502).json({ status })
    }
    if (provider === 'k3cloud') {
      const result = await testK3CloudConnection(k3Config(scope), internalScopeKey(scope)), status = { ...result, connected: result.authenticated, message: result.authenticated ? 'K3Cloud AppSecret 登录成功；尚未执行查询或写入。' : result.configured ? 'K3Cloud 登录失败；请核对 Base URL、账号、AppId/AppSecret 与账套授权。' : 'K3Cloud 配置不完整。' }
      return res.status(status.connected ? 200 : 502).json({ status })
    }
    const status = dingtalkStatus(dingTalkConfig(scope))
    if (!status.configured) return res.status(409).json({ status: { ...status, ok: false } })
    const result = await sendMarkdown('Momentum 钉钉连接测试', '这是一条由工作区管理员主动触发的连接测试消息。', dingTalkConfig(scope))
    return res.status(result.ok ? 200 : 502).json({ status: { ...result, connected: result.ok } })
  })

  router.get('/integrations/status', async (req, res) => {
    const scope = scopeForRequest(req)
    await initializeCache()
    const flowable = await flowableHealth(flowableConfig(scope)), k3cloud = k3cloudStatus(k3Config(scope), internalScopeKey(scope)), dingtalk = dingtalkStatus(dingTalkConfig(scope)), schedules = schedulesFor(scope)
    return res.json({ cache: cacheHealth(), k3cloud, flowable, dingtalk, reporting: { configured: dingtalk.configured, schedules: schedules.length } })
  })
  router.get('/k3cloud/status', (req, res) => { const scope = scopeForRequest(req); return res.json(k3cloudStatus(k3Config(scope), internalScopeKey(scope))) })
  router.post('/k3cloud/query', requireRole('admin', 'plm_manager'), async (req, res) => {
    const scope = scopeForRequest(req), config = connectorCredentialConfig(scope, 'k3cloud')
    const body = record(req.body), input: K3CloudQueryInput = { formId: String(body.formId ?? ''), fieldKeys: String(body.fieldKeys ?? ''), filterString: typeof body.filterString === 'string' ? body.filterString : '', limit: Number(body.limit ?? 100), startRow: Number(body.startRow ?? 0), orderString: typeof body.orderString === 'string' ? body.orderString : undefined }
    const allowlist = record(config.formAllowlist), allowedFields = allowlist[input.formId]
    const requestedFields = input.fieldKeys.split(',').map(field => field.trim()).filter(Boolean)
    if (!Array.isArray(allowedFields) || !requestedFields.length || requestedFields.some(field => !(allowedFields as unknown[]).includes(field))) return res.status(403).json({ error: 'FormId/FieldKeys 不在当前账套服务端只读 allowlist 中。' })
    const sortParts = input.orderString?.split(',').map(part => part.trim()).filter(Boolean) ?? []
    const validSort = sortParts.every(part => { const match = /^([A-Za-z0-9_.]+)(?:\s+(ASC|DESC))?$/i.exec(part); return Boolean(match && (allowedFields as string[]).includes(match[1]!)) })
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200 || !Number.isInteger(input.startRow ?? 0) || (input.startRow ?? 0) < 0 || (input.filterString?.length ?? 0) > 500 || !validSort) return res.status(400).json({ error: '查询分页、过滤或排序字段超过只读接口限制。' })
    try { return res.json(await queryK3Cloud(input, config as Partial<K3CloudConfig>, internalScopeKey(scope))) }
    catch (error) { return res.status(k3cloudStatus(config as Partial<K3CloudConfig>, internalScopeKey(scope)).configured ? 502 : 503).json({ error: error instanceof Error ? error.message : 'K3Cloud query failed' }) }
  })

  router.get('/workflow/status', async (req, res) => {
    const scope = scopeForRequest(req), engine = await flowableHealth(flowableConfig(scope))
    return res.json({ mode: engine.connected ? 'flowable' : engine.configured ? 'unavailable' : 'demo', engine, demoTasks: workflowFor(scope).tasks.length, identityMappingConfigured: Object.keys(record(flowableConfig(scope).userMap)).length > 0 })
  })
  router.get('/workflow/audit', async (req, res) => {
    const scope = scopeForRequest(req), config = flowableConfig(scope), engine = await flowableHealth(config), audit = auditFor(scope)
    if (engine.configured && !engine.connected) return res.status(502).json({ error: 'Flowable is configured but unavailable; audit records were not substituted.' })
    if (engine.connected) { const actor = trustedActor(req, config); if (!actor) return res.status(403).json({ error: '可信用户身份未配置：无法查询流程审计记录。' }); return res.json({ mode: 'flowable', entries: audit.filter(entry => entry.mode === 'flowable' && entry.actor === actor).slice(0, 100) }) }
    return res.json({ mode: 'demo', entries: workflowFor(scope).audit.slice(0, 100) })
  })
  router.get('/workflow/tasks', async (req, res) => {
    const scope = scopeForRequest(req), config = flowableConfig(scope), engine = await flowableHealth(config)
    if (engine.configured && !engine.connected) return res.status(502).json({ error: 'Flowable is configured but unavailable; local demo tasks are not used as a fallback.', engine })
    if (engine.connected) {
      const actor = trustedActor(req, config)
      if (!actor) return res.status(403).json({ error: '可信用户身份未配置：请配置本账套的 Flowable 用户映射。' })
      try { const tenantId = flowableTenantId(scope), rows = await listTasksForActor(actor, tenantId, trustedCandidateGroups(config, actor), config); return res.json({ mode: 'flowable', engine, tasks: rows.map(publicFlowableTask) }) }
      catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Flowable task query failed' }) }
    }
    return res.json({ mode: 'demo', engine, tasks: workflowFor(scope).tasks.filter(task => task.status === 'pending') })
  })
  router.post('/workflow/demo-tasks', requireRole('admin', 'plm_manager'), async (req, res) => {
    const scope = scopeForRequest(req), config = flowableConfig(scope), engine = await flowableHealth(config)
    if (engine.configured) return res.status(409).json({ error: 'Flowable is configured; use the live process endpoint instead of creating a demo task.' })
    const body = record(req.body), title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '', businessType = String(body.businessType ?? ''), businessId = typeof body.businessId === 'string' ? body.businessId.trim().slice(0, 120) : ''
    if (!title || !businessId || !['material', 'bom', 'document', 'performance'].includes(businessType)) return res.status(400).json({ error: '演示流程需要有效标题、业务编号与业务类型。' })
    const previewSource = record(body.preview), preview = Object.fromEntries(Object.entries(previewSource).slice(0, 20).map(([key, value]) => [key.slice(0, 60), typeof value === 'string' ? value.slice(0, 400) : JSON.stringify(value).slice(0, 400)]))
    const task: DemoTask = { id: `demo-${nanoid()}`, title, businessType, businessId, requester: req.authUser?.displayName ?? '发起人', assignee: typeof body.assignee === 'string' ? body.assignee.slice(0, 100) : '审批人（演示）', createdAt: new Date().toISOString(), dueAt: typeof body.dueAt === 'string' ? body.dueAt.slice(0, 40) : '', status: 'pending', preview }
    const state = workflowFor(scope); state.tasks.unshift(task); persistWorkflow(scope, state)
    return res.status(201).json({ mode: 'demo', task })
  })
  router.get('/workflow/tasks/:id', async (req, res) => {
    const scope = scopeForRequest(req), id = String(req.params.id), state = workflowFor(scope), demo = state.tasks.find(task => task.id === id)
    if (demo) return res.json({ mode: 'demo', task: demo, audit: state.audit.filter(entry => entry.taskId === demo.id) })
    const config = flowableConfig(scope), engine = await flowableHealth(config)
    if (engine.configured && !engine.connected) return res.status(502).json({ error: 'Flowable is configured but unavailable.' })
    if (!engine.connected) return res.status(404).json({ error: 'task not found in demo or connected Flowable engine' })
    const actor = trustedActor(req, config)
    if (!actor) return res.status(403).json({ error: 'trusted user identity is required' })
    try {
      const task = await getTaskForActor(id, actor, flowableTenantId(scope), trustedCandidateGroups(config, actor), config)
      if (!task) return res.status(403).json({ error: 'task is not assigned or available to the authenticated user in this tenant, organization, and account scope' })
      return res.json({ mode: 'flowable', task, audit: auditFor(scope).filter(entry => entry.taskId === id && entry.actor === actor) })
    } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Flowable task query failed' }) }
  })
  router.post('/workflow/tasks/:id/complete', requireRole('admin', 'plm_manager', 'reviewer'), async (req, res) => {
    const scope = scopeForRequest(req), id = String(req.params.id), body = record(req.body), rawDecision = String(body.decision ?? ''), decision = rawDecision === 'approve' ? 'approved' : rawDecision === 'reject' ? 'rejected' : rawDecision, comment = typeof body.comment === 'string' ? body.comment.trim() : ''
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' })
    if (!comment || comment.length > 4000) return res.status(400).json({ error: '审批意见必填，且不得超过 4000 字符。' })
    const state = workflowFor(scope), demo = state.tasks.find(task => task.id === id)
    if (demo) {
      if (demo.status !== 'pending') return res.status(409).json({ error: '该演示任务已处理。' })
      const actor = req.authUser?.email ?? 'authenticated-user', approvedAt = new Date().toISOString()
      demo.status = decision as 'approved' | 'rejected'; demo.comment = comment; demo.decision = String(decision); demo.approvedBy = actor; demo.approvedAt = approvedAt
      state.audit.unshift({ id: nanoid(), taskId: demo.id, title: demo.title, businessType: demo.businessType, businessId: demo.businessId, actor, decision, comment, createdAt: approvedAt, mode: 'demo' }); persistWorkflow(scope, state)
      return res.json({ ok: true, mode: 'demo', task: demo, audit: state.audit.filter(entry => entry.taskId === demo.id) })
    }
    const config = flowableConfig(scope), engine = await flowableHealth(config)
    if (!engine.connected) return res.status(503).json({ error: 'Flowable is not connected; no live approval was submitted.' })
    const actor = trustedActor(req, config)
    if (!actor) return res.status(403).json({ error: 'Flowable approval requires a configured user mapping.' })
    try {
      const task = await getTaskForActor(id, actor, flowableTenantId(scope), trustedCandidateGroups(config, actor), config)
      if (!task) return res.status(403).json({ error: 'task is not assigned or available to the authenticated user in this tenant, organization, and account scope' })
      const result = await completeTask(id, { actor, decision: decision as 'approved' | 'rejected', comment }, config), audit = auditFor(scope)
      const entry: ApprovalAuditEntry = { id: nanoid(), taskId: id, title: String(task.name ?? 'Flowable 审批任务'), businessType: String(task.businessType ?? ''), businessId: String(task.businessKey ?? task.processInstanceId ?? ''), actor, decision: decision as 'approved' | 'rejected', comment, createdAt: new Date().toISOString(), mode: 'flowable' }
      audit.unshift(entry); persistAudit(scope, audit)
      return res.json({ ok: true, mode: 'flowable', result, audit: entry })
    } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Flowable task completion failed' }) }
  })
  router.post('/workflow/instances', requireRole('admin', 'plm_manager'), async (req, res) => {
    const scope = scopeForRequest(req), config = flowableConfig(scope), engine = await flowableHealth(config)
    if (!engine.connected) return res.status(503).json({ error: 'Flowable is not connected; no live process was started.' })
    const actor = trustedActor(req, config)
    if (!actor) return res.status(403).json({ error: 'starting a live process requires a configured tenant user identity mapping' })
    const body = record(req.body), processDefinitionKey = String(body.processDefinitionKey ?? ''), variablesIn = record(body.variables)
    if (!allowedProcessKeys.has(processDefinitionKey)) return res.status(400).json({ error: 'processDefinitionKey is not allowed' })
    const businessType = String(variablesIn.businessType ?? ''), expectedKeys: Record<string, string> = { material: 'materialApproval', bom: 'bomReleaseApproval', document: 'documentReleaseApproval', performance: 'performanceReviewApproval' }
    if (expectedKeys[businessType] !== processDefinitionKey) return res.status(400).json({ error: 'businessType and processDefinitionKey do not match' })
    if (![variablesIn.title, variablesIn.businessId, variablesIn.assignee].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'title, businessId and assignee are required to start a live approval process' })
    const configuredAssignees = Object.values(record(config.userMap)).filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim())
    if (!configuredAssignees.includes(String(variablesIn.assignee).trim())) return res.status(403).json({ error: 'The requested Flowable assignee is not mapped in this tenant, organization, and account scope.' })
    const allowedVariables = new Set(['businessType', 'businessId', 'title', 'assignee', 'approver', 'requester', 'previewUrl', 'changeSummary'])
    const variables = Object.entries(variablesIn).filter(([key, value]) => allowedVariables.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')).map(([name, value]) => ({ name, value }))
    variables.push({ name: 'initiator', value: actor })
    const businessKey = typeof body.businessKey === 'string' ? body.businessKey.slice(0, 160) : undefined
    try {
      const dingtalk = dingTalkConfig(scope), started = await startProcess(processDefinitionKey, variables, { ...(businessKey ? { businessKey } : {}), tenantId: flowableTenantId(scope) }, config), created = record(started), id = String(created.id ?? created.businessKey ?? businessKey ?? '')
      const previewUrl = buildApprovalPreviewUrl('/', { page: 'workflow', approval: id }, dingtalk.publicAppUrl)
      let notification = { ok: false, message: 'DingTalk webhook is not configured; no notification was sent.' }
      if (dingtalkStatus(dingtalk).configured) { const summary = String(variablesIn.title ?? '新的 PLM 审批待办').slice(0, 120), link = previewUrl ? `\n\n[点击查看业务预览并填写审批意见](${previewUrl})` : ''; notification = await sendMarkdown('PLM 审批待办', `### ${summary}\n\n业务编号：${String(variablesIn.businessId ?? businessKey ?? id)}${link}`, dingtalk) }
      return res.status(201).json({ mode: 'flowable', process: started, previewUrl, notification })
    } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Flowable process start failed' }) }
  })

  router.post('/dingtalk/cards/callback', async (req, res) => {
    const input = record(req.body), corpId = String(input.corpId ?? ''), userId = String(input.userId ?? '')
    const content = typeof input.content === 'string' ? (() => { try { return JSON.parse(input.content) as unknown } catch { return null } })() : input.content
    const action = parseCardApprovalAction({ content })
    if (!action) return res.status(400).json({ error: 'unsupported card action' })
    const cardContent = record(content), privateData = record(cardContent.cardPrivateData), params = record(privateData.params), taskId = String(params.taskId ?? input.outTrackId ?? ''), comment = typeof params.comment === 'string' ? params.comment.trim() : ''
    if (!taskId) return res.status(400).json({ error: 'Flowable task ID is required.' })
    if (!comment) return res.status(422).json({ error: '请在审批详情页填写意见后再提交；此卡片操作未推进流程。' })
    const matches: Array<{ scope: WorkspaceScope; flow: FlowableConfig; actor: string; task: Record<string, unknown> }> = []
    for (const candidate of listConnectorConfigs('dingtalk')) {
      const cfg = candidate.config as unknown as DingTalkConfig
      if (!corpId || String(cfg.corpId ?? '') !== corpId || !verifyCardCallbackSignature(req.headers, cfg.cardCallbackSecret || cfg.appSecret)) continue
      const mappings = record(cfg.userMapping), mapped = mappings[`${corpId}:${userId}`]
      if (typeof mapped !== 'string' || !mapped) continue
      const flow = flowableConfig(candidate.scope)
      try {
        const task = await getTaskForActor(taskId, mapped, flowableTenantId(candidate.scope), trustedCandidateGroups(flow, mapped), flow)
        if (task) matches.push({ scope: candidate.scope, flow, actor: mapped, task })
      } catch { /* Try other configured enterprise accounts; only exact tenant and mapped assignee/candidate matches may proceed. */ }
    }
    if (matches.length !== 1) return res.status(matches.length ? 409 : 403).json({ error: matches.length ? 'DingTalk callback matched multiple configured accounts; no approval was submitted.' : 'DingTalk identity, signature, task tenant, or candidate mapping is not authorized.' })
    const match = matches[0]!
    try {
      const decision = action === 'approve' ? 'approved' : 'rejected'
      const result = await completeTask(taskId, { actor: match.actor, decision, comment }, match.flow)
      const audit = auditFor(match.scope), entry: ApprovalAuditEntry = { id: nanoid(), taskId, title: String(match.task.name ?? 'Flowable 审批任务'), businessType: String(match.task.businessType ?? ''), businessId: String(match.task.businessKey ?? match.task.processInstanceId ?? ''), actor: match.actor, decision, comment, createdAt: new Date().toISOString(), mode: 'flowable' }
      audit.unshift(entry); persistAudit(match.scope, audit)
      return res.json({ ok: true, status: decision, result })
    } catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Flowable task completion failed' }) }
  })

  router.get('/reports/preview', async (req, res) => {
    const scope = scopeForRequest(req), report = reportForScope(scope)
    return res.json({ title: 'PLM 工作区报告', generatedAt: report.summary.generatedAt, summary: report.summary, text: report.markdown, channelStatus: dingtalkStatus(dingTalkConfig(scope)), previewOnly: true })
  })
  router.get('/reports/schedules', (req, res) => {
    const scope = scopeForRequest(req), schedules = schedulesFor(scope)
    return res.json({ schedules: schedules.map(schedule => scheduleStatus(scope, schedule)), deliveryConfigured: dingtalkStatus(dingTalkConfig(scope)).configured })
  })
  router.post('/reports/send', requireRole('admin'), async (req, res) => {
    const scope = scopeForRequest(req), connector = dingTalkConfig(scope)
    if (!dingtalkStatus(connector).configured) return res.status(503).json({ error: '钉钉机器人未配置；报告只生成预览，没有发送。' })
    const report = reportForScope(scope), preview = buildApprovalPreviewUrl('/?page=reports', {}, connector.publicAppUrl), content = `${report.markdown}${preview ? `\n\n[打开报告预览](${preview})` : ''}`
    const result = await sendMarkdown('PLM 工作区报告', content, connector)
    return res.status(result.ok ? 200 : 502).json({ ...result, generatedAt: report.summary.generatedAt })
  })
  router.post('/reports/schedules', requireRole('admin'), (req, res) => {
    const scope = scopeForRequest(req), body = record(req.body), name = typeof body.name === 'string' ? body.name.trim() : '', cadence = body.cadence, time = typeof body.time === 'string' ? body.time : '', timezone = Object.hasOwn(body, 'timezone') ? body.timezone : 'Asia/Shanghai', rawDay = Object.hasOwn(body, 'dayOfWeek') ? body.dayOfWeek : 1, dayOfWeek = typeof rawDay === 'number' ? rawDay : typeof rawDay === 'string' && /^[0-6]$/.test(rawDay) ? Number(rawDay) : Number.NaN, enabled = Object.hasOwn(body, 'enabled') ? body.enabled : false
    if (!name || name.length > 80 || !['daily', 'weekly'].includes(String(cadence)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || typeof timezone !== 'string' || timezone.length > 64 || !validateTimezone(timezone) || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || typeof enabled !== 'boolean') return res.status(400).json({ error: '计划名称、频率、时间、时区、启停或星期参数无效。' })
    if (enabled && !dingtalkStatus(dingTalkConfig(scope)).configured) return res.status(409).json({ error: '钉钉机器人未配置。可先保存为停用计划，配置 Webhook 后再启用。' })
    const now = new Date().toISOString(), schedule: ReportSchedule = { id: nanoid(), name, cadence: cadence as Cadence, time, ...(cadence === 'weekly' ? { dayOfWeek } : {}), timezone, enabled, createdAt: now, updatedAt: now }, schedules = schedulesFor(scope)
    schedules.unshift(schedule); persistSchedules(scope, schedules); installCron(scope, schedule)
    return res.status(201).json(scheduleStatus(scope, schedule))
  })
  router.patch('/reports/schedules/:id', requireRole('admin'), (req, res) => {
    const scope = scopeForRequest(req), schedules = schedulesFor(scope), schedule = schedules.find(item => item.id === String(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'schedule not found' })
    const body = record(req.body), rawName = Object.hasOwn(body, 'name') ? body.name : schedule.name, cadence = Object.hasOwn(body, 'cadence') ? body.cadence : schedule.cadence, time = Object.hasOwn(body, 'time') ? body.time : schedule.time, timezone = Object.hasOwn(body, 'timezone') ? body.timezone : schedule.timezone, rawDay = Object.hasOwn(body, 'dayOfWeek') ? body.dayOfWeek : schedule.dayOfWeek ?? 1, dayOfWeek = typeof rawDay === 'number' ? rawDay : typeof rawDay === 'string' && /^[0-6]$/.test(rawDay) ? Number(rawDay) : Number.NaN, enabled = Object.hasOwn(body, 'enabled') ? body.enabled : schedule.enabled
    if (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 80 || !['daily', 'weekly'].includes(String(cadence)) || typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || typeof timezone !== 'string' || timezone.length > 64 || !validateTimezone(timezone) || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || typeof enabled !== 'boolean') return res.status(400).json({ error: '计划参数无效。' })
    const next: ReportSchedule = { ...schedule, name: rawName.trim(), cadence: cadence as Cadence, time, timezone, enabled, ...(cadence === 'weekly' ? { dayOfWeek } : {}) }
    if (cadence === 'daily') delete next.dayOfWeek
    if (next.enabled && !schedule.enabled && !dingtalkStatus(dingTalkConfig(scope)).configured) return res.status(409).json({ error: '钉钉机器人未配置；计划没有启用。' })
    Object.assign(schedule, next, { updatedAt: new Date().toISOString() }); persistSchedules(scope, schedules); installCron(scope, schedule)
    return res.json(scheduleStatus(scope, schedule))
  })
  router.delete('/reports/schedules/:id', requireRole('admin'), (req, res) => {
    const scope = scopeForRequest(req), schedules = schedulesFor(scope), id = String(req.params.id), index = schedules.findIndex(item => item.id === id)
    if (index < 0) return res.status(404).json({ error: 'schedule not found' })
    clearCron(scope, id); schedules.splice(index, 1); persistSchedules(scope, schedules)
    return res.status(204).end()
  })
  router.post('/reports/schedules/:id/run', requireRole('admin'), async (req, res) => {
    const scope = scopeForRequest(req), schedule = schedulesFor(scope).find(item => item.id === String(req.params.id))
    if (!schedule) return res.status(404).json({ error: 'schedule not found' })
    const result = await runScheduleDelivery(scope, schedule, false)
    if (result.status === 'blocked-missing-webhook') return res.status(503).json(result)
    if (result.status === 'already-running' || result.status === 'duplicate') return res.status(409).json(result)
    return res.status(result.ok ? 200 : 502).json(result)
  })

  // Re-arm only enabled schedules belonging to active account scopes after process restart.
  for (const scope of activeScopes()) installAllCron(scope)
  return router
}

export function stopIntegrationServices(): void { for (const task of activeCron.values()) task.stop(); activeCron.clear() }
