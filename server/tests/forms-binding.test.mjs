import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowableFormKey, parseFlowableFormKey } from '../dist/form-binding.js'

test('Flowable form key round-trips only immutable pinned form identities', () => {
  const binding = { formKey: 'inspection', formVersion: 12 }
  assert.equal(flowableFormKey(binding), 'plm-form:inspection:v12')
  assert.deepEqual(parseFlowableFormKey(flowableFormKey(binding)), binding)
  for (const value of [null, 'inspection', 'plm-form:inspection:latest', 'plm-form:inspection:v0', 'plm-form:inspection:v01', 'plm-form:inspection:v9007199254740992', 'https://example.invalid/form']) {
    assert.equal(parseFlowableFormKey(value), null)
  }
  assert.throws(() => flowableFormKey({ formKey: '../invalid', formVersion: 1 }))
  assert.throws(() => flowableFormKey({ formKey: 'inspection', formVersion: 0 }))
})
