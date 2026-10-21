import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'

test('自定义流程启动与内置入口分离，权限和模式不冒充运行状态', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
  try {
    const { default: Panel, engineLabel } = await server.ssrLoadModule('/src/CustomProcessStartPanel.tsx')
    assert.equal(renderToString(React.createElement(Panel, { modelId: '', refreshKey: 0 })), '')
    for (const role of ['admin', 'plm_manager', 'reviewer', 'member']) {
      const html = renderToString(React.createElement(Panel, { modelId: 'model-a', currentUser: { id: 'user-a', role }, refreshKey: 0 }))
      assert.match(html, /独立于四个内置业务流程入口/)
      assert.match(html, /不使用当前草稿或最新表单替换绑定/)
      assert.match(html, /disabled=""[^>]*>启动已发布自定义流程/)
      if (['member', 'reviewer'].includes(role)) assert.match(html, /仅工作区管理员或 PLM 管理员可启动/)
    }
    assert.match(engineLabel('mock-test'), /可连接模拟或真实测试引擎/)
    assert.match(engineLabel('flowable'), /已验证补丁/)
    assert.doesNotMatch(engineLabel('flowable'), /mock|模拟/)
    assert.match(engineLabel('blocked'), /阻断/)
  } finally { await server.close() }
})

test('启动请求只允许业务上下文和服务端固定版本，无内置流程跳转或客户端引擎身份', () => {
  const source = readFileSync(new URL('../src/CustomProcessStartPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /\/start-context/)
  assert.match(source, /Idempotency-Key/)
  assert.match(source, /expectedVersionId: operationContext.versionId/)
  assert.match(source, /remember\(next, operationKey, operationModel\)[\s\S]*await apiFetch/)
  assert.match(source, /sending.current \|\| busy \|\| attempt/)
  assert.match(source, /sessionStorage.setItem/)
  assert.match(source, /classifyStartFailure\(response.status, data.error\)/)
  assert.match(source, /state: 'uncertain'/)
  assert.match(source, /确认启动已发布 v/)
  assert.doesNotMatch(source, /\/workflow\/instances|processDefinitionKey:|assignee:|processDefinitionId:/)
})

test('发布与表单文案不再断言仅模拟或全局适配器缺失', () => {
  const bpmn = readFileSync(new URL('../src/BpmnModelerWorkbench.tsx', import.meta.url), 'utf8')
  const forms = readFileSync(new URL('../src/FormDesignerWorkbench.tsx', import.meta.url), 'utf8')
  assert.match(bpmn, /engineLabel\(preview.engineMode\)/)
  assert.match(bpmn, /CustomProcessStartPanel key=\{modelId\} modelId=/)
  assert.doesNotMatch(bpmn, /确认模拟发布|仅向本地 mock|真实 Flowable 发布保持阻断|模拟发布完成/)
  assert.doesNotMatch(forms, /response.status === 501|尚未接入可信流程任务适配器/)
  assert.match(forms, /Flowable 实际任务校验/)
})
