import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: [new URL('../src/report-table-preferences.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
})
const preferences = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

test('preferences stay inside the current report field catalog and preserve locked runtime exclusions', () => {
  const normalized = preferences.normalizeReportTablePreferences({
    visibleKeys: ['FDate', 'unknown', 'FModel', 'FAmount'],
    order: ['FAmount', 'FDate', 'FBillNo', 'FModel'],
    frozenCount: 99,
    sortKey: 'FModel',
    sortDirection: 'invalid',
  }, ['FBillNo', 'FDate', 'FAmount', 'FModel'], ['FBillNo', 'FDate'], ['FModel'])

  assert.deepEqual(normalized.visibleKeys, ['FDate', 'FAmount'])
  assert.deepEqual(normalized.order, ['FAmount', 'FDate', 'FBillNo', 'FModel'])
  assert.equal(normalized.frozenCount, 2)
  assert.equal(normalized.sortKey, '')
  assert.equal(normalized.sortDirection, 'asc')
})

test('each FormId has a distinct local preference key and column movement follows visible order', () => {
  assert.notEqual(preferences.reportTableStorageKey('SAL_DetailReport'), preferences.reportTableStorageKey('AP_PAYDETAILREPORT'))
  const current = {
    visibleKeys: ['FOne', 'FThree'],
    order: ['FOne', 'FTwo', 'FThree', 'FFour'],
    frozenCount: 0,
    sortKey: '',
    sortDirection: 'asc',
  }
  const moved = preferences.moveVisibleColumn(current, ['FOne', 'FTwo', 'FThree', 'FFour'], 'FThree', -1)
  assert.deepEqual(preferences.orderedVisibleKeys(moved, ['FOne', 'FTwo', 'FThree', 'FFour']), ['FThree', 'FOne'])
  assert.deepEqual(moved.order, ['FThree', 'FOne', 'FTwo', 'FFour'])
})

test('local row sorting handles numbers, natural text order, stable ties, and blank values', () => {
  const rows = [
    { id: 'two-a', value: 2 },
    { id: 'ten', value: 10 },
    { id: 'two-b', value: 2 },
    { id: 'blank', value: null },
  ]
  assert.deepEqual(preferences.sortReportRows(rows, 'value', 'asc').map(row => row.id), ['two-a', 'two-b', 'ten', 'blank'])
  assert.deepEqual(preferences.sortReportRows(rows, 'value', 'desc').map(row => row.id), ['ten', 'two-a', 'two-b', 'blank'])
  assert.deepEqual(preferences.sortReportRows(rows, '', 'desc'), rows)
})
