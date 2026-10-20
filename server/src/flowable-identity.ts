import { createHash } from 'node:crypto'
import { db } from './database.js'
import type { WorkspaceScope } from './scope.js'

export type FlowableIdentity = { actor: string; groups: string[] }
const roles = new Set(['admin', 'plm_manager', 'reviewer', 'member'])
export function resolveFlowableRoleGroup(scope: WorkspaceScope, role: string): string {
  if (!scope || !safePart(scope.tenantId) || !safePart(scope.organizationId) || !safePart(scope.accountId) || !roles.has(role))
    throw new Error('invalid Flowable role group scope or role')
  const scopeToken = digest(JSON.stringify([scope.tenantId, scope.organizationId, scope.accountId]))
  return `plm_${scopeToken}_r_${role}`
}
const safePart = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)

/** Deterministic, non-reversible Flowable identity scoped to tenant + organization + account.
 * No remote IAM user/group provisioning is performed; candidate labels are plain Flowable IDs.
 */
export function resolveFlowableIdentity(scope: WorkspaceScope, actorId: string): FlowableIdentity {
  if (!scope || !safePart(scope.tenantId) || !safePart(scope.organizationId) || !safePart(scope.accountId) || !safePart(actorId))
    throw new Error('invalid Flowable identity scope or actor')
  const membership = db.prepare(`SELECT m.role FROM tenant_memberships m
    JOIN users u ON u.id=m.user_id
    JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id
    JOIN tenants t ON t.id=m.tenant_id
    JOIN organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id
    WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?
      AND m.disabled=0 AND u.disabled=0 AND a.status='active' AND t.status='active' AND o.status='active'`).get(
    actorId, scope.tenantId, scope.organizationId, scope.accountId,
  ) as { role: string } | undefined
  if (!membership) throw new Error('actor is not an active member in this Flowable scope')
  const actor = `plm_${digest(JSON.stringify([scope.tenantId, scope.organizationId, scope.accountId]))}_u_${digest(actorId)}`
  const groups = [resolveFlowableRoleGroup(scope, membership.role)]
  return { actor, groups }
}

/** UI/API selects a PLM member, never an arbitrary engine identity. */
export function resolveFlowableMemberReference(scope: WorkspaceScope, reference: string): FlowableIdentity & {actorId:string;role:string} {
  if (!safePart(reference)) throw new Error('invalid PLM member reference')
  const members = db.prepare(`SELECT u.id,u.email,m.role FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? AND m.disabled=0 AND u.disabled=0`).all(scope.tenantId,scope.organizationId,scope.accountId) as Array<{id:string;email:string;role:string}>
  const matches = members.filter(m => m.id === reference || m.email === reference || resolveFlowableIdentity(scope,m.id).actor === reference)
  if (matches.length !== 1) throw new Error('PLM assignee is not a unique active scoped member')
  const member = matches[0]!
  return {...resolveFlowableIdentity(scope,member.id),actorId:member.id,role:member.role}
}

/** Re-check the immutable published assignment for a task already claimed by an actor.
 * Engine-native/legacy definitions without a matching PLM publish record remain governed by
 * the caller's normal Flowable authorization path.
 */
export function publishedTaskAssignmentAllowed(scope: WorkspaceScope, actorId: string, task: Record<string, unknown>): boolean {
  if (!scope || !safePart(scope.tenantId) || !safePart(scope.organizationId) || !safePart(scope.accountId) || !safePart(actorId)) return false
  const key = task.taskDefinitionKey
  if (!safePart(key)) return true
  const row = db.prepare(`SELECT v.graph FROM bpmn_publish p
    JOIN bpmn_versions v ON v.id=p.version_id AND v.model_id=p.model_id
      AND v.tenant_id=p.tenant_id AND v.organization_id=p.organization_id AND v.account_id=p.account_id
    WHERE p.tenant_id=? AND p.organization_id=? AND p.account_id=? AND p.status='published'
      AND p.definition_id=? LIMIT 1`).get(scope.tenantId, scope.organizationId, scope.accountId, task.processDefinitionId) as {graph:string} | undefined
  if (!row) return true
  let graph: {nodes?: Array<Record<string, unknown>>}
  try { graph = JSON.parse(row.graph) } catch { return false }
  const node = graph.nodes?.find(n => n.id === key && n.type === 'userTask')
  if (!node) return false
  const assignment = node.assignment as Record<string, unknown> | undefined
  if (!assignment) return false
  if (assignment.kind === 'candidateRole') {
    const active = db.prepare(`SELECT m.role FROM tenant_memberships m JOIN users u ON u.id=m.user_id
      JOIN accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id AND a.organization_id=m.organization_id
      JOIN tenants t ON t.id=m.tenant_id JOIN organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id
      WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?
        AND m.disabled=0 AND u.disabled=0 AND a.status='active' AND t.status='active' AND o.status='active'`).get(actorId, scope.tenantId, scope.organizationId, scope.accountId) as {role:string} | undefined
    return !!active && active.role === assignment.role
  }
  return (assignment.userIds as unknown[] | undefined)?.includes(actorId) === true
}
