import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AR_SUMMARY_PLACEHOLDER, REPORT_CANDIDATES } from '../dist/report-candidate-contract.js'

const expectedFormIds = [
  'PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'SAL_CollectReport',
  'SUB_ROExecuteDetailRpt', 'SUB_ROExecuteSummaryRpt', 'AR_AgingAnalysis',
  'AR_PAYDETAILREPORT', 'AP_AgingAnalysis', 'AP_IVDetailReport',
  'AP_PAYDETAILREPORT', 'AP_SumReport', 'QINL_YSCBFXB',
]
const localFixtureFormIds = [
  'PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'SAL_CollectReport',
  'AR_PAYDETAILREPORT', 'AP_IVDetailReport', 'AP_PAYDETAILREPORT', 'AP_SumReport',
]
const byFormId = formId => REPORT_CANDIDATES.find(report => report.formId === formId)
const outputKeys = report => report.fieldCandidates.map(field => field.key)
const parameterKeys = report => report.parameterFields.map(field => field.key)
const sorted = values => [...values].sort()
const assertIncludes = (actual, expected, context) => {
  for (const key of expected) assert.ok(actual.includes(key), `${context} must include ${key}`)
}
const assertRequired = (report, expected) => {
  assert.deepEqual(
    sorted(report.parameterFields.filter(field => field.requiredCandidate).map(field => field.key)),
    sorted(expected),
    report.formId,
  )
}

test('catalog exposes 12 independent FormIds and an AR placeholder without guessed identity', () => {
  assert.deepEqual(REPORT_CANDIDATES.map(report => report.formId), expectedFormIds)
  assert.equal(new Set(REPORT_CANDIDATES.map(report => report.formId)).size, 12)
  assert.ok(REPORT_CANDIDATES.every(report => report.sourceAttachment === null && report.requestedAttachment === null && report.sourceAttachmentMatchesRequestedPath === null))
  assert.ok(REPORT_CANDIDATES.every(report => report.name && report.id && report.formId))
  assert.equal(AR_SUMMARY_PLACEHOLDER.name, 'AR汇总待定义')
  assert.equal(AR_SUMMARY_PLACEHOLDER.formId, null)
  assert.equal(AR_SUMMARY_PLACEHOLDER.method, null)
  assert.equal(AR_SUMMARY_PLACEHOLDER.sourceAttachment, null)
  assert.deepEqual(AR_SUMMARY_PLACEHOLDER.fieldCandidates, [])
  assert.deepEqual(AR_SUMMARY_PLACEHOLDER.modelFieldKeys, [])
  assert.equal(AR_SUMMARY_PLACEHOLDER.liveState, 'pending')
  assert.equal(AR_SUMMARY_PLACEHOLDER.executionStatus, 'locked')
  assert.match(AR_SUMMARY_PLACEHOLDER.blocker, /不猜测/)
})

