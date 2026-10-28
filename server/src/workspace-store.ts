import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAppState, getAppStateVersioned, hasAppState, setAppState, setAppStateIfRevision, StateConflictError } from './database.js'
import type { WorkspaceScope } from './scope.js'

export type Priority = 'low' | 'medium' | 'high'
export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type BomKind = 'design' | 'manufacturing' | 'sales'
export interface Task { id: string; title: string; description?: string; dueDate: string; priority: Priority; status: TaskStatus; projectId?: string; createdAt: string; [key: string]: unknown }
export interface Project { id: string; name: string; description: string; color: string; dueDate: string; createdAt: string; [key: string]: unknown }
export type Entity = Record<string, unknown> & { id: string }
export interface Workspace {
  tasks: Task[]; projects: Project[]; kpiRules: Entity[]; reviews: Entity[]; materials: Entity[]; boms: Entity[]; documents: Entity[]; salesBomSnapshots: Entity[]
  projectPhases: Entity[]; projectMilestones: Entity[]; projectEvents: Entity[]; projectEventReviews: Entity[]; projectReports: Entity[]; projectTemplates: Entity[]
}
export type ScopedWorkspace = { key: string; value: Workspace; revision: number }

const moduleDir = dirname(fileURLToPath(import.meta.url))
const seedFile = resolve(moduleDir, '../data/seed-workspace.json')
const legacyJson = resolve(process.env.LEGACY_DATA_FILE?.trim() || process.env.DATA_FILE?.trim() || resolve(moduleDir, '../data/workspace.json'))
const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as Workspace

export function scopedWorkspaceKey(scope: Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>): string {
  return `workspace:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
}

export function completeWorkspace(value: Partial<Workspace> | null | undefined): Workspace {
  const workspace = { ...structuredClone(seed), ...(value ?? {}) } as Workspace
  for (const key of ['tasks', 'projects', 'kpiRules', 'reviews', 'materials', 'boms', 'documents', 'salesBomSnapshots', 'projectPhases', 'projectMilestones', 'projectEvents', 'projectEventReviews', 'projectReports', 'projectTemplates'] as const) {
    if (!Array.isArray(workspace[key])) workspace[key] = structuredClone(seed[key]) as never
  }
  return workspace
}

function legacyWorkspace(): Partial<Workspace> | null {
  if (hasAppState('workspace')) return getAppState<Partial<Workspace>>('workspace', {})
  if (!existsSync(legacyJson)) return null
  try {
    const value = JSON.parse(readFileSync(legacyJson, 'utf8')) as Partial<Workspace>
    setAppState('workspace', value)
    return value
  } catch {
    throw new Error('Legacy workspace JSON is invalid; it was not imported to protect existing data.')
  }
}

export function migrateLegacyWorkspace(scope: WorkspaceScope): void {
  const key = scopedWorkspaceKey(scope)
  if (hasAppState(key)) return
  const legacy = legacyWorkspace()
  setAppState(key, completeWorkspace(legacy))
}

export function loadScopedWorkspace(scope: WorkspaceScope): ScopedWorkspace {
  const key = scopedWorkspaceKey(scope)
  // Legacy state is migrated exactly once by the initial-tenant setup. Never use
  // it as a fallback for a newly-created account: doing so would copy the first
  // tenant's private workspace into every later tenant/account.
  let current = getAppStateVersioned<Partial<Workspace>>(key, completeWorkspace(null))
  if (current.revision === 0) {
    const value = completeWorkspace(current.value)
    try { current.revision = setAppStateIfRevision(key, value, 0); current.value = value }
    catch (error) {
      if (!(error instanceof StateConflictError)) throw error
      current = getAppStateVersioned<Partial<Workspace>>(key, completeWorkspace(null))
    }
  }
  return { key, value: completeWorkspace(current.value), revision: current.revision }
}

export function readScopedWorkspace(scope: WorkspaceScope): Workspace {
  const key = scopedWorkspaceKey(scope)
  if (!hasAppState(key)) return completeWorkspace(null)
  return completeWorkspace(getAppState<Partial<Workspace>>(key, {}))
}

export function persistScopedWorkspace(current: ScopedWorkspace): number {
  current.revision = setAppStateIfRevision(current.key, current.value, current.revision)
  return current.revision
}
