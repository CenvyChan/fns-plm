import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createCandidateReportFixture, LOCAL_CANDIDATE_FIXTURE_FORM_IDS } from '../src/candidate-report-fixtures.ts'

async function bundledServer(relative) {
  const output = await build({ entryPoints: [new URL(relative, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}

const { REPORT_CANDIDATES } = await bundledServer('../../server/src/report-candidate-contract.ts')
const { TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS } = await bundledServer('../../server/src/target-account-readonly-observations.ts')
const candidates = REPORT_CANDIDATES.map(candidate => ({
  ...candidate,
  targetAccountReadOnlyObservation: TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS[candidate.formId] || null,
}))
const byId = id => candidates.find(candidate => candidate.formId === id)

const expectedFormIds = [
  'SAL_CollectReport', 'AR_PAYDETAILREPORT', 'AP_IVDetailReport',
  'AP_PAYDETAILREPORT', 'AP_SumReport',
]

test('seven requested report pages expose independent synthetic fixtures without unlocking live calls', () => {
  assert.deepEqual([...LOCAL_CANDIDATE_FIXTURE_FORM_IDS].sort(), [...expectedFormIds].sort())
  const allRowIds = []
  const allRows = []
  for (const formId of expectedFormIds) {
    const candidate = byId(formId)
    assert.ok(candidate, `${formId} remains in the exact 12-item candidate catalog`)
    assert.equal(candidate.localRowsAvailable, true, `${formId} explicitly permits only its local fixture`)
    assert.equal(candidate.executionStatus, 'locked', `${formId} live remains locked`)
    assert.equal(candidate.validation.liveCallAllowed, false, `${formId} never enables K3 calls`)
    assert.equal(candidate.selectedFieldKeys, null, `${formId} request FieldKeys remain unselected`)
    const fixture = createCandidateReportFixture(candidate)
    assert.ok(fixture, `${formId} gets a local-only UI fixture`)
    assert.equal(fixture.formId, formId)
    assert.equal(fixture.source, 'local_synthetic_fixture_not_k3_tested')
    assert.equal(fixture.label, '本地合成 fixture / 非实测行')
    assert.equal(fixture.liveCallsAllowed, false)
    assert.equal(fixture.rows.length, 4, `${formId} uses a bounded four-row interaction sample`)
    assert.equal(new Set(fixture.rows.map(item => item.id)).size, fixture.rows.length, `${formId} synthetic row identifiers are unique`)
    assert.ok(fixture.rows.every(item => item.id.startsWith(`fixture:${formId}:`)), `${formId} row IDs are isolated by FormId`)
    assert.ok(candidate.modelFieldKeys.includes(fixture.filter.modelPath) || candidate.modelNestedFieldPaths.includes(fixture.filter.modelPath), `${formId} filter path comes from this attachment's Model`)
    const outputKeys = new Set(candidate.fieldCandidates.map(field => field.key))
    assert.ok(fixture.columns.every(key => outputKeys.has(key)), `${formId} table columns stay within its own FieldKeys`)
    assert.ok(fixture.filter.outputKeys.every(key => outputKeys.has(key)), `${formId} filter matching uses its own output FieldKeys`)
    for (const row of fixture.rows) assert.deepEqual(Object.keys(row.values).sort(), [...fixture.columns].sort(), `${formId} row values contain exactly the selected local display columns`)
    for (const excluded of candidate.targetAccountReadOnlyObservation?.excludedRuntimeFieldKeys || []) {
      assert.ok(!fixture.columns.includes(excluded), `${formId} fixture omits observed excluded runtime key ${excluded}`)
      assert.ok(fixture.rows.every(row => !(excluded in row.values)), `${formId} rows omit observed excluded runtime key ${excluded}`)
    }
    allRowIds.push(...fixture.rows.map(item => item.id))
    allRows.push(...fixture.rows)
    assert.equal('rows' in candidate, false, `${formId} contract stores no fixture rows`)
  }
  assert.equal(new Set(allRowIds).size, allRowIds.length, 'no fixture row is reused across FormIds')
  assert.equal(new Set(allRows).size, allRows.length, 'each report owns separate row objects')
})

test('fixture creation fails closed on unapproved Model paths, output keys, and excluded runtime columns', () => {
  const candidate = byId('AP_PAYDETAILREPORT')
  assert.throws(() => createCandidateReportFixture({ ...candidate, modelNestedFieldPaths: [] }), /outside its attachment Model/)
  assert.throws(() => createCandidateReportFixture({ ...candidate, fieldCandidates: candidate.fieldCandidates.filter(field => field.key !== 'FAMOUNTFOR') }), /outside its attachment FieldKeys/)
  assert.throws(() => createCandidateReportFixture({ ...candidate, targetAccountReadOnlyObservation: { excludedRuntimeFieldKeys: ['FAMOUNTFOR'] } }), /must omit excluded runtime key/)
  assert.throws(() => createCandidateReportFixture({ ...candidate, localRowsAvailable: false }), /must explicitly allow local synthetic rows/)
})

test('other candidate details remain locked and AR summary remains a FormId-free placeholder', () => {
  for (const formId of ['SUB_ROExecuteDetailRpt', 'SUB_ROExecuteSummaryRpt', 'QINL_YSCBFXB', 'AR_AgingAnalysis', 'AP_AgingAnalysis']) {
    const candidate = byId(formId)
    assert.equal(candidate.localRowsAvailable, false)
    assert.equal(createCandidateReportFixture(candidate), null)
    assert.equal(candidate.executionStatus, 'locked')
  }
  assert.equal(JSON.stringify(LOCAL_CANDIDATE_FIXTURE_FORM_IDS).includes('Aging'), false, 'no aging report has a local synthetic fixture')
  const arPlaceholder = candidates.find(candidate => candidate.formId === null)
  assert.equal(arPlaceholder, undefined, 'AR summary placeholder is not inserted into the 12 FormId candidates')
})
