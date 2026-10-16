import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractK3MetadataFields, summarizeK3Metadata } from '../dist/k3cloud-metadata.js'

const metadata = {
  Id: 'PUR_PurchaseOrder',
  Key: 'FBillHead',
  Items: [
    { Key: 'FBillNo', Name: '单据编号', MustInput: 1 },
    { Key: 'F_PAEZ_Text', Name: '二开文本', IsViewVisible: true },
    { Key: 'F_JR_Hidden', Name: '废弃字段', IsViewVisible: false },
    { Key: 'F_ABC_Flex', Name: '弹性域父键', ElementType: 60523 },
    { Key: 'FAUXPROPID__FF100001', Name: 'metadata 标识' },
    { Key: 'F_REQ_Code', Name: '必填二开', MustInput: 1, IsViewVisible: 'true' },
  ],
  Entrys: [{ Key: 'FEntryMaterialId', Name: '物料', MustInput: 'true' }],
}

test('metadata parser returns source keys and separates hidden, flex, and custom fields', () => {
  const fields = extractK3MetadataFields(JSON.stringify(metadata))
  const keys = fields.map(field => field.key)
  assert.ok(keys.includes('FBillNo'))
  assert.ok(keys.includes('F_PAEZ_Text'))
  assert.ok(keys.includes('F_ABC_Flex'))
  assert.ok(!keys.includes('FAUXPROPID__FF100001'))
  assert.equal(fields.find(field => field.key === 'F_PAEZ_Text').isCustom, true)
  assert.equal(fields.find(field => field.key === 'F_JR_Hidden').visible, false)
  assert.equal(fields.find(field => field.key === 'F_ABC_Flex').isFlexParent, true)
  assert.equal(fields.find(field => field.key === 'FBillNo').mustInput, true)
  assert.equal(fields.find(field => field.key === 'FEntryMaterialId').entity, 'Entrys')
})

test('metadata summary identifies usable custom keys without inferring any names', () => {
  const result = summarizeK3Metadata('PUR_PurchaseOrder', metadata, '2026-10-16T00:00:00.000Z')
  assert.equal(result.source, 'query_metadata')
  assert.equal(result.discoveredAt, '2026-10-16T00:00:00.000Z')
  assert.ok(result.usableCustomKeys.includes('F_PAEZ_Text'))
  assert.ok(!result.usableCustomKeys.includes('F_JR_Hidden'))
  assert.ok(!result.usableCustomKeys.includes('F_ABC_Flex'))
  assert.ok(result.requiredKeys.includes('FBillNo'))
  assert.ok(result.hiddenCustomKeys.includes('F_JR_Hidden'))
  assert.ok(result.flexParentKeys.includes('F_ABC_Flex'))
})

test('metadata without query-shaped fields fails closed', () => {
  assert.throws(() => summarizeK3Metadata('NOT_A_FORM', { Message: '业务对象不存在' }), /元数据响应中没有可用字段/)
})
