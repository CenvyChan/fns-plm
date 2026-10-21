import type { Task } from './types'

export type CollaborationMode = 'personal' | 'assignment' | 'report'
export type CollaborationRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'
export interface TaskAttachment { id: string; name: string; size: number }
export interface TaskReport { id: string; content: string; progress: number; createdAt: string; authorId: string; attachments: TaskAttachment[]; review?: { decision: 'approve' | 'return'; comment: string; by: string; at: string } }
export type CollaborationTask = Task & {
  creatorId?: string
  collaborationMode?: Exclude<CollaborationMode, 'personal'>
  receiverId?: string
  acceptanceStatus?: 'pending' | 'accepted' | 'auto-accepted'
  acceptBy?: string
  acceptedAt?: string
  committedDueDate?: string
  recurrence?: CollaborationRecurrence
  reviewComment?: string
  reportStatus?: 'none' | 'submitted' | 'approved' | 'returned'
  reports?: TaskReport[]
}

export const collaborationModeLabel: Record<CollaborationMode, string> = {
  personal: '个人待办', assignment: '指派任务', report: '周期汇报',
}
