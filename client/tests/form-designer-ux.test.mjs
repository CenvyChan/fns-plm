import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const clientDir = resolve(import.meta.dirname, '..')

test('partition renderer SSR groups visible fields, escapes hostile content, and accepts legacy DSL v1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'form-designer-ux-'))
  try {
    const result = await build({ stdin: { resolveDir: clientDir, loader: 'tsx', contents: `import React from 'react'; import {renderToString} from 'react-dom/server'; import {DefaultFormRenderer} from './src/FormDesignerWorkbench'; const section={id:'s',title:'<script>alert(1)</script>',description:'& details'}; const d={dslVersion:1,sections:[section],fields:[{id:'a',label:'<img src=x onerror=alert(1)>',type:'text',section:'s'},{id:'hidden',label:'Hidden',type:'text',section:'s',visibleWhen:{field:'flag',op:'eq',value:true}},{id:'b',label:'Plain',type:'text'}]}; const html=renderToString(React.createElement(DefaultFormRenderer,{definition:d,values:{flag:false},onChange:()=>{}})); if(!html.includes('&lt;script&gt;')||html.includes('<script>')||html.includes('<img')) throw Error('unsafe/unescaped rendered content: '+html); if(!html.includes('fd-section-heading')||!html.includes('Plain')||html.includes('Hidden')) throw Error('partition/visibility rendering failed: '+html); const legacy=renderToString(React.createElement(DefaultFormRenderer,{definition:{dslVersion:1,fields:[{id:'old',label:'Legacy field',type:'text'}]},values:{old:'ok'},onChange:()=>{}})); if(!legacy.includes('Legacy field')||legacy.includes('fd-section-heading')) throw Error('legacy DSL compatibility failed: '+legacy); console.log('renderer SSR contracts passed')` }, bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty' }, jsx: 'automatic', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: 'silent' })
    const file = join(dir, 'render.mjs'); writeFileSync(file, result.outputFiles[0].text)
    const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout); assert.match(run.stdout, /renderer SSR contracts passed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('rule inspector and fixed-version manager SSR expose ordered-rule and governance affordances', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'form-designer-ux-'))
  try {
    const result = await build({ stdin: { resolveDir: clientDir, loader: 'tsx', contents: `import React from 'react'; import {renderToString} from 'react-dom/server'; import Inspector from './src/FormRuleInspector'; import VersionManager from './src/FormVersionManager'; const definition={dslVersion:1,fields:[{id:'source',label:'Source',type:'text'},{id:'target',label:'Target',type:'text'}],events:[{on:'change',field:'source',actions:[{type:'set',target:'target',value:'first'},{type:'set',target:'target',value:'last'}]}]}; const i=renderToString(React.createElement(Inspector,{definition,field:definition.fields[0],onChange:()=>{},onEventsChange:()=>{}})); if(!i.includes('按定义顺序执行')||!i.includes('字段变更联动')||!i.includes('联动目标1')) throw Error('rule event controls missing: '+i); const v=renderToString(React.createElement(VersionManager,{formKey:'f',versions:[1,2],activeVersion:1,onChange:()=>{}})); for(const text of ['激活历史版本','激活仅切换回滚指针','登记流程节点绑定','不会部署到 Flowable','固定登记标识']) if(!v.includes(text)) throw Error('fixed-version governance copy missing '+text); console.log('inspector/version SSR contracts passed')` }, bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty' }, jsx: 'automatic', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: 'silent' })
    const file = join(dir, 'render.mjs'); writeFileSync(file, result.outputFiles[0].text)
    const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout); assert.match(run.stdout, /inspector\/version SSR contracts passed/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('event normalization preserves declaration order and old DSL without optional rules remains valid', async () => {
  const result = await build({ stdin: { resolveDir: clientDir, loader: 'ts', contents: `import {applyEvents,normalizeEvents} from './src/formRules'; const legacy={dslVersion:1,fields:[{id:'q',type:'text'}]}; if(normalizeEvents(legacy,{q:'x'}).q!=='x') throw Error('legacy DSL failed'); const d={dslVersion:1,fields:[{id:'a'},{id:'b'},{id:'c'}],events:[{on:'change',field:'a',actions:[{type:'set',target:'b',value:'from-a'}]},{on:'change',field:'b',actions:[{type:'set',target:'c',value:'from-b'},{type:'clear',target:'a'}]}]}; const values=applyEvents(d,'a','go',{c:'old'}); if(values.b!=='from-a'||values.c!=='from-b'||'a' in values) throw Error(JSON.stringify(values)); const empty=applyEvents(d,'a','',{b:'keep'}); if(empty.b!=='keep') throw Error('clearing source unexpectedly fired change rules'); console.log('event order/legacy contracts passed')` }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const dir = mkdtempSync(join(tmpdir(), 'form-rules-ux-'))
  try { const file = join(dir, 'rules.mjs'); writeFileSync(file, result.outputFiles[0].text); const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 }); assert.equal(run.status, 0, run.stderr || run.stdout); assert.match(run.stdout, /event order\/legacy contracts passed/) } finally { rmSync(dir, { recursive: true, force: true }) }
})
