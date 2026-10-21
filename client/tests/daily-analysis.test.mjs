import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const clientDir = resolve(import.meta.dirname, "..");

test("daily-analysis helper transpiles dynamically and preserves filter/query/date contracts", async () => {
  const result = await build({
    entryPoints: [join(clientDir, "src/daily-analysis.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles[0].text;
  const helper = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const filters = {
    q: " 单号 & note ", from: "2024-02-29", to: "2024-03-01", partyName: " Acme & Sons/東京? #1 ",
    createdBy: "user+ops@example.com", currency: "USD & CNY", source: "history/import",
  };
  const query = helper.analysisQuery("sales", filters);
  const params = new URLSearchParams(query);
  assert.equal(params.get("type"), "sales");
  assert.equal(params.get("q"), "单号 & note");
  assert.equal(params.get("partyName"), "Acme & Sons/東京? #1");
  assert.equal(params.get("createdBy"), "user+ops@example.com");
  assert.equal(params.get("currency"), "USD & CNY");
  assert.equal(params.get("source"), "history/import");
  assert.match(query, /%E6%9D%B1%E4%BA%AC/);

  const snapshot = helper.emptyAnalysisFilters("2024-02-29");
  assert.deepEqual(snapshot, { q: "", from: "2024-02-29", to: "2024-02-29", partyName: "", createdBy: "", currency: "", source: "" });
  assert.notEqual(snapshot, helper.emptyAnalysisFilters("2024-02-29"));
  assert.equal(helper.analysisQuery("purchase", { ...snapshot, partyName: "  ", createdBy: "\t", currency: "", source: "" }), "type=purchase&from=2024-02-29&to=2024-02-29");
  assert.equal(helper.analysisFilterError({ ...snapshot, from: "2023-02-29" }), "请输入有效日期。");
  assert.equal(helper.analysisFilterError({ ...snapshot, to: "2024-02-30" }), "请输入有效日期。");
  assert.equal(helper.analysisFilterError({ ...snapshot, from: "2024-03-02", to: "2024-03-01" }), "开始日期不能晚于结束日期。");
  assert.equal(helper.analysisFilterError({ ...snapshot, from: "2024-02-29", to: "2024-03-01" }), "");

  const today = new Date(2025, 0, 1, 12);
  assert.deepEqual(helper.analysisPreset("week", today), { from: "2024-12-30", to: "2025-01-01" });
  assert.deepEqual(helper.analysisPreset("month", today), { from: "2025-01-01", to: "2025-01-01" });
  assert.deepEqual(helper.analysisPreset("year", today), { from: "2025-01-01", to: "2025-01-01" });
  const olderDate = new Date(2023, 5, 19, 12);
  assert.deepEqual(helper.analysisPreset("week", olderDate), { from: "2023-06-19", to: "2023-06-19" });
});

test("daily analysis filter persistence is scoped, date-bound, allowlisted, and fail-safe", async () => {
  const result = await build({ entryPoints: [join(clientDir, "src/daily-analysis-state.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const state = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const values = new Map();
  const previousStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const filters = { q: "invoice 42", from: "2025-01-01", to: "2025-01-15", partyName: "Acme", createdBy: "u1", currency: "USD", source: "manual" };
    state.saveAnalysisState("tenant:user:daily-filters:daily-sales-analysis", "2025-01-15", filters);
    assert.deepEqual(state.readAnalysisState("tenant:user:daily-filters:daily-sales-analysis", "2025-01-15"), filters);
    assert.notDeepEqual(state.readAnalysisState("tenant:user:daily-filters:daily-sales", "2025-01-15"), filters);
    assert.equal(state.readAnalysisState("tenant:user:daily-filters:daily-sales-analysis", "2025-01-16").q, "");
    const stored = JSON.parse(values.get("tenant:user:daily-filters:daily-sales-analysis"));
    assert.deepEqual(Object.keys(stored.filters).sort(), ["createdBy", "currency", "from", "partyName", "q", "source", "to"]);
    stored.filters.q = "x".repeat(501);
    values.set("tampered", JSON.stringify(stored));
    assert.equal(state.readAnalysisState("tampered", "2025-01-15").q, "");
    values.set("invalid", "{");
    assert.equal(state.readAnalysisState("invalid", "2025-01-15").q, "");
  } finally { globalThis.sessionStorage = previousStorage; }
});

test("daily business analysis SSR renders records and analysis as explicit views without embedded tabs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plm-daily-analysis-render-"));
  try {
    const result = await build({
      stdin: {
        resolveDir: clientDir,
        loader: "tsx",
        contents: `import React from 'react';
import { renderToString } from 'react-dom/server';
import DailyBusinessAnalysis from './src/DailyBusinessAnalysis';
const noop = () => {};
const views = [['sales','records'],['purchase','records'],['sales','analysis'],['purchase','analysis']];
const htmls = views.map(([kind,view]) => renderToString(<DailyBusinessAnalysis kind={kind} view={view} date="2025-01-15" canWrite={false} canManage={false} revision={0} onNew={noop} onImport={noop} onDetail={noop} onEdit={noop}/>));
for (const [index, [kind,view]] of views.entries()) {
  const noun = kind === 'sales' ? '销售' : '采购';
  const html = htmls[index];
  if (!html.includes(noun + (view === 'records' ? '日报明细' : '统计分析'))) throw new Error(kind + '/' + view + ' title absent');
  if (view === 'analysis' && !html.includes(kind === 'sales' ? '客户名称' : '供应商名称')) throw new Error(kind + ' party filter absent');
  if (html.includes('新增' + noun + '日报') || html.includes('导入往期' + noun + '日报')) throw new Error(kind + ' permission-gated actions visible');
  if (html.includes('records-tab') || html.includes('analysis-tab') || /role="tab"/.test(html)) throw new Error(kind + '/' + view + ' contains embedded view tabs');
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error(kind + ' duplicate IDs: ' + ids.join(','));
  if (view === 'analysis' && (!html.includes('本周') || !html.includes('本月') || !html.includes('本年') || !html.includes('覆盖上方旧日期'))) throw new Error(kind + ' presets absent');
}
if (htmls.length !== 4 || new Set(views.map(([kind,view]) => kind + ':' + view)).size !== 4) throw new Error('four independent route/view combinations were not rendered');
for (const [kind,view] of views) for (const [canWrite,canManage] of [[false,false],[true,false],[false,true],[true,true]]) {
  const noun = kind === 'sales' ? '销售' : '采购';
  const html = renderToString(<DailyBusinessAnalysis kind={kind} view={view} date="2025-01-15" canWrite={canWrite} canManage={canManage} revision={0} onNew={noop} onImport={noop} onDetail={noop} onEdit={noop}/>).replaceAll("<!-- -->", "");
  if (html.includes('新增' + noun + '日报') !== (view === 'records' && canWrite)) throw new Error(kind + '/' + view + ' new action scope/permission mismatch');
  if (html.includes('导入往期' + noun + '日报') !== (view === 'records' && canManage)) throw new Error(kind + '/' + view + ' import action scope/permission mismatch');
  if (view === 'analysis' && html.includes('dr-list-actions')) throw new Error(kind + ' analysis includes record action container');
  if (!html.includes('应用筛选') || !html.includes('导出当前口径 Excel')) throw new Error(kind + '/' + view + ' read controls absent');
}

console.log('daily business analysis SSR checks passed');`,
      },
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      loader: { ".css": "empty" },
      jsx: "automatic",
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      logLevel: "silent",
    });
    const file = join(dir, "render-smoke.mjs");
    writeFileSync(file, result.outputFiles[0].text);
    const run = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 20_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /daily business analysis SSR checks passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("daily analysis stays embedded in the existing reporting workbench and exports applied result filters", async () => {
  const { readFileSync } = await import("node:fs");
  const workbench = readFileSync(join(clientDir, "src/DailyReportingWorkbench.tsx"), "utf8");
  const component = readFileSync(join(clientDir, "src/DailyBusinessAnalysis.tsx"), "utf8");
  assert.match(workbench, /<DailyBusinessAnalysis[\s\S]*?\/>/);
  assert.match(workbench, /daily-sales-analysis/);
  assert.match(workbench, /daily-purchase-analysis/);
  assert.match(workbench, /key=\{page\}/);
  assert.match(workbench, /view=\{page\.endsWith\("-analysis"\) \? "analysis" : "records"\}/);
  assert.doesNotMatch(workbench, /daily-analysis-new|analysis-new/);
  assert.doesNotMatch(component, /records-tab|analysis-tab|role="tab"|setView|activeTab/);
  assert.match(component, /const exportQuery = analysisQuery\(kind, result\.filters\)/);
  assert.doesNotMatch(component, /analysisQuery\(kind, draft\).*export/);
});

test("daily leaf filters are not editor drafts and unauthorized deep links cannot mount a tab", () => {
  const component = readFileSync(join(clientDir, "src/DailyBusinessAnalysis.tsx"), "utf8");
  const app = readFileSync(join(clientDir, "src/App.tsx"), "utf8");
  assert.match(component, /role="search"/);
  assert.doesNotMatch(component, /<form/);
  assert.match(component, /event\.key === "Enter"/);
  assert.match(app, /setAuthLoading\(true\); setDailyAccess\(null\); setDailyAccessReady\(false\)/);
  assert.match(app, /const deniedDailyLeaf = Boolean\(authUser && dailyAccessReady/);
  assert.match(app, /if \(deniedDailyLeaf\) setPage\('overview'\)/);
  assert.match(app, /if \(authLoading \|\| \(authUser && !dailyAccessReady\) \|\| deniedDailyLeaf\) return/);
});
