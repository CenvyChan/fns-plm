import { createHash } from 'node:crypto'
import { db } from './database.js'
import { validateGeneratedBpmnXml } from './bpmn-xml.js'
import { parseFlowableFormKey } from './form-binding.js'
import { resolveFlowableIdentity, publishedTaskAssignmentAllowed } from './flowable-identity.js'
import { connectorCredentialConfig } from './integrations/configuration.js'
import { getTaskForActor, type FlowableConfig } from './integrations/flowable.js'
import type { FormTaskAdapter } from './forms.js'
import type { WorkspaceScope } from './scope.js'

const tenantFor = (s: WorkspaceScope) => `tenant:${s.tenantId}:organization:${s.organizationId}:account:${s.accountId}`
/** Only server-published safe definitions can supply a PLM form binding. Engine formKey alone is not authority. */
export function verifiedTaskFormBinding(scope: WorkspaceScope, task: Record<string, unknown>) {
  const binding = parseFlowableFormKey(task.formKey)
  if (!binding || String(task.tenantId ?? '') !== tenantFor(scope) || !task.processInstanceId || !task.taskDefinitionKey || !task.processDefinitionId) return null
  const version = db.prepare(`SELECT v.graph,v.xml,v.sha256 FROM bpmn_publish p JOIN bpmn_versions v ON v.id=p.version_id AND v.model_id=p.model_id AND v.tenant_id=p.tenant_id AND v.organization_id=p.organization_id AND v.account_id=p.account_id WHERE p.tenant_id=? AND p.organization_id=? AND p.account_id=? AND p.status='published' AND p.definition_id=?`).get(scope.tenantId, scope.organizationId, scope.accountId, String(task.processDefinitionId)) as {graph:string;xml:string;sha256:string} | undefined
  if (!version || createHash('sha256').update(version.xml).digest('hex') !== version.sha256 || validateGeneratedBpmnXml(version.xml).length) return null
  try {
    const graph = JSON.parse(version.graph) as {nodes?: Array<Record<string, unknown>>}
    const node = graph.nodes?.find(n => n.type === 'userTask' && n.id === task.taskDefinitionKey)
    const pinned = node?.formBinding as {formKey?:unknown;formVersion?:unknown} | undefined
    if (!pinned || pinned.formKey !== binding.formKey || pinned.formVersion !== binding.formVersion) return null
    if (!db.prepare('SELECT 1 FROM form_versions WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? AND version=?').get(scope.tenantId,scope.organizationId,scope.accountId,binding.formKey,binding.formVersion)) return null
    return binding
  } catch { return null }
}

export const flowableFormTaskAdapter: FormTaskAdapter = {
  async resolve(input) {
    const { scope, actorId, taskId, formKey, formVersion } = input
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(taskId)) return null
    const identity = resolveFlowableIdentity(scope, actorId)
    const config = connectorCredentialConfig(scope, 'flowable') as unknown as FlowableConfig
    const task = await getTaskForActor(taskId, identity.actor, tenantFor(scope), identity.groups, config)
    if (!task || !publishedTaskAssignmentAllowed(scope, actorId, task)) return null
    const binding = verifiedTaskFormBinding(scope, task)
    if (!binding || binding.formKey !== formKey || binding.formVersion !== formVersion) return null
    // A membership may have changed while awaiting the engine. Recheck before accepting data.
    const current = resolveFlowableIdentity(scope, actorId)
    if (current.actor !== identity.actor || JSON.stringify(current.groups) !== JSON.stringify(identity.groups)) return null
    return { tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId, actorId, formKey, formVersion, taskId, processInstanceId: String(task.processInstanceId) }
  },
}

/** Completion is a separate approval operation, but must not bypass a task's required pinned form. */
export function taskFormSubmissionReady(scope: WorkspaceScope, actorId: string, task: Record<string, unknown>): boolean {
  if (!task.formKey) return true
  const binding = verifiedTaskFormBinding(scope, task)
  if (!binding) return false
  return Boolean(db.prepare(`SELECT 1 FROM form_submissions WHERE tenant_id=? AND organization_id=? AND account_id=? AND actor_id=? AND task_id=? AND process_instance_id=? AND form_key=? AND form_version=?`).get(scope.tenantId,scope.organizationId,scope.accountId,actorId,String(task.id),String(task.processInstanceId),binding.formKey,binding.formVersion))
}
