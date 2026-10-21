import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/design-system.css', import.meta.url), 'utf8');
const doc = await readFile(new URL('../../docs/UI_DESIGN_SYSTEM.md', import.meta.url), 'utf8');

test('design system publishes shared palette and 4px spacing tokens', () => {
  for (const token of ['--ui-ink', '--ui-accent', '--ui-success', '--ui-warning', '--ui-danger', '--ui-space-1', '--ui-space-6']) {
    assert.match(css, new RegExp(token));
  }
  assert.match(doc, /4\/8\/12\/16\/24px/);
});

test('shared rules are scoped and preserve accessible focus and table overflow', () => {
  assert.match(css, /\.dr-section/);
  assert.match(css, /\.plm-page/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /\.bpmn-[\w-]*\s*\{/);
  assert.match(doc, /不截断、不隐藏列或数据/);
});

test('modal and responsive contracts remain viewport bounded', () => {
  assert.match(css, /\.document-preview-modal/);
  assert.match(css, /max-width:\s*calc\(100vw/);
  assert.match(css, /max-height:\s*calc\(100dvh/);
  assert.match(doc, /375px、768px/);
});
