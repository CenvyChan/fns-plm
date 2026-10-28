export const PURCHASE_ARRAY_FIELD_KEYS = [
  'FBillNo', 'FDate', 'FSUPPLIERID', 'FMATERIALID', 'FOrderQty', 'FImportQty',
] as const

export type NormalizedPurchaseDemo = {
  formId: 'PUR_PurchaseOrderDetailRpt'
  source: 'local_demo_fixture_not_k3_tested'
  label: string
  status: 'fixture'
  liveCallsAllowed: false
  page: number
  pageSize: number
  total: number
  rows: Array<Record<string, unknown>>
}

/** Map tuple cells by the accompanying FieldKeys order; never infer object keys by position elsewhere. */
export function mapRowsByFieldKeys(fieldKeys: unknown, rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(fieldKeys) || fieldKeys.length === 0 || !fieldKeys.every(key => typeof key === 'string' && key.length > 0)) {
    throw new TypeError('FieldKeys must be a non-empty array of non-empty strings')
  }
  if (new Set(fieldKeys).size !== fieldKeys.length) throw new TypeError('FieldKeys must not contain duplicates')
  if (!Array.isArray(rows)) throw new TypeError('Rows must be an array of tuple rows')
  return rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== fieldKeys.length) {
      throw new TypeError(`Rows[${rowIndex}] must contain exactly ${fieldKeys.length} values`)
    }
    return Object.fromEntries(fieldKeys.map((key: string, columnIndex: number) => [key, row[columnIndex]]))
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Consume only the explicit local purchase mock. The observed K3 response is not
 * loaded or replayed; live calls remain locked and this mock contains synthetic rows only.
 */
export function parsePurchaseDemoMock(payload: unknown): NormalizedPurchaseDemo {
  if (!isRecord(payload) || payload.formId !== 'PUR_PurchaseOrderDetailRpt' || payload.source !== 'local_demo_fixture_not_k3_tested' || payload.status !== 'fixture' || payload.liveCallsAllowed !== false) {
    throw new TypeError('Purchase array response parser accepts local fixture mocks only')
  }
  if (!Number.isInteger(payload.page) || !Number.isInteger(payload.pageSize) || !Number.isInteger(payload.total) || (payload.page as number) < 1 || (payload.pageSize as number) < 1 || (payload.total as number) < 0) {
    throw new TypeError('Local purchase demo pagination metadata is invalid')
  }
  const fieldKeys = payload.FieldKeys
  if (!Array.isArray(fieldKeys) || fieldKeys.length !== PURCHASE_ARRAY_FIELD_KEYS.length ||
      [...fieldKeys].sort().some((key, index) => key !== [...PURCHASE_ARRAY_FIELD_KEYS].sort()[index])) {
    throw new TypeError('Local purchase mock FieldKeys must match the six-field response contract')
  }
  const mockRequest = payload.mockRequest
  if (!isRecord(mockRequest) || mockRequest.Limit !== 5) throw new TypeError('Local purchase mock request Limit must be 5')
  const result = payload.Result
  if (!isRecord(result) || result.IsSuccess !== true || !Number.isInteger(result.RowCount) || (result.RowCount as number) < 0 ||
      !Array.isArray(result.Rows) || Object.hasOwn(result, 'Limit')) {
    throw new TypeError('Local purchase mock Result envelope is invalid')
  }
  const mappedRows = mapRowsByFieldKeys(fieldKeys, result.Rows)
  if (mappedRows.length > (mockRequest.Limit as number) || (result.RowCount as number) < mappedRows.length || result.RowCount !== payload.total) {
    throw new TypeError('Local purchase mock row counts do not match its bounded page')
  }
  return {
    formId: 'PUR_PurchaseOrderDetailRpt', source: 'local_demo_fixture_not_k3_tested',
    label: String(payload.label ?? '本地演示 fixture'), status: 'fixture', liveCallsAllowed: false,
    page: payload.page as number, pageSize: payload.pageSize as number, total: result.RowCount as number, rows: mappedRows,
  }
}
