import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/TaskCollaboration.tsx', import.meta.url), 'utf8')
test('exports create fields and embedded collaboration panel', () => {
  assert.match(source, /export function TaskCollaborationFields/)
  assert.match(source, /export function TaskCollaborationPanel/)
})
test('uses the agreed collaboration endpoints and multipart form payload', () => {
  for (const route of ['/api/task-members', '/accept', '/commit-deadline', '/reports', '/review']) assert.ok(source.includes(route), `missing ${route}`)
  assert.match(source, /form\.append\('attachments'/)
  assert.ok(source.includes('apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/reports/'))
})
test('explains that recurring task reports do not import business daily data', () => {
  assert.match(source, /不会自动拉取业务数据/)
})
