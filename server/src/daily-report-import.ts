import { TextDecoder } from 'node:util'
import ExcelJS from 'exceljs'

export interface ParsedDailyImportRow {
  line: number
  values: Record<string, unknown>
  errors: string[]
}
export interface ParsedDailyImport {
  headers: string[]
  mappedFields: string[]
  rows: ParsedDailyImportRow[]
}

const aliases: Record<string, string[]> = {
  type: ['type', '类型', '业务类型', '日报类型', '销售采购类型'],
  date: ['date', 'reportdate', '日期', '业务日期', '报表日期'],
  partyName: ['partyname', '客户供应商', '客户/供应商', '客户名称', '供应商名称', '客商', '往来单位', '客户或供应商'],
  documentNo: ['documentno', 'billno', '单据编号', '单据号', '单号', '日报编号'],
  quantity: ['quantity', '数量', '业务数量'],
  currency: ['currency', '币种', '原币币种'],
  originalAmount: ['originalamount', 'amount', '原币金额', '金额', '发生金额'],
  exchangeRate: ['exchangerate', 'rate', '汇率', '折算汇率'],
  note: ['note', 'remark', '备注', '摘要', '说明'],
  sourceIdempotencyKey: ['sourceidempotencykey', 'sourcekey', 'sourceid', 'externalid', '来源幂等键', '来源键', '外部行ID', '外部单据行ID', '源系统ID'],
}
const normalizeHeader = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_\-()（）/\\:：.]/g, '')

function csvRows(input: string): Array<{ line: number; values: string[] }> {
  const source = input.replace(/^\uFEFF/, '')
  const rows: Array<{ line: number; values: string[] }> = []
  let row: string[] = [], value = '', quoted = false, afterQuote = false, line = 1, rowLine = 1
  const pushRow = () => {
    row.push(value); value = ''
    if (row.some(cell => cell.trim() !== '')) rows.push({ line: rowLine, values: row })
    row = []; afterQuote = false; line++; rowLine = line
    if (rows.length > 5001) throw new Error('每次最多导入 5000 条日报。')
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i++ }
      else if (char === '"') { quoted = false; afterQuote = true }
      else {
        value += char
        if (char === '\r' && source[i + 1] === '\n') { value += '\n'; i++; line++ }
        else if (char === '\n' || char === '\r') line++
      }
    } else if (afterQuote) {
      if (char === ',') { row.push(value); value = ''; afterQuote = false }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i++
        pushRow()
      } else throw new Error('CSV 文件的闭合引号后只能出现逗号或换行。')
    } else if (char === '"') {
      if (value.length !== 0) throw new Error('CSV 文件中的引号必须位于字段开头。')
      quoted = true
    } else if (char === ',') { row.push(value); value = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      pushRow()
    } else value += char
  }
  if (quoted) throw new Error('CSV 文件包含未闭合的引号。')
  if (value.length || row.length || afterQuote) {
    row.push(value)
    if (row.some(cell => cell.trim() !== '')) rows.push({ line: rowLine, values: row })
    if (rows.length > 5001) throw new Error('每次最多导入 5000 条日报。')
  }
  return rows
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const item = value as { text?: unknown; richText?: Array<{ text?: string }>; formula?: unknown; sharedFormula?: unknown; result?: unknown; hyperlink?: unknown }
    if (item.formula !== undefined || item.sharedFormula !== undefined) throw new Error('不支持含公式的单元格，请先将公式结果粘贴为值。')
    if (typeof item.text === 'string') return item.text.trim()
    if (Array.isArray(item.richText)) return item.richText.map(part => part.text ?? '').join('').trim()
    if (item.result !== undefined) return displayValue(item.result)
  }
  return String(value).trim()
}
function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
  }
  const raw = displayValue(value)
  const exact = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  if (exact) return `${exact[1]}-${exact[2]!.padStart(2, '0')}-${exact[3]!.padStart(2, '0')}`
  return raw
}
function numberValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return value
  const raw = displayValue(value).replace(/[￥¥$,，\s]/g, '')
  if (!raw) return undefined
  if (/^\(.*\)$/.test(raw)) return -Number(raw.slice(1, -1))
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : raw
}
function normalizedNumericText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  let raw = displayValue(value).replace(/[￥¥$,，\s]/g, '')
  if (!raw) return undefined
  if (/^\(.*\)$/.test(raw)) raw = `-${raw.slice(1, -1)}`
  return raw
}
function parseType(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return value
  const raw = displayValue(value).trim().toLocaleLowerCase()
  if (['sales', 'sale', '销售'].includes(raw)) return 'sales'
  if (['purchase', '采购'].includes(raw)) return 'purchase'
  return raw
}
function parseGrid(headers: string[], rows: Array<{ line: number; values: unknown[]; errors?: string[] }>, defaultType: string): ParsedDailyImport {
  const normalized = headers.map(normalizeHeader)
  const seenHeaders = new Map<string, number>()
  const seenFields = new Map<string, number>()
  for (const [index, header] of normalized.entries()) {
    if (!header) throw new Error(`第 ${index + 1} 列的表头不能为空。`)
    const previousHeader = seenHeaders.get(header)
    if (previousHeader !== undefined) throw new Error(`第 ${index + 1} 列与第 ${previousHeader + 1} 列表头重复。`)
    seenHeaders.set(header, index)
    const mappedField = Object.entries(aliases).find(([, candidates]) => candidates.map(normalizeHeader).includes(header))?.[0]
    if (mappedField) {
      const previousField = seenFields.get(mappedField)
      if (previousField !== undefined) throw new Error(`第 ${index + 1} 列与第 ${previousField + 1} 列都映射到重复字段“${mappedField}”。`)
      seenFields.set(mappedField, index)
    }
  }
  const indices: Record<string, number> = {}
  const mappedFields: string[] = []
  for (const [field, candidates] of Object.entries(aliases)) {
    const aliasesNormalized = candidates.map(normalizeHeader)
    const found = normalized.findIndex(header => aliasesNormalized.includes(header))
    if (found >= 0) { indices[field] = found; mappedFields.push(field) }
  }
  const parsedRows = rows.map(row => {
    const values: Record<string, unknown> = {}
    const errors = [...(row.errors ?? [])]
    if (row.values.length !== headers.length) {
      errors.push(`第 ${row.line} 行字段数不匹配：表头有 ${headers.length} 列，当前行有 ${row.values.length} 列。`)
    }
    for (const field of Object.keys(aliases)) {
      const index = indices[field]
      if (index === undefined) continue
      const raw = row.values[index]
      try {
        if (field === 'date') values.date = dateValue(raw)
        else if (field === 'type') values.type = parseType(raw) || defaultType
        else if (field === 'quantity') values[field] = numberValue(raw)
        else if (field === 'originalAmount' || field === 'exchangeRate') {
          values[field] = numberValue(raw)
          values[`${field}Exact`] = normalizedNumericText(raw)
        }
        else if (field === 'currency') values.currency = displayValue(raw).toUpperCase()
        else values[field] = displayValue(raw)
      } catch (error) {
        values[field] = ''
        errors.push(`${field}：${error instanceof Error ? error.message : '单元格格式无效。'}`)
      }
    }
    if (indices.type === undefined && defaultType) values.type = defaultType
    if (values.quantity === undefined) values.quantity = 0
    if (values.currency === undefined || values.currency === '') values.currency = 'CNY'
    if (values.exchangeRate === undefined) values.exchangeRate = 1
    if (values.documentNo === undefined) values.documentNo = ''
    if (values.note === undefined) values.note = ''
    return { line: row.line, values, errors }
  })
  return { headers, mappedFields, rows: parsedRows }
}

