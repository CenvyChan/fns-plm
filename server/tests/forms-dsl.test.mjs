import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDefinition, validateValues, normalizeEvents } from '../dist/forms-dsl.js'

const scope = { tenantId: 't', organizationId: 'o', accountId: 'a' }
const field = (id, overrides = {}) => ({ id, label: id, type: 'text', ...overrides })

test('strict DSL rejects unknown properties, prototype IDs and executable configuration', () => {
  assert.doesNotThrow(() => validateDefinition({ dslVersion: 1, fields: [field('code', { pattern: '^[A-Z][A-Z0-9_-]{0,31}$' })] }))
  for (const definition of [
    { dslVersion: 1, fields: [field('x', { evil: 'x' })] },
    { dslVersion: 1, fields: [field('__proto__')] },
    { dslVersion: 1, fields: [field('constructor')] },
    { dslVersion: 1, fields: [field('x', { requiredWhen: null })] },
    { dslVersion: 1, fields: [field('x', { visibleWhen: false })] },
    { dslVersion: 1, fields: [field('x', { min: -1 })] },
    { dslVersion: 1, fields: [field('x', { pattern: '(a+)+' })] },
  ]) assert.throws(() => validateDefinition(definition))
})

test('hidden and disabled required fields may be empty but supplied values are rejected', () => {
  const definition = validateDefinition({ dslVersion: 1, fields: [
    field('gate'), field('secret', { required: true, visibleWhen: { field: 'gate', op: 'eq', value: 'yes' } }),
  ] })
  assert.deepEqual(validateValues(definition, { gate: 'no' }, scope, () => false), { gate: 'no' })
  assert.throws(() => validateValues(definition, { gate: 'no', secret: 'hidden' }, scope, () => false), /not editable/)
  assert.throws(() => validateValues(definition, { gate: 'yes' }, scope, () => false), /required/)
})

test('safe regex subset allows practical IDs and forbids combinatorial backtracking', () => {
  for (const pattern of ['[0-9]{3,8}', '^[A-Z][A-Z0-9_-]{0,31}$', 'ABC[0-9]{3}']) {
    assert.doesNotThrow(() => validateDefinition({ dslVersion: 1, fields: [field('code', { pattern })] }))
  }
  for (const pattern of ['(a+)+$', 'a{0,100}a{0,100}', 'a?a?', 'a*', 'a+', '(x|y)', '\\1']) {
    assert.throws(() => validateDefinition({ dslVersion: 1, fields: [field('code', { pattern })] }), /pattern/)
  }
})

test('forward event dependencies normalize idempotently and never recurse', () => {
  const definition = validateDefinition({ dslVersion: 1, fields: [field('source'), field('target'), field('tail')], events: [
    { on: 'change', field: 'source', actions: [{ type: 'set', target: 'target', value: 'derived' }] },
    { on: 'change', field: 'target', actions: [{ type: 'clear', target: 'tail' }] },
  ] })
  const normalized = normalizeEvents(definition, { source: 'active', tail: 'old' })
  assert.deepEqual(normalized, { source: 'active', target: 'derived' })
  assert.deepEqual(normalizeEvents(definition, normalized), normalized)
  assert.deepEqual(validateValues(definition, { source: 'active', tail: 'old' }, scope, () => false), normalized)
  const fields = [field('a'), field('b')]
  for (const events of [
    [{ on: 'change', field: 'a', actions: [{ type: 'set', target: 'a', value: 'loop' }] }],
    [{ on: 'change', field: 'b', actions: [] }, { on: 'change', field: 'a', actions: [{ type: 'set', target: 'b', value: 'back-edge' }] }],
    [{ on: 'change', field: 'a', actions: [] }, { on: 'change', field: 'a', actions: [] }],
  ]) assert.throws(() => validateDefinition({ dslVersion: 1, fields, events }))
})

test('DSL v1 sections remain optional, require unique safe IDs and valid field references', () => {
  assert.doesNotThrow(() => validateDefinition({ dslVersion: 1, fields: [field('legacy')] }))
  assert.deepEqual(validateDefinition({ dslVersion: 1, sections: [{ id: 'main', title: 'Main', description: 'Details' }], fields: [field('code', { section: 'main' })] }).sections[0].id, 'main')
  for (const sections of [[{ id: 'x', title: 'X' }, { id: 'x', title: 'Again' }], [{ id: '__proto__', title: 'Unsafe' }]]) assert.throws(() => validateDefinition({ dslVersion: 1, sections, fields: [field('code')] }))
  assert.throws(() => validateDefinition({ dslVersion: 1, sections: [{ id: 'known', title: 'Known' }], fields: [field('code', { section: 'missing' })] }), /section/)
})
