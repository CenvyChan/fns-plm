import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root=resolve(import.meta.dirname,'../src')
test('full-width workspace overrides old centered gutters after base styles and preserves navigation',()=>{
  const main=readFileSync(resolve(root,'main.tsx'),'utf8'),css=readFileSync(resolve(root,'workspace-layout.css'),'utf8'),tabs=readFileSync(resolve(root,'workspace-tabs.css'),'utf8')
  for(const name of ['styles.css','workspace-tabs.css','overview-metrics.css'])assert.ok(main.indexOf(`'./workspace-layout.css'`)>main.indexOf(`'./${name}'`))
  const content=css.match(/\.app-shell \.content-area\s*\{([^}]+)\}/)?.[1]
  assert.ok(content);for(const rule of ['max-width: none','width: 100%','margin: 0','padding: 0'])assert.ok(content.includes(rule))
  assert.match(css,/\.workspace-frame > \.workspace-tab-panel\s*\{[^}]*padding: 12px/)
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*\.workspace-frame > \.workspace-tab-panel\s*\{[^}]*padding: 8px/)
  assert.match(css,/\.workspace-tab-panel > \.iw-page\s*\{\s*padding: 0/)
  assert.match(css,/\.workspace-frame > \.workspace-tabs\s*\{[^}]*top: var\(--workspace-header-height\)/)
  assert.match(tabs,/\.workspace-tab-panel\[hidden\]\s*\{\s*display: none !important/)
  assert.doesNotMatch(css,/\.(?:sidebar|topbar|workspace-tabs)\s*\{[^}]*display:\s*none/)
})
