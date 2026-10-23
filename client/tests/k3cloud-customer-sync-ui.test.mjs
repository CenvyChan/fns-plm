import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workbench = readFileSync(new URL('../src/ConnectorWorkbench.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../src/K3CloudSettings.tsx', import.meta.url), 'utf8')

test('K3Cloud UI exposes customer-only sync and persists/restores the selected schedule mode', () => {
  assert.match(workbench, /setK3SyncMode\(syncSchedule\.mode === 'customer-only' \? 'customer-only' : 'full'\)/)
  assert.match(workbench, /mode: k3SyncMode/)
  assert.match(workbench, /jsonRequest\('POST', kind === 'customer' \? \{ kind: 'customer' \} : \{\}\)/)
  assert.match(workbench, /onCustomerSync=\{\(\) => void runK3DataSync\('customer'\)\}/)
  assert.match(settings, /value="customer-only">仅客户同步/)
  assert.match(settings, /仅同步客户/)
})

test('K3Cloud metadata mapping updates preserve additional master-source attributes', () => {
  assert.match(workbench, /sourceValue\[input\.target\] = \{ \.\.\.previous, formId: input\.formId, fields:/)
})
