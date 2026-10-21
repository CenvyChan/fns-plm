import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { apiFetch } from "./api";
import { analysisFilterError, analysisPreset, analysisQuery, emptyAnalysisFilters, type AnalysisFilters, type AnalysisKind } from "./daily-analysis";
import "./daily-business-analysis.css";
import { readAnalysisState, saveAnalysisState } from "./daily-analysis-state";

export type AnalysisReport = {
  id: string; type: AnalysisKind; date: string; partyName: string; partyId?: string;
  documentNo: string; quantity: number; currency: string; originalAmount: number;
  exchangeRate: number; amountCny: number; note: string; source?: string;
  createdAt: string; createdByName: string; allocatedAmount: number;
  links: Array<{ id: string; k3RowId: string; allocatedAmount: number; allocatedQuantity: number }>;
  canEdit?: boolean;
};
type Aggregate = { count: number; quantity: number; amountCny: number };
type Analysis = {
  reports: AnalysisReport[]; filters: AnalysisFilters & { type: AnalysisKind };
  summary: Aggregate & { cnyAmount: number; usdAmount: number };
  dailyTrend: Array<Aggregate & { period: string }>;
  monthlyTrend: Array<Aggregate & { period: string }>;
  counterpartRank: Array<Aggregate & { label: string }>;
  options: { people: Array<{ id: string; label: string }> };
  mockEnabled: boolean; notice: string; amountBasis: string;
};
const decimal = (value: number) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
const money = (value: number) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.message || body?.error || `请求失败（HTTP ${response.status}）`;
}
type Props = {
  filterStorageKey?: string; kind: AnalysisKind; view: "records" | "analysis"; date: string; canWrite: boolean; canManage: boolean; revision: unknown;
  onNew: () => void; onImport: () => void;
  onDetail: (report: AnalysisReport) => void; onEdit: (report: AnalysisReport) => void;
};
export default function DailyBusinessAnalysis({ kind, view, date, filterStorageKey, canWrite, canManage, revision, onNew, onImport, onDetail, onEdit }: Props) {
  const noun = kind === "sales" ? "销售" : "采购";
  const title = `${noun}${view === "records" ? "日报明细" : "统计分析"}`;
  const [draft, setDraft] = useState(() => readAnalysisState(filterStorageKey, date));
  const [applied, setApplied] = useState(() => readAnalysisState(filterStorageKey, date));
  const [result, setResult] = useState<Analysis | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const query = analysisQuery(kind, applied);
  // Restore only this leaf in this verified scope; a deliberate report date change resets it.
  const filterContext = useRef({ date, kind, filterStorageKey });
  useEffect(() => {
    const previous = filterContext.current;
    if (previous.date === date && previous.kind === kind && previous.filterStorageKey === filterStorageKey) return;
    filterContext.current = { date, kind, filterStorageKey };
    const next = previous.date !== date ? emptyAnalysisFilters(date) : readAnalysisState(filterStorageKey, date);
    saveAnalysisState(filterStorageKey, date, next);
    setDraft(next); setApplied(next); setPage(1);
  }, [date, kind, filterStorageKey]);
  useEffect(() => {
    let active = true;
    const sequence = ++request.current;
    setLoading(true); setResult(null); setError(""); setPage(1);
    void (async () => {
      try {
        const response = await apiFetch(`/api/daily-reports/analysis?${query}`);
        if (!response.ok) throw new Error(await errorMessage(response));
        const body = await response.json() as Analysis;
        if (!body || !Array.isArray(body.reports) || !body.summary || !Array.isArray(body.dailyTrend) || !body.options) throw new Error("日报分析接口返回格式无效。");
        if (active && sequence === request.current) setResult(body);
      } catch (cause) {
        if (active && sequence === request.current) setError(cause instanceof Error ? cause.message : "加载失败。");
      } finally { if (active && sequence === request.current) setLoading(false); }
    })();
    return () => { active = false; };
  }, [query, revision, refresh]);
  function apply() {
    const message = analysisFilterError(draft); setValidation(message);
    if (!message) { saveAnalysisState(filterStorageKey, date, draft); setApplied({ ...draft }); setRefresh(value => value + 1); }
  }
  function preset(value: "week" | "month" | "year") {
    const next = { ...draft, ...analysisPreset(value) };
    saveAnalysisState(filterStorageKey, date, next);
    setValidation(""); setDraft(next); setApplied(next); setRefresh(count => count + 1);
  }
  async function exportCurrent() {
    if (!result || loading || exporting) return;
    const exportQuery = analysisQuery(kind, result.filters);
    setExporting(true); setError("");
    try {
      const response = await apiFetch(`/api/daily-reports/analysis/export.xlsx?${exportQuery}`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `${kind}-analysis-${result.filters.from || "all"}-${result.filters.to || "all"}.xlsx`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导出失败。"); }
    finally { setExporting(false); }
  }
  const pageCount = Math.max(1, Math.ceil((result?.reports.length ?? 0) / 10));
  const pageReports = result?.reports.slice((page - 1) * 10, page * 10) ?? [];
  const setField = (field: keyof AnalysisFilters, value: string) => setDraft(current => ({ ...current, [field]: value }));
  const groupTable = (title: string, rows: Array<Aggregate & { period?: string; label?: string }>) => <section className="dba-group" aria-label={title}>
    <h3>{title}</h3><div className="iw-table-wrap"><table><thead><tr><th>{title.includes("排名") ? "客商" : "期间"}</th><th>记录数</th><th>数量</th><th>人民币金额</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.period ?? row.label}><td>{row.period ?? row.label}</td><td>{row.count}</td><td>{decimal(row.quantity)}</td><td>¥{money(row.amountCny)}</td></tr>)}
    </tbody></table>{!rows.length && <p className="iw-empty">当前筛选没有数据。</p>}</div>
  </section>;
  return <section className="iw-card dba" aria-label={title}>
    <div className="iw-card-head"><div><h2>{title}</h2><p>明细、汇总、趋势和导出使用同一筛选口径；不触发 ERP 同步。</p></div>
      {view === "records" && <div className="dr-list-actions">{canWrite && <button className="iw-button iw-approve" onClick={onNew}>新增{noun}日报</button>}{canManage && <button className="iw-button iw-secondary" onClick={onImport}>导入往期{noun}日报</button>}</div>}
    </div>
    <div className="dba-filters" role="search" aria-label={`${noun}统一筛选`} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }}>
      <label>关键词<input value={draft.q} placeholder="客商、单号或备注" onChange={event => setField("q", event.target.value)} /></label>
      <label>开始日期<input type="date" value={draft.from} onChange={event => setField("from", event.target.value)} /></label>
      <label>结束日期<input type="date" value={draft.to} onChange={event => setField("to", event.target.value)} /></label>
      <label>{kind === "sales" ? "客户名称" : "供应商名称"}<input value={draft.partyName} placeholder="按名称包含匹配" onChange={event => setField("partyName", event.target.value)} /></label>
      <label>录入人<select value={draft.createdBy} onChange={event => setField("createdBy", event.target.value)}><option value="">全部录入人</option>{result?.options.people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label>
      <label>币种<select value={draft.currency} onChange={event => setField("currency", event.target.value)}><option value="">全部币种</option><option value="CNY">CNY</option><option value="USD">USD</option></select></label>
      <label>来源<select value={draft.source} onChange={event => setField("source", event.target.value)}><option value="">全部来源</option><option value="manual">手工日报</option><option value="history-import">历史导入</option></select></label>
      <div className="dba-filter-actions"><button className="iw-button iw-approve" type="button" onClick={apply}>应用筛选</button><button className="iw-button iw-secondary" type="button" onClick={() => { const next = emptyAnalysisFilters(date); saveAnalysisState(filterStorageKey, date, next); setDraft(next); setApplied(next); setValidation(""); setRefresh(value => value + 1); }}>重置</button></div>
      <div className="dba-presets" aria-label="时间范围快捷选择">{([['week', '本周'], ['month', '本月'], ['year', '本年']] as const).map(([value, label]) => <button key={value} className="iw-button iw-secondary iw-small" type="button" onClick={() => preset(value)}>{label}</button>)}<span>快捷范围截至今天，覆盖上方旧日期。</span></div>
    </div>
    {validation && <p role="alert" className="iw-alert iw-error">{validation}</p>}
    {error && <div role="alert" className="iw-alert iw-error">{error}<button type="button" className="iw-button iw-secondary iw-small" onClick={() => setRefresh(value => value + 1)}>重试</button></div>}
    <div className="dba-toolbar">
      <div><button type="button" className="iw-button iw-secondary iw-small" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />刷新当前口径</button><button type="button" className="iw-button iw-secondary iw-small" disabled={loading || !result || exporting} onClick={() => void exportCurrent()}><Download size={14} />{exporting ? "导出中…" : "导出当前口径 Excel"}</button></div></div>
    {loading && <p role="status" className="iw-empty">正在加载当前筛选的日报与分析…</p>}
    {!loading && result && <>
      <p className="dba-basis" data-testid="analysis-applied-filters">已应用：{result.filters.q ? `关键词“${result.filters.q}” · ` : ""}{result.filters.from || "不限"} 至 {result.filters.to || "不限"} · {result.filters.partyName || "全部客商"} · {result.filters.currency || "全部币种"} · {result.filters.source === "manual" ? "手工日报" : result.filters.source === "history-import" ? "历史导入" : "全部来源"} · {result.filters.createdBy ? result.options.people.find(person => person.id === result.filters.createdBy)?.label || result.filters.createdBy : "全部录入人"}。修改筛选后请点击“应用筛选”，导出以此处已应用条件为准。</p>
      <div className="dba-summary" aria-label="当前口径汇总">{[["记录数", result.summary.count], ["数量（混合单位）", decimal(result.summary.quantity)], ["CNY 原币", `¥${money(result.summary.cnyAmount)}`], ["USD 原币", `$${money(result.summary.usdAmount)}`], ["折合人民币", `¥${money(result.summary.amountCny)}`]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="dba-basis">{result.notice} {result.amountBasis}</p>
      {view === "records" ? <div role="region" aria-label={`${noun}日报明细表`}><div className="iw-table-wrap"><table><thead><tr><th>日期</th><th>单据编号</th><th>客户 / 供应商</th><th>数量</th><th>原币金额</th><th>人民币金额</th><th>录入人</th><th>操作</th></tr></thead><tbody>{pageReports.map(row => <tr key={row.id}><td>{row.date}</td><td>{row.documentNo || "—"}</td><td>{row.partyName}</td><td>{decimal(row.quantity)}</td><td>{row.currency} {money(row.originalAmount)}</td><td>¥{money(row.amountCny)}</td><td>{row.createdByName || "—"}</td><td><button type="button" className="iw-button iw-secondary iw-small" onClick={() => onDetail(row)}>查看详情</button>{row.canEdit && canWrite && <button type="button" className="iw-button iw-secondary iw-small" onClick={() => onEdit(row)}>编辑</button>}</td></tr>)}</tbody></table>{!pageReports.length && <div className="iw-empty">当前筛选没有日报记录。</div>}</div><div className="dr-pagination"><span>第 {page} / {pageCount} 页 · 共 {result.summary.count} 条；汇总包含全部筛选记录</span><button type="button" className="iw-button iw-secondary iw-small" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" className="iw-button iw-secondary iw-small" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>
        : <div role="region" aria-label={`${noun}统计分析结果`} className="dba-groups">{groupTable("按日趋势", result.dailyTrend)}{groupTable("按月趋势", result.monthlyTrend)}{groupTable("客商排名（前 10）", result.counterpartRank)}</div>}
    </>}
  </section>;
}
