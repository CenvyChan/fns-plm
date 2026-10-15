export interface ReportWorkspace {
  tasks?: object[]
  projects?: object[]
  kpiRules?: object[]
  reviews?: object[]
  materials?: object[]
  boms?: object[]
  documents?: object[]
  salesBomSnapshots?: object[]
  workflowTasks?: object[]
}

const asRecord = (value: object) => value as Record<string, unknown>
const text = (value: unknown, max = 120) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)
const escapeMarkdown = (value: unknown, max = 120) => text(value, max).replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&')
const isoDay = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function buildWorkspaceReport(workspace: ReportWorkspace, now = new Date()) {
  const tasks = (workspace.tasks ?? []).map(asRecord)
  const projects = (workspace.projects ?? []).map(asRecord)
  const rules = (workspace.kpiRules ?? []).map(asRecord)
  const reviews = (workspace.reviews ?? []).map(asRecord)
  const materials = (workspace.materials ?? []).map(asRecord)
  const boms = (workspace.boms ?? []).map(asRecord)
  const documents = (workspace.documents ?? []).map(asRecord)
  const workflowTasks = (workspace.workflowTasks ?? []).map(asRecord)
  const today = isoDay(now)
  const done = tasks.filter(item => item.status === 'done').length
  const open = tasks.length - done
  const overdue = tasks.filter(item => item.status !== 'done' && typeof item.dueDate === 'string' && item.dueDate < today).length
  const releasedMaterials = materials.filter(item => item.lifecycle === 'released').length
  const releasedBoms = boms.filter(item => item.lifecycle === 'released').length
  const releasedDocuments = documents.filter(item => item.lifecycle === 'released').length
  const pendingReviews = reviews.filter(item => item.status !== 'approved').length
  const projectLines = projects.slice(0, 8).map(project => {
    const related = tasks.filter(task => task.projectId === project.id)
    const complete = related.filter(task => task.status === 'done').length
    const progress = related.length ? Math.round(complete * 100 / related.length) : 0
    return `- **${escapeMarkdown(project.name, 80)}**：${progress}%（${complete}/${related.length} 项），截止 ${escapeMarkdown(project.dueDate, 20) || '未设置'}`
  })
  const generatedAt = now.toISOString()
  const summary = {
    generatedAt,
    taskTotal: tasks.length,
    taskOpen: open,
    taskDone: done,
    taskOverdue: overdue,
    projectTotal: projects.length,
    kpiRuleTotal: rules.length,
    reviewPending: pendingReviews,
    materialTotal: materials.length,
    materialReleased: releasedMaterials,
    bomTotal: boms.length,
    bomReleased: releasedBoms,
    documentTotal: documents.length,
    documentReleased: releasedDocuments,
    salesBomSnapshots: (workspace.salesBomSnapshots ?? []).length,
    approvalPending: workflowTasks.filter(item => item.status === 'pending').length,
    approvalApproved: workflowTasks.filter(item => item.status === 'approved').length,
    approvalRejected: workflowTasks.filter(item => item.status === 'rejected').length,
  }
  const markdown = [
    `### PLM 工作区报告 · ${today}`,
    `生成时间：${generatedAt.replace('T', ' ').slice(0, 16)} UTC`,
    '',
    `**任务**：${tasks.length} 项，待完成 ${open} 项，已完成 ${done} 项，逾期 ${overdue} 项。`,
    `**项目**：${projects.length} 个；**KPI 规则**：${rules.length} 条；待评审 ${pendingReviews} 份；流程待办 ${summary.approvalPending} 项。`,
    `**PLM**：物料 ${materials.length} 项（已发布 ${releasedMaterials}）；BOM ${boms.length} 份（已发布 ${releasedBoms}）；图文档 ${documents.length} 份（已发布 ${releasedDocuments}）。`,
    ...(projectLines.length ? ['', '**项目进度**', ...projectLines] : []),
    '',
    '由 PLM 工作区自动生成；发布状态以源系统记录为准。',
  ].join('\n')
  return { summary, markdown }
}
