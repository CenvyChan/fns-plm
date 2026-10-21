import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Database,
  Download,
  FileClock,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { apiFetch } from "./api";
import DetailDrawer from "./DetailDrawer";
import DailyBusinessAnalysis from "./DailyBusinessAnalysis";
import "./daily-reporting.css";

type Kind = "sales" | "purchase";
type Channel = "email" | "dingtalk";
type Link = {
  id: string;
  k3RowId: string;
  allocatedAmount: number;
  allocatedQuantity: number;
  k3Row?: K3Row;
};
type DailyReport = {
  id: string;
  type: Kind;
  date: string;
  partyName: string;
  partyId?: string;
  documentNo: string;
  quantity: number;
  currency: string;
  originalAmount: number;
  exchangeRate: number;
  amountCny: number;
  note: string;
  source?: string;
  importBatchId?: string;
  createdAt: string;
  createdByName: string;
  allocatedAmount: number;
  links: Link[];
  canEdit?: boolean;
};
type PartyOption = {
  id: string;
  kind: "customer" | "supplier";
  name: string;
  aliases: string[];
  active: boolean;
  k3Number: string;
};
type MonthlyRate = {
  month: string;
  rate: string;
  currency: string;
  targetCurrency: string;
};
type K3Row = {
  id: string;
  kind: string;
  type: Kind;
  billNo: string;
  date: string;
  partyName: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  currency: string;
  originalAmount: number;
  amountCny: number;
  settledAmountCny: number;
  taxAmountCny?: number;
  outstandingAmountCny?: number;
  status: string;
  upstreamId?: string;
  upstreamBillNo?: string;
  modifiedAt?: string;
  linkedDocuments?: Array<{
    id: string;
    kind: string;
    billNo: string;
    date: string;
    partyName: string;
    materialName: string;
    quantity: number;
    unit: string;
    unitPrice?: number;
    currency: string;
    amountCny: number;
    status: string;
  }>;
  allocatedAmount: number;
  remainingAmount: number;
  overAllocatedAmount: number;
  related?: Array<{
    reportId: string;
    reportDate: string | null;
    allocatedAmount: number;
  }>;
};
type Reconciliation = {
  dailyCoverage: {
    reportCount: number;
    totalAmount: number;
    coveredAmount: number;
    coverageRate: number | null;
  };
  monthDifference: {
    systemAmount: number;
    k3Amount: number;
    difference: number;
    differenceRate: number | null;
    isComplete: boolean;
  };
  yearDifference: {
    systemAmount: number;
    k3Amount: number;
    difference: number;
    differenceRate: number | null;
    isComplete: boolean;
  };
  k3Allocation: {
    rowCount: number;
    originalAmount: number;
    allocatedAmount: number;
    remainingAmount: number;
    overAllocatedAmount: number;
    crossDateCount: number;
  };
};
type Summary = {
  reportDate: string;
  source: string;
  isMock: boolean;
  liveErpConnected: boolean;
  mockSnapshotAt?: string | null;
  k3Sync?: {
    lastSyncedAt: string;
    rowCounts: Record<string, number>;
    changedRowCounts?: Record<string, number>;
    mode?: "full" | "incremental" | "mixed";
    incrementalFrom?: string | null;
  } | null;
  notice: string;
  access?: {
    sales: boolean;
    purchase: boolean;
    canManage: boolean;
    canWrite: boolean;
  };
  sales?: {
    daily: { count: number; quantity: number; amountCny: number };
    reconciliation: Reconciliation;
  };
  purchase?: {
    daily: { count: number; quantity: number; amountCny: number };
    reconciliation: Reconciliation;
  };
  orders: {
    sales: { count: number; amountCny: number; rows: K3Row[] };
    purchase: { count: number; amountCny: number; rows: K3Row[] };
  };
  fulfillment: {
    sales: { count: number; amountCny: number; rows: K3Row[] };
    purchase: { count: number; amountCny: number; rows: K3Row[] };
  };
  invoices: {
    sales: { count: number; amountCny: number; rows: K3Row[] };
    purchase: { count: number; amountCny: number; rows: K3Row[] };
  };
  balances: {
    receivables: {
      count: number;
      documentAmountCny: number;
      settledAmountCny: number;
      outstandingAmountCny: number;
      rows: K3Row[];
    };
    payables: {
      count: number;
      documentAmountCny: number;
      settledAmountCny: number;
      outstandingAmountCny: number;
      rows: K3Row[];
    };
  };
  warnings: Array<{
    type: string;
    billNo: string;
    overAllocatedAmount: number;
    crossDate: boolean;
  }>;
};
type Snapshot = {
  id: string;
  reportDate: string;
  scope: string;
  version: number;
  createdAt: string;
  source: string;
  isComplete: boolean;
  warnings: string[];
};
type Delivery = {
  id: string;
  channel: Channel;
  status: string;
  message: string;
  createdAt: string;
};
type Correction = {
  id: string;
  originalDate: string;
  type: string;
  affectedReport: Kind;
  referenceId: string;
  originalValue: number | null;
  newValue: number | null;
  diffAmount: number;
  reason: string;
  detectedAt: string;
  reportedInSnapshotId: string | null;
};
type DraftLink = {
  k3RowId: string;
  allocatedAmount: number;
  allocatedQuantity: number;
};
type FormState = {
  type: Kind;
  date: string;
  partyName: string;
  partyId: string;
  documentNo: string;
  quantity: string;
  currency: string;
  originalAmount: string;
  exchangeRate: string;
  note: string;
};

