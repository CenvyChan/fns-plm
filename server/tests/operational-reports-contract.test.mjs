import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temp = mkdtempSync(join(tmpdir(), 'operational-contract-'))
process.env.DATABASE_FILE = join(temp, 'contract.sqlite')
process.env.APP_ENCRYPTION_KEY = '8b'.repeat(32)
process.env.APP_ENCRYPTION_KEY_FILE = join(temp, 'test.key')
process.env.DATA_FILE = join(temp, 'missing.json')
process.env.LEGACY_DATA_FILE = join(temp, 'missing.json')
const { OPERATIONAL_REPORTS, OPERATIONAL_REPORT_METADATA_PREFLIGHT, INVENTORY_LIVE_SAMPLE_EVIDENCE, buildOperationalInventoryFixture } = await import('../dist/operational-reports.js')
const { TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS, GET_INVENTORY_DATA_READ_ONLY_OBSERVATION, AGING_READ_ONLY_PARAMETER_METADATA } = await import('../dist/target-account-readonly-observations.js')
const { db } = await import('../dist/database.js')
after(() => { db.close(); rmSync(temp, { recursive: true, force: true }) })

test('operational catalog keeps stable first-five identifiers and truthful blocked states', () => {
  assert.deepEqual(OPERATIONAL_REPORTS.map(r => r.id), ['instant-inventory', 'stock-movement', 'purchase-execution', 'sales-execution', 'inventory-aging'])
  assert.equal(OPERATIONAL_REPORTS[0].status, 'uncollected')
  assert.ok(OPERATIONAL_REPORTS.slice(1).every(report => report.status === 'unsupported'))
  assert.deepEqual(OPERATIONAL_REPORTS[0].fields, ['warehouse', 'materialNumber', 'materialName', 'unit', 'quantity'])
})
test('every report exposes user-transcribed public guidance in a separate, unverified interface lane structure', () => {
  for (const report of OPERATIONAL_REPORTS) {
    assert.ok(typeof report.publicGuidanceNote === 'string' && report.publicGuidanceNote.length > 0)
    assert.ok(Array.isArray(report.interfaceLanes) && report.interfaceLanes.length > 0)
    for (const lane of report.interfaceLanes) {
      assert.ok(lane.name && lane.service && lane.method)
      assert.ok(lane.formId === null || typeof lane.formId === 'string')
      assert.ok(Array.isArray(lane.parameters) && lane.parameters.length > 0)
      assert.equal(lane.status, 'candidate_unverified')
      assert.ok(lane.provenance && Array.isArray(lane.limitations) && lane.limitations.length > 0)
    }
  }
  const movement = OPERATIONAL_REPORTS.find(report => report.id === 'stock-movement')
  assert.ok(movement.interfaceLanes.some(lane => lane.service === 'DynamicFormService' && lane.method === 'GetSysReportData' && lane.formId === 'BD_HS_INOUTSTOCKSUMMARYRPT'))
  const stockReportLane = movement.interfaceLanes.find(lane => lane.service === 'StockReportQueryService')
  assert.equal(stockReportLane.method, 'GetReportData')
  assert.equal(stockReportLane.formId, null, 'only the detail report ID is known, not the summary ID')
  assert.ok(stockReportLane.parameters.some(parameter => parameter.includes('FSCHEMEID') && parameter.includes('非默认')))
  const aging = OPERATIONAL_REPORTS.find(report => report.id === 'inventory-aging').interfaceLanes[0]
  assert.equal(aging.service, 'StockReportQueryService')
  assert.equal(aging.method, 'GetReportData')
  assert.equal(aging.formId, null)
  const inventoryLanes = OPERATIONAL_REPORTS[0].interfaceLanes
  assert.ok(inventoryLanes.some(lane => lane.method === 'ExecuteBillQuery' && lane.formId === 'STK_Inventory'))
  assert.ok(inventoryLanes.some(lane => lane.method === 'GetInventoryData' && lane.formId === null))
  assert.ok(OPERATIONAL_REPORTS.filter(report => ['purchase-execution', 'sales-execution'].includes(report.id)).every(report => report.interfaceLanes[0].formId === null && report.interfaceLanes[0].service === '未知'))
  assert.match(OPERATIONAL_REPORTS[1].metricSpecs[0].formula, /会计组织\/会计期间\/成本范围/)
  assert.match(OPERATIONAL_REPORTS[1].metricSpecs[0].formula, /数量为0或null不出值/)
  assert.match(OPERATIONAL_REPORTS[4].metricSpecs[0].formula, /参考价金额≠账面估值/)
})
test('preflight never promotes candidates or fixtures into confirmed metadata or real metrics', () => {
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.metadataConfirmed, false)
  assert.deepEqual(OPERATIONAL_REPORT_METADATA_PREFLIGHT.confirmedFields, [])
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.liveBusinessQueriesAllowed, false)
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.stockOrganizationMapping, 'pending')
  assert.match(OPERATIONAL_REPORT_METADATA_PREFLIGHT.verificationMethod, /明确授权的专用环境/)
  for (const report of OPERATIONAL_REPORTS) {
    assert.ok(report.filterSpecs.length > 0)
    assert.ok(report.fieldSpecs.length > 0)
    assert.ok(report.fieldSpecs.every(field => field.status === 'candidate_unverified' && field.label && field.use && typeof field.filterable === 'boolean'))
    assert.ok(report.chartPrerequisites.length > 0)
  }
  assert.match(OPERATIONAL_REPORTS[1].description, /不能倒算期初/)
  assert.match(OPERATIONAL_REPORTS[4].description, /不能从当前库存余额推算账龄/)
})
test('user report definitions remain unverified candidates and never enable report or inventory queries', () => {
  const preflight = OPERATIONAL_REPORT_METADATA_PREFLIGHT
  const localFixtureFormIds = [
    'PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'SAL_CollectReport',
    'AR_PAYDETAILREPORT', 'AP_IVDetailReport', 'AP_PAYDETAILREPORT', 'AP_SumReport',
  ]
  assert.deepEqual(preflight.reportCandidates.map(item => item.formId), [
    'PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'SAL_CollectReport',
    'SUB_ROExecuteDetailRpt', 'SUB_ROExecuteSummaryRpt', 'AR_AgingAnalysis',
    'AR_PAYDETAILREPORT', 'AP_AgingAnalysis', 'AP_IVDetailReport',
    'AP_PAYDETAILREPORT', 'AP_SumReport', 'QINL_YSCBFXB',
  ])
  assert.ok(preflight.reportCandidates.every(item => item.method === 'GetSysReportData' && item.status === 'candidate_unverified_locked' && item.liveState === 'unverified' && item.executionStatus === 'locked' && item.methodEvidence === 'attachment_example' && item.publicApiClassification === 'unverified' && item.targetAccountValidation === 'unverified' && item.schemeId === null && item.selectedFieldKeys === null))
  assert.ok(preflight.reportCandidates.every(item => item.parameterFields.length > 0 && item.modelFieldKeys.length > 0 && item.fieldCandidates.length > 0 && item.candidateFieldKeys.length === item.fieldCandidates.length && item.localRowsAvailable === localFixtureFormIds.includes(item.formId) && item.validation.liveCallAllowed === false))
  assert.equal(preflight.arSummaryPlaceholder.name, 'AR汇总待定义')
  assert.equal(preflight.arSummaryPlaceholder.formId, null)
  assert.equal(preflight.arSummaryPlaceholder.liveState, 'pending')
  assert.equal(preflight.arSummaryPlaceholder.executionStatus, 'locked')
  assert.ok(preflight.reportCandidates.find(item => item.formId === 'SAL_DetailReport').candidateFieldKeys.includes('FSPECIFICATION'))
  assert.ok(preflight.reportCandidates.find(item => item.formId === 'PUR_PurchaseOrderDetailRpt').candidateFieldKeys.includes('FMaterialModel'))
  assert.ok(preflight.reportCandidates.every(item => item.sourceMatchesRequestedFormId && item.sourceReportedFormId === item.formId), 'field candidates must be assigned by the embedded FormId')
  assert.ok(preflight.reportCandidates.every(item => item.sourceAttachment === null && item.requestedAttachment === null), 'historical attachment paths have been removed')
  assert.deepEqual(preflight.reportCandidates.find(item => item.formId === 'QINL_YSCBFXB').candidateFieldKeys, ['FMATERIALID', 'FgroupName'])
  assert.ok(preflight.reportCandidates.find(item => item.formId === 'AP_AgingAnalysis').modelFieldKeys.includes('FExChangeRateType'))
  assert.ok(!preflight.reportCandidates.some(item => ['STK_Inventory', 'BD_STOCK', 'GetInventoryData'].includes(item.formId)))
  assert.ok(!preflight.reportCandidates.some(item => item.formId === 'inventory-aging'), 'inventory aging remains a separate unsupported PLM report')
  assert.equal(preflight.instantInventoryCandidate.method, '/k3cloud/Kingdee.K3.SCM.WebApi.ServicesStub.InventoryQueryService.GetInventoryData,Kingdee.K3.SCM.WebApi.ServicesStub.common.kdsvc')
  assert.equal(preflight.instantInventoryCandidate.status, 'candidate_unverified_locked')
  assert.equal(preflight.instantInventoryCandidate.executionStatus, 'locked')
  assert.equal(preflight.instantInventoryCandidate.liveCallsAllowed, false)
  assert.equal(preflight.instantInventoryCandidate.directoryScope, 'outside_12_formids')
  assert.equal(preflight.instantInventoryCandidate.sourceAttachment, null)
  assert.ok(preflight.instantInventoryCandidate.parameters.includes('pageindex'))
  assert.ok(preflight.instantInventoryCandidate.parameters.includes('pagerows'))
  assert.equal('readOnlyEvidence' in preflight, false, 'historical range/filter values must not be sent to the browser')
  assert.equal(preflight.liveBusinessQueriesAllowed, false)
  assert.equal(preflight.metadataConfirmed, false)
})
test('every report distinguishes source identity evidence, filter candidates, and metric readiness', () => {
  for (const report of OPERATIONAL_REPORTS) {
    assert.ok(report.sourceContracts.length > 0)
    assert.ok(report.filterContracts.length > 0)
    assert.ok(report.metricSpecs.length > 0)
    assert.ok(report.sourceContracts.every(source => source.status === 'candidate_unverified' && Array.isArray(source.fieldKeys) && Array.isArray(source.limitations) && source.evidence))
    assert.ok(report.filterContracts.every(item => item.status === 'candidate_unverified' && item.name && item.evidence))
    assert.ok(report.metricSpecs.every(item => ['unsupported', 'needs_real_data'].includes(item.status) && item.formula && item.unit && item.chart && item.requires.length > 0))
  }
  const inventory = OPERATIONAL_REPORTS[0]
  assert.deepEqual(inventory.sourceContracts[0].fieldKeys, ['FID', 'FStockOrgId', 'FMaterialId', 'FStockId', 'FStockStatusId', 'FBaseUnitId', 'FBaseQty'])
  assert.equal(inventory.sourceContracts[0].formId, 'STK_Inventory')
  assert.equal(inventory.sourceContracts[0].entity, null, 'Chinese display label is not an exact entity Key')
  assert.ok(inventory.sourceContracts[0].label)
  assert.deepEqual(inventory.filterContracts.map(item => item.name), inventory.filterSpecs)
  assert.equal(inventory.filterContracts.find(item => item.name === 'q').classification, 'ui_only_local')
  assert.equal(inventory.filterContracts.find(item => item.name === 'batch').key, null)
  assert.ok(['warehouse','unit','stockOrganization','stockStatus'].every(name => inventory.filterContracts.find(item => item.name === name).classification === 'code_contract_candidate'))
  const purchaseSources = OPERATIONAL_REPORTS.find(report => report.id === 'purchase-execution').sourceContracts
  for (const formId of ['PUR_PurchaseOrder','PUR_ReceiveBill','STK_InStock']) assert.ok(purchaseSources.some(source => source.formId === formId && source.entity === null))
  for (const report of OPERATIONAL_REPORTS) for (const contract of report.sourceContracts) assert.ok(contract.entity === null || /^[A-Za-z][A-Za-z0-9_]*$/.test(contract.entity), 'entity is an exact key, never a localized document label')
  assert.ok(OPERATIONAL_REPORTS.find(report => report.id === 'purchase-execution').metricSpecs.some(item => item.formula.includes('× 100') && item.formula.includes('分母为0/负数不计算')) )
  assert.match(inventory.sourceContracts[0].evidence, /没有保留任何账号专属响应/)
  assert.ok(inventory.filterContracts.every(item => item.status === 'candidate_unverified'))
  assert.ok(OPERATIONAL_REPORTS.slice(1).some(report => report.sourceContracts.some(source => source.formId === null && source.fieldKeys.length === 0)))
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.metadataConfirmed, false)
  assert.deepEqual(OPERATIONAL_REPORT_METADATA_PREFLIGHT.confirmedFields, [])
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.liveBusinessQueriesAllowed, false)
  assert.equal(INVENTORY_LIVE_SAMPLE_EVIDENCE.runtimeScopeBinding, 'not_configured')
})
test('historical inventory observations are removed and runtime contracts stay locked', () => {
  assert.equal(INVENTORY_LIVE_SAMPLE_EVIDENCE.status, 'historical_evidence_removed')
  assert.equal(INVENTORY_LIVE_SAMPLE_EVIDENCE.request, null)
  assert.equal(INVENTORY_LIVE_SAMPLE_EVIDENCE.queryAttempts, null)
  assert.equal(INVENTORY_LIVE_SAMPLE_EVIDENCE.returnedCount, null)
  assert.deepEqual(INVENTORY_LIVE_SAMPLE_EVIDENCE.existingAllowedFieldKeys, [])
  assert.deepEqual(INVENTORY_LIVE_SAMPLE_EVIDENCE.newlyAllowedFieldKeys, [])
  assert.deepEqual(TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS, {})
  assert.equal(GET_INVENTORY_DATA_READ_ONLY_OBSERVATION, null)
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.inventoryGetInventoryDataReadOnlyObservation, null)
  assert.equal(AGING_READ_ONLY_PARAMETER_METADATA.status, 'historical_observation_removed')
  assert.equal(AGING_READ_ONLY_PARAMETER_METADATA.organizationMapping, null)
  assert.equal(AGING_READ_ONLY_PARAMETER_METADATA.currencyMapping, null)
  assert.equal(AGING_READ_ONLY_PARAMETER_METADATA.rowsPersisted, false)
  assert.equal(AGING_READ_ONLY_PARAMETER_METADATA.liveCallsAllowed, false)
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.metadataConfirmed, false)
  assert.deepEqual(OPERATIONAL_REPORT_METADATA_PREFLIGHT.confirmedFields, [])
  assert.equal(OPERATIONAL_REPORT_METADATA_PREFLIGHT.liveBusinessQueriesAllowed, false)
  for (const report of OPERATIONAL_REPORT_METADATA_PREFLIGHT.reportCandidates) {
    assert.equal(report.targetAccountReadOnlyObservation, null)
    assert.equal(report.sourceAttachment, null)
    assert.equal(report.requestedAttachment, null)
    assert.equal(report.selectedFieldKeys, null)
    assert.equal(report.validation.liveCallAllowed, false)
  }
  assert.ok(OPERATIONAL_REPORTS.every(report => report.fieldSpecs.every(field => field.status === 'candidate_unverified')))
})
test('fixture builder binds all three scope dimensions and keeps units explicit without totals', () => {
  const scope = { tenantId: 't', organizationId: 'o', accountId: 'a' }
  const row = { id: 'row-1', warehouse: '演示仓', materialNumber: 'M1', materialName: '示例', unit: '件', quantity: 3, ignoredSecretField: 'must-not-copy' }
  const fixture = buildOperationalInventoryFixture(scope, '2026-10-23T00:00:00Z', [row, { ...row, id: 'row-2', unit: '箱', quantity: 1 }])
  assert.deepEqual(fixture.scope, scope)
  assert.equal(fixture.source, 'fixture')
  assert.equal(fixture.status, 'fixture')
  assert.deepEqual(fixture.rows.map(row => row.unit), ['件', '箱'])
  assert.equal('totalQuantity' in fixture, false)
  assert.equal('ignoredSecretField' in fixture.rows[0], false)
  row.quantity = 99
  assert.equal(fixture.rows[0].quantity, 3)
  assert.throws(() => buildOperationalInventoryFixture(scope, 'not-a-date', [row]), TypeError)
  assert.throws(() => buildOperationalInventoryFixture(scope, '2026-10-23', [row, row]), TypeError)
  assert.throws(() => buildOperationalInventoryFixture(scope, '2026-10-23', [{ ...row, unit: '' }]), TypeError)
  assert.throws(() => buildOperationalInventoryFixture(scope, '2026-10-23', [{ ...row, quantity: NaN }]), TypeError)
})
test('preview seed refuses non-temporary database before application modules can open it', () => {
  const forbidden = join(temp, 'must-not-be-created.sqlite')
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_FILE: forbidden }
  const run = spawnSync(process.execPath, ['scripts/seed-operational-reports-preview.mjs'], { cwd: resolve(import.meta.dirname, '..'), env, encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Refusing to seed outside/)
  assert.equal(existsSync(forbidden), false)
})
test('preview seed refuses a symlink database before application modules can open the target', () => {
  const previewDir = mkdtempSync('/tmp/plm-operational-fixture-')
  const target = join(temp, 'non-database-target')
  writeFileSync(target, 'unchanged')
  symlinkSync(target, join(previewDir, 'fixture.sqlite'))
  try {
    const run = spawnSync(process.execPath, ['scripts/seed-operational-reports-preview.mjs'], { cwd: resolve(import.meta.dirname, '..'), env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_FILE: join(previewDir, 'fixture.sqlite') }, encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /must not be a symbolic link/)
  } finally { rmSync(previewDir, { recursive: true, force: true }) }
})
