import type { Request, Response } from 'express'

const searchFields = ['id', 'title', 'name', 'code', 'partNo', 'bomNo', 'docNo', 'orderNo', 'description', 'specification', 'employee', 'department', 'period'] as const
const has = (query: Request['query'], key: string) => Object.hasOwn(query, key)

/** Opt-in pagination preserves existing array consumers. Input must already be scope-filtered. */
export function listResponse<T extends object>(req: Request, res: Response, rows: ReadonlyArray<T>, resolveSearchText?: (row: T) => ReadonlyArray<unknown>) {
  if (!['page', 'pageSize', 'q'].some(key => has(req.query, key))) return res.json(rows)
  const integer = (key: string, fallback: number, max: number): number | undefined => {
    if (!has(req.query, key)) return fallback
    const raw = req.query[key]
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return undefined
    const value = Number(raw)
    return Number.isSafeInteger(value) && value <= max ? value : undefined
  }
  const page = integer('page', 1, Number.MAX_SAFE_INTEGER)
  const pageSize = integer('pageSize', 50, 200)
  const rawQuery = has(req.query, 'q') ? req.query.q : ''
  if (page === undefined || pageSize === undefined || typeof rawQuery !== 'string' || rawQuery.length > 200 || !Number.isSafeInteger((page - 1) * pageSize)) {
    return res.status(400).json({ error: 'invalid_list_query', message: 'page 必须为正整数，pageSize 为 1–200，q 为不超过 200 字符的单一文本。' })
  }
  const query = rawQuery.trim().toLowerCase()
  const matches = query ? rows.filter(row => searchFields.some(field => {
    const value = (row as Record<string, unknown>)[field]
    return typeof value === 'string' && value.toLowerCase().includes(query)
  }) || (resolveSearchText?.(row) ?? []).some(value => typeof value === 'string' && value.toLowerCase().includes(query.normalize('NFKC')))) : rows
  const offset = (page - 1) * pageSize
  return res.json({ items: matches.slice(offset, offset + pageSize), total: matches.length, page, pageSize, totalPages: Math.ceil(matches.length / pageSize) })
}
