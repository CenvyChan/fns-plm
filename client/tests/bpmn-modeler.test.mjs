import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
import { BpmnModdle } from "bpmn-moddle";
import descriptor from "../src/flowable-minimal-moddle.json" with { type: "json" };
const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
test("自有最小 Flowable moddle 描述符对分配属性和固定表单版本 roundtrip", async () => {
  assert.equal(descriptor.name, "FlowableMinimal");
  assert.deepEqual(
    descriptor.types[0].properties.map((p) => p.name),
    ["assignee", "candidateUsers", "candidateGroups", "formKey"],
  );
  const moddle = new BpmnModdle({ flowable: descriptor });
  const xml =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="test"><bpmn:process id="p"><bpmn:userTask id="task" flowable:assignee="plm-user-1" flowable:candidateUsers="plm-user-1,plm-user-2" flowable:candidateGroups="reviewers" flowable:formKey="plm-form:inspection:v2"/></bpmn:process></bpmn:definitions>';
  const parsed = await moddle.fromXML(xml);
  const task = parsed.rootElement.rootElements[0].flowElements[0];
  assert.equal(task.assignee, "plm-user-1");
  assert.equal(task.candidateUsers, "plm-user-1,plm-user-2");
  assert.equal(task.candidateGroups, "reviewers");
  assert.equal(task.formKey, "plm-form:inspection:v2");
  const serialized = (await moddle.toXML(parsed.rootElement)).xml;
  for (const [name, value] of [
    ["assignee", "plm-user-1"],
    ["candidateUsers", "plm-user-1,plm-user-2"],
    ["candidateGroups", "reviewers"],
    ["formKey", "plm-form:inspection:v2"],
  ])
    assert.match(serialized, new RegExp(`flowable:${name}="${value}"`));
});
test("workflow 页面提供 BPMN 入口及结构化安全生命周期 API", async () => {
  const app = await read("../src/App.tsx");
  const workbench = await read("../src/BpmnModelerWorkbench.tsx");
  assert.match(app, /page === 'workflow'.*WorkflowEntry/);
  assert.match(app, /BPMN 模型设计/);
  assert.match(
    workbench,
    /\/api\/bpmn-models\/options|\/api\/bpmn-modeler\/options/,
  );
  for (const route of [
    "/api/bpmn-models",
    "validate",
    "versions",
    "preview",
    "publish",
  ])
    assert.ok(workbench.includes(route));
  assert.match(workbench, /confirmationToken/);
  assert.match(workbench, /candidateRole/);
  assert.match(workbench, /bpmn\.io/);
});
test("BPMN 键盘、编辑规则与 bpmnRules 服务显式受约束", async () => {
  const workbench = await read("../src/BpmnModelerWorkbench.tsx");
  const css = await read("../src/bpmn-modeler.css");
  for (const rule of [
    "shape.create",
    "connection.create",
    "shape.replace",
    "shape.delete",
    "connection.delete",
    "elements.move",
  ])
    assert.ok(workbench.includes(`"${rule}"`), `missing guard ${rule}`);
  assert.match(workbench, /m\.get\("bpmnRules"\)/);
  assert.match(
    workbench,
    /rules\.addRule\(action,\s*2000,\s*\(\)\s*=>\s*false\)/,
  );
  assert.match(workbench, /keyboard:\s*\{\s*bindTo:\s*null\s*\}/);
  assert.match(css, /\.bpmn-canvas\s+\.djs-palette/);
  assert.doesNotMatch(css, /bjs-powered-by\s*\{[^}]*display\s*:\s*none/i);
  assert.doesNotMatch(workbench, /className="bpmn-watermark"/);
});
test("组件可由 React SSR 加载并渲染（仅 smoke，不验证浏览器运行时）", async () => {
  const server = await createServer({
    configFile: false,
    root: new URL("..", import.meta.url).pathname,
    plugins: [
      {
        name: "stub-browser-modeler-for-ssr",
        enforce: "pre",
        resolveId(source) {
          return source === "bpmn-js/lib/Modeler" ? "virtual:modeler" : null;
        },
        load(id) {
          return id === "virtual:modeler"
            ? "export default class Modeler {}"
            : null;
        },
      },
    ],
    server: { middlewareMode: true },
    appType: "custom",
    ssr: { noExternal: ["bpmn-js"] },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { default: Workbench } = await server.ssrLoadModule(
      "/src/BpmnModelerWorkbench.tsx",
    );
    const html = renderToString(
      React.createElement(Workbench, {
        currentUser: { id: "admin-user", role: "admin" },
      }),
    );
    assert.match(html, /流程模型设计器/);
    assert.match(html, /新建/);
  } finally {
    await server.close();
  }
});
