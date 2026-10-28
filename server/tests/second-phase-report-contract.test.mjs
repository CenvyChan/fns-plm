import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PURCHASE_ARRAY_RESPONSE_FIELD_KEYS, SECOND_PHASE_REPORTS, buildSecondPhaseReportDemo, runSecondPhaseReportAction } from '../dist/second-phase-report-contract.js'

const purchaseKeys = [
  'FBillNo', 'FDate', 'FSUPPLIERID', 'FSUPPLIERNAME', 'FMATERIALID', 'FMATERIALNAME', 'FMaterialModel',
  'FUnitId', 'FCurrencyId', 'FOrderQty', 'FReceiveQty', 'FImportQty', 'FReturnQty',
  'FOrderAmount', 'FReceiveAmount', 'FImportAmount', 'FPAYAMOUNT',
]
const salesKeys = [
  'FBILLNO', 'FDate', 'FCUSTID', 'FCUSTOMERNAME', 'FMATERIALID', 'FMATERIALNAME', 'FSPECIFICATION',
  'FUNIT', 'FCURRENCYID', 'FORDERQTY', 'FDELIQTY', 'FOUTQTY', 'FRETURNQTY',
  'FORDERAMOUNT', 'FDELIAMOUNT', 'FOUTAMOUNT', 'FRECAMOUNT',
]
const purchaseValue = (row, key) => row[buildSecondPhaseReportDemo('purchase').FieldKeys.indexOf(key)]

test('purchase and sales demo contracts keep attachment identities, field casing, and filter boundaries distinct', () => {
  assert.deepEqual(Object.keys(SECOND_PHASE_REPORTS), ['purchase', 'sales'])
  assert.equal(SECOND_PHASE_REPORTS.purchase.formId, 'PUR_PurchaseOrderDetailRpt')
  assert.equal(SECOND_PHASE_REPORTS.sales.formId, 'SAL_DetailReport')
  assert.deepEqual(SECOND_PHASE_REPORTS.purchase.fields, purchaseKeys)
  assert.deepEqual(SECOND_PHASE_REPORTS.sales.fields, salesKeys)
  assert.deepEqual(SECOND_PHASE_REPORTS.purchase.candidateFilterKeys, ['FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID'])
  assert.deepEqual(SECOND_PHASE_REPORTS.sales.candidateFilterKeys, ['FBILLNO', 'FDate', 'FCUSTID', 'FMATERIALID'])
  assert.deepEqual(SECOND_PHASE_REPORTS.purchase.enabledFilters, ['FBillNo', 'FDate', 'FMATERIALID'])
  assert.deepEqual(SECOND_PHASE_REPORTS.sales.enabledFilters, ['FBILLNO', 'FDate', 'FMATERIALID'])
  assert.deepEqual(SECOND_PHASE_REPORTS.purchase.disabledFilterKeys, ['FSUPPLIERID'])
  assert.deepEqual(SECOND_PHASE_REPORTS.sales.disabledFilterKeys, ['FCUSTID'])
  assert.ok(!SECOND_PHASE_REPORTS.purchase.enabledFilters.includes('FPURCHASEDEPTID'))
  assert.ok(!SECOND_PHASE_REPORTS.sales.enabledFilters.includes('FSALEDEPTID'))
})

test('fixture envelopes are explicitly local-only; procurement mocks FieldKeys-indexed arrays and sales retains object rows', () => {
  const purchase = buildSecondPhaseReportDemo('purchase')
  const sales = buildSecondPhaseReportDemo('sales')
  assert.equal(purchase.formId, SECOND_PHASE_REPORTS.purchase.formId)
  assert.equal(purchase.source, 'local_demo_fixture_not_k3_tested')
  assert.equal(purchase.label, '演示/fixture/非K3实测')
  assert.equal(purchase.status, 'fixture')
  assert.equal(purchase.liveCallsAllowed, false)
  assert.deepEqual(purchase.FieldKeys, PURCHASE_ARRAY_RESPONSE_FIELD_KEYS)
  assert.deepEqual(purchase.FieldKeys, ['FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID', 'FOrderQty', 'FImportQty'])
  assert.deepEqual(purchase.mockRequest, { Limit: 5 })
  assert.equal(purchase.Result.IsSuccess, true)
  assert.equal(purchase.Result.RowCount, 2)
  assert.deepEqual(Object.keys(purchase.Result).sort(), ['IsSuccess', 'RowCount', 'Rows'])
  assert.equal(purchase.total, purchase.Result.RowCount)
  assert.equal(purchase.Result.Rows.length, 2)
  assert.ok(purchase.Result.Rows.every(row => row.length === purchase.FieldKeys.length))
  assert.ok(purchase.Result.Rows.flat().every(value => typeof value === 'string' || typeof value === 'number'))
  assert.equal('rows' in purchase, false)
  assert.equal('metrics' in purchase, false)
  assert.equal('kpis' in purchase, false)
  assert.equal(sales.formId, SECOND_PHASE_REPORTS.sales.formId)
  assert.equal(sales.source, 'local_demo_fixture_not_k3_tested')
  assert.equal(sales.status, 'fixture')
  assert.equal(sales.liveCallsAllowed, false)
  assert.equal(sales.total, 2)
  assert.equal(sales.rows.length, 2)
  assert.ok(sales.rows.every(row => Object.keys(row).every(key => salesKeys.includes(key))))
  assert.ok(sales.rows.every(row => Object.values(row).every(value => typeof value === 'string' || typeof value === 'number')))
  assert.ok(sales.rows.every(row => row.FUNIT && row.FCURRENCYID))
  assert.equal('metrics' in sales, false)
  assert.equal('kpis' in sales, false)
  assert.notEqual(sales.rows[0].FUNIT, sales.rows[1].FUNIT)
  assert.notEqual(sales.rows[0].FCURRENCYID, sales.rows[1].FCURRENCYID)
})

