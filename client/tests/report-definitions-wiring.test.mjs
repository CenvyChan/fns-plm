import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workbench = readFileSync(
  new URL("../src/ReportDefinitionsWorkbench.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const navigation = readFileSync(
  new URL("../src/navigation.ts", import.meta.url),
  "utf8",
);

test("report definitions use the real API and preserve safety wiring", () => {
  assert.match(workbench, /\/api\/report-definitions/);
  assert.match(workbench, /method:\s*['"]PATCH['"]/);
  assert.match(workbench, /expectedVersion:\s*selected\.version/);
  assert.match(workbench, /if\s*\(r\.status\s*===\s*409\)/);
  assert.match(workbench, /重新加载定义/);
  assert.match(workbench, /缺少 definitionId/);
  assert.match(
    workbench,
    /source:\s*['"]local-mock['"]\s*\|\s*['"]workspace['"]/,
  );
  assert.match(workbench, /p\.notice/);
  assert.match(workbench, /p\.amountBasis/);
  assert.match(workbench, /setPreview\(null\)/);
  assert.match(workbench, /!canManage/);
  assert.match(app, /<ReportDefinitionsWorkbench/);
  assert.match(app, /canManage=\{authUser\.role === 'admin'\}/);
  assert.match(navigation, /typeof window === "undefined"/);
});
