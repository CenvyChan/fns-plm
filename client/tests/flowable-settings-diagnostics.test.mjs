import test from 'node:test'
import assert from 'node:assert/strict'
import { flowableMissingFieldLabels, flowableTestDisabledReason, flowableRestContextHint } from '../src/flowable-settings-diagnostics.ts'

test('explains missing required Flowable fields and enables only when complete', () => {
  assert.deepEqual(flowableMissingFieldLabels(['baseUrl', 'password']), ['REST API Base URL', 'Basic Auth 密码'])
  assert.match(flowableTestDisabledReason(['username']), /测试连接禁用.*服务账号/)
  assert.equal(flowableTestDisabledReason([]), null)
  assert.match(flowableTestDisabledReason([], true), /尚未保存.*服务端已加密保存/)
})

test('distinguishes the built-in Spring Boot path from the standard REST container path', () => {
  assert.match(flowableRestContextHint('http://host/flowable-rest/process-api'), /内置 Spring Boot.*当前隔离标准 REST 容器.*\/flowable-rest\/service/)
  assert.equal(flowableRestContextHint('https://host/flowable-rest/service'), null)
  assert.match(flowableRestContextHint('https://host/other'), /内置 Spring Boot 服务.*process-api.*标准 Flowable REST 容器.*service/)
  assert.equal(flowableRestContextHint('not a URL'), null)
})
