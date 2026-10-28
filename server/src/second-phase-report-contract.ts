export const SECOND_PHASE_REPORTS = {
  purchase: {
    formId: 'PUR_PurchaseOrderDetailRpt',
    candidateFilterKeys: ['FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID'],
    enabledFilters: ['FBillNo', 'FDate', 'FMATERIALID'],
    disabledFilterKeys: ['FSUPPLIERID'],
    fields: [
      'FBillNo', 'FDate', 'FSUPPLIERID', 'FSUPPLIERNAME', 'FMATERIALID', 'FMATERIALNAME', 'FMaterialModel',
      'FUnitId', 'FCurrencyId', 'FOrderQty', 'FReceiveQty', 'FImportQty', 'FReturnQty',
      'FOrderAmount', 'FReceiveAmount', 'FImportAmount', 'FPAYAMOUNT',
    ],
  },
  sales: {
    formId: 'SAL_DetailReport',
    candidateFilterKeys: ['FBILLNO', 'FDate', 'FCUSTID', 'FMATERIALID'],
    enabledFilters: ['FBILLNO', 'FDate', 'FMATERIALID'],
    disabledFilterKeys: ['FCUSTID'],
    fields: [
      'FBILLNO', 'FDate', 'FCUSTID', 'FCUSTOMERNAME', 'FMATERIALID', 'FMATERIALNAME', 'FSPECIFICATION',
      'FUNIT', 'FCURRENCYID', 'FORDERQTY', 'FDELIQTY', 'FOUTQTY', 'FRETURNQTY',
      'FORDERAMOUNT', 'FDELIAMOUNT', 'FOUTAMOUNT', 'FRECAMOUNT',
    ],
  },
} as const

export type SecondPhaseReportKind = keyof typeof SECOND_PHASE_REPORTS
export type SecondPhaseFilterKey = typeof SECOND_PHASE_REPORTS[SecondPhaseReportKind]['enabledFilters'][number]
type CandidateRow = Record<string, string | number>

/** Observed procurement row shape for a local mock only; not a selected live FieldKeys request. */
export const PURCHASE_ARRAY_RESPONSE_FIELD_KEYS = [
  'FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID', 'FOrderQty', 'FImportQty',
] as const

interface SecondPhaseDemoBase {
  formId: string
  source: 'local_demo_fixture_not_k3_tested'
  label: '演示/fixture/非K3实测'
  status: 'fixture'
  liveCallsAllowed: false
  page: number
  pageSize: number
  total: number
}

export interface PurchaseSecondPhaseDemoResult extends SecondPhaseDemoBase {
  formId: 'PUR_PurchaseOrderDetailRpt'
  FieldKeys: Array<(typeof PURCHASE_ARRAY_RESPONSE_FIELD_KEYS)[number]>
  mockRequest: { Limit: 5 }
  Result: { IsSuccess: true; RowCount: number; Rows: Array<Array<string | number>> }
}

export interface SalesSecondPhaseDemoResult extends SecondPhaseDemoBase {
  formId: 'SAL_DetailReport'
  rows: CandidateRow[]
}

export type SecondPhaseDemoResult = PurchaseSecondPhaseDemoResult | SalesSecondPhaseDemoResult

