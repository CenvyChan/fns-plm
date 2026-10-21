import { analysisFilterError, emptyAnalysisFilters, type AnalysisFilters } from './daily-analysis';

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
    for (const field of Object.keys(fallback) as Array<keyof AnalysisFilters>) {
      if (typeof filters[field] !== 'string' || filters[field].length > 500) return fallback;
      next[field] = filters[field];
    }
    return analysisFilterError(next) ? fallback : next;
  } catch { return fallback; }
}
export function saveAnalysisState(key: string | undefined, date: string, filters: AnalysisFilters): void {
  if (!key || analysisFilterError(filters)) return;
  const metadata = emptyAnalysisFilters(date);
  for (const field of Object.keys(metadata) as Array<keyof AnalysisFilters>) metadata[field] = filters[field];
  try { sessionStorage.setItem(key, JSON.stringify({ date, filters: metadata })); } catch { /* optional storage */ }
}
