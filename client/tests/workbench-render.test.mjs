import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const clientDir = resolve(import.meta.dirname, "..");
test("every split reporting route renders without initialization errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plm-render-smoke-"));
  try {
    const result = await build({
      stdin: {
        resolveDir: clientDir,
        loader: "tsx",
        contents: `import React from 'react';
import { renderToString } from 'react-dom/server';
import DailyReportingWorkbench from './src/DailyReportingWorkbench';
import DailyReportingManagement from './src/DailyReportingManagement';
import ReportsWorkbench from './src/ReportsWorkbench';
import ReportDefinitionsWorkbench from './src/ReportDefinitionsWorkbench';
import DailyReportImport from './src/DailyReportImport';
const navigate = () => {};
const routes = ['daily-sales','daily-purchase','daily-sales-new','daily-purchase-new','daily-sales-edit','daily-purchase-edit','daily-documents','daily-reconciliation','daily-archives'];
for (const page of routes) { const html = renderToString(<DailyReportingWorkbench page={page} onNavigate={navigate}/>); if (!html) throw new Error(page); }
for (const page of ['daily-parties','daily-parties-new','daily-parties-edit','daily-rates','daily-rates-new','daily-assignments','daily-mappings','daily-imports']) renderToString(<DailyReportingManagement page={page} onNavigate={navigate} onChanged={navigate}/>);
for (const page of ['reports','report-schedules','report-schedules-new','report-schedules-edit']) renderToString(<ReportsWorkbench page={page} onNavigate={navigate} canManage={true}/>);
for (const page of ['report-definitions','report-definitions-new','report-definitions-edit']) { const html = renderToString(<ReportDefinitionsWorkbench page={page} onNavigate={navigate} canManage={true}/>); if (!html.includes('报表定义')) throw new Error(page); }
for (const kind of ['sales','purchase'] as const) { const html = renderToString(<DailyReportImport kind={kind} onNavigate={navigate}/>); if (!html.includes(kind === 'sales' ? '导入往期销售日报' : '导入往期采购日报')) throw new Error(kind); }
console.log('reporting route render checks passed');`,
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      loader: { ".css": "empty" },
      jsx: "automatic",
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: "silent",
    });
    const file = join(dir, "render-smoke.mjs");
    writeFileSync(file, result.outputFiles[0].text);
    const run = spawnSync(process.execPath, [file], {
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /reporting route render checks passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
