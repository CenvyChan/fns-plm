import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { groupInventoryRows, inventoryBarPercent, operationalRoutes, operationalStatusLabel, reportCandidateEntryRoutes, reportCandidateRoutes, specificationModelFilter, summarizeInventoryFixture } from '../src/operational-report-model.ts'
import { mapRowsByFieldKeys, parsePurchaseDemoMock, PURCHASE_ARRAY_FIELD_KEYS } from '../src/purchase-array-response.ts'
import { createCandidateReportFixture, LOCAL_CANDIDATE_FIXTURE_FORM_IDS } from '../src/candidate-report-fixtures.ts'

async function bundled(relative) {
  const output = await build({ entryPoints: [new URL(relative, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', loader: { '.css': 'empty' } })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
async function bundledServer(relative) {
  const output = await build({ entryPoints: [new URL(relative, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const nav = await bundled('../src/navigation.ts')
const areas = await bundled('../src/navigation-areas.ts')
const candidateModule = await bundledServer('../../server/src/report-candidate-contract.ts')
const observationModule = await bundledServer('../../server/src/target-account-readonly-observations.ts')
const { REPORT_CANDIDATES, AR_SUMMARY_PLACEHOLDER } = candidateModule
const { TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS, GET_INVENTORY_DATA_READ_ONLY_OBSERVATION } = observationModule
const { UserReportCandidates, InventoryFixedSampleAction } = await bundled('../src/OperationalReports.tsx')

test('K3 report navigation includes all 12 independent FormId routes, a FormId-free placeholder, and five retained independent pages', () => {
  const menu = areas.navigationAreas.find(area => area.id === 'k3-reports')
  assert.equal(menu.label, 'K3 报表')
  assert.equal(operationalRoutes.length, 5)
  assert.equal(reportCandidateEntryRoutes.length, 13)
  assert.equal(reportCandidateRoutes.length, 10)
  const candidatePages = reportCandidateEntryRoutes.map(route => route.page)
  assert.equal(new Set(candidatePages).size, 13)
  for (const route of reportCandidateEntryRoutes) {
    assert.equal(nav.resolvePage(route.page), route.page)
    assert.equal(nav.pageById[route.page].parent, 'operational-reports')
    assert.equal(nav.canAccessPage(route.page, { role: 'admin' }, null), true)
    assert.equal(nav.canAccessPage(route.page, { role: 'plm_manager' }, null), true)
    assert.equal(nav.canAccessPage(route.page, { role: 'member' }, null), false)
    assert.equal(nav.pageFromSearch(`?page=${route.page}`, { role: 'member' }), 'overview')
  }
  assert.equal(reportCandidateEntryRoutes.find(route => route.candidateId === 'ar-summary-placeholder').formId, null)
  const destinations = menu.sections.flatMap(section => section.pages)
  assert.ok(destinations.includes('operational-candidate-sales-collect'))
  assert.ok(destinations.includes('operational-candidate-ar-summary'))
  for (const page of ['operational-inventory', 'operational-movements', 'operational-purchase', 'operational-sales', 'operational-aging']) assert.ok(destinations.includes(page))
})

test('candidate preflight cards omit removed attachment metadata and keep inventory separate', () => {
  const inventory = {
    method: 'GetInventoryData', status: 'candidate_unverified_locked', executionStatus: 'locked', liveCallsAllowed: false,
    directoryScope: 'outside_12_formids', sourceAttachment: null,
    parameters: ['pageindex', 'pagerows'], limitations: ['独立库存能力候选；历史筛选值和响应已移除。'],
  }
  const reportCandidates = REPORT_CANDIDATES.map(candidate => ({ ...candidate, targetAccountReadOnlyObservation: TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS[candidate.formId] ?? null }))
  const html = renderToStaticMarkup(createElement(UserReportCandidates, { preflight: { reportCandidates, arSummaryPlaceholder: AR_SUMMARY_PLACEHOLDER, instantInventoryCandidate: inventory, inventoryGetInventoryDataReadOnlyObservation: GET_INVENTORY_DATA_READ_ONLY_OBSERVATION } }))
  for (const formId of ['PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'SAL_CollectReport', 'SUB_ROExecuteDetailRpt', 'SUB_ROExecuteSummaryRpt', 'AR_AgingAnalysis', 'AR_PAYDETAILREPORT', 'AP_AgingAnalysis', 'AP_IVDetailReport', 'AP_PAYDETAILREPORT', 'AP_SumReport', 'QINL_YSCBFXB']) assert.ok(html.includes(formId))
  assert.match(html, /12 项 FormId 报表候选目录/)
  assert.match(html, /附件候选 · 未验证 · live call 锁定/)
  assert.doesNotMatch(html, /路径错位|原始清单为/)
  assert.doesNotMatch(html, /\/home\/ubuntu\/upload|pasted_content_[0-9]+\.txt/)
  assert.match(html, /AP_AgingAnalysis/)
  assert.match(html, /QINL_YSCBFXB/)
  assert.match(html, /AR汇总待定义/)
  assert.match(html, /无 FormId/)
  assert.match(html, /不猜测/)
  assert.match(html, /本地合成 fixture \/ 非实测行/)
  assert.match(html, /无 fixture · live call 锁定/)
  assert.match(html, /GetInventoryData/)
  assert.doesNotMatch(html, /只读结构观察：RowCount|返回 \d+ 个对象|pasted_content_[0-9]+\.txt|\/home\/ubuntu\/upload/)
  assert.match(html, /独立于以上 12 项/)
  assert.match(html, /STK_Inventory.*收发存.*库存账龄.*BD_STOCK/)
  assert.doesNotMatch(html, /查询固定样本|执行查询|<table[^>]*>.*<tbody/s)
})

test('purchase and sales demo controls expose only enabled args; disabled filters never enter requests', () => {
  const purchase = REPORT_CANDIDATES.find(report => report.formId === 'PUR_PurchaseOrderDetailRpt')
  const sales = REPORT_CANDIDATES.find(report => report.formId === 'SAL_DetailReport')
  assert.ok(purchase)
  assert.ok(sales)
  const source = readFileSync(new URL('../src/OperationalReports.tsx', import.meta.url), 'utf8')
  assert.match(source, /for \(const key of contract\.enabledFilterKeys\).*params\.set\(key/)
  assert.doesNotMatch(source, /for \(const key of contract\.candidateFilterKeys\).*params\.set\(key/)
  for (const required of ['PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', '供应商', '客户', 'FSUPPLIERID', 'FCUSTID', '规格/型号筛选', '选择显示列', '只改变本地表格显示', '指标（原始字段）', 'local_demo_fixture_not_k3_tested', 'liveCallsAllowed=false', 'op-row-detail-button', '导出当前页本地 fixture 快照 CSV', 'URL.createObjectURL(new Blob']) assert.ok(source.includes(required))
  for (const key of ['FBillNo', 'FDate', 'FMATERIALID', 'FBILLNO']) assert.ok(source.includes(key))
  assert.match(source, /if \(!active \|\| isSecondPhaseReport\(active\)\) return/)
  assert.match(source, /apiJson<unknown>\(`\/api\/operational-reports\/\$\{reportId\}\/demo\?\$\{params\}`/)
  assert.match(source, /normalizeSecondPhaseDemo\(reportId, value\)/)
  assert.doesNotMatch(source, /apiJson<unknown>[^\n]{0,200}\/api\/k3cloud/)
  assert.equal(purchase.localRowsAvailable, true)
  assert.equal(sales.localRowsAvailable, true)
})

test('inventory GetInventoryData is shown as a directory-external locked capability with no real-action button or request', () => {
  const html = renderToStaticMarkup(createElement(InventoryFixedSampleAction, { observation: GET_INVENTORY_DATA_READ_ONLY_OBSERVATION }))
  assert.match(html, /GetInventoryData/)
  assert.match(html, /目录外独立库存查询能力/)
  assert.match(html, /未接线 · 未启用/)
  assert.match(html, /不发起真实 K3 请求/)
  assert.match(html, /BD_STOCK/)
  assert.match(html, /历史观察已移除/)
  assert.doesNotMatch(html, /RowCount|对象键数/)
  assert.doesNotMatch(html, /\/home\/ubuntu\/upload|pasted_content_[0-9]+\.txt/)
  assert.doesNotMatch(html, /<button|<input|<form/)
  const source = readFileSync(new URL('../src/OperationalReports.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /apiJson<InventoryActionEnvelope>/)
  assert.doesNotMatch(source, /\/api\/k3cloud\/actions\/GetInventoryData/)
  assert.match(source, /GetInventoryData 当前未启用/)
})

test('inventory fixture groupings preserve exact item identity, unit separation, and explicit null-safe metrics', () => {
  const rows = [
    { materialNumber: 'A', materialName: '同名', unit: '件', quantity: 2 },
    { materialNumber: 'A', materialName: '同名', unit: '件', quantity: 3 },
    { materialNumber: 'A', materialName: '同名', unit: '箱', quantity: 1 },
    { materialNumber: 'B', materialName: '同名', unit: '件', quantity: 4 },
  ]
  const groups = groupInventoryRows(rows)
  assert.deepEqual(groups.map(row => [row.materialNumber, row.unit, row.quantity]), [['A', '件', 5], ['A', '箱', 1], ['B', '件', 4]])
  assert.equal(inventoryBarPercent(groups[0], groups), 100)
  assert.equal(inventoryBarPercent(groups[1], groups), 100)
  const summary = summarizeInventoryFixture([{ materialNumber: 'A', warehouse: 'W1', unit: '件', quantity: 2 }, { materialNumber: 'A', warehouse: 'W1', unit: '箱', quantity: 9 }])
  assert.deepEqual(summary.quantitiesByUnit, [{ unit: '件', quantity: 2 }, { unit: '箱', quantity: 9 }])
  assert.equal('totalQuantity' in summary, false)
})

test('specification/model controls stay disabled and report statuses remain explicit', () => {
  assert.equal(specificationModelFilter.disabled, true)
  assert.equal(specificationModelFilter.fieldKey, null)
  assert.equal(operationalStatusLabel('fixture'), '本地示例')
  assert.equal(operationalStatusLabel('candidate_unverified_locked'), '附件候选 · 未验证 · live call 锁定')
  assert.equal(operationalStatusLabel('not_defined'), '待定义 · 无 FormId')
  const source = readFileSync(new URL('../src/OperationalReports.tsx', import.meta.url), 'utf8')
  assert.match(source, /规格\/型号筛选/)
  assert.match(source, /disabled=\{specificationModelFilter\.disabled\}/)
  assert.match(source, /createCandidateReportFixture\(candidate\)/)
  assert.match(source, /CandidateFixtureWorkbench/)
  assert.match(source, /本地合成 fixture \/ 非实测行/)
  assert.deepEqual([...LOCAL_CANDIDATE_FIXTURE_FORM_IDS].sort(), ['AP_IVDetailReport', 'AP_PAYDETAILREPORT', 'AP_SumReport', 'AR_PAYDETAILREPORT', 'SAL_CollectReport'].sort())
  assert.equal(typeof createCandidateReportFixture, 'function')
  const css = readFileSync(new URL('../src/operational-reports.css', import.meta.url), 'utf8')
  const sizes = [...css.matchAll(/font-size:(\d+)px/g)].map(match => Number(match[1]))
  assert.ok(sizes.length && sizes.every(size => size >= 12))
  assert.match(css, /@media\(max-width:650px\)/)
  assert.match(css, /min-height:44px;min-width:44px/)
  assert.match(css, /\.op-candidate-grid\{grid-template-columns:1fr\}/)
  assert.match(css, /\.op-field-table-wrap/)
  assert.match(css, /\.op-fixture-workbench\{/)
  assert.match(css, /\.op-fixture-pagination/)
  assert.match(css, /\.op-fixture-table\{min-width:980px/)
})

test('purchase local mock maps each array cell by the supplied FieldKeys order and rejects malformed or non-fixture responses', () => {
  const values = {
    FBillNo: '演示采购单-TEST', FDate: '2026-10-20', FSUPPLIERID: '合成供应商',
    FMATERIALID: '合成物料', FOrderQty: 7, FImportQty: 3,
  }
  const makePayload = fieldKeys => ({
    formId: 'PUR_PurchaseOrderDetailRpt', source: 'local_demo_fixture_not_k3_tested',
    label: '本地合成 fixture', status: 'fixture', liveCallsAllowed: false,
    page: 1, pageSize: 5, total: 1, FieldKeys: fieldKeys, mockRequest: { Limit: 5 },
    Result: { IsSuccess: true, RowCount: 1, Rows: [fieldKeys.map(key => values[key])] },
  })
  const mapped = parsePurchaseDemoMock(makePayload([...PURCHASE_ARRAY_FIELD_KEYS]))
  assert.deepEqual(Object.keys(makePayload([...PURCHASE_ARRAY_FIELD_KEYS]).Result).sort(), ['IsSuccess', 'RowCount', 'Rows'])
  assert.deepEqual(mapped.rows[0], values)
  const reorderedKeys = [...PURCHASE_ARRAY_FIELD_KEYS].reverse()
  assert.deepEqual(parsePurchaseDemoMock(makePayload(reorderedKeys)).rows[0], values)
  assert.throws(() => mapRowsByFieldKeys(['F1', 'F2'], [[1]]), /exactly 2 values/)
  assert.throws(() => mapRowsByFieldKeys(['F1', 'F1'], [[1, 2]]), /duplicates/)
  assert.throws(() => parsePurchaseDemoMock({ ...makePayload([...PURCHASE_ARRAY_FIELD_KEYS]), source: 'k3' }), /local fixture mocks only/)
  assert.throws(() => parsePurchaseDemoMock({ ...makePayload([...PURCHASE_ARRAY_FIELD_KEYS]), Result: { ...makePayload([...PURCHASE_ARRAY_FIELD_KEYS]).Result, IsSuccess: false } }), /Result envelope is invalid/)
})