test('only enabled candidate keys filter demo rows; disabled supplier/customer never enter args', () => {
  const byBill = buildSecondPhaseReportDemo('purchase', { FBillNo: '演示采购单-001' })
  assert.equal(purchaseValue(byBill.Result.Rows[0], 'FMATERIALID'), '演示物料-001')
  const byDate = buildSecondPhaseReportDemo('purchase', { FDate: '2026-10-21' })
  assert.equal(purchaseValue(byDate.Result.Rows[0], 'FBillNo'), '演示采购单-001')
  assert.equal(buildSecondPhaseReportDemo('purchase', { FMATERIALID: '演示物料-002' }).total, 1)
  assert.equal(buildSecondPhaseReportDemo('sales', { FBILLNO: '演示销售单-001' }).rows[0].FCUSTID, '演示客户-A')
  assert.equal(buildSecondPhaseReportDemo('sales', { FDate: '2026-10-22' }).rows[0].FBILLNO, '演示销售单-002')
  assert.equal(buildSecondPhaseReportDemo('sales', { FMATERIALID: '演示物料-003' }).total, 1)
  const noPurchaseMatches = buildSecondPhaseReportDemo('purchase', { FBillNo: 'no-match' })
  assert.equal(noPurchaseMatches.total, 0)
  assert.equal(noPurchaseMatches.Result.RowCount, 0)
  assert.deepEqual(noPurchaseMatches.Result.Rows, [])
  assert.deepEqual(buildSecondPhaseReportDemo('sales', { FMATERIALID: 'no-match' }).rows, [])
  for (const [kind, query] of [
    ['purchase', { FSUPPLIERID: '供应商-B' }], ['purchase', { FSPECIFICATION: '规格' }], ['purchase', { FMaterialModel: '型号' }],
    ['sales', { FCUSTID: '客户-B' }], ['sales', { FSPECIFICATION: '规格' }], ['sales', { FMaterialModel: '型号' }],
    ['purchase', { FCUSTID: 'x' }], ['sales', { FSUPPLIERID: 'x' }], ['sales', { pageSize: 2, q: 'x' }],
  ]) assert.throws(() => buildSecondPhaseReportDemo(kind, query), /Unknown or unsupported query key/)
  assert.throws(() => buildSecondPhaseReportDemo('sales', { FDate: 20261022 }), /must be a string/)
})

test('pagination stays local and bounded to pageSize 1..200, including explicit empty results', () => {
  const first = buildSecondPhaseReportDemo('purchase', { page: 1, pageSize: 1 })
  assert.equal(first.total, 2)
  assert.equal(first.Result.Rows.length, 1)
  const second = buildSecondPhaseReportDemo('purchase', { page: 2, pageSize: 1 })
  assert.equal(second.Result.Rows[0][second.FieldKeys.indexOf('FBillNo')], '演示采购单-002')
  assert.deepEqual(buildSecondPhaseReportDemo('purchase', { page: 3, pageSize: 1 }).Result.Rows, [])
  assert.equal(buildSecondPhaseReportDemo('sales', { pageSize: 200 }).rows.length, 2)
  for (const query of [{ page: 0 }, { page: -1 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 201 }, { pageSize: 1.5 }]) {
    assert.throws(() => buildSecondPhaseReportDemo('sales', query), TypeError)
  }
})

test('all K3 report actions and request-shaped actions fail closed; only local demo runs', () => {
  for (const action of ['GetSysReportData', 'PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'POST /api/k3cloud/query', 'k3-report-request', 'live-report', 'GetReportData']) {
    assert.throws(() => runSecondPhaseReportAction(action, 'purchase', {}), /locked/)
  }
  assert.throws(() => runSecondPhaseReportAction('local-demo'), /kind/)
  assert.equal(runSecondPhaseReportAction('local-demo', 'sales', {}).source, 'local_demo_fixture_not_k3_tested')
})
