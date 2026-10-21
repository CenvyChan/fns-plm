import test from 'node:test'
import assert from 'node:assert/strict'
import { businessTabTitle, dailyReportTabTitle, taskTabTitle } from '../src/workspace-tab-title.ts'

test('daily reporting identity uses persisted date and document number, with date-only fallback', () => {
  assert.equal(dailyReportTabTitle('2026-10-20', 'DR-007'), '日报 · 2026-10-20 · #DR-007')
  assert.equal(dailyReportTabTitle('2026-10-20', ''), '日报 · 2026-10-20')
  assert.equal(dailyReportTabTitle('', ''), '')
})

test('task identity prefers actual WBS code and falls back to persisted task id', () => {
  assert.equal(taskTabTitle('校验图纸', 'WBS-2', 'task-1'), '任务 · 校验图纸 · #WBS-2')
  assert.equal(taskTabTitle('校验图纸', '', 'task-1'), '任务 · 校验图纸 · #task-1')
  assert.equal(taskTabTitle('', '', ''), '')
})

test('empty business codes never introduce undefined or whitespace into a title', () => {
  assert.equal(businessTabTitle('物料', ' 托盘 ', '  '), '物料 · 托盘')
  assert.equal(businessTabTitle('物料', null, undefined), '')
})

test('sales and purchase record families have distinct daily titles', () => {
  assert.equal(dailyReportTabTitle('2026-10-21', 'DR-01', 'sales'), '销售日报 · 2026-10-21 · #DR-01')
  assert.notEqual(dailyReportTabTitle('2026-10-21', null, 'sales'), dailyReportTabTitle('2026-10-21', null, 'purchase'))
})
