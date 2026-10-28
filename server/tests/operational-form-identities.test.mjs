import assert from 'node:assert/strict'
import { test } from 'node:test'
import { K3_FORM_CATALOG } from '../dist/k3cloud-form-catalog.js'

test('owner supplied other-outstock identity remains distinct from sales-outstock and missing historical form', () => {
  const other = K3_FORM_CATALOG.find(entry => entry.formId === 'STK_MisDelivery')
  const sales = K3_FORM_CATALOG.find(entry => entry.formId === 'SAL_OUTSTOCK')
  const missing = K3_FORM_CATALOG.find(entry => entry.formId === 'STK_OutStock')
  assert.equal(other.name, '其他出库单')
  assert.deepEqual(other.suggestedFor, [])
  assert.equal(other.sourceCatalogMarkedVerified, false)
  assert.match(other.notes, /未做目标账套查询验证/)
  assert.deepEqual(sales.suggestedFor, ['shipment'])
  assert.equal(missing.sourceCatalogMarkedVerified, false)
  assert.deepEqual(missing.suggestedFor, [])
  assert.match(missing.notes, /未找到/)
  assert.match(missing.notes, /不得据此断定没有销售出库业务/)
})
