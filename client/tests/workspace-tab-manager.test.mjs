import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
const result = await build({ entryPoints: [new URL('../src/workspace-tabs.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' })
const { planTabClose, TAB_WARNING_THRESHOLD } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const tabs = ['overview', 'tasks', 'materials'].map(id => ({ id, page: id, url: `/?page=${id}` }))
test('soft warning threshold is eight, with no automatic eviction', () => { assert.equal(TAB_WARNING_THRESHOLD, 8) })
test('batch planning deduplicates selection and rejects unknown tab ids', () => {
  const result = planTabClose(tabs, ['tasks', 'tasks', 'unknown'], { tasks: true }, 'materials')
  assert.deepEqual(result.closing.map(t => t.id), ['tasks'])
  assert.deepEqual(result.unsaved.map(t => t.id), ['tasks'])
  assert.equal(result.target.id, 'materials')
  assert.equal(tabs.length, 3)
})
test('closing current tab chooses a remaining tab, all closed returns overview fallback', () => {
  assert.equal(planTabClose(tabs, ['materials'], {}, 'materials').target.id, 'tasks')
  const all = planTabClose(tabs, tabs.map(t => t.id), { materials: true, tasks: true }, 'materials')
  assert.equal(all.target, undefined)
  assert.deepEqual(all.remaining, [])
  assert.equal(all.unsaved.length, 2)
})
test('empty selection and hidden draft states remain intact in planning', () => {
  const dirty = { tasks: true }
  const result = planTabClose(tabs, [], dirty, 'overview')
  assert.deepEqual(result.remaining, tabs)
  assert.deepEqual(result.closing, [])
  assert.deepEqual(dirty, { tasks: true })
})
test('UI confirms the entire batch before mutation and exposes modal keyboard support', () => {
  const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
  const source = read('WorkspaceTabs.tsx'), manager = read('WorkspaceTabManager.tsx')
  assert.ok(source.indexOf('window.confirm(`所选页签') < source.indexOf('setTabs(remaining)'))
  assert.match(source, /dirtyRef.current/)
  assert.match(source, /role="status">页签较多/)
  assert.match(manager, /showModal\(\)/)
  assert.match(manager, /onCancel=/)
  assert.match(manager, /previous\?\.focus\(\)/)
  assert.match(manager, /type="checkbox"/)
  assert.match(manager, /if \(onCloseTabs\(chosen\)\) onClose\(\)/)
})
test('header entry portals the existing manager state without a duplicate toolbar or tab store', () => {
  const source = readFileSync(new URL('../src/WorkspaceTabs.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /workspace-tabs-toolbar/)
  assert.match(source, /managerTarget && createPortal/)
  assert.match(source, /aria-haspopup="dialog" aria-expanded=\{managerOpen\}/)
  assert.match(source, /管理页签，已打开 \$\{tabs.length\} 个页签/)
  assert.match(source, /onClick=\{\(\) => setManagerOpen\(true\)\}/)
  assert.match(app, /className="workspace-manager-slot" ref=\{tabManagerSlotRef\}\/><div className="notification-wrap"/)
  assert.match(app, /<WorkspaceTabs managerTarget=\{tabManagerTarget\}/)
  assert.doesNotMatch(app, /setTabs|setManagerOpen/)
})
