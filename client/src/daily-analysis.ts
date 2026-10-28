export type AnalysisKind = "sales" | "purchase";
export type AnalysisFilters = {
  q: string; from: string; to: string; partyName: string;
  createdBy: string[]; currency: string[];
};
export const emptyAnalysisFilters = (date: string): AnalysisFilters => ({
  q: "", from: date, to: date, partyName: "", createdBy: [], currency: [],
});
// Also accepts older single-value API responses or saved filter metadata.
export function analysisSelections(value: unknown): string[] {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean))];
}
export function analysisQuery(kind: AnalysisKind, filters: AnalysisFilters): string {
  const query = new URLSearchParams({ type: kind });
  for (const key of ["q", "from", "to", "partyName"] as const) if (filters[key]?.trim()) query.set(key, filters[key].trim());
  for (const key of ["createdBy", "currency"] as const) for (const value of analysisSelections(filters[key])) query.append(key, value);
  // Source was removed from the UI: old API responses/cache must never reapply it.
  return query.toString();
}
const localDay = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function analysisPreset(preset: "week" | "month" | "year", today = new Date()): Pick<AnalysisFilters, "from" | "to"> {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (preset === "month") start.setDate(1);
  if (preset === "year") { start.setMonth(0); start.setDate(1); }
  return { from: localDay(start), to: localDay(today) };
}
export function analysisFilterError(filters: Pick<AnalysisFilters, "from" | "to">): string {
  for (const date of [filters.from, filters.to]) {
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "请输入有效日期。";
  }
  return filters.from && filters.to && filters.from > filters.to ? "开始日期不能晚于结束日期。" : "";
}
// Move both endpoints, not the browser clock or a UI-only date label. UTC avoids DST gaps.
// If one endpoint is blank, use the other as a one-day window; if both are blank, use the report date.
export function shiftAnalysisRange(filters: Pick<AnalysisFilters, "from" | "to">, days: -7 | 7, fallbackDate: string): Pick<AnalysisFilters, "from" | "to"> {
  if (analysisFilterError(filters)) return { from: filters.from, to: filters.to };
  const shift = (day: string) => {
    const value = new Date(`${day}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : day;
  };
  return { from: shift(filters.from || filters.to || fallbackDate), to: shift(filters.to || filters.from || fallbackDate) };
}
