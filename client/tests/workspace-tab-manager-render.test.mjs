import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('tab manager renders record identities, unsaved state, current marker and disabled empty selection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-manager-render-'))
  try {
    const result = await build({
      stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
        import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import Manager from './src/WorkspaceTabManager';
        const tabs = [{id:'daily-sales',page:'daily-sales-edit',url:'/'},{id:'materials',page:'materials',url:'/'}];
        const html = renderToStaticMarkup(<Manager tabs={tabs} activeId="materials" dirty={{'daily-sales':true}} label={tab => tab.id === 'materials' ? '物料 · 样例 · #instance-001' : '销售日报 · 2026-10-21 · #DR-001'} onClose={()=>{}} onCloseTabs={()=>false}/>);
        for(const expected of ['<dialog','aria-labelledby="workspace-manager-title"','type="checkbox"','销售日报 · 2026-10-21 · #DR-001','物料 · 样例 · #instance-001','未保存内容','当前页签','disabled=""','关闭所选（0）']) if(!html.includes(expected)) throw Error('Missing rendered manager contract: '+expected);
        if((html.match(/type="checkbox"/g)||[]).length!==2) throw Error('Expected checkbox per record');
        console.log('workspace manager render passed');
      ` },
      bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', logLevel: 'silent',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    })
    const file = join(dir, 'render.mjs')
    writeFileSync(file, result.outputFiles[0].text)
    const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /workspace manager render passed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
