import { useEffect, useId, useRef, useState } from "react";
import { Download, Filter, Boxes, Banknote, CircleDollarSign, Sigma, FileText, Plus, Upload, RotateCcw, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Eye, Pencil, ListFilter, Check } from "lucide-react";
import { apiFetch } from "./api";
import { analysisFilterError, analysisPreset, analysisQuery, analysisSelections, shiftAnalysisRange, emptyAnalysisFilters, type AnalysisFilters, type AnalysisKind } from "./daily-analysis";
import "./daily-business-analysis.css";
import DailyAnalysisCharts from "./DailyAnalysisCharts";
import { readAnalysisState, saveAnalysisState } from "./daily-analysis-state";

export type AnalysisReport = {
  id: string; type: AnalysisKind; date: string; partyName: string; partyId?: string;
  documentNo: string; quantity: number; currency: string; originalAmount: number;
  exchangeRate: number; amountCny: number; note: string; source?: string;
  createdAt: string; createdByName: string; recordedByName?: string; allocatedAmount: number;
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
type Choice = { id: string; label: string };
function MultiFilter({ label, options, values, onChange }: { label: string; options: Choice[]; values: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const choices = [...options, ...values.filter(value => !options.some(option => option.id === value)).map(value => ({ id: value, label: value }))];
  const selectedLabels = values.map(value => choices.find(option => option.id === value)?.label || value);
  return <div className="dba-multi" ref={root} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); root.current?.querySelector('button')?.focus(); } }}>
    <span className="dba-filter-label">{label}</span>
    <button className="dba-multi-trigger" type="button" aria-label={`${label}筛选`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} title={selectedLabels.join("、")}>
      <span>{values.length ? selectedLabels.join("、") : `全部${label}`}</span><ChevronsUpDown size={13} aria-hidden="true" />
    </button>
    {open && <div className="dba-multi-menu" id={id} role="group" aria-label={`${label}多选`}>
      <button className="dba-multi-all" type="button" onClick={() => onChange([])}><ListFilter size={13} aria-hidden="true" />全部{label}{!values.length && <Check size={13} aria-hidden="true" />}</button>
      <div className="dba-multi-options">{choices.map(option => <label key={option.id}><input type="checkbox" checked={values.includes(option.id)} disabled={label === "录入人" && values.length >= 50 && !values.includes(option.id)} onChange={event => onChange(event.target.checked ? [...values, option.id] : values.filter(value => value !== option.id))} /><span>{option.label}</span></label>)}{!choices.length && <span className="dba-multi-empty">暂无可选{label}</span>}</div>
      {label === "录入人" && values.length >= 50 && <small className="dba-multi-empty">最多选择 50 名录入人</small>}
    </div>}
  </div>;
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
  const [people, setPeople] = useState<Choice[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [jumpPage, setJumpPage] = useState("");
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
    setDraft(next); setApplied(next); setPage(1); setPeople([]);
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
        if (active && sequence === request.current) {
          setResult(body); setPeople(Array.isArray(body.options.people) ? body.options.people : []);
        }
      } catch (cause) {
        if (active && sequence === request.current) setError(cause instanceof Error ? cause.message : "加载失败。");
      } finally { if (active && sequence === request.current) setLoading(false); }
    })();
    return () => { active = false; };
  }, [query, revision, refresh, filterStorageKey]);
  function apply() {
    const message = analysisFilterError(draft); setValidation(message);
    if (!message) { saveAnalysisState(filterStorageKey, date, draft); setApplied({ ...draft }); setRefresh(value => value + 1); }
  }
  function applyRange(range: Pick<AnalysisFilters, "from" | "to">) {
    const next = { ...draft, ...range };
    const message = analysisFilterError(next); setValidation(message);
    if (message) return;
    saveAnalysisState(filterStorageKey, date, next);
    setDraft(next); setApplied(next); setRefresh(count => count + 1);
  }
  function preset(value: "week" | "month" | "year") { applyRange(analysisPreset(value)); }
  function slide(days: -7 | 7) {
    const message = analysisFilterError(draft); setValidation(message);
    if (!message) applyRange(shiftAnalysisRange(draft, days, date));
  }
  function reset() {
    const next = emptyAnalysisFilters(date); saveAnalysisState(filterStorageKey, date, next);
    setDraft(next); setApplied(next); setValidation(""); setRefresh(value => value + 1);
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
  const pageCount = Math.max(1, Math.ceil((result?.reports.length ?? 0) / pageSize));
  const pageReports = result?.reports.slice((page - 1) * pageSize, page * pageSize) ?? [];
  const setField = (field: keyof AnalysisFilters, value: string | string[]) => setDraft(current => ({ ...current, [field]: value }));
  const summaryCards = result && <div className="dba-summary" aria-label="当前口径汇总">{[
        { label: "记录数", value: result.summary.count, note: "全部筛选记录，不限当前分页", Icon: FileText },
        { label: "数量（混合单位）", value: decimal(result.summary.quantity), note: "可能包含不同单位，仅供参考", Icon: Boxes },
        { label: "CNY 原币", value: `¥${money(result.summary.cnyAmount)}`, note: "仅人民币原币金额", Icon: CircleDollarSign },
        { label: "USD 原币", value: `$${money(result.summary.usdAmount)}`, note: "仅美元原币金额", Icon: Banknote },
        { label: "折合人民币", value: `¥${money(result.summary.amountCny)}`, note: "保存金额合计，不重算历史汇率", Icon: Sigma },
      ].map(({ label, value, note, Icon }) => <div key={label} className={label === "折合人民币" ? "dba-kpi dba-kpi-key" : "dba-kpi"}><span className="dba-kpi-label">{label}<Icon size={16} aria-hidden="true" /></span><strong>{value}</strong><small>{note}</small></div>)}</div>;
  const pagination = result && <div className="dr-pagination dba-pagination" aria-label="日报分页">
    <span>第 {page} / {pageCount} 页 · 共 {result.summary.count} 条；汇总包含全部筛选记录</span>
    <button type="button" className="iw-button iw-secondary iw-small" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft size={13} aria-hidden="true" />首页</button>
    <button type="button" className="iw-button iw-secondary iw-small" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={13} aria-hidden="true" />上一页</button>
    <button type="button" className="iw-button iw-secondary iw-small" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight size={13} aria-hidden="true" />下一页</button>
    <button type="button" className="iw-button iw-secondary iw-small" disabled={page >= pageCount} onClick={() => setPage(pageCount)}><ChevronsRight size={13} aria-hidden="true" />末页</button>
    <label>每页<select aria-label="每页条数" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}</select>条</label>
    <label>跳至<input aria-label="跳转页码" type="number" min={1} max={pageCount} step={1} value={jumpPage} onChange={event => setJumpPage(event.target.value)} /></label>
    <button type="button" className="iw-button iw-secondary iw-small" disabled={!/^\d+$/.test(jumpPage) || Number(jumpPage) < 1 || Number(jumpPage) > pageCount} onClick={() => { setPage(Number(jumpPage)); setJumpPage(""); }}><ChevronsRight size={13} aria-hidden="true" />跳转</button>
  </div>;
  return <section className={`iw-card dba ${view === "analysis" ? "dba-dashboard" : "dba-list"}`} aria-label={title}>
    <div className="iw-card-head"><div><h2>{title}</h2></div>
      <div className={view === "records" ? "dr-list-actions" : "dba-analysis-actions"}>{view === "records" && <>{canWrite && <button className="iw-button iw-approve iw-small" onClick={onNew}><Plus size={14} aria-hidden="true" />新增{noun}日报</button>}{canManage && <button className="iw-button iw-secondary iw-small" onClick={onImport}><Upload size={14} aria-hidden="true" />导入往期{noun}日报</button>}</>}
        <button type="button" className="iw-button iw-secondary iw-small" disabled={loading || !result || exporting} onClick={() => void exportCurrent()}><Download size={14} aria-hidden="true" />{exporting ? "导出中…" : "导出当前口径 Excel"}</button>
      </div>
    </div>
    <div className="dba-filters" role="search" aria-label={`${noun}统一筛选`} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "checkbox") { event.preventDefault(); apply(); } }}>
      <div className="dba-fields-row">
        <label className="dba-keyword">关键词<input value={draft.q} placeholder="客商、单号或备注" onChange={event => setField("q", event.target.value)} /></label>
        <label>开始日期<input type="date" value={draft.from} onChange={event => setField("from", event.target.value)} /></label>
        <label>结束日期<input type="date" value={draft.to} onChange={event => setField("to", event.target.value)} /></label>
        <label>{kind === "sales" ? "客户名称" : "供应商名称"}<input value={draft.partyName} placeholder="名称包含匹配" onChange={event => setField("partyName", event.target.value)} /></label>
        <MultiFilter label="录入人" options={people} values={draft.createdBy} onChange={values => setField("createdBy", values)} />
        <MultiFilter label="币种" options={[{ id: "CNY", label: "CNY" }, { id: "USD", label: "USD" }]} values={draft.currency} onChange={values => setField("currency", values)} />
      </div>
      <div className="dba-filter-actions" aria-label="日期快捷选择与筛选操作">
        <div className="dba-date-scroll" aria-label="日期范围滚动"><button className="iw-button iw-secondary iw-small" type="button" onClick={() => slide(-7)}><ChevronLeft size={14} aria-hidden="true" />前7天</button><button className="iw-button iw-secondary iw-small" type="button" onClick={() => slide(7)}>后7天<ChevronRight size={14} aria-hidden="true" /></button></div>
        <div className="dba-presets" aria-label="时间范围快捷选择">{([["week", "本周"], ["month", "本月"], ["year", "本年"]] as const).map(([value, label]) => <button key={value} className="iw-button iw-secondary iw-small" type="button" onClick={() => preset(value)}><CalendarDays size={14} aria-hidden="true" />{label}</button>)}</div>
        <div className="dba-apply-actions"><button className="iw-button iw-approve iw-small" type="button" onClick={apply}><Filter size={14} aria-hidden="true" />应用筛选</button><button className="iw-button iw-secondary iw-small" type="button" onClick={reset}><RotateCcw size={14} aria-hidden="true" />重置</button></div>
      </div>
    </div>
    {validation && <p role="alert" className="iw-alert iw-error">{validation}</p>}
    {error && <div role="alert" className="iw-alert iw-error">{error}<button type="button" className="iw-button iw-secondary iw-small" onClick={() => setRefresh(value => value + 1)}><RotateCcw size={14} aria-hidden="true" />重试</button></div>}
    {loading && <p role="status" className="iw-empty">正在加载当前筛选的日报与分析…</p>}
    {!loading && result && <>
      <p className="dba-basis dba-applied" data-testid="analysis-applied-filters">已应用：{result.filters.from || "不限"} 至 {result.filters.to || "不限"}{result.filters.q ? ` · 关键词“${result.filters.q}”` : ""}{result.filters.partyName ? ` · ${result.filters.partyName}` : ""} · {analysisSelections(result.filters.createdBy).map(value => people.find(person => person.id === value)?.label || value).join("、") || "全部录入人"} · {analysisSelections(result.filters.currency).join("、") || "全部币种"}</p>
      {summaryCards}
      {view === "records" ? <div role="region" aria-label={`${noun}日报明细表`} className="dba-records">{pagination}<div className="iw-table-wrap"><table><thead><tr><th>日期</th><th>单据编号</th><th>客户 / 供应商</th><th className="dba-number">数量</th><th>币种</th><th className="dba-number">原币金额</th><th className="dba-number">折合人民币</th><th>录入人</th><th>操作</th></tr></thead><tbody>{pageReports.map(row => <tr key={row.id}><td>{row.date}</td><td>{row.documentNo || "—"}</td><td>{row.partyName}</td><td className="dba-number">{decimal(row.quantity)}</td><td><span className={`dba-currency ${row.currency === "USD" ? "dba-currency-usd" : ""}`}>{row.currency}</span></td><td className="dba-number">{money(row.originalAmount)}</td><td className="dba-number dba-amount">¥{money(row.amountCny)}</td><td>{row.recordedByName || row.createdByName || "—"}</td><td><button type="button" className="iw-button iw-secondary iw-small" onClick={() => onDetail(row)}><Eye size={13} aria-hidden="true" />查看详情</button>{row.canEdit && canWrite && <button type="button" className="iw-button iw-secondary iw-small" onClick={() => onEdit(row)}><Pencil size={13} aria-hidden="true" />编辑</button>}</td></tr>)}</tbody></table>{!pageReports.length && <div className="iw-empty">当前筛选没有日报记录。</div>}</div>{pagination}</div>
        : <div role="region" aria-label={`${noun}统计分析结果`}><DailyAnalysisCharts kind={kind} dailyTrend={result.dailyTrend} monthlyTrend={result.monthlyTrend} counterpartRank={result.counterpartRank} /></div>}
    </>}
  </section>;
}
