import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { feedbackDuration, persistentFeedbackSelector, transientFeedbackSelector } from '../src/workspace-feedback.ts'
const source = await readFile(new URL('../src/WorkspaceFeedback.tsx', import.meta.url), 'utf8')
const tabs = await readFile(new URL('../src/WorkspaceTabs.tsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/workspace-tabs.css', import.meta.url), 'utf8')
test('feedback allowlist never treats generic status, errors or source warnings as success', () => {
  assert.doesNotMatch(transientFeedbackSelector, /role|dr-source|dr-import|test-result/)
  for (const name of ['iw-success', 'connector-notice', 'fd-notice', 'fvp-notice', 'bpmn-notice']) assert.ok(transientFeedbackSelector.includes(name))
  for (const name of ['dr-migration-import', 'persistent', 'role="alert"', 'iw-error']) assert.ok(persistentFeedbackSelector.includes(name))
})
test('transient messages have bounded reading time', () => {
  assert.equal(feedbackDuration('已保存'), 6000)
  assert.equal(feedbackDuration('字'.repeat(80)), 9600)
  assert.equal(feedbackDuration('字'.repeat(300)), 16000)
})
test('feedback is isolated, deduplicated and does not remove actionable inline content', () => {
  assert.match(source, /if \(!active \|\| !root.current \|\| !host\)/)
  assert.match(source, /new WeakMap/)
  assert.match(source, /node.closest\(persistentFeedbackSelector\)/)
  assert.match(source, /button:not/)
  assert.match(source, /observer.disconnect\(\)/)
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /onMouseEnter/)
  assert.match(source, /onFocusCapture/)
  assert.doesNotMatch(source, /sessionStorage|localStorage|fetch\(/)
})
test('tab rail and panel share one continuous surface without the old gap', () => {
  assert.match(tabs, /className="workspace-frame"/)
  assert.match(tabs, /<WorkspaceFeedback root=\{root\} host=\{host\} active=\{active\}/)
  assert.match(css, /\.workspace-tabs \{[^}]*padding: 0; margin: 0;/)
  assert.match(css, /\.workspace-tab.is-active \{[^}]*border-bottom-color: #fff;/)
  assert.match(css, /\.workspace-tab-panel\[hidden\] \{ display: none !important;/)
})
test('long tab rows reveal the selected tab after content changes the available width', () => {
  assert.match(tabs, /new ResizeObserver\(reveal\)/)
  assert.match(tabs, /observer.observe\(row\)/)
  assert.match(css, /scrollbar-width: none/)
})
test('history nesting can shrink while its complete table remains scrollable', async () => {
  const shared = await readFile(new URL('../src/design-system.css', import.meta.url), 'utf8')
  assert.match(shared, /\.dr-admin :is\([^}]+min-width: 0; max-width: 100%;/)
  assert.match(shared, /\.dr-admin \.iw-table-wrap \{ max-width: 100%; overflow-x: auto;/)
  assert.match(shared, /\.workflow-entry-tabs > button.active/)
})
test('role-only changes and newly actionable results regain their inline presentation', () => {
  assert.match(source, /attributeFilter: \['class', 'role', 'data-feedback'\]/)
  assert.match(source, /node\.querySelector\(actionableContent\)\) node\.removeAttribute/)
  assert.match(source, /useState\(\(\) => document\.hidden\)/)
})
