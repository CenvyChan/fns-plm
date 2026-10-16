import assert from 'node:assert/strict'
import { test } from 'node:test'
import { K3_FORM_CATALOG, K3_FORM_CATALOG_NOTE } from '../dist/k3cloud-form-catalog.js'

test('uploaded form catalog preserves evidence labels and never supplies target-account fields', () => {
  const ids = K3_FORM_CATALOG.map(item => item.formId)
  assert.equal(new Set(ids).size, ids.length, 'FormIds must be unique')
  assert.ok(K3_FORM_CATALOG.every(item => Array.isArray(item.suggestedFor) && Array.isArray(item.downstream)))
  assert.deepEqual(K3_FORM_CATALOG.filter(item => item.referencedAsExample).map(item => item.formId), ['BD_MATERIAL', 'PUR_PurchaseOrder', 'SAL_SaleOrder'])
  assert.match(K3_FORM_CATALOG_NOTE, /不代表当前 PLM 账套可用/)
  assert.ok(K3_FORM_CATALOG.every(item => !('fields' in item) && !('fieldKeys' in item)), 'static catalog must not invent or claim field mappings')
})

test('business suggestions preserve distinct shipment, receipt and payment semantics', () => {
  const item = (formId) => K3_FORM_CATALOG.find(entry => entry.formId === formId)
  assert.deepEqual(item('SAL_OUTSTOCK').suggestedFor, ['shipment'])
  assert.deepEqual(item('STK_InStock').suggestedFor, ['purchase-receipt'])
  assert.deepEqual(item('PUR_ReceiveBill').suggestedFor, [])
  assert.deepEqual(item('AR_receiveBill').suggestedFor, [])
  assert.deepEqual(item('AP_PAYBILL').suggestedFor, [])
  assert.deepEqual(item('BD_Customer').suggestedFor, ['customer'])
  assert.deepEqual(item('BD_Supplier').suggestedFor, ['supplier'])
})
