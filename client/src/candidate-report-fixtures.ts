export type CandidateFixtureContract = {
  formId: string
  localRowsAvailable?: boolean
  modelFieldKeys: string[]
  modelNestedFieldPaths: string[]
  fieldCandidates: Array<{ key: string; label: string }>
  targetAccountReadOnlyObservation?: { kind?: string; excludedRuntimeFieldKeys?: string[] } | null
}

export type CandidateFixtureRow = { id: string; values: Record<string, string | number> }
export type CandidateFixtureFilter = { modelPath: string; label: string; outputKeys: string[] }
export type CandidateFixture = {
  formId: string
  source: 'local_synthetic_fixture_not_k3_tested'
  label: '本地合成 fixture / 非实测行'
  liveCallsAllowed: false
  pageSize: number
  filter: CandidateFixtureFilter
  columns: string[]
  rows: CandidateFixtureRow[]
}

const row = (id: string, values: Record<string, string | number>): CandidateFixtureRow => ({ id, values })

/**
 * Every row below is fabricated for a single report's UI interaction test.
 * Values are never sourced from a K3 response and are never aggregated across reports.
 */
const definitions: Record<string, Omit<CandidateFixture, 'source' | 'label' | 'liveCallsAllowed'>> = {
  SAL_CollectReport: {
    formId: 'SAL_CollectReport', pageSize: 2,
    filter: { modelPath: 'FCustomerFrom.FNumber', label: '客户', outputKeys: ['FCUSTID', 'FCUSTOMERNAME'] },
    columns: ['FBILLNO', 'FDate', 'FCUSTID', 'FCUSTOMERNAME', 'FMATERIALID', 'FMATERIALNAME', 'FCURRENCYID', 'FSOQTY', 'FSOAMOUNT'],
    rows: [
      row('fixture:SAL_CollectReport:01', { FBILLNO: 'SYN-SOC-001', FDate: '2026-09-01', FCUSTID: 'SYN-SAL-CUST-01', FCUSTOMERNAME: '合成销售客户甲', FMATERIALID: 'SYN-SAL-MAT-01', FMATERIALNAME: '合成销售品甲', FCURRENCYID: '样例币别-A', FSOQTY: 3, FSOAMOUNT: 1200.5 }),
      row('fixture:SAL_CollectReport:02', { FBILLNO: 'SYN-SOC-002', FDate: '2026-09-02', FCUSTID: 'SYN-SAL-CUST-02', FCUSTOMERNAME: '合成销售客户乙', FMATERIALID: 'SYN-SAL-MAT-02', FMATERIALNAME: '合成销售品乙', FCURRENCYID: '样例币别-A', FSOQTY: 2, FSOAMOUNT: 845.25 }),
      row('fixture:SAL_CollectReport:03', { FBILLNO: 'SYN-SOC-003', FDate: '2026-09-03', FCUSTID: 'SYN-SAL-CUST-03', FCUSTOMERNAME: '合成销售客户丙', FMATERIALID: 'SYN-SAL-MAT-03', FMATERIALNAME: '合成销售品丙', FCURRENCYID: '样例币别-B', FSOQTY: 5, FSOAMOUNT: 2100 }),
      row('fixture:SAL_CollectReport:04', { FBILLNO: 'SYN-SOC-004', FDate: '2026-09-04', FCUSTID: 'SYN-SAL-CUST-04', FCUSTOMERNAME: '合成销售客户丁', FMATERIALID: 'SYN-SAL-MAT-04', FMATERIALNAME: '合成销售品丁', FCURRENCYID: '样例币别-B', FSOQTY: 1, FSOAMOUNT: 460 }),
    ],
  },
  AR_PAYDETAILREPORT: {
    formId: 'AR_PAYDETAILREPORT', pageSize: 2,
    filter: { modelPath: 'FCONTACTUNITFrom.FNumber', label: '往来单位', outputKeys: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME'] },
    columns: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME', 'FBUSINESSORGNAME', 'FBILLNO', 'FDATE', 'FCURRENCYFORNAME', 'FAMOUNTFOR', 'FREALAMOUNTFOR', 'FLEFTAMOUNTFOR'],
    rows: [
      row('fixture:AR_PAYDETAILREPORT:01', { FCONTACTUNITNUMBER: 'SYN-AR-PAY-01', FCONTACTUNITNAME: '合成应收往来甲', FBUSINESSORGNAME: '合成销售组织甲', FBILLNO: 'SYN-AR-PAY-001', FDATE: '2026-09-02', FCURRENCYFORNAME: '样例币别-A', FAMOUNTFOR: 1800, FREALAMOUNTFOR: 900, FLEFTAMOUNTFOR: 900 }),
      row('fixture:AR_PAYDETAILREPORT:02', { FCONTACTUNITNUMBER: 'SYN-AR-PAY-02', FCONTACTUNITNAME: '合成应收往来乙', FBUSINESSORGNAME: '合成销售组织乙', FBILLNO: 'SYN-AR-PAY-002', FDATE: '2026-09-04', FCURRENCYFORNAME: '样例币别-A', FAMOUNTFOR: 1320.5, FREALAMOUNTFOR: 500, FLEFTAMOUNTFOR: 820.5 }),
      row('fixture:AR_PAYDETAILREPORT:03', { FCONTACTUNITNUMBER: 'SYN-AR-PAY-03', FCONTACTUNITNAME: '合成应收往来丙', FBUSINESSORGNAME: '合成销售组织丙', FBILLNO: 'SYN-AR-PAY-003', FDATE: '2026-09-06', FCURRENCYFORNAME: '样例币别-B', FAMOUNTFOR: 2460, FREALAMOUNTFOR: 1000, FLEFTAMOUNTFOR: 1460 }),
      row('fixture:AR_PAYDETAILREPORT:04', { FCONTACTUNITNUMBER: 'SYN-AR-PAY-04', FCONTACTUNITNAME: '合成应收往来丁', FBUSINESSORGNAME: '合成销售组织丁', FBILLNO: 'SYN-AR-PAY-004', FDATE: '2026-09-08', FCURRENCYFORNAME: '样例币别-B', FAMOUNTFOR: 760, FREALAMOUNTFOR: 260, FLEFTAMOUNTFOR: 500 }),
    ],
  },
  AP_IVDetailReport: {
    formId: 'AP_IVDetailReport', pageSize: 2,
    filter: { modelPath: 'FCONTACTUNITFrom.FNumber', label: '往来单位', outputKeys: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME'] },
    columns: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME', 'FBillNo', 'FDate', 'FMaterialNumber', 'FMaterialName', 'FCURRENCYFORNAME', 'FQty', 'FPRECAMOUNT', 'FPPAMOUNT'],
    rows: [
      row('fixture:AP_IVDetailReport:01', { FCONTACTUNITNUMBER: 'SYN-AP-IV-01', FCONTACTUNITNAME: '合成未开票往来甲', FBillNo: 'SYN-AP-IV-001', FDate: '2026-09-02', FMaterialNumber: 'SYN-AP-IV-MAT-01', FMaterialName: '合成未开票品甲', FCURRENCYFORNAME: '样例币别-A', FQty: 2, FPRECAMOUNT: 720, FPPAMOUNT: 180 }),
      row('fixture:AP_IVDetailReport:02', { FCONTACTUNITNUMBER: 'SYN-AP-IV-02', FCONTACTUNITNAME: '合成未开票往来乙', FBillNo: 'SYN-AP-IV-002', FDate: '2026-09-04', FMaterialNumber: 'SYN-AP-IV-MAT-02', FMaterialName: '合成未开票品乙', FCURRENCYFORNAME: '样例币别-A', FQty: 4, FPRECAMOUNT: 930, FPPAMOUNT: 230 }),
      row('fixture:AP_IVDetailReport:03', { FCONTACTUNITNUMBER: 'SYN-AP-IV-03', FCONTACTUNITNAME: '合成未开票往来丙', FBillNo: 'SYN-AP-IV-003', FDate: '2026-09-06', FMaterialNumber: 'SYN-AP-IV-MAT-03', FMaterialName: '合成未开票品丙', FCURRENCYFORNAME: '样例币别-B', FQty: 3, FPRECAMOUNT: 1150, FPPAMOUNT: 350 }),
      row('fixture:AP_IVDetailReport:04', { FCONTACTUNITNUMBER: 'SYN-AP-IV-04', FCONTACTUNITNAME: '合成未开票往来丁', FBillNo: 'SYN-AP-IV-004', FDate: '2026-09-08', FMaterialNumber: 'SYN-AP-IV-MAT-04', FMaterialName: '合成未开票品丁', FCURRENCYFORNAME: '样例币别-B', FQty: 1, FPRECAMOUNT: 480, FPPAMOUNT: 120 }),
    ],
  },
  AP_PAYDETAILREPORT: {
    formId: 'AP_PAYDETAILREPORT', pageSize: 2,
    filter: { modelPath: 'FCONTACTUNITFrom.FNumber', label: '往来单位', outputKeys: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME'] },
    columns: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME', 'FBUSINESSORGNAME', 'FBILLNO', 'FDATE', 'FSUPPLIERID', 'FCURRENCYFORNAME', 'FAMOUNTFOR', 'FREALAMOUNTFOR', 'FLEFTAMOUNTFOR'],
    rows: [
      row('fixture:AP_PAYDETAILREPORT:01', { FCONTACTUNITNUMBER: 'SYN-AP-PAY-01', FCONTACTUNITNAME: '合成应付明细往来甲', FBUSINESSORGNAME: '合成采购组织甲', FBILLNO: 'SYN-AP-PAY-001', FDATE: '2026-09-02', FSUPPLIERID: 'SYN-AP-PAY-01', FCURRENCYFORNAME: '样例币别-A', FAMOUNTFOR: 2100, FREALAMOUNTFOR: 800, FLEFTAMOUNTFOR: 1300 }),
      row('fixture:AP_PAYDETAILREPORT:02', { FCONTACTUNITNUMBER: 'SYN-AP-PAY-02', FCONTACTUNITNAME: '合成应付明细往来乙', FBUSINESSORGNAME: '合成采购组织乙', FBILLNO: 'SYN-AP-PAY-002', FDATE: '2026-09-04', FSUPPLIERID: 'SYN-AP-PAY-02', FCURRENCYFORNAME: '样例币别-A', FAMOUNTFOR: 1640, FREALAMOUNTFOR: 640, FLEFTAMOUNTFOR: 1000 }),
      row('fixture:AP_PAYDETAILREPORT:03', { FCONTACTUNITNUMBER: 'SYN-AP-PAY-03', FCONTACTUNITNAME: '合成应付明细往来丙', FBUSINESSORGNAME: '合成采购组织丙', FBILLNO: 'SYN-AP-PAY-003', FDATE: '2026-09-06', FSUPPLIERID: 'SYN-AP-PAY-03', FCURRENCYFORNAME: '样例币别-B', FAMOUNTFOR: 3050, FREALAMOUNTFOR: 1200, FLEFTAMOUNTFOR: 1850 }),
      row('fixture:AP_PAYDETAILREPORT:04', { FCONTACTUNITNUMBER: 'SYN-AP-PAY-04', FCONTACTUNITNAME: '合成应付明细往来丁', FBUSINESSORGNAME: '合成采购组织丁', FBILLNO: 'SYN-AP-PAY-004', FDATE: '2026-09-08', FSUPPLIERID: 'SYN-AP-PAY-04', FCURRENCYFORNAME: '样例币别-B', FAMOUNTFOR: 880, FREALAMOUNTFOR: 380, FLEFTAMOUNTFOR: 500 }),
    ],
  },
  AP_SumReport: {
    formId: 'AP_SumReport', pageSize: 2,
    filter: { modelPath: 'FCONTACTUNITFrom.FNumber', label: '往来单位', outputKeys: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME'] },
    columns: ['FCONTACTUNITNUMBER', 'FCONTACTUNITNAME', 'FBUSINESSORGNAME', 'FYEARPERIOD', 'FCURRENCYFORNAME', 'FINITAMOUNTFOR', 'FAMOUNTFOR', 'FREALAMOUNTFOR', 'FLEFTAMOUNTFOR'],
    rows: [
      row('fixture:AP_SumReport:01', { FCONTACTUNITNUMBER: 'SYN-AP-SUM-01', FCONTACTUNITNAME: '合成应付汇总往来甲', FBUSINESSORGNAME: '合成采购组织甲', FYEARPERIOD: '样例期间-A', FCURRENCYFORNAME: '样例币别-A', FINITAMOUNTFOR: 300, FAMOUNTFOR: 1200, FREALAMOUNTFOR: 700, FLEFTAMOUNTFOR: 800 }),
      row('fixture:AP_SumReport:02', { FCONTACTUNITNUMBER: 'SYN-AP-SUM-02', FCONTACTUNITNAME: '合成应付汇总往来乙', FBUSINESSORGNAME: '合成采购组织乙', FYEARPERIOD: '样例期间-B', FCURRENCYFORNAME: '样例币别-A', FINITAMOUNTFOR: 450, FAMOUNTFOR: 1320, FREALAMOUNTFOR: 620, FLEFTAMOUNTFOR: 1150 }),
      row('fixture:AP_SumReport:03', { FCONTACTUNITNUMBER: 'SYN-AP-SUM-03', FCONTACTUNITNAME: '合成应付汇总往来丙', FBUSINESSORGNAME: '合成采购组织丙', FYEARPERIOD: '样例期间-C', FCURRENCYFORNAME: '样例币别-B', FINITAMOUNTFOR: 260, FAMOUNTFOR: 980, FREALAMOUNTFOR: 500, FLEFTAMOUNTFOR: 740 }),
      row('fixture:AP_SumReport:04', { FCONTACTUNITNUMBER: 'SYN-AP-SUM-04', FCONTACTUNITNAME: '合成应付汇总往来丁', FBUSINESSORGNAME: '合成采购组织丁', FYEARPERIOD: '样例期间-D', FCURRENCYFORNAME: '样例币别-B', FINITAMOUNTFOR: 380, FAMOUNTFOR: 1440, FREALAMOUNTFOR: 840, FLEFTAMOUNTFOR: 980 }),
    ],
  },
}

export const LOCAL_CANDIDATE_FIXTURE_FORM_IDS = Object.freeze(Object.keys(definitions))

/** Return only a schema-checked, report-specific in-memory fixture; never a request payload. */
export function createCandidateReportFixture(candidate: CandidateFixtureContract): CandidateFixture | null {
  const definition = definitions[candidate.formId]
  if (!definition) {
    if (candidate.localRowsAvailable === true) throw new TypeError(`${candidate.formId} declares local fixture rows but has no independent fixture definition`)
    return null
  }
  if (candidate.localRowsAvailable !== true) throw new TypeError(`${candidate.formId} fixture metadata must explicitly allow local synthetic rows`)

  const outputKeys = new Set(candidate.fieldCandidates.map(field => field.key))
  const inputPaths = new Set([...candidate.modelFieldKeys, ...candidate.modelNestedFieldPaths])
  if (!inputPaths.has(definition.filter.modelPath)) throw new TypeError(`${candidate.formId} filter is outside its attachment Model: ${definition.filter.modelPath}`)
  for (const key of [...definition.columns, ...definition.filter.outputKeys]) {
    if (!outputKeys.has(key)) throw new TypeError(`${candidate.formId} fixture key is outside its attachment FieldKeys: ${key}`)
  }
  for (const key of candidate.targetAccountReadOnlyObservation?.excludedRuntimeFieldKeys || []) {
    if (definition.columns.includes(key) || definition.rows.some(item => key in item.values)) throw new TypeError(`${candidate.formId} fixture must omit excluded runtime key: ${key}`)
  }
  const columnSet = new Set(definition.columns)
  for (const fixtureRow of definition.rows) {
    if (Object.keys(fixtureRow.values).length !== definition.columns.length || Object.keys(fixtureRow.values).some(key => !columnSet.has(key))) {
      throw new TypeError(`${candidate.formId} fixture row must contain only its declared FieldKeys columns`)
    }
  }
  return {
    ...definition,
    source: 'local_synthetic_fixture_not_k3_tested',
    label: '本地合成 fixture / 非实测行',
    liveCallsAllowed: false,
    rows: definition.rows.map(item => ({ id: item.id, values: { ...item.values } })),
    columns: [...definition.columns],
    filter: { ...definition.filter, outputKeys: [...definition.filter.outputKeys] },
  }
}
