import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncK3CloudMasterData } from '../dist/k3cloud-master-data.js'

test('unsupported master-data fields are rejected before any K3Cloud query', async () => {
  const scope = { tenantId: 'tenant-a', organizationId: 'org-a', accountId: 'account-a' }
  for (const unsupportedField of ['email', 'password']) {
    let queryCount = 0
    await assert.rejects(
      syncK3CloudMasterData(scope, {
        customer: { formId: 'BD_CUSTOMER', fields: { id: 'FID', name: 'FName', [unsupportedField]: `F${unsupportedField}` } },
      }, async () => { queryCount += 1; return [] }),
      /不支持的规范字段/,
      `${unsupportedField} must not be accepted as a master-data mapping key`,
    )
    assert.equal(queryCount, 0, `${unsupportedField} mapping must fail before the K3Cloud query callback runs`)
  }
})