test('all report contracts remain attachment candidates, unverified, and live-locked', () => {
  for (const report of REPORT_CANDIDATES) {
    assert.equal(report.status, 'candidate_unverified_locked')
    assert.equal(report.liveState, 'unverified')
    assert.equal(report.executionStatus, 'locked')
    assert.equal(report.method, 'GetSysReportData')
    assert.equal(report.methodEvidence, 'attachment_example')
    assert.equal(report.publicApiClassification, 'unverified')
    assert.equal(report.targetAccountValidation, 'unverified')
    assert.equal(report.schemeId, null)
    assert.equal(report.selectedFieldKeys, null)
    assert.equal(report.sourceAttachment, null)
    assert.equal(report.requestedAttachment, null)
    assert.equal(report.sourceAttachmentMatchesRequestedPath, null)
    assert.equal(report.sourceReportedFormId, report.formId)
    assert.equal(report.sourceMatchesRequestedFormId, true)
    assert.equal(report.validation.attachmentMethodDemonstrated, true)
    assert.equal(report.validation.publicApiClassificationVerified, false)
    assert.equal(report.validation.targetLedgerValidated, false)
    assert.equal(report.validation.schemeIdValidated, false)
    assert.equal(report.validation.fieldKeysSelected, false)
    assert.equal(report.validation.requiredEnumsValidated, false)
    assert.equal(report.validation.responseEnvelopeValidated, false)
    assert.equal(report.validation.rowGrainValidated, false)
    assert.equal(report.validation.liveCallAllowed, false)
    assert.equal(report.localRowsAvailable, localFixtureFormIds.includes(report.formId))
    assert.deepEqual(report.candidateFieldKeys, outputKeys(report))
    assert.ok(report.parameterFields.length > 0)
    assert.ok(report.modelFieldKeys.length > 0)
    assert.ok(Array.isArray(report.modelNestedFieldPaths))
    assert.ok(report.fieldCandidates.length > 0)
    assert.ok(report.blockers.some(blocker => /SchemeId.*顶层FieldKeys.*显示列清单/.test(blocker)))
    assert.ok(report.blockers.some(blocker => /枚举/.test(blocker)))
    assert.ok(report.blockers.some(blocker => /响应/.test(blocker)))
    assert.ok(!('model' in report) && !('rows' in report) && !('metrics' in report) && !('kpis' in report))
  }
})

test('removed source paths do not erase generic FormId and field-candidate contracts', () => {
  for (const report of REPORT_CANDIDATES) {
    assert.equal(report.sourceAttachment, null)
    assert.equal(report.requestedAttachment, null)
    assert.equal(report.sourceAttachmentMatchesRequestedPath, null)
    assert.equal(report.sourceReportedFormId, report.formId)
    assert.equal(report.sourceMatchesRequestedFormId, true)
    assert.equal(report.selectedFieldKeys, null)
    assert.equal(report.executionStatus, 'locked')
  }
})

test('all 12 report definitions retain their Model and FieldKeys structure counts without rows', () => {
  const expectedCounts = {
    PUR_PurchaseOrderDetailRpt: [14, 6, 101],
    SAL_DetailReport: [26, 8, 121],
    SAL_CollectReport: [31, 8, 138],
    SUB_ROExecuteDetailRpt: [20, 5, 28],
    SUB_ROExecuteSummaryRpt: [20, 5, 14],
    AR_AgingAnalysis: [32, 7, 25],
    AR_PAYDETAILREPORT: [42, 7, 53],
    AP_AgingAnalysis: [31, 7, 25],
    AP_IVDetailReport: [20, 5, 29],
    AP_PAYDETAILREPORT: [42, 7, 51],
    AP_SumReport: [41, 7, 31],
    QINL_YSCBFXB: [41, 16, 2],
  }
  assert.deepEqual(Object.keys(expectedCounts), expectedFormIds)
  for (const [formId, [modelKeyCount, nestedPathCount, outputFieldKeyCount]] of Object.entries(expectedCounts)) {
    const report = byFormId(formId)
    assert.equal(report.modelFieldKeys.length, modelKeyCount, `${formId} Model top-level keys`)
    assert.equal(report.modelNestedFieldPaths.length, nestedPathCount, `${formId} Model nested paths`)
    assert.equal(outputKeys(report).length, outputFieldKeyCount, `${formId} output FieldKeys`)
    assert.equal(report.sourceReportedFormId, formId, `${formId} is assigned by embedded FormId`)
    assert.equal(report.localRowsAvailable, localFixtureFormIds.includes(formId), `${formId} fixture boundary`)
    assert.equal(report.selectedFieldKeys, null, `${formId} FieldKeys remain unselected`)
    assert.equal('rows' in report, false, `${formId} has no persisted rows`)
  }
})

