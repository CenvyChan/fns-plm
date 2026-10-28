import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWorkspaceReport } from '../dist/reporting.js'

test('workspace report aggregates scoped tasks and PLM records deterministically', () => {
  const now = new Date('2026-10-16T10:00:00.000Z')
  const report = buildWorkspaceReport({
    tasks: [
      { id: 'open', title: 'Open', status: 'todo', dueDate: '2026-10-15' },
      { id: 'done', title: 'Done', status: 'done', dueDate: '2026-10-14' },
    ],
    projects: [{ id: 'p1', name: 'Project | *A*', dueDate: '2026-10-20' }],
    kpiRules: [{ id: 'k1' }],
    reviews: [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'approved' }],
    materials: [{ lifecycle: 'released' }, { lifecycle: 'draft' }],
    boms: [{ lifecycle: 'released' }],
    documents: [{ lifecycle: 'released' }],
    salesBomSnapshots: [{ id: 's1' }],
    workflowTasks: [{ status: 'pending' }, { status: 'approved' }, { status: 'rejected' }],
  }, now)

  assert.deepEqual(report.summary, {
    generatedAt: now.toISOString(),
    taskTotal: 2, taskOpen: 1, taskDone: 1, taskOverdue: 1,
    projectTotal: 1, kpiRuleTotal: 1, reviewPending: 1,
    materialTotal: 2, materialReleased: 1, bomTotal: 1, bomReleased: 1,
    documentTotal: 1, documentReleased: 1, salesBomSnapshots: 1,
    approvalPending: 1, approvalApproved: 1, approvalRejected: 1,
  })
  assert.match(report.markdown, /PLM 工作区报告 · 2026-10-16/)
  assert.ok(report.markdown.includes('- **Project \\| \\*A\\***'))
  assert.match(report.markdown, /逾期 1 项/)
})

test('empty scope report is a preview and contains no records from another workspace', () => {
  const report = buildWorkspaceReport({}, new Date('2026-10-16T10:00:00.000Z'))
  assert.equal(report.summary.taskTotal, 0)
  assert.equal(report.summary.projectTotal, 0)
  assert.equal(report.summary.approvalPending, 0)
  assert.match(report.markdown, /任务\*\*：0 项/)
})
