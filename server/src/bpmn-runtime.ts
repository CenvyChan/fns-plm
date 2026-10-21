import { Router, type Request } from 'express'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import { SaxesParser } from 'saxes'
import { db } from './database.js'
import { engineReleaseBlocked, validateGeneratedBpmnXml } from './bpmn-xml.js'
import { flowableHealth, startProcessDefinition, type FlowableConfig } from './integrations/flowable.js'
import { connectorCredentialConfig } from './integrations/configuration.js'
import { resolveFlowableIdentity, resolveFlowableRoleGroup } from './flowable-identity.js'
import type { WorkspaceScope } from './scope.js'

// Independent router; mount at /bpmn-models. Do not accept a process key, XML, assignments,
// Flowable user/group IDs, or deployment parameters from the request.
const init = db.transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS bpmn_runtime_starts (
    idempotency_key TEXT NOT NULL, tenant_id TEXT NOT NULL, organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('starting','started','uncertain')),
    process_instance_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,organization_id,account_id,actor_id,idempotency_key)
  )`)
})
init()

function scopeOf(req: Request): WorkspaceScope {
  const u = req.authUser
  if (!u) throw new Error('Verified tenant scope is missing.')
  return { tenantId: u.tenantId, tenantName: u.tenantName, organizationId: u.organizationId,
    organizationName: u.organizationName, accountId: u.accountId, accountName: u.accountName,
    role: u.role, isPlatformAdmin: u.isPlatformAdmin }
}
function configOf(scope: WorkspaceScope): FlowableConfig {
  return connectorCredentialConfig(scope, 'flowable') as unknown as FlowableConfig
}
function str(value: unknown): string { return typeof value === 'string' ? value : '' }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function createBpmnRuntimeRouter(): Router {
  const router = Router()
  router.post('/:id/start', async (req, res) => {
    const user = req.authUser
    if (!user) return res.status(401).json({ error: 'authentication_required' })
    if (!['admin', 'plm_manager'].includes(user.role)) return res.status(403).json({ error: 'role_forbidden' })
    const scope = scopeOf(req), cfg = configOf(scope)
    if (engineReleaseBlocked(cfg)) return res.status(503).json({ error: 'custom_bpmn_runtime_release_blocked' })

    const modelId = str(req.params.id), body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {}
    const idempotencyKey = str(req.get('Idempotency-Key') ?? body.idempotencyKey).trim()
    if (!modelId || modelId.length > 160 || !/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey))
      return res.status(400).json({ error: 'model_id_and_idempotency_key_required' })
    // Reject all caller-controlled execution/identity fields. Only business context scalars pass.
    const allowed = new Set(['title', 'businessId', 'businessType', 'changeSummary'])
    if (Object.keys(body).some(k => !allowed.has(k) && !['idempotencyKey','expectedVersionId'].includes(k))) return res.status(400).json({ error: 'unsupported_start_field' })
    const expectedVersionId = body.expectedVersionId
    if (expectedVersionId !== undefined && (typeof expectedVersionId !== 'string' || !expectedVersionId.trim() || expectedVersionId.length > 160)) return res.status(400).json({ error: 'invalid_expected_version_id' })
    const input = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)))
    if (Object.entries(input).some(([k, v]) => typeof v !== 'string' || !(v as string).trim() || (v as string).length > (k === 'changeSummary' ? 4000 : 240)))
      return res.status(400).json({ error: 'invalid_business_context' })
    const vars: Record<string, unknown> = { ...input, requester: user.displayName }
    const requestHash = createHash('sha256').update(stable({ modelId, vars })).digest('hex')
    const prior = db.prepare(`SELECT request_hash AS requestHash,state,process_instance_id AS processInstanceId FROM bpmn_runtime_starts
      WHERE tenant_id=? AND organization_id=? AND account_id=? AND actor_id=? AND idempotency_key=?`)
      .get(scope.tenantId, scope.organizationId, scope.accountId, user.id, idempotencyKey) as { requestHash: string; state: string; processInstanceId?: string } | undefined
    if (prior) {
      if (prior.requestHash !== requestHash) return res.status(409).json({ error: 'idempotency_key_reused_with_different_request' })
      if (prior.state === 'started') return res.status(200).json({ processInstanceId: prior.processInstanceId, replayed: true })
      return res.status(409).json({ error: 'start_outcome_uncertain_no_retry', state: prior.state })
    }

    // Join through all three exact scope dimensions and require a successfully published immutable version.
    const published = db.prepare(`SELECT m.id AS modelId,m.key AS modelKey,m.name AS modelName,v.id AS versionId,v.xml,v.sha256,v.graph,
        p.definition_id AS definitionId,p.deployment_id AS deploymentId
      FROM bpmn_models m JOIN bpmn_versions v ON v.model_id=m.id
      JOIN bpmn_publish p ON p.model_id=m.id AND p.version_id=v.id AND p.status='published'
      WHERE m.id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?
        AND v.tenant_id=? AND v.organization_id=? AND v.account_id=?
        AND p.tenant_id=? AND p.organization_id=? AND p.account_id=?
      ORDER BY v.version DESC LIMIT 1`)
      .get(modelId, scope.tenantId, scope.organizationId, scope.accountId,
        scope.tenantId, scope.organizationId, scope.accountId, scope.tenantId, scope.organizationId, scope.accountId) as
      { modelId: string; modelKey: string; modelName: string; versionId: string; xml: string; sha256: string; graph: string; definitionId: string | null; deploymentId: string | null } | undefined
    if (!published || !published.definitionId || !published.deploymentId) return res.status(404).json({ error: 'published_model_not_found_in_scope' })
    if (expectedVersionId !== undefined && expectedVersionId !== published.versionId) return res.status(409).json({ error: 'published_version_changed', message: 'Published BPMN version changed; refresh context and confirm again.' })
    const engine = await flowableHealth(cfg)
    if (!engine.connected) return res.status(503).json({ error: 'flowable_unavailable_no_process_started' })
    const digest = createHash('sha256').update(published.xml, 'utf8').digest('hex')
    if (digest !== published.sha256 || validateGeneratedBpmnXml(published.xml).length) return res.status(409).json({ error: 'published_version_integrity_or_safe_subset_failed' })
    try {
      const graph = JSON.parse(published.graph) as Record<string, unknown>
      if (graph.key !== published.modelKey || !Array.isArray(graph.nodes)) return res.status(409).json({ error: 'published_graph_binding_mismatch' })
      const xmlTasks = new Map<string, Record<string,string>>()
      const parser = new SaxesParser({xmlns:false})
      parser.on('opentag',tag=>{ if(tag.name==='userTask') xmlTasks.set(String(tag.attributes.id), tag.attributes as Record<string,string>) })
      parser.write(published.xml).close()
      for (const node of graph.nodes as Array<Record<string, unknown>>) {
        if (node?.type !== 'userTask') continue
        const assignment = node.assignment as Record<string, unknown> | undefined
        if (!assignment || typeof assignment !== 'object') return res.status(409).json({ error: 'published_assignment_invalid' })
        if (assignment.kind === 'candidateRole') {
          const role = str(assignment.role), group = resolveFlowableRoleGroup(scope, role)
          // The immutable graph intentionally contains the logical role, while the publisher
          // resolves the scoped group into XML. Verify that published XML contains that exact ID.
          if (xmlTasks.get(str(node.id))?.['flowable:candidateGroups'] !== group) return res.status(409).json({ error: 'published_assignment_invalid' })
          const active = db.prepare(`SELECT 1 FROM tenant_memberships m JOIN users u ON u.id=m.user_id JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id JOIN tenants t ON t.id=m.tenant_id JOIN organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.role=? AND m.disabled=0 AND u.disabled=0 AND a.status='active' AND t.status='active' AND o.status='active' LIMIT 1`).get(scope.tenantId, scope.organizationId, scope.accountId, role)
          if (!active) return res.status(409).json({ error: 'published_assignment_membership_expired' })
        } else {
          const ids = assignment.userIds
          if (!['assignee','candidateUsers'].includes(str(assignment.kind)) || !Array.isArray(ids) || !ids.length) return res.status(409).json({ error: 'published_assignment_invalid' })
          let actors: string[]
          try { actors = ids.map(id=>resolveFlowableIdentity(scope, String(id)).actor) }
          catch { return res.status(409).json({ error: 'published_assignment_membership_expired' }) }
          const attribute = assignment.kind === 'assignee' ? 'flowable:assignee' : 'flowable:candidateUsers'
          if (xmlTasks.get(str(node.id))?.[attribute] !== actors.join(',')) return res.status(409).json({ error: 'published_assignment_invalid_republish_required' })
        }
      }
    } catch { return res.status(409).json({ error: 'published_graph_invalid' }) }

    let identity: { actor: string; groups: string[] }
    try { identity = await resolveFlowableIdentity(scope, user.id) }
    catch { return res.status(403).json({ error: 'current_scope_flowable_membership_required' }) }
    if (!identity || typeof identity.actor !== 'string' || !identity.actor.trim() || !Array.isArray(identity.groups))
      return res.status(403).json({ error: 'current_scope_flowable_membership_required' })
    vars.initiator = identity.actor

    const now = new Date().toISOString()
    try {
      db.prepare(`INSERT INTO bpmn_runtime_starts VALUES(?,?,?,?,?,?, 'starting',NULL,?,?)`)
        .run(idempotencyKey, scope.tenantId, scope.organizationId, scope.accountId, user.id, requestHash, now, now)
    } catch { return res.status(409).json({ error: 'start_already_in_progress_or_recorded' }) }
    try {
      const started = await startProcessDefinition(published.definitionId, Object.entries(vars).map(([name, value]) => ({ name, value })),
        { tenantId: flowableTenantId(scope), expectedDefinition: { deploymentId: published.deploymentId, key: published.modelKey }, businessKey: `custom:${modelId}:${idempotencyKey}` }, cfg)
      const response = started as Record<string, unknown>
      const processInstanceId = str(response?.id)
      if (!processInstanceId) throw new Error('Flowable start response omitted process instance id; outcome uncertain.')
      if ((response.tenantId !== undefined && str(response.tenantId) !== flowableTenantId(scope)) ||
          (response.processDefinitionId !== undefined && str(response.processDefinitionId) !== published.definitionId))
        throw new Error('Flowable start response scope or definition mismatch; outcome uncertain.')
      db.prepare(`UPDATE bpmn_runtime_starts SET state='started',process_instance_id=?,updated_at=? WHERE tenant_id=? AND organization_id=? AND account_id=? AND actor_id=? AND idempotency_key=?`)
        .run(processInstanceId, new Date().toISOString(), scope.tenantId, scope.organizationId, scope.accountId, user.id, idempotencyKey)
      return res.status(201).json({ processInstanceId, processDefinitionId: published.definitionId, modelId, versionId: published.versionId })
    } catch (error) {
      db.prepare(`UPDATE bpmn_runtime_starts SET state='uncertain',updated_at=? WHERE tenant_id=? AND organization_id=? AND account_id=? AND actor_id=? AND idempotency_key=?`)
        .run(new Date().toISOString(), scope.tenantId, scope.organizationId, scope.accountId, user.id, idempotencyKey)
      return res.status(502).json({ error: 'flowable_start_outcome_uncertain_no_retry', detail: error instanceof Error ? error.message : 'Flowable start failed' })
    }
  })
  return router
}

function flowableTenantId(scope: WorkspaceScope): string { return `tenant:${scope.tenantId}:organization:${scope.organizationId}:account:${scope.accountId}` }
