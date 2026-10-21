import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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

test("daily business analysis SSR exposes sales and purchase controls with unique tab IDs", async () => {
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
const htmls = ['sales','purchase'].map(kind => renderToString(<DailyBusinessAnalysis kind={kind} date="2025-01-15" canWrite={false} canManage={false} revision={0} onNew={noop} onImport={noop} onDetail={noop} onEdit={noop}/>));
for (const [index, kind] of ['sales','purchase'].entries()) {
  const html = htmls[index];
  if (!html.includes(kind === 'sales' ? '销售日报与分析' : '采购日报与分析')) throw new Error(kind + ' title absent');
  if (!html.includes(kind === 'sales' ? '客户名称' : '供应商名称')) throw new Error(kind + ' party filter absent');
  if (html.includes('新增' + (kind === 'sales' ? '销售' : '采购') + '日报') || html.includes('导入往期' + (kind === 'sales' ? '销售' : '采购') + '日报')) throw new Error(kind + ' permission-gated actions visible');
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) throw new Error(kind + ' duplicate IDs: ' + ids.join(','));
  for (const suffix of ['records-tab','analysis-tab']) if (!html.includes('dba-' + kind + '-' + suffix)) throw new Error(kind + ' tab missing ' + suffix);
  if (!html.includes('本周') || !html.includes('本月') || !html.includes('本年') || !html.includes('覆盖上方旧日期')) throw new Error(kind + ' presets absent');
}
if (new Set(htmls.flatMap(html => [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]))).size !== 4) throw new Error('sales and purchase IDs are not mutually unique');
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
  assert.match(workbench, /page === "daily-sales" \|\| page === "daily-purchase"/);
  assert.doesNotMatch(workbench, /daily-analysis-new|analysis-new/);
  assert.match(component, /const exportQuery = analysisQuery\(kind, result\.filters\)/);
  assert.doesNotMatch(component, /analysisQuery\(kind, draft\).*export/);
});
