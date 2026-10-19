import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/ReportsWorkbench.tsx", import.meta.url), "utf8");
test("schedule editor supports pinned definitions while preserving legacy behavior", () => {
  assert.match(source, /\/api\/report-definitions/);
  assert.match(source, /definitionId\?: string \| null/);
  assert.match(source, /definitionVersion\?: number \| null/);
  assert.match(source, /保留已绑定版本/);
  assert.match(source, /definitionId, definitionVersion: Number\(version\)/);
  assert.match(source, /definitionId: null, definitionVersion: null/);
  assert.match(source, /\/preview`\)/);
  assert.match(source, /\/snapshots`\)/);
  assert.match(source, /loadScheduleDetails/);
  assert.match(source, /if \(!canManage\)/);
  assert.match(source, /historyResponse\.ok/);
  assert.match(source, /不代表已成功送达/);
  assert.match(source, /!definitions\.some/);
  assert.doesNotMatch(source, /预览 \/ 发送历史/);
  assert.doesNotMatch(source, /尚不绑定新增/);
});
