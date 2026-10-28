import { analysisFilterError, analysisSelections, emptyAnalysisFilters, type AnalysisFilters } from './daily-analysis';

// Page + verified user/tenant/organization/account/role key is supplied by App.
// Persist filter metadata only; never cache report rows, editor drafts or permissions.
export function readAnalysisState(key: string | undefined, date: string): AnalysisFilters {
  const fallback = emptyAnalysisFilters(date);
  if (!key) return fallback;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const entry = saved as { date?: unknown; filters?: unknown };
    if (entry.date !== date || !entry.filters || typeof entry.filters !== 'object') return fallback;
    const filters = entry.filters as Record<string, unknown>;
    const next = { ...fallback };
    for (const field of ['q', 'from', 'to', 'partyName'] as const) {
      const value = filters[field];
      if (typeof value !== 'string' || value.length > 500) return fallback;
      next[field] = value;
    }
    for (const field of ['createdBy', 'currency'] as const) {
      const value = filters[field];
      if (typeof value !== 'string' && !Array.isArray(value)) return fallback;
      const values = typeof value === 'string' ? [value] : value;
      if (values.length > (field === 'createdBy' ? 50 : 2) || values.some(item => typeof item !== 'string' || item.length > 500)) return fallback;
      next[field] = analysisSelections(values);
    }
    if (next.currency.some(value => !['CNY', 'USD'].includes(value))) return fallback;
    // Do not read a legacy source filter, even when it exists in the saved metadata.
    return analysisFilterError(next) ? fallback : next;
  } catch { return fallback; }
}
export function saveAnalysisState(key: string | undefined, date: string, filters: AnalysisFilters): void {
  if (!key || analysisFilterError(filters)) return;
  const metadata: AnalysisFilters = {
    q: filters.q, from: filters.from, to: filters.to, partyName: filters.partyName,
    createdBy: analysisSelections(filters.createdBy), currency: analysisSelections(filters.currency),
  };
  try { sessionStorage.setItem(key, JSON.stringify({ date, filters: metadata })); } catch { /* optional storage */ }
}
