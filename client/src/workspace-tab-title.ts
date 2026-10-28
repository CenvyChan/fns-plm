/** Compose an identity title using a stable persisted business key only. */
export function businessTabTitle(kind: string, name?: string | null, stableCode?: string | null): string {
  const code = stableCode?.trim()
  const businessName = name?.trim()
  if (!businessName && !code) return ''
  return [kind.trim(), businessName, code ? `#${code}` : ''].filter(Boolean).join(' · ')
}

export function dailyReportTabTitle(date?: string | null, documentNo?: string | null, kind?: 'sales' | 'purchase'): string {
  return businessTabTitle(kind === 'sales' ? '销售日报' : kind === 'purchase' ? '采购日报' : '日报', date?.trim(), documentNo)
}

export function taskTabTitle(title?: string | null, wbsCode?: string | null, id?: string | null): string {
  // Prefer the model's WBS code. The persisted record id is a safe fallback, never a draft field.
  return businessTabTitle('任务', title, wbsCode?.trim() || id?.trim())
}
