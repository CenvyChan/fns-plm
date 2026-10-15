import { AsyncLocalStorage } from 'node:async_hooks'

export type WorkspaceScope = {
  tenantId: string
  tenantName: string
  organizationId: string
  organizationName: string
  accountId: string
  accountName: string
  role: 'admin' | 'plm_manager' | 'reviewer' | 'member'
  isPlatformAdmin: boolean
}

const storage = new AsyncLocalStorage<WorkspaceScope>()

export function runWithWorkspaceScope<T>(scope: WorkspaceScope, callback: () => T): T {
  return storage.run(scope, callback)
}

export function currentWorkspaceScope(): WorkspaceScope | undefined {
  return storage.getStore()
}

export function scopedStateKey(namespace: string, scope = currentWorkspaceScope()): string {
  if (!scope) throw new Error('A verified tenant, organization and account scope is required.')
  return `${namespace}:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}
