import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProjectPlanFile, projectTaskCsv, projectWorkbook } from '../dist/project-planning.js'

test('project plan XLSX export can be imported without losing phases, milestones, or task relationships', async () => {
  const project = { id: 'p1', code: 'PRJ-QA-01', name: '计划交换验收', type: '工程变更', status: 'active', department: '研发', owner: '测试负责人', sponsor: '', startDate: '2026-10-15', dueDate: '2026-11-15', progress: 25, goal: '验收计划交换', scope: '阶段、里程碑和任务', successCriteria: '数据回环一致', description: '测试项目' }
  const phases = [{ id: 'ph1', projectId: 'p1', code: 'P1', name: '需求阶段', order: 1, startDate: '2026-10-15', dueDate: '2026-10-20', owner: '负责人 A', status: 'in-progress', progress: 45, deliverables: '需求清单', acceptanceCriteria: '评审通过' }]
  const milestones = [{ id: 'ms1', projectId: 'p1', phaseId: 'ph1', code: 'M1', title: '需求评审', dueDate: '2026-10-19', actualDate: '', owner: '负责人 A', status: 'planned', acceptanceCriteria: '会议纪要归档' }]
  const tasks = [{ id: 't1', projectId: 'p1', phaseId: 'ph1', milestoneId: 'ms1', wbsCode: '1.1', title: '评审,并冻结需求', description: '包含“边界”说明', startDate: '2026-10-15', dueDate: '2026-10-18', priority: 'high', status: 'in-progress', progress: 55, estimateHours: 8, acceptanceCriteria: '需求清单经签字' }]
  const workbook = await projectWorkbook(project, phases, milestones, tasks, [], [], [], [])
  assert.deepEqual([...workbook.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04])
  const parsed = await parseProjectPlanFile('project-workspace.xlsx', workbook)
  assert.equal(parsed.phases.length, 1)
  assert.equal(parsed.phases[0].code, 'P1')
  assert.equal(parsed.phases[0].name, '需求阶段')
  assert.equal(parsed.phases[0].startDate, '2026-10-15')
  assert.equal(parsed.milestones.length, 1)
  assert.equal(parsed.milestones[0].code, 'M1')
  assert.equal(parsed.milestones[0].phaseCode, 'P1')
  assert.equal(parsed.milestones[0].dueDate, '2026-10-19')
  assert.equal(parsed.tasks.length, 1)
  assert.equal(parsed.tasks[0].wbsCode, '1.1')
  assert.equal(parsed.tasks[0].title, '评审,并冻结需求')
  assert.equal(parsed.tasks[0].phaseCode, 'P1')
  assert.equal(parsed.tasks[0].milestoneCode, 'M1')
  assert.equal(parsed.tasks[0].priority, 'high')
  assert.equal(parsed.tasks[0].status, 'in-progress')
})

test('project task CSV export/import preserves quoting and validates required dates', async () => {
  const csv = projectTaskCsv([], [], [{ id: 't2', wbsCode: '1.1', title: '设计,评审 "A"', dueDate: '2026-10-20', startDate: '2026-10-16', priority: 'medium', status: 'todo', progress: 0, estimateHours: 3, acceptanceCriteria: '边界,已确认', description: '多行\n说明' }])
  const parsed = await parseProjectPlanFile('tasks.csv', csv)
  assert.equal(parsed.tasks.length, 1)
  assert.equal(parsed.tasks[0].title, '设计,评审 "A"')
  assert.equal(parsed.tasks[0].startDate, '2026-10-16')
  assert.equal(parsed.tasks[0].acceptanceCriteria, '边界,已确认')
  assert.equal(parsed.tasks[0].description, '多行\n说明')
  await assert.rejects(() => parseProjectPlanFile('tasks.csv', Buffer.from('任务名称,计划截止\n无效任务,not-a-date\n')), /计划截止日期无效/)
  await assert.rejects(() => parseProjectPlanFile('legacy.xls', Buffer.from('legacy')), /仅支持 CSV 或 XLSX/)
})
