import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { BpmnModdle } from 'bpmn-moddle';
import descriptor from '../src/flowable-minimal-moddle.json' with { type: 'json' };

test('功能设计器：模板、固定表单与权限空态契约', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, plugins: [{ name: 'modeler-ssr-stub', enforce: 'pre', resolveId(source) { return source === 'bpmn-js/lib/Modeler' ? 'virtual:modeler' : null; }, load(id) { return id === 'virtual:modeler' ? 'export default class Modeler {}' : null; } }], server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: ['bpmn-js'] }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Workbench, graphXml } = await server.ssrLoadModule('/src/BpmnModelerWorkbench.tsx');
    const { approvalTemplate } = await server.ssrLoadModule('/src/bpmnTemplates.ts');
    await t.test('三种模板是连通且有界的真实图，不是菜单占位', () => {
      for (const kind of ['serial', 'exclusive', 'parallel']) {
        const graph = approvalTemplate(kind, 'approval', 'scoped-user');
        assert.equal(graph.nodes.filter(n => n.type === 'startEvent').length, 1);
        assert.ok(graph.nodes.some(n => n.type === 'userTask'));
        assert.equal(new Set([...graph.nodes, ...graph.flows].map(n => n.id)).size, graph.nodes.length + graph.flows.length);
        const walk = id => { const seen = new Set(), queue = [id]; while (queue.length) { const node = queue.pop(); if (seen.has(node)) continue; seen.add(node); queue.push(...graph.flows.filter(f => f.source === node).map(f => f.target)); } return seen; };
        assert.equal(walk('start').size, graph.nodes.length);
        for (const n of graph.nodes) assert.ok(walk(n.id).has('end'));
        for (const n of graph.nodes.filter(n => n.type === 'userTask')) assert.deepEqual(n.assignment.userIds, ['scoped-user']);
        if (kind === 'parallel') assert.equal(graph.nodes.filter(n => n.type === 'parallelGateway').length, 2);
        if (kind === 'exclusive') assert.deepEqual(graph.flows.filter(f => f.condition).map(f => f.condition).sort(), ['approved', 'rejected']);
      }
    });
    await t.test('图形 XML 保留并行和固定表单版本并转义文本', async () => {
      const g = approvalTemplate('parallel', 'parallelApproval', 'scoped-user');
      g.nodes.find(n => n.type === 'userTask').formBinding = { formKey: 'purchase', formVersion: 2 };
      g.nodes.find(n => n.type === 'userTask').name = '<审批 & 复核>';
      const xml = graphXml(g);
      assert.ok(xml.includes('flowable:formKey="plm-form:purchase:v2"'));
      assert.ok(xml.includes('&lt;审批 &amp; 复核&gt;'));
      const parsed = await new BpmnModdle({ flowable: descriptor }).fromXML(xml);
      const elements = parsed.rootElement.rootElements[0].flowElements;
      assert.equal(elements.filter(e => e.$type === 'bpmn:ParallelGateway').length, 2);
      assert.equal(elements.find(e => e.formKey).formKey, 'plm-form:purchase:v2');
    });
    await t.test('空态不显示可编辑的示例节点或伪同步改动', () => {
      const html = renderToString(React.createElement(Workbench, { currentUser: { id: 'user', role: 'admin' } }));
      assert.match(html, /准备好构建流程/);
      assert.match(html, /新建流程模板/);
      assert.doesNotMatch(html, /未保存更改/);
      assert.doesNotMatch(html, /显示名称/);
      assert.match(html, /发布历史与审计/);
    });
    await t.test('只读成员写入控件禁用且未冒充会签或运行时支持', () => {
      const html = renderToString(React.createElement(Workbench, { currentUser: { id: 'member', role: 'member' } }));
      assert.match(html, /当前账户不是工作区管理员/);
      assert.match(html, /disabled=""[^>]*>保存草稿/);
      assert.match(html, /并行分支不等同于多实例会签/);
      assert.match(html, /发布和启动受服务端安全门禁控制/);
      assert.doesNotMatch(html, /真实 Flowable 发布保持阻断/);
    });
  } finally { await server.close(); }
});
