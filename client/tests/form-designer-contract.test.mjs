import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const clientDir = resolve(import.meta.dirname, '..')
test('renderer SSR marks only explicitly/conditionally required fields and disables gated fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'form-render-'))
  try {
    const result = await build({ stdin: { resolveDir: clientDir, loader: 'tsx', contents: `import React from 'react'; import {renderToString} from 'react-dom/server'; import {DefaultFormRenderer} from './src/FormDesignerWorkbench'; const d={dslVersion:1,fields:[{id:'a',label:'Optional',type:'text'},{id:'b',label:'Required',type:'text',required:true},{id:'c',label:'Conditional',type:'text',requiredWhen:{field:'flag',op:'eq',value:true}},{id:'d',label:'Disabled',type:'text',enabledWhen:{field:'flag',op:'eq',value:true}}]}; const html=renderToString(React.createElement(DefaultFormRenderer,{definition:d,values:{flag:false},onChange:()=>{}})); if((html.match(/必填/g)||[]).length!==1) throw Error(html); if(!html.includes('disabled')||!html.includes('当前条件不满足')) throw Error(html); console.log('SSR contract passed')` }, bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty' }, jsx: 'automatic', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: 'silent' })
    const file = join(dir, 'render.mjs'); writeFileSync(file, result.outputFiles[0].text); const run = spawnSync(process.execPath, [file], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr || run.stdout); assert.match(run.stdout, /SSR contract passed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP adapter uses revision to select POST create and checks all GET responses', () => {
  const source = readFileSync(join(clientDir, 'src/FormDesignerWorkbench.tsx'), 'utf8')
  assert.match(source, /save: \(key, name, definition, revision\) => revision === undefined\s+\? checkedJson\('\/api\/forms', \{ method: 'POST', body: JSON\.stringify\(\{ key, name, definition \}\) \}\)/)
  assert.match(source, /get: key => checkedJson/); assert.match(source, /list: \(\) => checkedJson/); assert.match(source, /versions: key => checkedJson/); assert.match(source, /version: \(key, version\) => checkedJson/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(await responseError\(response\)\)/)
  assert.match(source, /JSON\.stringify\(\{ values, taskId \}\)/)
})
