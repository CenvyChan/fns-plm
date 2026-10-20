import test from 'node:test'
import assert from 'node:assert/strict'
import { conditionMatches, applyEvents, normalizeEvents, isEmptyValue } from '../src/formRules.ts'

test('DSL conditions evaluate eq, neq and in without executing expressions', () => {
  const values = { status: 'approved', count: 4 }
  assert.equal(conditionMatches({ field: 'status', op: 'eq', value: 'approved' }, values), true)
  assert.equal(conditionMatches({ field: 'count', op: 'neq', value: 4 }, values), false)
  assert.equal(conditionMatches({ field: 'status', op: 'in', value: ['pending', 'approved'] }, values), true)
  assert.equal(conditionMatches(undefined, values), true)
})

test('change actions only set/clear the named target', () => {
  const definition = { dslVersion: 1, fields: [], events: [{ on: 'change', field: 'country', actions: [{ type: 'set', target: 'region', value: 'north' }, { type: 'clear', target: 'city' }] }] }
  assert.deepEqual(applyEvents(definition, 'country', 'CN', { city: 'Shanghai' }), { country: 'CN', region: 'north' })
  assert.deepEqual(applyEvents(definition, 'other', 'x', { city: 'Shanghai' }), { other: 'x', city: 'Shanghai' })
})

test('event normalization is ordered and single pass, and skips empty sources', () => {
  const definition = { dslVersion: 1, fields: [], events: [
    { on: 'change', field: 'country', actions: [{ type: 'set', target: 'region', value: 'north' }] },
    { on: 'change', field: 'region', actions: [{ type: 'set', target: 'city', value: 'Shanghai' }] },
    { on: 'change', field: 'empty', actions: [{ type: 'set', target: 'wrong', value: 'x' }] },
  ] }
  assert.deepEqual(normalizeEvents(definition, { country: 'CN', empty: '', count: 0 }), { country: 'CN', region: 'north', empty: '', count: 0, city: 'Shanghai' })
  assert.deepEqual(applyEvents(definition, 'country', 'CN', { empty: '' }), { country: 'CN', region: 'north', empty: '', city: 'Shanghai' })
})

test('empty-value logic treats zero as a value and empty arrays as missing', () => {
  assert.equal(isEmptyValue(undefined), true)
  assert.equal(isEmptyValue(''), true)
  assert.equal(isEmptyValue([]), true)
  assert.equal(isEmptyValue(0), false)
  assert.equal(isEmptyValue(false), false)
  assert.equal(isEmptyValue(['selected']), false)
})