// Deliberately synthetic, report-specific local rows; none are K3 output.
const LOCAL_DEMO_ROWS: Record<SecondPhaseReportKind, CandidateRow[]> = {
  purchase: [
    {
      FBillNo: '演示采购单-001', FDate: '2026-10-21', FSUPPLIERID: '演示供应商-A', FSUPPLIERNAME: '演示供应商 A',
      FMATERIALID: '演示物料-001', FMATERIALNAME: '演示物料 A', FMaterialModel: '规格 α', FUnitId: '件', FCurrencyId: 'CNY',
      FOrderQty: 10, FReceiveQty: 4, FImportQty: 3, FReturnQty: 0, FOrderAmount: 1000, FReceiveAmount: 400, FImportAmount: 300, FPAYAMOUNT: 250,
    },
    {
      FBillNo: '演示采购单-002', FDate: '2026-10-22', FSUPPLIERID: '演示供应商-B', FSUPPLIERNAME: '演示供应商 B',
      FMATERIALID: '演示物料-002', FMATERIALNAME: '演示物料 B', FMaterialModel: '规格 β', FUnitId: '箱', FCurrencyId: 'USD',
      FOrderQty: 5, FReceiveQty: 2, FImportQty: 1, FReturnQty: 0, FOrderAmount: 250, FReceiveAmount: 100, FImportAmount: 50, FPAYAMOUNT: 40,
    },
  ],
  sales: [
    {
      FBILLNO: '演示销售单-001', FDate: '2026-10-21', FCUSTID: '演示客户-A', FCUSTOMERNAME: '演示客户 A',
      FMATERIALID: '演示物料-001', FMATERIALNAME: '演示物料 A', FSPECIFICATION: '规格 α', FUNIT: '件', FCURRENCYID: 'CNY',
      FORDERQTY: 12, FDELIQTY: 8, FOUTQTY: 6, FRETURNQTY: 0, FORDERAMOUNT: 1200, FDELIAMOUNT: 800, FOUTAMOUNT: 600, FRECAMOUNT: 200,
    },
    {
      FBILLNO: '演示销售单-002', FDate: '2026-10-22', FCUSTID: '演示客户-B', FCUSTOMERNAME: '演示客户 B',
      FMATERIALID: '演示物料-003', FMATERIALNAME: '演示物料 C', FSPECIFICATION: '规格 γ', FUNIT: '套', FCURRENCYID: 'JPY',
      FORDERQTY: 3, FDELIQTY: 2, FOUTQTY: 1, FRETURNQTY: 0, FORDERAMOUNT: 900, FDELIAMOUNT: 600, FOUTAMOUNT: 300, FRECAMOUNT: 100,
    },
  ],
}

/** Validated, paginated local fixture only. No credentials, integration call, or K3 fallback. */
export function buildSecondPhaseReportDemo(kind: SecondPhaseReportKind, query: Record<string, unknown> = {}): SecondPhaseDemoResult {
  if (!Object.hasOwn(SECOND_PHASE_REPORTS, kind)) throw new TypeError('Unsupported second-phase report kind')
  const contract = SECOND_PHASE_REPORTS[kind]
  const allowedKeys = new Set<string>([...contract.enabledFilters, 'page', 'pageSize'])
  for (const key of Object.keys(query)) if (!allowedKeys.has(key)) throw new TypeError(`Unknown or unsupported query key: ${key}`)
  for (const key of contract.enabledFilters) if (query[key] !== undefined && typeof query[key] !== 'string') throw new TypeError(`Filter ${key} must be a string`)
  const page = query.page === undefined ? 1 : query.page
  const pageSize = query.pageSize === undefined ? 50 : query.pageSize
  if (!Number.isInteger(page) || (page as number) <= 0) throw new TypeError('page must be a positive integer')
  if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 200) throw new TypeError('pageSize must be an integer from 1 to 200')
  const rows = LOCAL_DEMO_ROWS[kind].filter(row => contract.enabledFilters.every(key => {
    const filter = query[key]
    return typeof filter !== 'string' || String(row[key] ?? '').toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
  }))
  const start = ((page as number) - 1) * (pageSize as number)
  const pageRows = rows.slice(start, start + (pageSize as number))
  const base = {
    formId: contract.formId,
    source: 'local_demo_fixture_not_k3_tested',
    label: '演示/fixture/非K3实测',
    status: 'fixture',
    liveCallsAllowed: false,
    page: page as number,
    pageSize: pageSize as number,
    total: rows.length,
  } as const
  if (kind === 'purchase') return {
    ...base,
    formId: 'PUR_PurchaseOrderDetailRpt',
    FieldKeys: [...PURCHASE_ARRAY_RESPONSE_FIELD_KEYS],
    mockRequest: { Limit: 5 },
    Result: {
      IsSuccess: true,
      RowCount: rows.length,
      Rows: pageRows.map(row => PURCHASE_ARRAY_RESPONSE_FIELD_KEYS.map(key => row[key])),
    },
  }
  return { ...base, formId: 'SAL_DetailReport', rows: pageRows.map(row => ({ ...row })) }
}

/** Every live report/API action fails closed; only the explicit local-demo action is available. */
export function runSecondPhaseReportAction(action: string, kind?: SecondPhaseReportKind, query?: Record<string, unknown>): SecondPhaseDemoResult {
  if (action !== 'local-demo') throw new Error('K3 live report actions are locked: scheme/FieldKeys/envelope/response schema are unverified')
  if (!kind) throw new TypeError('A local demo report kind is required')
  return buildSecondPhaseReportDemo(kind, query)
}
