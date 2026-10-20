import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import { matches, normalizeEvents, isEmptyValue } from '../dist/forms-dsl.js'

// Compile the actual browser-side pure rules, not a second test-only implementation.
const source = readFileSync(new URL('../../client/src/formRules.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const browser = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('form renderer and API agree on empty values including zero and empty multi-select', () => {
  for (const value of [undefined, null, '', [], 0, false, '0', ['x'], 'text']) {
    assert.equal(browser.isEmptyValue(value), isEmptyValue(value), JSON.stringify(value))
  }
  assert.equal(isEmptyValue(0), false)
  assert.equal(isEmptyValue([]), true)
})

test('form renderer and API agree on all supported condition operators', () => {
  for (const value of ['', 'x', 'y', 0, 1, false, true, undefined, ['x']]) {
    for (const condition of [undefined,
      { field: 'source', op: 'eq', value: 'x' },
      { field: 'source', op: 'neq', value: 0 },
      { field: 'source', op: 'in', value: ['x', 0, false] },
    ]) {
      assert.equal(browser.conditionMatches(condition, { source: value }), matches(condition, { source: value }))
    }
  }
})

test('form renderer and API use identical ordered event normalization without mutating inputs', () => {
  const definition = {
    dslVersion: 1,
    fields: ['source', 'target', 'tail'].map(id => ({ id, label: id, type: 'text' })),
    events: [
      { on: 'change', field: 'source', actions: [{ type: 'set', target: 'target', value: 'linked' }] },
      { on: 'change', field: 'target', actions: [{ type: 'clear', target: 'tail' }] },
    ],
  }
  for (const values of [{ source: 'x', tail: 'old' }, { source: '', tail: 'old' }, { source: 0, tail: 'old' }]) {
    const before = structuredClone(values)
    assert.deepEqual(browser.normalizeEvents(definition, values), normalizeEvents(definition, values))
    assert.deepEqual(values, before)
  }
  assert.deepEqual(normalizeEvents(definition, { source: 'x', tail: 'old' }), { source: 'x', target: 'linked' })
})

test('changing one browser field normalizes the complete rule set exactly as submission does', () => {
  const definition = {
    dslVersion: 1,
    fields: ['source', 'target', 'other'].map(id => ({ id, label: id, type: 'text' })),
    events: [{ on: 'change', field: 'source', actions: [{ type: 'set', target: 'target', value: 'derived' }] }],
  }
  const prior = { source: 'active', target: 'tampered' }
  assert.deepEqual(browser.applyEvents(definition, 'other', 'changed', prior),
    normalizeEvents(definition, { ...prior, other: 'changed' }))
})
