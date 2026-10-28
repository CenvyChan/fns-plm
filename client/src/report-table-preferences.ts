export type ReportColumnField = { key: string; label: string }
export type ReportSortDirection = 'asc' | 'desc'
export type ReportTablePreferences = {
  visibleKeys: string[]
  order: string[]
  frozenCount: number
  sortKey: string
  sortDirection: ReportSortDirection
}

const unique = (values: unknown[]): string[] => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]

export function reportTableStorageKey(formId: string): string {
  return `plm-report-table-preferences:v1:${encodeURIComponent(formId)}`
}

export function createDefaultReportTablePreferences(
  allKeys: readonly string[],
  defaultVisibleKeys: readonly string[],
  excludedKeys: readonly string[] = [],
): ReportTablePreferences {
  return normalizeReportTablePreferences({
    visibleKeys: [...defaultVisibleKeys],
    order: [...allKeys],
    frozenCount: 0,
    sortKey: '',
    sortDirection: 'asc',
  }, allKeys, defaultVisibleKeys, excludedKeys)
}

export function normalizeReportTablePreferences(
  value: unknown,
  allKeys: readonly string[],
  defaultVisibleKeys: readonly string[],
  excludedKeys: readonly string[] = [],
): ReportTablePreferences {
  const keys = unique([...allKeys])
  const available = new Set(keys)
  const excluded = new Set(excludedKeys)
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const storedVisible = Array.isArray(raw.visibleKeys) ? unique(raw.visibleKeys) : [...defaultVisibleKeys]
  let visibleKeys = storedVisible.filter(key => available.has(key) && !excluded.has(key))
  if (!visibleKeys.length) {
    visibleKeys = unique([...defaultVisibleKeys]).filter(key => available.has(key) && !excluded.has(key)).slice(0, 1)
  }
  if (!visibleKeys.length) visibleKeys = keys.filter(key => !excluded.has(key)).slice(0, 1)
  const storedOrder = Array.isArray(raw.order) ? unique(raw.order) : []
  const order = [...storedOrder.filter(key => available.has(key)), ...keys.filter(key => !storedOrder.includes(key))]
  const maxFrozen = Math.min(5, visibleKeys.length)
  const requestedFrozen = Number.isInteger(raw.frozenCount) ? Number(raw.frozenCount) : 0
  const frozenCount = Math.min(maxFrozen, Math.max(0, requestedFrozen))
  const sortKey = typeof raw.sortKey === 'string' && available.has(raw.sortKey) && !excluded.has(raw.sortKey) ? raw.sortKey : ''
  const sortDirection: ReportSortDirection = raw.sortDirection === 'desc' ? 'desc' : 'asc'
  return { visibleKeys, order, frozenCount, sortKey, sortDirection }
}

export function orderedVisibleKeys(preferences: ReportTablePreferences, allKeys: readonly string[]): string[] {
  const visible = new Set(preferences.visibleKeys)
  return [...allKeys]
    .filter(key => visible.has(key))
    .sort((left, right) => {
      const leftIndex = preferences.order.indexOf(left)
      const rightIndex = preferences.order.indexOf(right)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
        || left.localeCompare(right, 'en')
    })
}

export function moveVisibleColumn(
  preferences: ReportTablePreferences,
  visibleKeys: readonly string[],
  key: string,
  delta: -1 | 1,
): ReportTablePreferences {
  const visibleOrder = orderedVisibleKeys(preferences, visibleKeys)
  const index = visibleOrder.indexOf(key)
  const target = index + delta
  if (index < 0 || target < 0 || target >= visibleOrder.length) return preferences
  const nextVisible = [...visibleOrder]
  ;[nextVisible[index], nextVisible[target]] = [nextVisible[target], nextVisible[index]]
  const visible = new Set(visibleOrder)
  const hiddenOrder = preferences.order.filter(item => !visible.has(item))
  return { ...preferences, order: [...nextVisible, ...hiddenOrder] }
}

function compareValues(left: unknown, right: unknown): number {
  if (left === null || left === undefined || left === '') return right === null || right === undefined || right === '' ? 0 : 1
  if (right === null || right === undefined || right === '') return -1
  if (typeof left === 'number' && typeof right === 'number' && Number.isFinite(left) && Number.isFinite(right)) return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' })
}

export function sortReportRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  sortKey: string,
  direction: ReportSortDirection,
): T[] {
  if (!sortKey) return [...rows]
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = left.row[sortKey], rightValue = right.row[sortKey]
      const leftBlank = leftValue === null || leftValue === undefined || leftValue === ''
      const rightBlank = rightValue === null || rightValue === undefined || rightValue === ''
      if (leftBlank !== rightBlank) return leftBlank ? 1 : -1
      const compared = compareValues(leftValue, rightValue)
      return (direction === 'desc' ? -compared : compared) || left.index - right.index
    })
    .map(item => item.row)
}
