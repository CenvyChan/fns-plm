import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type FlowableStatus = { connected: boolean; configured: boolean; message: string }
export type ApprovalDecision = 'approved' | 'rejected'
export type FlowableConfig = { baseUrl: string; username?: string; password?: string; timeoutMs?: number; userMap?: Record<string, unknown> }
type JsonRecord = Record<string, unknown>

const moduleDir = dirname(fileURLToPath(import.meta.url))
const bpmnPath = resolve(moduleDir, '../../workflow/processes/plm-approvals.bpmn20.xml')
const processKeys = ['materialApproval', 'bomReleaseApproval', 'documentReleaseApproval', 'performanceReviewApproval'] as const
const tenantDeployments = new Map<string, Promise<void>>()

function normalizeConfig(input?: FlowableConfig): FlowableConfig | null {
  const baseUrl = input?.baseUrl?.trim()
  if (!baseUrl) return null
  let parsed: URL
  try { parsed = new URL(baseUrl) } catch { throw new Error('Flowable baseUrl is invalid.') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Flowable baseUrl must be a clean HTTP(S) URL without embedded credentials, query or fragment.')
  const username = input?.username
  const password = input?.password
  if (!username || !password) throw new Error('Flowable Basic Auth username and password must both be configured.')
  const rawTimeout = Number(input?.timeoutMs ?? process.env.FLOWABLE_TIMEOUT_MS ?? 10000)
  return { baseUrl: parsed.toString().replace(/\/$/, ''), username, password, timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(rawTimeout, 120000) : 10000 }
}

export function getFlowableStatus(input?: FlowableConfig): FlowableStatus {
  try { return normalizeConfig(input) ? { connected: false, configured: true, message: 'Configured; connectivity has not been checked.' } : { connected: false, configured: false, message: 'Flowable base URL and Basic Auth credentials are not configured.' } }
  catch { return { connected: false, configured: false, message: 'Flowable connection settings are invalid or incomplete.' } }
}
export const flowableStatus = getFlowableStatus

function safeConfig(input?: FlowableConfig): FlowableConfig | null { try { return normalizeConfig(input) } catch { return null } }
function requireConfig(input?: FlowableConfig): FlowableConfig { const cfg = safeConfig(input); if (!cfg) throw new Error(getFlowableStatus(input).message); return cfg }
function apiPath(path: string): string {
  const queryAt = path.indexOf('?')
  const pathname = queryAt >= 0 ? path.slice(0, queryAt) : path
  const query = queryAt >= 0 ? path.slice(queryAt) : ''
  const encoded = pathname.split('/').map((part, index) => index ? encodeURIComponent(decodeURIComponent(part)) : part).join('/')
  return `${encoded}${query}`
}

async function responseData(response: Response): Promise<unknown> {
  const text = await response.text()
  let data: unknown = null
  if (text) { try { data = JSON.parse(text) } catch { throw new Error(`Flowable returned invalid JSON (HTTP ${response.status}).`) } }
  if (!response.ok) throw new Error(`Flowable request failed (HTTP ${response.status}).`)
  return data
}

function authHeaders(cfg: FlowableConfig): Record<string, string> {
  return { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${cfg.username ?? ''}:${cfg.password ?? ''}`).toString('base64')}` }
}

async function request(cfg: FlowableConfig, method: string, path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000)
  const headers = authHeaders(cfg)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try { return await responseData(await fetch(`${cfg.baseUrl}${apiPath(path)}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal })) }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Flowable request timed out.')
    if (error instanceof Error && /Flowable/.test(error.message)) throw error
    throw new Error('Flowable request failed due to a network error.')
  } finally { clearTimeout(timer) }
}

async function deployTenantDefinitions(cfg: FlowableConfig, tenantId: string): Promise<void> {
  if (!tenantId || tenantId.length > 160) throw new Error('A valid Flowable tenantId is required.')
  const deployKey = `${cfg.baseUrl}\u0000${tenantId}`
  const existing = tenantDeployments.get(deployKey)
  if (existing) return existing
  const deployment = (async () => {
    const query = new URLSearchParams({ tenantId, size: '100' })
    const definitions = await request(cfg, 'GET', `/repository/process-definitions?${query}`) as { data?: unknown[] }
    const present = new Set((Array.isArray(definitions?.data) ? definitions.data : []).map(value => String((value as JsonRecord)?.key ?? '')))
    if (processKeys.every(key => present.has(key))) return
    let xml: Buffer
    try { xml = await readFile(bpmnPath) } catch { throw new Error('PLM BPMN source file is missing from this server release.') }
    const form = new FormData()
    form.append('file', new Blob([xml], { type: 'application/xml' }), 'plm-approvals.bpmn20.xml')
    form.append('tenantId', tenantId)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000)
    try {
      const response = await fetch(`${cfg.baseUrl}/repository/deployments`, { method: 'POST', headers: authHeaders(cfg), body: form, signal: controller.signal })
      await responseData(response)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('Flowable BPMN tenant deployment timed out.')
      if (error instanceof Error && /Flowable/.test(error.message)) throw error
      throw new Error('Flowable BPMN tenant deployment failed due to a network error.')
    } finally { clearTimeout(timer) }
    const verified = await request(cfg, 'GET', `/repository/process-definitions?${query}`) as { data?: unknown[] }
    const deployed = new Set((Array.isArray(verified?.data) ? verified.data : []).map(value => String((value as JsonRecord)?.key ?? '')))
    if (!processKeys.every(key => deployed.has(key))) throw new Error('Flowable BPMN tenant deployment did not contain every required PLM approval definition.')
  })()
  tenantDeployments.set(deployKey, deployment)
  try { await deployment } catch (error) { tenantDeployments.delete(deployKey); throw error }
}

export async function health(input?: FlowableConfig): Promise<FlowableStatus> {
  const cfg = safeConfig(input)
  if (!cfg) return getFlowableStatus(input)
  try { await request(cfg, 'GET', '/runtime/tasks?size=1'); return { connected: true, configured: true, message: 'Flowable is reachable.' } }
  catch { return { connected: false, configured: true, message: 'Flowable is configured but unavailable or rejected the service credentials.' } }
}
export const flowableHealth = health

export async function listTasks(query: Record<string, string | number | boolean> = {}, input?: FlowableConfig): Promise<unknown> {
  const cfg = requireConfig(input), params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  return request(cfg, 'GET', `/runtime/tasks${params.size ? `?${params}` : ''}`)
}

export async function getTask(taskId: string, input?: FlowableConfig): Promise<unknown> {
  if (!taskId.trim()) throw new Error('taskId is required')
  return request(requireConfig(input), 'GET', `/runtime/tasks/${encodeURIComponent(taskId)}`)
}

export async function startProcess(processDefinitionKey: string, variables: Array<{ name: string; value: unknown }> = [], options: Record<string, unknown> = {}, input?: FlowableConfig): Promise<unknown> {
  if (!processKeys.includes(processDefinitionKey as typeof processKeys[number])) throw new Error('processDefinitionKey is not an approved PLM process.')
  const cfg = requireConfig(input)
  const tenantId = typeof options.tenantId === 'string' ? options.tenantId : ''
  if (!tenantId) throw new Error('tenantId is required to start a PLM approval process.')
  await deployTenantDefinitions(cfg, tenantId)
  return request(cfg, 'POST', '/runtime/process-instances', { ...options, processDefinitionKey, tenantId, variables })
}

export async function completeTask(taskId: string, input: { actor: string; decision: ApprovalDecision; comment: string }, connection?: FlowableConfig): Promise<unknown> {
  if (!taskId.trim()) throw new Error('taskId is required')
  const actor = input.actor.trim(), comment = input.comment.trim()
  if (!actor || !comment || !['approved', 'rejected'].includes(input.decision)) throw new Error('actor, comment, and a valid decision are required')
  const cfg = requireConfig(connection), decisionText = input.decision === 'approved' ? '同意' : '驳回'
  const message = `actor: ${actor}\ndecision: ${decisionText} (${input.decision})\ncomment: ${comment}`
  await request(cfg, 'POST', `/runtime/tasks/${encodeURIComponent(taskId)}/comments`, { message })
  const variables = [
    { name: 'approvalDecision', value: input.decision }, { name: 'approvalComment', value: comment },
    { name: 'approvedBy', value: actor }, { name: 'approvedAt', value: new Date().toISOString() },
  ]
  return request(cfg, 'POST', `/runtime/tasks/${encodeURIComponent(taskId)}`, { action: 'complete', variables })
}