test('AP and cost report definitions retain their Model input keys and output FieldKeys', () => {
  const keyList = value => value.trim().split(/\s+/)
  const expected = {
    AP_AgingAnalysis: {
      model: `FAffiliation FCONTACTUNITTYPE FContactUnitFrom FContactUnitTo FByDate FRadioBusinessDate FRadioEndDate FUnAudit FByBill FInSettle FAccountSystem FOutSettle FIsFromFilter FSettleOrgLst FIncludePayEvaluate_New FOnlyShowPayEvaluate_New FShowLocal FCurrencyFrom FShowSumLocal FToEndDate FNoPrePayment FOnlyShowPrePayment FShowAmountInCost FCONTACTUNITMUL FMULCONTACT FPRESETBASE1 FPRESETBASE2 FReSetAllocateExc FExChangeRateType FAgingCalStd FEntAgingGrpSetting`,
      nested: `FAffiliation.FNAME FContactUnitFrom.FNumber FContactUnitTo.FNumber FAccountSystem.FNumber FExChangeRateType.FNUMBER FEntAgingGrpSetting[].FSection FEntAgingGrpSetting[].FDays`,
      output: `FContactUnitNumber FCONTACTUNIT FCurrencyName FPAYORGNAME FSettleOrgName FPurchaseOrgName FPurchaseDeptName FPurchaseGroupName FPurchaserName FBillTypeName FBillNo FDate FEndDate FPROVINCIAL FBalanceAmtFor FMasterCurrencyName FBalanceAmt FREMARK FSetAccountType FMATERIALNUMBER FMATERIALNAME FORDERNUMBER FSUPPLIERGROUPNAME FPayConditon FISWRITEOFF`,
    },
    AP_IVDetailReport: {
      model: `FAffiliation FCONTACTUNITTYPE FCONTACTUNITFrom FPurTaxInCost FSettleOrgLst FAccountSystem FInSettle FCONTACTUNITTo FShowByMaterial FEndDate FBeginDate FOutSettle FCurrencyFrom FIncludeExpBill FInCludeAllExpBill FBalZeroNotDisp FINCLUDOTHER FINSTOCKBUSTYPE FIVTakeNoTaxAmount FIncludeZCBill`,
      nested: `FAffiliation.FNAME FCONTACTUNITFrom.FNumber FAccountSystem.FNumber FCONTACTUNITTo.FNumber FCurrencyFrom[].FNumber`,
      output: `FCONTACTUNITNUMBER FCONTACTUNITNAME FCURRENCYFORNAME FBUSINESSDESP FBillNo FBILLTYPENAME FDate FBUSINESSDEPTNAME FBUSINESSGROUPNAME FBUSINESSERNAME FBUSINESSORGNAME FSETTLEORGNAME FMaterialNumber FMaterialName FModel FUnit FQty FPAmountBegin FPRECAMOUNT FPPAMOUNT FPLEFTAMOUNT FOAmountBegin FOInOutAmount FOOutAMOUNT FOLEFTAMOUNT FREMARK FSetAccountType FCOMMENT FMaterialGroupName`,
    },
    AP_PAYDETAILREPORT: {
      model: `FAffiliation FSTARTYEAR FENDYEAR FCONTACTUNITTYPE FSTARTPERIOD FENDPERIOD FCONTACTUNITFrom FUSEPERIOD FUSEDATE FSettleOrgLst FCONTACTUNITTo FAccountSystem FInSettle FOutSettle FShowByMaterial FNoShowForNoLeft FNoShowForNoOccur FNOAUDIT FEndDate FBeginDate FNoShowForBoth FCurrencyFrom FIncludePayEvaluate FIncludePayEvaluate_New FDEFAULTACCTCALENDARID FOnlyShowPayEvaluate FOnlyShowPayEvaluate_New FShowLocal FShowSumLocal FShowZeroAmountBill FNoPrePayment FOnlyShowPrePayment FShowAmountInCost FCONTACTUNITMUL FMULCONTACT FPRESETBASE1 FPRESETBASE2 FRedHookNotDisp FMergeSameMaterial FGROUPSUPPLIER FShowMatchBill FDateRadioGrp`,
      nested: `FAffiliation.FNAME FCONTACTUNITFrom.FNumber FCONTACTUNITTo.FNumber FAccountSystem.FNumber FCurrencyFrom[].FNumber FPRESETBASE1[].FNumber FPRESETBASE2[].FNumber`,
      output: `FCONTACTUNITNUMBER FCONTACTUNITNAME FBUSINESSORGNAME FSETTLEORGNAME FRPORGNAME FBUSINESSDEPTNAME FBUSINESSGROUPNAME FBUSINESSERNAME FCURRENCYFORNAME FAMOUNTFOR FHADIVAMOUNTFOR FREALAMOUNTFOR FOFFAMOUNTFOR FLEFTAMOUNTFOR FCURRENCYNAME FAMOUNT FHADIVAMOUNT FREALAMOUNT FOFFAMOUNT FLEFTAMOUNT FSUPPLIERID FSUPPLIERGROUPNAME FBUSINESSDEPTID FBUSINESSDEPTGNAME FBUSINESSDESP FBILLTYPENAME FBILLNO FDATE FORDERNO FMaterialNumber FMaterialName FModel FLOT FUnit FQty FTaxPrice FDISCOUNTAMOUNTFOR FRPOSEName FSetAccountType FCASHSALE FREMARK FORDER FTRANSFER FCHARGE FCURRENCYRECNAME FREFUNDAMOUNTFOR FSOURCEFORMNAME FSOURCEBILLNO FCOMMENT FGROUPSUPPLIERNAME FISWRITEOFF`,
    },
    AP_SumReport: {
      model: `FAffiliation FSTARTYEAR FENDYEAR FCONTACTUNITTYPE FSTARTPERIOD FENDPERIOD FCONTACTUNITFrom FUSEDATE FSettleOrgLst FCONTACTUNITTo FAccountSystem FInSettle FOutSettle FUSEPERIOD FNoShowForNoLeft FNoShowForNoOccur FNOAUDIT FEndDate FBeginDate FNoShowForBoth FCurrencyFrom FIncludePayEvaluate FIncludePayEvaluate_New FDEFAULTACCTCALENDARID FOnlyShowPayEvaluate FOnlyShowPayEvaluate_New FShowLocal FShowSumLocal FNoPrePayment FOnlyShowPrePayment FShowAmountInCost FCONTACTUNITMUL FMULCONTACT FPRESETBASE1 FPRESETBASE2 FGROUPSUPPLIER FPERIODAMOUNT FTOPERIODAMOUNT FCheckPeriod FShowMatchBill FDateRadioGrp`,
      nested: `FAffiliation.FNAME FCONTACTUNITFrom.FNumber FCONTACTUNITTo.FNumber FAccountSystem.FNumber FCurrencyFrom[].FNumber FPRESETBASE1[].FNumber FPRESETBASE2[].FNumber`,
      output: `FCONTACTUNITNUMBER FCONTACTUNITNAME FBUSINESSORGNAME FSETTLEORGNAME FRPORGNAME FBUSINESSDEPTNAME FBUSINESSGROUPNAME FBUSINESSERNAME FCURRENCYFORNAME FINITAMOUNTFOR FAMOUNTFOR FHADIVAMOUNTFOR FREALAMOUNTFOR FOFFAMOUNTFOR FLEFTAMOUNTFOR FCURRENCYNAME FINITAMOUNT FAMOUNT FHADIVAMOUNT FREALAMOUNT FOFFAMOUNT FLEFTAMOUNT FYEARPERIOD FSUPPLIERID FSUPPLIERGROUPNAME FBUSINESSDEPTID FBUSINESSDEPTGNAME FBILLTYPENAME FCURRENCYRECNAME FREFUNDAMOUNTFOR FGROUPSUPPLIERNAME`,
    },
    QINL_YSCBFXB: {
      model: `FACCTGSYSTEMID FACCTGORGID FACCTPOLICYID FYear FPeriod FEndYear FSTARTMATERIALID FEndPeriod FENDMATERIALID FCurrencyID FSTARTBILLNO FFPROORDERTYPE FCHXTotal FENDSALEDEPT FSTARTSALER FSTARTCUSTOMER FENDSALER FSTARTSALEDEPT FSTARTEXPENSEID FENDEXPENSEID FSTARTCOSTCID FISSHOWDETAIL FMULBILLTYPE FENDDATE FSTARTDATE FBILLTYPE FENDCOSTCID FGroupBy FENDBILLNO FENDPROORDERID FSTARTPROORDERID FAcrossOrgOrder FENDCUSTOMER FCUSTOMERTYPE FGETCBFROMAR FISARAPINFO FRADIOGROUP FRdPeriod FRdData FIsDisplayPeriod FSHOWALLAMOUNTFOR`,
      nested: `FACCTGSYSTEMID.FNumber FACCTGORGID.FNumber FACCTPOLICYID.FNumber FSTARTMATERIALID.FNumber FENDMATERIALID.FNumber FCurrencyID.FNumber FENDSALEDEPT.FNUMBER FSTARTSALER.FNUMBER FSTARTCUSTOMER.FNUMBER FENDSALER.FNUMBER FSTARTSALEDEPT.FNUMBER FSTARTEXPENSEID.FNumber FENDEXPENSEID.FNumber FSTARTCOSTCID.FNumber FENDCOSTCID.FNumber FENDCUSTOMER.FNUMBER`,
      output: `FMATERIALID FgroupName`,
    },
  }
  for (const [formId, contract] of Object.entries(expected)) {
    const report = byFormId(formId)
    assert.deepEqual(report.modelFieldKeys, keyList(contract.model), `${formId} Model`)
    assert.deepEqual(report.modelNestedFieldPaths, keyList(contract.nested), `${formId} nested Model`)
    assert.deepEqual(outputKeys(report), keyList(contract.output), `${formId} FieldKeys`)
    assert.equal(report.sourceAttachmentMatchesRequestedPath, null, formId)
    assert.equal(report.localRowsAvailable, localFixtureFormIds.includes(formId), `${formId} local fixture allowlist`)
    assert.equal(report.selectedFieldKeys, null, `${formId} output keys remain unselected`)
    assert.equal(report.executionStatus, 'locked', `${formId} remains live-locked`)
  }
})