const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const initialDay = () => {
  const selected =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("date");
  if (selected && /^\d{4}-\d{2}-\d{2}$/.test(selected)) {
    const parsed = new Date(selected + "T12:00:00Z");
    if (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === selected
    )
      return selected;
  }
  const value = new Date();
  value.setDate(value.getDate() - 1);
  return day(value);
};
const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const currencyMoney = (value: number | null | undefined, currency: string) =>
  value == null
    ? "—"
    : `${currency} ${currency === "CNY" ? "¥" : ""}${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
const defaultForm = (date: string, type: Kind = "sales"): FormState => ({
  type,
  date,
  partyName: "",
  partyId: "",
  documentNo: "",
  quantity: "",
  currency: "CNY",
  originalAmount: "",
  exchangeRate: "1",
  note: "",
});

async function apiError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  return (
    body?.message || body?.error || `${fallback}（HTTP ${response.status}）`
  );
}
async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(await apiError(response, "加载失败"));
  return response.json() as Promise<T>;
}

type Props = { page: string; onNavigate: (page: string) => void };

export default function DailyReportingWorkbench({ page, onNavigate }: Props) {
  const [reportDate, setReportDate] = useState(initialDay);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") !== reportDate) {
      url.searchParams.set("date", reportDate);
      window.history.replaceState({}, "", url);
    }
  }, [reportDate]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<K3Row[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [mockEnabled, setMockEnabled] = useState(false);
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [masterDataConfigured, setMasterDataConfigured] = useState(false);
  const [monthlyRates, setMonthlyRates] = useState<MonthlyRate[]>([]);
  const [loadedPartyKind, setLoadedPartyKind] = useState<Kind | null>(null);
  const [exchangeRatesReady, setExchangeRatesReady] = useState(false);
  const [partyLoadError, setPartyLoadError] = useState("");
  const [rateLoadError, setRateLoadError] = useState("");
  const partyRequest = useRef(0);
  const [form, setForm] = useState<FormState>(() =>
    defaultForm(initialDay(), page.includes("purchase") ? "purchase" : "sales"),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [draftLinks, setDraftLinks] = useState<Record<string, DraftLink>>({});
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [channel, setChannel] = useState<Channel>("dingtalk");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadSequence = useRef(0);
  const [documentTab, setDocumentTab] = useState("orders");
  const [documentDirection, setDocumentDirection] = useState<"all" | Kind>(
    "all",
  );
  const [documentQuery, setDocumentQuery] = useState("");
  const [documentPage, setDocumentPage] = useState(1);
  const [detailReport, setDetailReport] = useState<DailyReport | null>(null);
  const [detailRow, setDetailRow] = useState<K3Row | null>(null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId),
    [reports, selectedReportId],
  );
  const reconciliation =
    selectedReport?.type === "purchase"
      ? summary?.purchase?.reconciliation
      : selectedReport?.type === "sales"
        ? summary?.sales?.reconciliation
        : summary?.access?.sales
          ? summary?.sales?.reconciliation
          : summary?.access?.purchase
            ? summary?.purchase?.reconciliation
            : undefined;
  const hasK3Snapshot = Boolean(
    summary?.mockSnapshotAt || summary?.k3Sync?.lastSyncedAt,
  );
  const canViewSales = summary?.access?.sales ?? false;
  const canViewPurchase = summary?.access?.purchase ?? false;
  const canManage = summary?.access?.canManage ?? false;
  const canWrite = summary?.access?.canWrite ?? false;
  const partyOptionsReady = loadedPartyKind === form.type;
  const currentMonthRate = monthlyRates.find(
    (item) => item.month === form.date.slice(0, 7),
  );

  const loadData = useCallback(
    async (forDate = reportDate) => {
      const sequence = ++loadSequence.current;
      setLoading(true);
      setError("");
      try {
        const [reportResult, summaryResult, snapshotResult] = await Promise.all(
          [
            getJson<{ reports: DailyReport[]; mockEnabled: boolean }>(
              `/api/daily-reports?from=${encodeURIComponent(forDate)}&to=${encodeURIComponent(forDate)}`,
            ),
            getJson<Summary>(
              `/api/daily-reports/summary?date=${encodeURIComponent(forDate)}`,
            ),
            getJson<{
              snapshots: Snapshot[];
              deliveries: Delivery[];
              corrections: Correction[];
            }>(`/api/daily-reports/snapshots`),
          ],
        );
        if (sequence !== loadSequence.current) return;
        setReports(reportResult.reports);
        setMockEnabled(reportResult.mockEnabled);
        setSummary(summaryResult);
        setSnapshots(snapshotResult.snapshots);
        setDeliveries(snapshotResult.deliveries);
        setCorrections(snapshotResult.corrections);
        setSelectedReportId((current) =>
          reportResult.reports.some((item) => item.id === current)
            ? current
            : (reportResult.reports[0]?.id ?? ""),
        );
        setSelectedSnapshotId((current) =>
          snapshotResult.snapshots.some((item) => item.id === current)
            ? current
            : (snapshotResult.snapshots[0]?.id ?? ""),
        );
      } catch (caught) {
        if (sequence === loadSequence.current)
          setError(
            caught instanceof Error ? caught.message : "日报数据加载失败",
          );
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [reportDate],
  );

  const loadK3Rows = useCallback(async (kind: Kind) => {
    try {
      const response = await getJson<{ rows: K3Row[] }>(
        `/api/daily-reports/k3-lines?type=${kind}`,
      );
      setRows(response.rows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "K3 快照行加载失败");
    }
  }, []);

  const loadPartyOptions = useCallback(async (kind: Kind) => {
    const partyKind = kind === "sales" ? "customer" : "supplier";
    const sequence = ++partyRequest.current;
    setPartyOptions([]);
    setLoadedPartyKind(null);
    setPartyLoadError("");
    try {
      const result = await getJson<{
        parties: PartyOption[];
        masterDataConfigured: boolean;
      }>(`/api/daily-reporting/party-options?kind=${partyKind}`);
      if (sequence !== partyRequest.current) return;
      setPartyOptions(result.parties);
      setMasterDataConfigured(result.masterDataConfigured);
      setLoadedPartyKind(kind);
    } catch (caught) {
      if (sequence !== partyRequest.current) return;
      setMasterDataConfigured(false);
      setPartyLoadError(
        caught instanceof Error ? caught.message : "客户/供应商选项加载失败",
      );
    }
  }, []);
  const loadExchangeRates = useCallback(async () => {
    setExchangeRatesReady(false);
    setRateLoadError("");
    try {
      const result = await getJson<{ rates: MonthlyRate[] }>(
        "/api/daily-reporting/exchange-rates",
      );
      setMonthlyRates(result.rates);
      setExchangeRatesReady(true);
    } catch (caught) {
      setMonthlyRates([]);
      setRateLoadError(
        caught instanceof Error ? caught.message : "月汇率加载失败",
      );
    }
  }, []);

  useEffect(() => {
    setDetailReport(null);
    setDetailRow(null);
    if (page.endsWith("-new")) {
      setEditingId(null);
      setForm(
        defaultForm(
          reportDate,
          page.includes("purchase") ? "purchase" : "sales",
        ),
      );
    }
  }, [page]);
  useEffect(() => {
    void loadData();
  }, [loadData]);
  useEffect(() => {
    void loadPartyOptions(form.type);
  }, [form.type, loadPartyOptions]);
  useEffect(() => {
    if (page === "daily-sales-new" || page === "daily-sales-edit")
      setForm((current) =>
        current.type === "sales"
          ? current
          : { ...current, type: "sales", partyId: "", partyName: "" },
      );
    else if (page === "daily-purchase-new" || page === "daily-purchase-edit")
      setForm((current) =>
        current.type === "purchase"
          ? current
          : { ...current, type: "purchase", partyId: "", partyName: "" },
      );
  }, [page]);
  useEffect(() => {
    void loadExchangeRates();
  }, [loadExchangeRates]);
  useEffect(() => {
    if (!summary?.access) return;
    const nextType: Kind | undefined =
      !summary.access.sales && summary.access.purchase
        ? "purchase"
        : summary.access.sales && !summary.access.purchase
          ? "sales"
          : undefined;
    if (nextType)
      setForm((current) =>
        current.type === nextType
          ? current
          : { ...current, type: nextType, partyId: "", partyName: "" },
      );
  }, [summary?.access?.sales, summary?.access?.purchase]);
  useEffect(() => {
    if (editingId || form.currency !== "USD") return;
    const rate = monthlyRates.find(
      (item) => item.month === form.date.slice(0, 7),
    );
    if (rate)
      setForm((current) =>
        current.currency === "USD" && current.date.slice(0, 7) === rate.month
          ? { ...current, exchangeRate: rate.rate }
          : current,
      );
  }, [editingId, form.currency, form.date, monthlyRates]);
  useEffect(() => {
    const type = selectedReport?.type ?? form.type;
    void loadK3Rows(type);
    if (selectedReport) {
      const next: Record<string, DraftLink> = {};
      for (const link of selectedReport.links ?? [])
        next[link.k3RowId] = {
          k3RowId: link.k3RowId,
          allocatedAmount: link.allocatedAmount,
          allocatedQuantity: link.allocatedQuantity,
        };
      setDraftLinks(next);
    } else setDraftLinks({});
  }, [
    selectedReportId,
    selectedReport?.type,
    selectedReport?.links,
    form.type,
    loadK3Rows,
  ]);

  const changeForm = (key: keyof FormState, value: string) =>
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "currency" && value === "CNY" ? { exchangeRate: "1" } : {}),
      ...(key === "type" ? { partyId: "", partyName: "" } : {}),
    }));
  const selectParty = (id: string) => {
    const party = partyOptions.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      partyId: id,
      partyName: party?.name ?? "",
    }));
  };
  const saveReport = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canWrite || !partyOptionsReady || !exchangeRatesReady) return;
    if (
      form.type !== kind ||
      (form.type === "sales" ? !canViewSales : !canViewPurchase)
    ) {
      setError("当前页面业务类型与权限不匹配，不能保存。");
      return;
    }
    if (page.endsWith("-edit") && !editingId) {
      setError("未选择可编辑记录，请返回列表选择记录。");
      onNavigate(kind === "sales" ? "daily-sales" : "daily-purchase");
      return;
    }
    if (
      !editingId &&
      form.currency === "USD" &&
      masterDataConfigured &&
      !currentMonthRate
    ) {
      setError(
        `尚未维护 ${form.date.slice(0, 7)} USD→CNY 月汇率，请联系日报管理员。`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      ...form,
      partyId: form.partyId || undefined,
      quantity: Number(form.quantity || 0),
      originalAmount: Number(form.originalAmount),
      exchangeRate: Number(form.exchangeRate || 1),
      source: "manual",
    };
    try {
      const response = await apiFetch(
        editingId
          ? `/api/daily-reports/${encodeURIComponent(editingId)}`
          : "/api/daily-reports",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok)
        throw new Error(await apiError(response, "日报保存失败"));
      const saved = (await response.json()) as DailyReport;
      setReportDate(saved.date);
      setEditingId(null);
      setForm(defaultForm(saved.date, saved.type));
      setNotice(
        editingId
          ? "日报已更新；如旧日期已归档，更正将保留在后续快照中。"
          : "日报已保存。",
      );
      if (saved.date === reportDate) await loadData(saved.date);
      onNavigate(saved.type === "sales" ? "daily-sales" : "daily-purchase");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "日报保存失败");
    } finally {
      setBusy(false);
    }
  };
  const editReport = (report: DailyReport) => {
    setSelectedReportId(report.id);
    setEditingId(report.id);
    setReportDate(report.date);
    setForm({
      type: report.type,
      date: report.date,
      partyName: report.partyName,
      partyId: report.partyId ?? "",
      documentNo: report.documentNo,
      quantity: String(report.quantity),
      currency: report.currency,
      originalAmount: String(report.originalAmount),
      exchangeRate: String(report.exchangeRate),
      note: report.note,
    });
    setNotice(
      `正在编辑 ${report.documentNo || (report.type === "sales" ? "销售日报" : "采购日报")}`,
    );
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(defaultForm(reportDate));
    setNotice("已取消编辑。");
    onNavigate(form.type === "sales" ? "daily-sales" : "daily-purchase");
  };

  const saveLinks = async () => {
    if (!selectedReport || busy || !canWrite || !selectedReport.canEdit) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/daily-reports/${encodeURIComponent(selectedReport.id)}/links`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ links: Object.values(draftLinks) }),
        },
      );
      if (!response.ok)
        throw new Error(await apiError(response, "关联保存失败"));
      const result = (await response.json()) as {
        links: Link[];
        warnings: string[];
      };
      setNotice(
        result.warnings.length
          ? `分摊已保存。${result.warnings.join(" ")}`
          : "关联与金额分摊已保存。",
      );
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "关联保存失败");
    } finally {
      setBusy(false);
    }
  };
  const toggleLink = (row: K3Row, checked: boolean) =>
    setDraftLinks((current) => {
      const next = { ...current };
      if (!checked) delete next[row.id];
      else
        next[row.id] = {
          k3RowId: row.id,
          allocatedAmount: row.amountCny,
          allocatedQuantity: row.quantity,
        };
      return next;
    });
  const setLinkValue = (
    rowId: string,
    key: "allocatedAmount" | "allocatedQuantity",
    value: string,
  ) =>
    setDraftLinks((current) => ({
      ...current,
      [rowId]: {
        ...(current[rowId] ?? {
          k3RowId: rowId,
          allocatedAmount: 0,
          allocatedQuantity: 0,
        }),
        [key]: Number(value || 0),
      },
    }));

  const refreshMock = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/daily-reports/mock-refresh", {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(await apiError(response, "刷新本地演示数据失败"));
      const result = (await response.json()) as { message?: string };
      setNotice(result.message || "本地隔离快照已刷新；没有连接真实 K3Cloud。");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "演示快照刷新失败");
    } finally {
      setBusy(false);
    }
  };
  const syncK3 = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/daily-reports/k3-sync", {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(await apiError(response, "K3Cloud 同步失败"));
      const result = (await response.json()) as {
        totalRows: number;
        refreshedAt: string;
        mode?: string;
        incrementalFrom?: string | null;
      };
      const modeLabel =
        result.mode === "incremental"
          ? "增量"
          : result.mode === "mixed"
            ? "增量 + 全量回扫"
            : "首轮/全量";
      setNotice(
        `K3Cloud 只读数据同步完成：本次新增/更新 ${result.totalRows} 行（${modeLabel}）${result.incrementalFrom ? `，回看起点 ${dateTime(result.incrementalFrom)}` : ""}；${dateTime(result.refreshedAt)}。`,
      );
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "K3Cloud 同步失败");
    } finally {
      setBusy(false);
    }
  };
  const createSnapshot = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const access = summary?.access;
      const scope =
        access?.sales && access.purchase
          ? "both"
          : access?.sales
            ? "sales"
            : access?.purchase
              ? "purchase"
              : "both";
      const response = await apiFetch("/api/daily-reports/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate, scope }),
      });
      if (!response.ok)
        throw new Error(await apiError(response, "生成快照失败"));
      const result = (await response.json()) as Snapshot;
      setSelectedSnapshotId(result.id);
      setNotice(
        `不可变快照 v${result.version} 已归档。${result.warnings.length ? ` 警告 ${result.warnings.length} 项。` : ""}`,
      );
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "快照生成失败");
    } finally {
      setBusy(false);
    }
  };
  const exportSnapshot = async (format: "html" | "xlsx") => {
    if (!selectedSnapshotId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/daily-reports/snapshots/${encodeURIComponent(selectedSnapshotId)}/export.${format}`,
      );
      if (!response.ok) throw new Error(await apiError(response, "导出失败"));
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `daily-report-${reportDate}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`${format.toUpperCase()} 文件已生成。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件导出失败");
    } finally {
      setBusy(false);
    }
  };
  const simulateDelivery = async () => {
    if (!selectedSnapshotId || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/daily-reports/snapshots/${encodeURIComponent(selectedSnapshotId)}/deliveries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel }),
        },
      );
      if (!response.ok)
        throw new Error(await apiError(response, "模拟推送失败"));
      const result = (await response.json()) as Delivery;
      setNotice(result.message);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模拟推送失败");
    } finally {
      setBusy(false);
    }
  };

  const coverageLabel = (value: number | null | undefined) =>
    value == null ? "待判定" : `${value.toFixed(1)}%`;
  const reconciliationCard = (
    dimension: 1 | 2 | 3,
    label: string,
    value?: Reconciliation,
  ) =>
    value ? (
      <div className="dr-recon-card" key={label}>
        <b>{label}</b>
        {dimension === 1 ? (
          <>
            <span>
              日报总金额{" "}
              <strong>{money(value.dailyCoverage.totalAmount)}</strong>
            </span>
            <span>
              封顶后已覆盖{" "}
              <strong>{money(value.dailyCoverage.coveredAmount)}</strong>
            </span>
            <span>
              关联覆盖率{" "}
              <strong>{coverageLabel(value.dailyCoverage.coverageRate)}</strong>
            </span>
            <small>按绝对金额计算；单条日报覆盖额不超过日报金额。</small>
          </>
        ) : dimension === 2 ? (
          <>
            <span>
              月累计差额{" "}
              <strong>
                {value.monthDifference.isComplete
                  ? money(value.monthDifference.difference)
                  : "待判定"}
              </strong>
            </span>
            <span>
              月系统 / K3{" "}
              <strong>
                {value.monthDifference.isComplete
                  ? `${money(value.monthDifference.systemAmount)} / ${money(value.monthDifference.k3Amount)}`
                  : "数据不完整"}
              </strong>
            </span>
            <span>
              年累计差额{" "}
              <strong>
                {value.yearDifference.isComplete
                  ? money(value.yearDifference.difference)
                  : "待判定"}
              </strong>
            </span>
            <small>
              差额 = 手工日报系统金额 − 同期间 K3Cloud 金额；缺数据不按零判定。
            </small>
          </>
        ) : (
          <>
            <span>
              K3 原金额{" "}
              <strong>{money(value.k3Allocation.originalAmount)}</strong>
            </span>
            <span>
              累计分摊 / 剩余{" "}
              <strong>
                {money(value.k3Allocation.allocatedAmount)} /{" "}
                {money(value.k3Allocation.remainingAmount)}
              </strong>
            </span>
            <span>
              超额分摊{" "}
              <strong
                className={
                  value.k3Allocation.overAllocatedAmount
                    ? "dr-warning-text"
                    : ""
                }
              >
                {money(value.k3Allocation.overAllocatedAmount)}
              </strong>
            </span>
            <small>
              {value.k3Allocation.rowCount} 行 · 跨日{" "}
              {value.k3Allocation.crossDateCount} 行；超额/跨日均显式警告。
            </small>
          </>
        )}
      </div>
    ) : null;
  const reportType = (kind: Kind) => (kind === "sales" ? "销售" : "采购");
  const documentKindLabel = (kind: string) =>
    (
      ({
        "sales-order": "销售订单",
        "purchase-order": "采购订单",
        shipment: "销售出库",
        "purchase-receipt": "采购入库",
        "sales-invoice": "销项发票",
        "purchase-invoice": "采购收票",
        receivable: "应收单",
        payable: "应付单",
      }) as Record<string, string>
    )[kind] ?? kind;
  const businessDocumentTable = (
    title: string,
    items: K3Row[],
    balance = false,
  ) => (
    <div className="dr-business-doc-group" key={title}>
      <h3>
        {title} · {items.length} 笔
      </h3>
      <div className="iw-table-wrap">
        <table>
          <caption>
            {title} · ERP 来源 {summary?.source ?? "未知"} ·{" "}
            {summary?.isMock ? "本地模拟快照" : "只读 ERP 快照"}
          </caption>
          <thead>
            <tr>
              <th>单号 / 日期</th>
              <th>客户 / 供应商</th>
              <th>数量</th>
              <th>单价</th>
              <th>原币 / CNY 金额</th>
              {balance && (
                <>
                  <th>已收 / 付</th>
                  <th>未收 / 付</th>
                </>
              )}
              <th>上下游关联</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{item.billNo}</b>
                  <small>{item.date}</small>
                </td>
                <td>
                  {item.partyName}
                  <small>{item.materialName}</small>
                </td>
                <td>
                  {item.quantity != null
                    ? `${item.quantity} ${item.unit ?? ""}`
                    : "—"}
                </td>
                <td>
                  {item.unitPrice != null
                    ? currencyMoney(item.unitPrice, item.currency)
                    : "—"}
                </td>
                <td>
                  {currencyMoney(item.originalAmount, item.currency)}
                  <small>
                    CNY {money(item.amountCny)}
                    {item.taxAmountCny != null
                      ? ` · 税额 ${money(item.taxAmountCny)}`
                      : ""}
                  </small>
                </td>
                {balance && (
                  <>
                    <td>{money(item.settledAmountCny)}</td>
                    <td>{money(item.outstandingAmountCny)}</td>
                  </>
                )}
                <td>
                  {item.upstreamBillNo ? (
                    <span>来源 {item.upstreamBillNo}</span>
                  ) : (
                    "—"
                  )}
                  {item.linkedDocuments?.map((link) => (
                    <small key={link.id}>
                      {documentKindLabel(link.kind)}：{link.billNo}
                    </small>
                  ))}
                </td>
                <td>{item.status}</td>
                <td>
                  <button
                    type="button"
                    className="iw-button iw-secondary iw-small"
                    onClick={() => setDetailRow(item)}
                  >
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <div className="iw-empty">当前报表日期/范围没有明细。</div>
        )}
      </div>
    </div>
  );

  const isForm =
    page === "daily-sales-new" ||
    page === "daily-purchase-new" ||
    page === "daily-sales-edit" ||
    page === "daily-purchase-edit";
  const kind: Kind = page.includes("purchase") ? "purchase" : "sales";
  const formMissingEdit = page.endsWith("-edit") && !editingId;
  const pageTitle =
    (
      {
        "daily-sales": "销售日报",
        "daily-purchase": "采购日报",
        "daily-reconciliation": "关联分摊与三维对账",
        "daily-documents": "ERP订单、出入库、发票与往来",
        "daily-archives": "日报归档、导出与更正",
      } as Record<string, string>
    )[page] ||
    `${reportType(kind)}日报${page.endsWith("-edit") ? "编辑" : "新增"}`;
  const goEdit = (r: DailyReport) => {
    editReport(r);
    onNavigate(r.type === "sales" ? "daily-sales-edit" : "daily-purchase-edit");
  };
  const sourceBanner = summary && (
    <div className={`dr-source-banner ${summary.isMock ? "dr-mock" : ""}`}>
      <ShieldCheck size={17} />
      <div>
        <b>
          {summary.isMock
            ? "本地隔离演示数据（非真实 ERP）"
            : summary.liveErpConnected
              ? "K3Cloud 只读快照"
              : "数据来源与完整性"}
        </b>
        <span>
          {summary.notice}
          {summary.k3Sync?.lastSyncedAt
            ? ` 最近同步：${dateTime(summary.k3Sync.lastSyncedAt)}。`
            : ""}
        </span>
      </div>
    </div>
  );
  return (
    <section className="dr-section" aria-label={pageTitle}>
      <header className="dr-header">
        <div>
          <div className="iw-eyebrow">日报管理 / DAILY REPORTING</div>
          <h2>{pageTitle}</h2>
          <p>按日期记录销售与采购日报，关联 ERP 快照并进行可追溯对账。</p>
        </div>
        <div className="dr-header-actions">
          {!isForm && (
            <label className="dr-header-date">
              报表日期
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
            </label>
          )}
          <button
            className="iw-button iw-secondary iw-small"
            onClick={() => {
              void loadData();
              void loadPartyOptions(form.type);
              void loadExchangeRates();
            }}
            disabled={loading || busy}
          >
            <RefreshCw size={14} />
            刷新
          </button>
          {canManage && (
            <button
              className="iw-button iw-approve iw-small"
              onClick={() => void syncK3()}
              disabled={busy}
            >
              <Database size={14} />
              {busy ? "同步中…" : "同步真实 K3Cloud"}
            </button>
          )}
          {canManage && mockEnabled && (
            <button
              className="iw-button iw-secondary iw-small"
              onClick={() => void refreshMock()}
              disabled={busy}
            >
              刷新本地演示快照
            </button>
          )}
        </div>
      </header>
      {sourceBanner}
      {error && (
        <div className="iw-alert iw-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="iw-alert iw-success" role="status">
          {notice}
        </div>
      )}
      {loading && (
        <div className="iw-card dr-loading">正在加载日报及权限信息…</div>
      )}
      {!loading && !summary && (
        <div className="iw-card dr-loading">
          日报数据未能加载，请检查错误信息后重试。
        </div>
      )}
      {!loading && summary && !summary.access && (
        <div className="iw-card dr-loading">
          无法确认当前用户权限，已按默认拒绝处理。
        </div>
      )}
      {!loading && summary?.access && (
        <>
          {(page === "daily-sales" || page === "daily-purchase") &&
            ((kind === "sales" ? canViewSales : canViewPurchase) ? (
              <DailyBusinessAnalysis
                key={kind}
                kind={kind}
                date={reportDate}
                canWrite={canWrite}
                canManage={canManage}
                revision={reports}
                onNew={() => {
                  setEditingId(null);
                  setForm(defaultForm(reportDate, kind));
                  onNavigate(kind === "sales" ? "daily-sales-new" : "daily-purchase-new");
                }}
                onImport={() => onNavigate(kind === "sales" ? "daily-sales-import" : "daily-purchase-import")}
                onDetail={setDetailReport}
                onEdit={goEdit}
              />
            ) : (
              <div className="iw-card" role="alert">
                无权查看该业务日报列表。
              </div>
            ))}
          {isForm &&
            (formMissingEdit ? (
              <section className="iw-card">
                <p>未选择编辑记录，请返回日报列表选择一条记录。</p>
                <button
                  className="iw-button iw-secondary"
                  onClick={() =>
                    onNavigate(
                      kind === "sales" ? "daily-sales" : "daily-purchase",
                    )
                  }
                >
                  返回列表
                </button>
              </section>
            ) : (
              <section className="iw-card">
                <div className="iw-card-head">
                  <button
                    className="iw-button iw-secondary iw-small"
                    onClick={() =>
                      onNavigate(
                        kind === "sales" ? "daily-sales" : "daily-purchase",
                      )
                    }
                  >
                    ‹ 返回列表
                  </button>
                  <div>
                    <h2>
                      {editingId ? "编辑日报" : `新增${reportType(kind)}日报`}
                    </h2>
                    <p>保存成功后返回对应列表；修改历史日期会保留更正记录。</p>
                  </div>
                </div>
                {canWrite ? (
                  <form className="dr-form" onSubmit={saveReport}>
                    {(!partyOptionsReady || !exchangeRatesReady) && (
                      <div className="dr-wide iw-alert" role="status">
                        {partyLoadError ||
                          rateLoadError ||
                          "正在加载客商与汇率配置…"}
                        {(partyLoadError || rateLoadError) && (
                          <button
                            type="button"
                            className="iw-button iw-secondary iw-small"
                            onClick={() => {
                              void loadPartyOptions(form.type);
                              void loadExchangeRates();
                            }}
                          >
                            重新加载配置
                          </button>
                        )}
                      </div>
                    )}
                    <label>
                      类型
                      <input value={reportType(kind)} disabled />
                    </label>
                    <label>
                      业务日期
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => changeForm("date", e.target.value)}
                        required
                      />
                    </label>
                    {masterDataConfigured ? (
                      <label className="dr-wide">
                        客户 / 供应商
                        <select
                          value={form.partyId}
                          onChange={(e) => selectParty(e.target.value)}
                          required
                        >
                          <option value="">选择已分配客商</option>
                          {partyOptions.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        {!partyOptions.length && (
                          <small>当前账套无可用客商分配。</small>
                        )}
                      </label>
                    ) : (
                      <label className="dr-wide">
                        客户 / 供应商
                        <input
                          value={form.partyName}
                          onChange={(e) =>
                            changeForm("partyName", e.target.value)
                          }
                          required
                        />
                      </label>
                    )}
                    <label>
                      单据编号
                      <input
                        value={form.documentNo}
                        onChange={(e) =>
                          changeForm("documentNo", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      数量
                      <input
                        type="number"
                        step="0.001"
                        value={form.quantity}
                        onChange={(e) => changeForm("quantity", e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      币种
                      <select
                        value={form.currency}
                        onChange={(e) => changeForm("currency", e.target.value)}
                      >
                        {["CNY", "USD", "JPY", "EUR"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      原币金额
                      <input
                        type="number"
                        step="0.01"
                        value={form.originalAmount}
                        onChange={(e) =>
                          changeForm("originalAmount", e.target.value)
                        }
                        required
                      />
                    </label>
                    <label>
                      汇率
                      <input
                        type="number"
                        step="0.000001"
                        value={form.exchangeRate}
                        onChange={(e) =>
                          changeForm("exchangeRate", e.target.value)
                        }
                        required
                      />
                    </label>
                    <label className="dr-wide">
                      备注
                      <textarea
                        value={form.note}
                        onChange={(e) => changeForm("note", e.target.value)}
                      />
                    </label>
                    <div className="dr-form-actions">
                      <button
                        type="button"
                        className="iw-button iw-secondary"
                        onClick={cancelEdit}
                        disabled={busy}
                      >
                        取消返回列表
                      </button>
                      <button
                        className="iw-button iw-approve"
                        disabled={
                          busy || !partyOptionsReady || !exchangeRatesReady
                        }
                      >
                        {busy ? "保存中…" : "保存日报"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p>当前用户没有日报写入权限。</p>
                )}
              </section>
            ))}
          {page === "daily-reconciliation" && (
            <>
              <section className="iw-card">
                <h2>关联日报与 K3Cloud 单据</h2>
                <div className="dr-history-list">
                  {reports
                    .filter((r) =>
                      r.type === "sales" ? canViewSales : canViewPurchase,
                    )
                    .map((r) => (
                      <article
                        key={r.id}
                        className={
                          selectedReportId === r.id ? "is-selected" : ""
                        }
                      >
                        <button
                          className="dr-history-select"
                          onClick={() => setSelectedReportId(r.id)}
                        >
                          <b>
                            {r.date} · {r.partyName} · {r.documentNo}
                          </b>
                          <span>
                            {reportType(r.type)} · {money(r.amountCny)}
                          </span>
                        </button>
                      </article>
                    ))}
                </div>
                {!reports.length && (
                  <div className="iw-empty">
                    所选日期暂无日报记录；仍可查看已授权业务的汇总对账信息。
                  </div>
                )}
              </section>
              <section className="iw-card dr-link-card">
                <h3>
                  {selectedReport
                    ? `当前日报：${selectedReport.date} · ${selectedReport.partyName}`
                    : "业务权限汇总"}
                </h3>
                <div className="dr-recon-grid">
                  {canViewSales &&
                    reconciliationCard(
                      1,
                      "销售日报覆盖",
                      summary.sales?.reconciliation,
                    )}
                  {canViewPurchase &&
                    reconciliationCard(
                      1,
                      "采购日报覆盖",
                      summary.purchase?.reconciliation,
                    )}
                  {canViewSales &&
                    reconciliationCard(
                      2,
                      "销售月/年差额",
                      summary.sales?.reconciliation,
                    )}
                  {canViewPurchase &&
                    reconciliationCard(
                      2,
                      "采购月/年差额",
                      summary.purchase?.reconciliation,
                    )}
                  {canViewSales &&
                    reconciliationCard(
                      3,
                      "销售 K3 分摊",
                      summary.sales?.reconciliation,
                    )}
                  {canViewPurchase &&
                    reconciliationCard(
                      3,
                      "采购 K3 分摊",
                      summary.purchase?.reconciliation,
                    )}
                </div>
                {selectedReport ? (
                  <>
                    <p className="dr-doc-summary">
                      输入分摊金额与数量；剩余、超额及跨日报关联会在保存前明确提示并由服务端校验。
                    </p>
                    <div className="iw-table-wrap dr-k3-table">
                      <table>
                        <thead>
                          <tr>
                            <th>关联</th>
                            <th>ERP单据</th>
                            <th>客户/供应商</th>
                            <th>金额</th>
                            <th>分摊额</th>
                            <th>分摊数量</th>
                            <th>剩余 / 超额</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={!!draftLinks[row.id]}
                                  disabled={
                                    !canWrite || !selectedReport.canEdit || busy
                                  }
                                  onChange={(e) =>
                                    toggleLink(row, e.target.checked)
                                  }
                                />
                              </td>
                              <td>
                                {row.billNo} · {row.date}
                              </td>
                              <td>{row.partyName}</td>
                              <td>{money(row.amountCny)}</td>
                              <td>
                                <input
                                  className="dr-number"
                                  type="number"
                                  disabled={
                                    !canWrite ||
                                    !selectedReport.canEdit ||
                                    busy ||
                                    !draftLinks[row.id]
                                  }
                                  value={
                                    draftLinks[row.id]?.allocatedAmount ?? 0
                                  }
                                  onChange={(e) =>
                                    setLinkValue(
                                      row.id,
                                      "allocatedAmount",
                                      e.target.value,
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="dr-number"
                                  type="number"
                                  step="0.001"
                                  disabled={
                                    !canWrite ||
                                    !selectedReport.canEdit ||
                                    busy ||
                                    !draftLinks[row.id]
                                  }
                                  value={
                                    draftLinks[row.id]?.allocatedQuantity ?? 0
                                  }
                                  onChange={(e) =>
                                    setLinkValue(
                                      row.id,
                                      "allocatedQuantity",
                                      e.target.value,
                                    )
                                  }
                                />
                              </td>
                              <td>
                                {money(row.remainingAmount)} 剩余
                                {row.overAllocatedAmount > 0 && (
                                  <strong className="dr-warning-text">
                                    {" "}
                                    · 超额 {money(row.overAllocatedAmount)}
                                  </strong>
                                )}
                                {row.related?.some(
                                  (x) => x.reportDate !== selectedReport.date,
                                ) && (
                                  <strong className="dr-warning-text">
                                    {" "}
                                    · 跨日报
                                  </strong>
                                )}
                              </td>
                              <td>{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      className="iw-button iw-approve"
                      disabled={!canWrite || busy || !selectedReport.canEdit}
                      onClick={() => void saveLinks()}
                    >
                      保存关联与分摊
                    </button>
                  </>
                ) : (
                  <div className="iw-empty">
                    请从上方选择一条日报以编辑分摊。
                  </div>
                )}
              </section>
            </>
          )}
          {page === "daily-documents" && summary && (
            <section className="iw-card dr-business-documents">
              <nav
                className="dr-document-tabs"
                role="tablist"
                aria-label="ERP 单据分类"
              >
                {[
                  ["orders", "订单"],
                  ["fulfillment", "出入库"],
                  ["invoices", "发票"],
                  ["balances", "应收应付"],
                ].map(([key, label]) => (
                  <button
                    role="tab"
                    aria-selected={documentTab === key}
                    aria-controls="daily-documents-panel"
                    id={`daily-documents-tab-${key}`}
                    key={key}
                    className={documentTab === key ? "active" : ""}
                    onClick={() => {
                      setDocumentTab(key);
                      setDocumentPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div
                role="tabpanel"
                id="daily-documents-panel"
                aria-labelledby={`daily-documents-tab-${documentTab}`}
              >
                <div className="dr-list-filters">
                  <label>
                    方向
                    <select
                      value={documentDirection}
                      onChange={(e) => {
                        setDocumentDirection(e.target.value as "all" | Kind);
                        setDocumentPage(1);
                      }}
                    >
                      <option value="all">全部</option>
                      {canViewSales && <option value="sales">销售</option>}
                      {canViewPurchase && (
                        <option value="purchase">采购</option>
                      )}
                    </select>
                  </label>
                  <label>
                    关键词
                    <input
                      value={documentQuery}
                      onChange={(e) => {
                        setDocumentQuery(e.target.value);
                        setDocumentPage(1);
                      }}
                      placeholder="单号、客商、物料"
                    />
                  </label>
                </div>
                {(() => {
                  const groups =
                    documentTab === "orders"
                      ? [
                          ["销售订单", summary.orders.sales.rows, "sales"],
                          [
                            "采购订单",
                            summary.orders.purchase.rows,
                            "purchase",
                          ],
                        ]
                      : documentTab === "fulfillment"
                        ? [
                            [
                              "销售出库",
                              summary.fulfillment.sales.rows,
                              "sales",
                            ],
                            [
                              "采购入库",
                              summary.fulfillment.purchase.rows,
                              "purchase",
                            ],
                          ]
                        : documentTab === "invoices"
                          ? [
                              [
                                "销项发票",
                                summary.invoices.sales.rows,
                                "sales",
                              ],
                              [
                                "采购收票",
                                summary.invoices.purchase.rows,
                                "purchase",
                              ],
                            ]
                          : [
                              [
                                "应收单",
                                summary.balances.receivables.rows,
                                "sales",
                              ],
                              [
                                "应付单",
                                summary.balances.payables.rows,
                                "purchase",
                              ],
                            ];
                  const all = groups
                    .filter((g) =>
                      g[2] === "sales" ? canViewSales : canViewPurchase,
                    )
                    .filter(
                      (g) =>
                        documentDirection === "all" ||
                        g[2] === documentDirection,
                    )
                    .flatMap((g) => g[1] as K3Row[]);
                  const filtered = all.filter(
                    (r) =>
                      !documentQuery ||
                      `${r.billNo} ${r.partyName} ${r.materialName} ${r.status} ${r.upstreamBillNo || ""}`
                        .toLowerCase()
                        .includes(documentQuery.toLowerCase()),
                  );
                  const rowsPage = filtered.slice(
                    (documentPage - 1) * 20,
                    documentPage * 20,
                  );
                  return (
                    <>
                      <p className="dr-doc-summary">
                        {filtered.length} 笔 · CNY{" "}
                        {money(filtered.reduce((a, r) => a + r.amountCny, 0))} ·
                        来源 {summary.source} · {summary.notice} ·
                        原币金额合计按币种分别统计
                      </p>
                      {businessDocumentTable(
                        groups
                          .filter((g) =>
                            g[2] === "sales" ? canViewSales : canViewPurchase,
                          )
                          .filter(
                            (g) =>
                              documentDirection === "all" ||
                              g[2] === documentDirection,
                          )
                          .map((g) => g[0])
                          .join(" / "),
                        rowsPage,
                        documentTab === "balances",
                      )}
                      <div className="dr-pagination">
                        第 {documentPage} /{" "}
                        {Math.max(1, Math.ceil(filtered.length / 20))} 页
                        <button
                          className="iw-button iw-secondary iw-small"
                          disabled={documentPage <= 1}
                          onClick={() => setDocumentPage(documentPage - 1)}
                        >
                          上一页
                        </button>
                        <button
                          className="iw-button iw-secondary iw-small"
                          disabled={documentPage * 20 >= filtered.length}
                          onClick={() => setDocumentPage(documentPage + 1)}
                        >
                          下一页
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </section>
          )}
          {page === "daily-archives" && (
            <>
              <section className="iw-card">
                <div className="dr-snapshot-toolbar">
                  <button
                    className="iw-button iw-approve"
                    disabled={!canWrite || busy}
                    onClick={() => void createSnapshot()}
                  >
                    生成不可变快照
                  </button>
                  <select
                    value={selectedSnapshotId}
                    onChange={(e) => setSelectedSnapshotId(e.target.value)}
                  >
                    {snapshots.map((x) => (
                      <option value={x.id} key={x.id}>
                        {x.reportDate} · v{x.version} · {x.source}
                      </option>
                    ))}
                  </select>
                  <button
                    className="iw-button iw-secondary"
                    disabled={!selectedSnapshotId || busy}
                    onClick={() => void exportSnapshot("html")}
                  >
                    导出 HTML
                  </button>
                  <button
                    className="iw-button iw-secondary"
                    disabled={!selectedSnapshotId || busy}
                    onClick={() => void exportSnapshot("xlsx")}
                  >
                    导出 XLSX
                  </button>
                </div>
                <div className="dr-simulate-row">
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as Channel)}
                  >
                    <option value="dingtalk">钉钉模拟</option>
                    <option value="email">邮件模拟</option>
                  </select>
                  <button
                    className="iw-button iw-secondary"
                    disabled={!canWrite || !selectedSnapshotId || busy}
                    onClick={() => void simulateDelivery()}
                  >
                    模拟投递
                  </button>
                </div>
                <p>
                  归档范围包含所选业务权限、ERP
                  来源完整性与快照警告；投递仅为本地模拟，不会真实发送。
                </p>
                <div className="dr-snapshot-list">
                  {deliveries.slice(0, 5).map((d) => (
                    <div key={d.id}>
                      <span>
                        {d.channel === "email" ? "邮件" : "钉钉"} · {d.status}
                      </span>
                      <small>
                        {dateTime(d.createdAt)} · {d.message}
                      </small>
                    </div>
                  ))}
                  {snapshots.map((x) => (
                    <button
                      type="button"
                      className={
                        selectedSnapshotId === x.id ? "is-selected" : ""
                      }
                      onClick={() => setSelectedSnapshotId(x.id)}
                      key={x.id}
                    >
                      <span>
                        {x.reportDate} · v{x.version}
                      </span>
                      <small>
                        {dateTime(x.createdAt)} · {x.source} · {x.scope} ·{" "}
                        {x.isComplete ? "完整" : "不完整"} ·{" "}
                        {x.warnings.join("；")}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="iw-card dr-pending-corrections">
                <b>历史更正 {corrections.length}</b>
                {corrections.map((c) => (
                  <span key={c.id}>
                    {c.originalDate} · {reportType(c.affectedReport)} · {c.type}{" "}
                    · {money(c.diffAmount)} ·{" "}
                    {c.reportedInSnapshotId ? "已纳入快照" : "待纳入快照"} ·{" "}
                    {c.reason}
                  </span>
                ))}
              </section>
            </>
          )}
        </>
      )}
      <DetailDrawer
        open={!!detailReport}
        title="日报详情"
        subtitle={
          detailReport
            ? `${reportType(detailReport.type)} · ${detailReport.documentNo || "无单号"}`
            : undefined
        }
        onClose={() => setDetailReport(null)}
      >
        {detailReport && (
          <dl className="dr-detail-fields">
            {[
              ["业务日期", detailReport.date],
              ["客户 / 供应商", detailReport.partyName],
              ["日报来源", detailReport.source === "history-import" ? "历史日报导入" : detailReport.source === "manual" || !detailReport.source ? "手工日报" : detailReport.source],
              ["导入批次", detailReport.importBatchId || "—"],
              ["单据编号", detailReport.documentNo],
              ["数量", detailReport.quantity],
              ["币种", detailReport.currency],
              [
                "原币金额",
                currencyMoney(
                  detailReport.originalAmount,
                  detailReport.currency,
                ),
              ],
              ["汇率", detailReport.exchangeRate],
              ["CNY金额", money(detailReport.amountCny)],
              ["已关联分摊", money(detailReport.allocatedAmount)],
              ["备注", detailReport.note],
              ["创建人", detailReport.createdByName],
              ["创建时间", dateTime(detailReport.createdAt)],
              [
                "关联单据",
                detailReport.links
                  .map(
                    (l) =>
                      `${l.k3Row?.billNo || l.k3RowId}（${money(l.allocatedAmount)} / ${l.allocatedQuantity}）`,
                  )
                  .join("；") || "—",
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v ?? "—")}</dd>
              </div>
            ))}
          </dl>
        )}
      </DetailDrawer>
      <DetailDrawer
        open={!!detailRow}
        title="ERP 单据详情"
        subtitle={
          detailRow
            ? `${documentKindLabel(detailRow.kind)} · ${detailRow.billNo}`
            : undefined
        }
        onClose={() => setDetailRow(null)}
      >
        {detailRow && (
          <dl className="dr-detail-fields">
            {Object.entries({
              ...detailRow,
              source: summary?.source,
              currencyAmount: `${detailRow.currency} ${currencyMoney(detailRow.originalAmount, detailRow.currency)}`,
              links:
                detailRow.linkedDocuments
                  ?.map(
                    (x) =>
                      `${documentKindLabel(x.kind)} ${x.billNo} · ${x.date} · ${x.partyName} · ${x.quantity} ${x.unit}`,
                  )
                  .join("；") || "—",
            }).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>
                  {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DetailDrawer>
    </section>
  );
}
