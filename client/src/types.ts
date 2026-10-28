export type TaskStatus = 'todo' | 'in-progress' | 'done'
export type Priority = 'low' | 'medium' | 'high'
export interface Task {
  id: string; title: string; description?: string; dueDate: string; priority: Priority; status: TaskStatus; projectId?: string; createdAt: string
  startDate?: string; assignee?: string; assigneeId?: string; department?: string; phaseId?: string; milestoneId?: string; wbsCode?: string
  progress?: number; estimateHours?: number; actualHours?: number; dependencyIds?: string[]; acceptanceCriteria?: string; updatedAt?: string
}
export type ProjectStatus = 'draft' | 'active' | 'on-hold' | 'completed' | 'cancelled'
export interface Project {
  id: string; name: string; description: string; color: string; dueDate: string; createdAt: string
  code?: string; type?: string; department?: string; owner?: string; ownerId?: string; sponsor?: string; startDate?: string; actualStartDate?: string; actualEndDate?: string
  status?: ProjectStatus; priority?: Priority; progress?: number; stage?: string; scope?: string; goal?: string; successCriteria?: string; updatedAt?: string
}

export type KpiStatus = 'active' | 'draft'
export type KpiDirection = 'higher' | 'lower'
export interface KpiRule { id: string; code: string; name: string; category: string; formula: string; unit: string; target: number; direction: KpiDirection; weight: number; cycle: string; owner: string; status: KpiStatus; updatedAt: string; revision?: number; effectiveFrom?: string; updatedBy?: string }
export type ReviewStatus = 'self-review' | 'manager-review' | 'approved'
export interface ReviewScoreLine { kpiRuleId: string; actual: number; score: number; comment?: string }
export interface PerformanceReview { id: string; employee: string; department: string; period: string; reviewer: string; status: ReviewStatus; score: number; note: string; updatedAt: string; scoreLines?: ReviewScoreLine[] }

export type ProjectPhaseStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked'
export interface ProjectPhase { id: string; projectId: string; code: string; name: string; order: number; startDate: string; dueDate: string; actualStartDate?: string; actualEndDate?: string; owner: string; status: ProjectPhaseStatus; progress: number; deliverables?: string; acceptanceCriteria?: string; updatedAt: string }
export type MilestoneStatus = 'planned' | 'completed' | 'missed'
export interface ProjectMilestone { id: string; projectId: string; phaseId?: string; code: string; title: string; dueDate: string; actualDate?: string; owner: string; status: MilestoneStatus; acceptanceCriteria: string; updatedAt: string }
export type ProjectEventType = 'meeting' | 'decision' | 'risk' | 'issue' | 'change' | 'deliverable' | 'other'
export type ProjectEventStatus = 'open' | 'in-progress' | 'completed' | 'blocked' | 'cancelled'
export interface ProjectEvent { id: string; projectId: string; phaseId?: string; milestoneId?: string; taskId?: string; code: string; type: ProjectEventType; title: string; description: string; owner: string; ownerId?: string; department: string; startDate: string; dueDate: string; actualDate?: string; status: ProjectEventStatus; projectWeight: number; createdBy: string; createdById?: string; createdAt: string; updatedAt: string }
export interface KpiRuleSnapshot { kpiRuleId: string; code: string; name: string; formula: string; unit: string; target: number; direction: KpiDirection; weight: number; revision: number; category: string }
export interface EventScoreLine { kpiRuleId: string; actual: number; score: number; comment: string }
export interface ProjectEventReview { id: string; projectId: string; eventId: string; employee: string; department: string; reviewer: string; period: string; status: ReviewStatus; rulesSnapshot: KpiRuleSnapshot[]; selfScores: EventScoreLine[]; managerScores: EventScoreLine[]; selfComment: string; managerComment: string; selfReviewerId?: string; managerReviewerId?: string; selfSubmittedAt?: string; managerReviewedAt?: string; selfScore: number; finalScore: number; eventWeight: number; createdAt: string; updatedAt: string }
export interface ProjectReport { id: string; projectId: string; period: string; progress: number; achievements: string; blockers: string; risks: string; decisionsNeeded: string; nextSteps: string; author: string; authorId?: string; createdAt: string; updatedAt: string }
export interface ProjectTemplatePhase { name: string; durationDays: number; deliverables: string; acceptanceCriteria: string; milestones: { title: string; offsetDays: number; acceptanceCriteria: string }[]; tasks: { title: string; offsetDays: number; priority: Priority; estimateHours: number; acceptanceCriteria: string }[] }
export interface ProjectTemplate { id: string; code: string; name: string; type: string; description: string; phases: ProjectTemplatePhase[]; builtIn?: boolean }