test('purchase and sales detail preserve separate Model filters and output FieldKeys', () => {
  const purchase = byFormId('PUR_PurchaseOrderDetailRpt')
  const sales = byFormId('SAL_DetailReport')
  assert.deepEqual(sorted(parameterKeys(purchase)), sorted(purchase.modelFieldKeys))
  assert.deepEqual(sorted(parameterKeys(sales)), sorted(sales.modelFieldKeys))
  assertRequired(purchase, [
    'FOrderStartDate', 'FOrderEndDate', 'FBusinessType', 'FDocumentStatus',
    'FPurchaseOrgIdList', 'FLineStatus',
  ])
  assertIncludes(parameterKeys(purchase), [
    'FBeginSupplierId', 'FEndSupplierId', 'FBeginBillNumber', 'FEndBillNumber',
    'FBeginMaterialId', 'FEndMaterialId', 'FBeginPurchaser', 'FEndFPurchaser',
  ], purchase.formId)
  assertIncludes(outputKeys(purchase), [
    'FBillNo', 'FBillSeqId', 'FSUPPLIERID', 'FMATERIALID', 'FOrderQty', 'FOrderAmount',
    'FReceiveQty', 'FReceiveAmount', 'FImportQty', 'FImportAmount', 'FReturnQty', 'FReturnAmount',
    'FPAYQTY', 'FPAYAMOUNT', 'FINVOICEQTY', 'FINVOICEAMOUNT', 'FRECPAYBILLAMOUNT',
    'FPAYBILLAMOUNT', 'FSETADJAMOUNT', 'FPAYWRITOFFAMOUNT', 'FSPEWOFFAMOUNT', 'FINTEPAYAMOUNT',
  ], purchase.formId)
  assertRequired(sales, [
    'FFormStatus', 'FFormCloseStatus', 'FBusCloseStatus', 'FSaleOrgList',
    'FSoFromDate', 'FSoToDate', 'FPriceFrom', 'FSuite', 'FSetAccountType',
  ])
  assertIncludes(parameterKeys(sales), [
    'FCustomerFrom', 'FCustomerTo', 'FSalesFrom', 'FSalesTo', 'FMaterialFrom', 'FMaterialTo',
    'FDelliveryDateFrom', 'FDelliveryDateTo',
  ], sales.formId)
  assertIncludes(outputKeys(sales), [
    'FBILLNO', 'FORDERQTY', 'FORDERAMOUNT', 'FDELIQTY', 'FOUTQTY', 'FRETURNQTY',
    'FRECAMOUNT', 'FINVOECEAMOUNT', 'FADVANCEAMOUNT', 'FRECEIPTAMOUNT', 'FRECSKAMOUNT',
  ], sales.formId)
  assert.equal(purchase.selectedFieldKeys, null)
  assert.equal(sales.selectedFieldKeys, null)
})

