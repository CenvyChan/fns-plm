import type { WorkspaceData } from './types'
import { seedWorkspace } from './seed'
import { apiJson, jsonRequest } from './api'

const mergeWorkspace = (data: Partial<WorkspaceData>): WorkspaceData => ({
  tasks: data.tasks ?? structuredClone(seedWorkspace.tasks),
  projects: data.projects ?? structuredClone(seedWorkspace.projects),
  kpiRules: data.kpiRules ?? structuredClone(seedWorkspace.kpiRules),
  reviews: data.reviews ?? structuredClone(seedWorkspace.reviews),
  materials: data.materials ?? structuredClone(seedWorkspace.materials),
  boms: data.boms ?? structuredClone(seedWorkspace.boms),
  salesBomSnapshots: data.salesBomSnapshots ?? structuredClone(seedWorkspace.salesBomSnapshots),
  documents: data.documents ?? structuredClone(seedWorkspace.documents),
  projectPhases: data.projectPhases ?? [],
  projectMilestones: data.projectMilestones ?? [],
  projectEvents: data.projectEvents ?? [],
  projectEventReviews: data.projectEventReviews ?? [],
  projectReports: data.projectReports ?? [],
  projectTemplates: data.projectTemplates ?? [],
})

export function loadLocalWorkspace(): WorkspaceData { return structuredClone(seedWorkspace) }
export function saveLocalWorkspace(_data: WorkspaceData): void { /* server database is the authoritative store */ }
export async function requestWorkspace(): Promise<WorkspaceData> {
  return mergeWorkspace(await apiJson<Partial<WorkspaceData>>('/api/workspace'))
}
export async function syncMutation(path: string, method: string, body?: unknown): Promise<unknown> {
  return apiJson(`/api${path}`, jsonRequest(method, body))
}
export const createId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
export type { WorkspaceData }
