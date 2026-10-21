export type AnalysisKind = "sales" | "purchase";
export type AnalysisFilters = {
  q: string; from: string; to: string; partyName: string; createdBy: string;
  currency: string; source: string;
};
export const emptyAnalysisFilters = (date: string): AnalysisFilters => ({
  q: "", from: date, to: date, partyName: "", createdBy: "", currency: "", source: "",
});
export function analysisQuery(kind: AnalysisKind, filters: AnalysisFilters): string {
  const query = new URLSearchParams({ type: kind });
  for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim());
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
export function analysisFilterError(filters: AnalysisFilters): string {
  for (const date of [filters.from, filters.to]) {
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "请输入有效日期。";
  }
  return filters.from && filters.to && filters.from > filters.to ? "开始日期不能晚于结束日期。" : "";
}