test('sales collection, outsourcing detail and summary retain independent field contracts', () => {
  const collect = byFormId('SAL_CollectReport')
  const subDetail = byFormId('SUB_ROExecuteDetailRpt')
  const subSummary = byFormId('SUB_ROExecuteSummaryRpt')
  assertIncludes(parameterKeys(collect), ['FShipment', 'FOutStock', 'FIncoice', 'FReceipt', 'FReturnStock'], collect.formId)
  assertIncludes(outputKeys(collect), ['FSOQTY', 'FSQTY', 'FALREADYQTY', 'FNOTQTY', 'FRECAMOUNT', 'FNRECEIPTAMOUNT'], collect.formId)
  assert.equal(collect.localRowsAvailable, true)
  assert.notDeepEqual(parameterKeys(collect), parameterKeys(byFormId('SAL_DetailReport')))
  assert.notDeepEqual(outputKeys(collect), outputKeys(byFormId('SAL_DetailReport')))
  assertIncludes(parameterKeys(subDetail), [
    'FBeginConveyDate', 'FEndConveyDate', 'FBeginPlanStartDate', 'FEndPlanStartDate',
    'FBeginPlanFinishDate', 'FEndPlanFinishDate', 'FROBillType', 'FStatus', 'FCtrlItem',
  ], subDetail.formId)
  assertIncludes(outputKeys(subDetail), ['FPLANQTY', 'FPURQTY', 'FSTOCKINQTY', 'FNOSTOCKINQTY', 'FPICKEDQTY'], subDetail.formId)
  assertIncludes(parameterKeys(subSummary), ['FSummaryBasis', 'FRODocumentStatus', 'FCloseType'], subSummary.formId)
  assert.notDeepEqual(parameterKeys(subDetail), parameterKeys(subSummary))
  assert.notDeepEqual(outputKeys(subDetail), outputKeys(subSummary))
})

