import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("daily import audit renders as a separate tab from migration batches", async () => {
  const clientDir = resolve(import.meta.dirname, "..");
  const dir = mkdtempSync(join(tmpdir(), "daily-import-history-render-"));
  try {
    const result = await build({
      stdin: {
        resolveDir: clientDir,
        loader: "tsx",
        contents: `import React from 'react'; import { renderToString } from 'react-dom/server'; import DailyReportImportHistory from './src/DailyReportImportHistory'; const html = renderToString(<DailyReportImportHistory migration={<div aria-label="migration-audit">基础资料批次</div>} />); if (!html.includes('role="tablist"') || !html.includes('aria-selected="true"') || !html.includes('基础资料迁移批次') || !html.includes('销售 / 采购日报批次') || !html.includes('migration-audit') || html.includes('SHA-256')) throw new Error('separate tabs/migration initial state were not rendered correctly'); console.log('daily import history render contract passed');`,
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
    const file = join(dir, "render.mjs");
    writeFileSync(file, result.outputFiles[0].text);
    const run = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 20_000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /daily import history render contract passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