export type LifecycleStatus = 'draft' | 'review' | 'released' | 'obsolete'
export type MaterialCodeState = 'preview' | 'blocked' | 'reserved' | 'synced'
export interface Material {
  id: string; partNo: string; name: string; category: string; specification: string; unit: string; revision: string; lifecycle: LifecycleStatus; owner: string; createdAt: string; updatedAt: string
  family?: string; groupNodeId?: string; proposedGroupNumber?: string; erpGroupId?: string; erpGroupNumber?: string; erpSyncState?: 'unverified' | 'synced'; classificationPath?: string[]; dimensions?: Record<string, string>; specificationFields?: Record<string, string>; codePreview?: string; codeState?: MaterialCodeState; templateSourceId?: string
}
export interface MaterialCatalogNode { id: string; family: string; path: string[]; code: string; confirmed: boolean; status: string; source: string }

export type BomKind = 'design' | 'manufacturing' | 'sales'
export type BomLineRole = 'component' | 'process' | 'packaging' | 'label' | 'sales-option'
export interface BomLine { id: string; materialId: string; quantity: number; findNumber: string; role?: BomLineRole; operation?: string; referenceDesignLineId?: string }
export interface BomConfigAttribute { key: string; label: string; required: boolean; values: { value: string; label: string }[] }
export interface BomConfigGroup { key: string; label: string; required: boolean }
export interface BomCondition { attributeKey: string; value: string }
export interface SalesBomRule { id: string; groupKey: string; conditions: BomCondition[]; materialId: string; quantity: number; priority: number }
export interface Bom { id: string; bomNo: string; parentMaterialId: string; kind: BomKind; revision: string; lifecycle: LifecycleStatus; effectiveDate: string; lines: BomLine[]; updatedAt: string; scope?: string; sourceBomId?: string; sourceRevision?: string; configAttributes?: BomConfigAttribute[]; configGroups?: BomConfigGroup[]; salesRules?: SalesBomRule[] }
export interface SalesBomSnapshotLine { id: string; materialId: string; quantity: number; role: BomLineRole; sourceBomId: string; sourceRevision: string; sourceRuleId?: string; findNumber: string }
export interface SalesBomSnapshot { id: string; orderNo: string; parentMaterialId: string; bomId: string; bomNo: string; bomRevision: string; quantity: number; attributes: Record<string, string>; lines: SalesBomSnapshotLine[]; createdAt: string }
export interface PlmDocument { id: string; docNo: string; title: string; type: string; materialId?: string; revision: string; lifecycle: LifecycleStatus; owner: string; updatedAt: string; fileName?: string; fileUrl?: string }

export interface WorkspaceData {
  tasks: Task[]; projects: Project[]; kpiRules: KpiRule[]; reviews: PerformanceReview[]; materials: Material[]; boms: Bom[]; salesBomSnapshots: SalesBomSnapshot[]; documents: PlmDocument[]
  projectPhases: ProjectPhase[]; projectMilestones: ProjectMilestone[]; projectEvents: ProjectEvent[]; projectEventReviews: ProjectEventReview[]; projectReports: ProjectReport[]; projectTemplates: ProjectTemplate[]
}