export async function parseDailyReportImportFile(fileName: string, buffer: Buffer, defaultType: string): Promise<ParsedDailyImport> {
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
  if (extension === '.csv') {
    if (buffer.includes(0)) throw new Error('CSV 文件包含二进制内容；请使用 UTF-8 编码的 CSV。')
    let input: string
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
    catch { throw new Error('CSV 文件不是有效的 UTF-8 编码。') }
    const rows = csvRows(input)
    if (rows.length < 2) throw new Error('文件至少需要一行表头和一行日报数据。')
    const [header, ...data] = rows
    return parseGrid(header!.values.map(value => value.trim()), data.map(row => ({ line: row.line, values: row.values })), defaultType)
  }
  if (extension !== '.xlsx') throw new Error('仅支持 CSV 或 XLSX 文件；旧版 XLS 请先另存为 XLSX。')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('日报') ?? workbook.getWorksheet('日报明细') ?? workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 2) throw new Error('工作簿至少需要一行表头和一行日报数据。')
  if (sheet.rowCount > 5002) throw new Error('每次最多导入 5000 条日报。')
  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, cell => headers.push(displayValue(cell.value)))
  const rows: Array<{ line: number; values: unknown[]; errors: string[] }> = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const values: unknown[] = [], errors: string[] = []
    row.eachCell({ includeEmpty: true }, cell => {
      try { values.push(cell.value instanceof Date ? cell.value : displayValue(cell.value)) }
      catch (error) { values.push(''); errors.push(error instanceof Error ? error.message : '单元格格式无效。') }
    })
    if (values.some(value => String(value ?? '').trim() !== '')) rows.push({ line: rowNumber, values, errors })
  })
  if (!rows.length) throw new Error('工作簿没有日报数据行。')
  return parseGrid(headers, rows, defaultType)
}
