import test from 'node:test'
import assert from 'node:assert/strict'
import { flowableMissingFieldLabels, flowableTestDisabledReason, flowableRestContextHint } from '../src/flowable-settings-diagnostics.ts'

test('explains missing required Flowable fields and enables only when complete', () => {
  assert.deepEqual(flowableMissingFieldLabels(['baseUrl', 'password']), ['REST API Base URL', 'Basic Auth 密码'])
  assert.match(flowableTestDisabledReason(['username']), /测试连接禁用.*服务账号/)
  assert.equal(flowableTestDisabledReason([]), null)
  assert.match(flowableTestDisabledReason([], true), /尚未保存.*服务端已加密保存/)
})

test('flags obsolete process-api sample and guides toward the REST context', () => {
  assert.match(flowableRestContextHint('http://host/flowable-rest/process-api'), /通常为 \/flowable-rest\/service/)
  assert.equal(flowableRestContextHint('https://host/flowable-rest/service'), null)
  assert.match(flowableRestContextHint('https://host/other'), /REST context/)
  assert.equal(flowableRestContextHint('not a URL'), null)
})