test('AR/AP aging, receivable detail, AP accrual detail and AP summary preserve original keys', () => {
  const arAging = byFormId('AR_AgingAnalysis')
  const arDetail = byFormId('AR_PAYDETAILREPORT')
  const apAging = byFormId('AP_AgingAnalysis')
  const apIv = byFormId('AP_IVDetailReport')
  const apPay = byFormId('AP_PAYDETAILREPORT')
  const apSum = byFormId('AP_SumReport')
  for (const report of [arAging, apAging]) {
    assertIncludes(parameterKeys(report), ['FByDate', 'FSettleOrgLst', 'FAgingCalStd', 'FExChangeRateType', 'FSection', 'FDays'], report.formId)
    assert.ok(report.modelFieldKeys.includes('FEntAgingGrpSetting'), report.formId)
    assertIncludes(report.modelNestedFieldPaths, ['FEntAgingGrpSetting[].FSection', 'FEntAgingGrpSetting[].FDays'], report.formId)
    assertIncludes(outputKeys(report), ['FBalanceAmtFor', 'FBalanceAmt'], report.formId)
  }
  assertIncludes(parameterKeys(arDetail), [
    'FIncludePayEvaluate', 'FIncludePayEvaluate_New', 'FOnlyShowPayEvaluate',
    'FOnlyShowPayEvaluate_New', 'FNoPreReceive', 'FOnlyShowPreReceive',
  ], arDetail.formId)
  assertIncludes(outputKeys(arDetail), ['FAMOUNTFOR', 'FREALAMOUNTFOR', 'FREFUNDAMOUNTFOR', 'FISWRITEOFF'], arDetail.formId)
  assertIncludes(parameterKeys(apIv), ['FIncludeExpBill', 'FInCludeAllExpBill', 'FIncludeZCBill'], apIv.formId)
  assertIncludes(outputKeys(apIv), ['FPAmountBegin', 'FPRECAMOUNT', 'FPPAMOUNT', 'FPLEFTAMOUNT', 'FOAmountBegin', 'FOInOutAmount', 'FOOutAMOUNT', 'FOLEFTAMOUNT'], apIv.formId)
  assertIncludes(parameterKeys(apPay), [
    'FIncludePayEvaluate', 'FIncludePayEvaluate_New', 'FOnlyShowPayEvaluate', 'FOnlyShowPayEvaluate_New',
    'FSTARTYEAR', 'FSTARTPERIOD', 'FENDYEAR', 'FENDPERIOD',
  ], apPay.formId)
  assertIncludes(outputKeys(apPay), ['FAMOUNTFOR', 'FHADIVAMOUNTFOR', 'FREALAMOUNTFOR', 'FOFFAMOUNTFOR', 'FLEFTAMOUNTFOR', 'FAMOUNT', 'FLEFTAMOUNT', 'FISWRITEOFF'], apPay.formId)
  assertIncludes(parameterKeys(apSum), ['FSTARTYEAR', 'FSTARTPERIOD', 'FENDYEAR', 'FENDPERIOD', 'FPERIODAMOUNT', 'FTOPERIODAMOUNT'], apSum.formId)
  assertIncludes(outputKeys(apSum), [
    'FCURRENCYFORNAME',
    'FINITAMOUNTFOR', 'FAMOUNTFOR', 'FHADIVAMOUNTFOR', 'FREALAMOUNTFOR', 'FOFFAMOUNTFOR', 'FLEFTAMOUNTFOR',
    'FCURRENCYNAME', 'FINITAMOUNT', 'FAMOUNT', 'FHADIVAMOUNT', 'FREALAMOUNT', 'FOFFAMOUNT', 'FLEFTAMOUNT', 'FREFUNDAMOUNTFOR',
  ], apSum.formId)
  assert.notDeepEqual(outputKeys(apPay), outputKeys(apSum))
})

test('QINL keeps its attachment input candidates but exposes only the two listed output fields', () => {
  const qinl = byFormId('QINL_YSCBFXB')
  assertIncludes(parameterKeys(qinl), [
    'FACCTGSYSTEMID', 'FACCTGORGID', 'FACCTPOLICYID', 'FYear', 'FPeriod',
    'FSTARTCOSTCID', 'FENDCOSTCID', 'FSTARTEXPENSEID', 'FENDEXPENSEID',
  ], qinl.formId)
  assert.deepEqual(outputKeys(qinl), ['FMATERIALID', 'FgroupName'])
  assert.equal(qinl.selectedFieldKeys, null)
  assert.equal(qinl.localRowsAvailable, false)
})

test('instant inventory GetInventoryData and unrelated stock reports remain outside the 12-item catalog', () => {
  const serialized = JSON.stringify(REPORT_CANDIDATES)
  for (const excluded of ['GetInventoryData', 'STK_Inventory', 'stock-movement', 'inventory-aging', 'BD_STOCK']) {
    assert.equal(serialized.includes(excluded), false, `${excluded} must remain outside the report catalog`)
  }
})
