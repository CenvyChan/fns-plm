import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Archive,
  Check,
  Coins,
  Database,
  Link2,
  RefreshCw,
  Save,
  Users,
} from "lucide-react";
import { apiFetch } from "./api";
import DailyReportImportHistory from "./DailyReportImportHistory";
import "./daily-reporting-admin.css";

type PartyKind = "customer" | "supplier";
type Party = {
  id: string;
  kind: PartyKind;
  name: string;
  aliases: string[];
  active: boolean;
  k3Number: string;
  legacyCompanyCode: string;
  legacyId: string;
  source: "manual" | "legacy-import";
  updatedAt: string;
};
type Rate = {
  id: string;
  month: string;
  currency: "USD";
  targetCurrency: "CNY";
  rate: string;
  source: "manual" | "legacy-import";
  legacyCompanyCode?: string;
  updatedAt: string;
};
type Assignment = {
  id: string;
  kind: PartyKind;
  partyId: string | null;
  userId: string | null;
  legacyCompanyCode: string;
  legacyPartyId: string;
  legacyUserId: string;
  legacyUsername: string;
  legacyUserName: string;
  status: "unmapped" | "party-unmapped" | "member-unmapped" | "mapped";
  updatedAt: string;
};
type PartyMapping = {
  id: string;
  kind: PartyKind;
  k3Number: string;
  k3Name: string;
  partyId: string | null;
  status: "PENDING" | "MANUAL" | "UNMATCHED";
  legacyStatus: string;
  legacyPartyId: string;
  legacyCompanyCode: string;
  candidates: Array<{ legacyId?: string; name: string; score?: number }>;
  updatedAt: string;
  updatedBy: string;
};
type Member = {
  id: string;
  displayName: string;
  role: string;
  disabled: boolean;
};
type ImportBatch = {
  id: string;
  category: string;
  sourceCompanyCode: string;
  rowCount: number;
  inserted: number;
  skipped: number;
  conflicts: number;
  digest: string;
  createdAt: string;
  createdBy: string;
};
type MirrorRecord = { number: string; name: string; status: string };
type Management = {
  masterDataConfigured: boolean;
  parties: Party[];
  exchangeRates: Rate[];
  assignments: Assignment[];
  partyMappings: PartyMapping[];
  importBatches: ImportBatch[];
  members: Member[];
  k3Parties: {
    customerCount: number;
    supplierCount: number;
    lastSyncedAt: string | null;
  };
};

const KIND_LABEL: Record<PartyKind, string> = {
  customer: "客户",
  supplier: "供应商",
};
const roleLabel = (value: string) =>
  (
    ({
      admin: "管理员",
      plm_manager: "PLM 经理",
      member: "成员",
      reviewer: "审阅者",
    }) as Record<string, string>
  )[value] ?? value;
const dateTime = (value: string) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    const error = new Error(
      body?.message || body?.error || `请求失败（HTTP ${response.status}）`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}
async function writeJson<T>(
  path: string,
  method: string,
  payload: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? `无权执行此操作（HTTP 403）：${body?.message || body?.error || "请联系管理员确认当前账套权限。"}`
        : body?.message || body?.error || `保存失败（HTTP ${response.status}）`,
    );
  return body as T;
}

export default function DailyReportingManagement({
  onChanged,
  page,
  onNavigate,
  canManageUsers = false,
}: {
  onChanged: () => void;
  page: string;
  onNavigate: (page: string) => void;
  canManageUsers?: boolean;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Management | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const previousPage = useRef(page);

  const [partyKind, setPartyKind] = useState<PartyKind>("customer");
  const [partyName, setPartyName] = useState("");
  const [partyAliases, setPartyAliases] = useState("");
  const [partyK3, setPartyK3] = useState("");
  const [legacyCompanyCode, setLegacyCompanyCode] = useState("");
  const [legacyId, setLegacyId] = useState("");
  const [editingPartyId, setEditingPartyId] = useState("");

  const [rateMonth, setRateMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [rateValue, setRateValue] = useState("");
  const [assignmentKind, setAssignmentKind] = useState<PartyKind>("customer");
  const [assignmentPartyId, setAssignmentPartyId] = useState("");
  const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([]);
  const [assignmentExpectedUserIds, setAssignmentExpectedUserIds] = useState<string[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const batchPageSize = 20;
  const [assignmentSelections, setAssignmentSelections] = useState<
    Record<string, { partyId: string; userId: string }>
  >({});
  const [mappingSelections, setMappingSelections] = useState<
    Record<string, string>
  >({});
  const [mirrorByMapping, setMirrorByMapping] = useState<
    Record<
      string,
      { records: MirrorRecord[]; total: number; lastSyncedAt: string | null }
    >
  >({});
  const [verifiedAt, setVerifiedAt] = useState<Record<string, string>>({});
  const [assignmentFilter, setAssignmentFilter] = useState<
    "all" | "pending" | "confirmed"
  >("all");
  const [mappingFilter, setMappingFilter] = useState<
    "all" | "pending" | "confirmed"
  >("all");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setData(null);
    }
    setError("");
    try {
      const [management, batchResult] = await Promise.all([
        readJson<Omit<Management, "importBatches">>(
          "/api/daily-reporting/management",
        ),
        readJson<{ batches: ImportBatch[] }>(
          "/api/daily-reporting/migration/batches",
        ),
      ]);
      setData({ ...management, importBatches: batchResult.batches });
      setAllowed(true);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "日报业务设置加载失败";
      if ((caught as { status?: number })?.status === 403) {
        setAllowed(false);
        setError(
          "无权访问日报业务设置（HTTP 403）。请联系管理员确认当前账套权限。",
        );
      } else {
        setAllowed(true);
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    setNotice("");
    if (page === "daily-parties-new") resetPartyForm();
    else if (page === "daily-parties-edit" && !editingPartyId)
      onNavigate("daily-parties");
  }, [page, editingPartyId, onNavigate]);
  useEffect(() => {
    if (page === "daily-parties-new") resetPartyForm();
    if (page === "daily-parties-edit" && !editingPartyId)
      onNavigate("daily-parties");
    // Direct URL refresh on edit has no selected row; return to list rather than exposing create form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!data) return;
    setAssignmentSelections((current) => {
      const next = { ...current };
      for (const item of data.assignments)
        if (!next[item.id])
          next[item.id] = {
            partyId: item.partyId ?? "",
            userId: item.userId ?? "",
          };
      return next;
    });
    setMappingSelections((current) => {
      const next = { ...current };
      for (const item of data.partyMappings)
        if (!(item.id in next)) next[item.id] = item.partyId ?? "";
      return next;
    });
  }, [data]);
  useEffect(() => {
    const currentIds = [...new Set((data?.assignments ?? [])
      .filter(item => item.kind === assignmentKind && item.partyId === assignmentPartyId && item.userId)
      .map(item => item.userId!))];
    setAssignmentUserIds(currentIds);
    setAssignmentExpectedUserIds(currentIds);
  }, [data, assignmentKind, assignmentPartyId]);

  const activeParties = useMemo(
    () => data?.parties.filter((item) => item.active) ?? [],
    [data],
  );
  const partyList = useMemo(
    () =>
      [...(data?.parties ?? [])].sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "zh-CN"),
      ),
    [data],
  );
  const members = useMemo(
    () => data?.members.filter((item) => !item.disabled) ?? [],
    [data],
  );
  const partyNameById = useMemo(
    () => new Map((data?.parties ?? []).map((item) => [item.id, item.name])),
    [data],
  );
  const memberById = useMemo(
    () => new Map((data?.members ?? []).map((item) => [item.id, item])),
    [data],
  );

  const submitParty = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const isEditing = page === "daily-parties-edit" && Boolean(editingPartyId);
    if (page === "daily-parties-edit" && !editingPartyId) {
      setBusy(false);
      onNavigate("daily-parties");
      return;
    }
    const prior = data?.parties.find((item) => item.id === editingPartyId);
    const payload = {
      kind: partyKind,
      name: partyName.trim(),
      aliases: partyAliases
        .split(/[\n,;；，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      k3Number: partyK3.trim(),
      legacyCompanyCode: legacyCompanyCode.trim().toUpperCase(),
      legacyId: legacyId.trim(),
      ...(isEditing ? { active: prior?.active ?? true } : {}),
    };
    try {
      await writeJson(
        isEditing
          ? `/api/daily-reporting/masters/${encodeURIComponent(editingPartyId)}`
          : "/api/daily-reporting/masters",
        isEditing ? "PATCH" : "POST",
        payload,
      );
      setNotice(isEditing ? "客商主档已更新。" : "客商主档已新增。");
      resetPartyForm();
      await load(true);
      onChanged();
      onNavigate("daily-parties");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "主档保存失败");
    } finally {
      setBusy(false);
    }
  };
  const resetPartyForm = () => {
    setEditingPartyId("");
    setPartyName("");
    setPartyAliases("");
    setPartyK3("");
    setLegacyCompanyCode("");
    setLegacyId("");
  };
  const editParty = (party: Party) => {
    setEditingPartyId(party.id);
    setPartyKind(party.kind);
    setPartyName(party.name);
    setPartyAliases(party.aliases.join("，"));
    setPartyK3(party.k3Number);
    setLegacyCompanyCode(party.legacyCompanyCode);
    setLegacyId(party.legacyId);
  };
  const toggleParty = async (party: Party) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await writeJson(
        `/api/daily-reporting/masters/${encodeURIComponent(party.id)}`,
        "PATCH",
        { ...party, active: !party.active },
      );
      setNotice(
        `${KIND_LABEL[party.kind]}「${party.name}」已${party.active ? "停用" : "启用"}。`,
      );
      await load(true);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "主档状态更新失败");
    } finally {
      setBusy(false);
    }
  };
  const editRate = (rate: Rate) => {
    setRateMonth(rate.month);
    setRateValue(rate.rate);
    onNavigate("daily-rates-new");
  };
  const saveRate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await writeJson("/api/daily-reporting/exchange-rates", "PUT", {
        month: rateMonth,
        rate: rateValue,
      });
      setNotice(
        `${rateMonth} USD→CNY 月汇率已保存；既有日报记录中的历史汇率不变。`,
      );
      setRateValue("");
      await load(true);
      onChanged();
      onNavigate("daily-rates");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "月汇率保存失败");
    } finally {
      setBusy(false);
    }
  };
  const existingPartyAssignments = data?.assignments.filter(
    (item) => item.kind === assignmentKind && item.partyId === assignmentPartyId && item.userId,
  ) ?? [];
  const existingPartyUserIds = [...new Set(existingPartyAssignments.map((item) => item.userId!))];
  const saveAssignments = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || loading || !data || !assignmentPartyId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (existingPartyUserIds.some((id) => !members.some((member) => member.id === id))) {
        throw new Error("该客商现有分配包含已停用或不可用成员。为避免误删，请先在归属关系列表处理旧成员后再保存。");
      }
      await writeJson("/api/daily-reporting/assignments", "POST", {
        kind: assignmentKind,
        partyId: assignmentPartyId,
        userIds: assignmentUserIds,
        expectedUserIds: assignmentExpectedUserIds,
      });
      setNotice(
        `已保存 ${KIND_LABEL[assignmentKind]}归属：${assignmentUserIds.length} 位当前账套成员；此操作将整体替换该客商成员列表。`,
      );
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "人员归属保存失败");
    } finally {
      setBusy(false);
    }
  };
  const mapLegacyAssignment = async (item: Assignment) => {
    if (busy) return;
    const selected = assignmentSelections[item.id];
    if (!selected?.partyId || !selected?.userId) {
      setError("请同时选择 PLM 客商和当前账套成员。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await writeJson(
        `/api/daily-reporting/assignments/${encodeURIComponent(item.id)}`,
        "PUT",
        selected,
      );
      setNotice(
        `已将旧归属关系映射到「${partyNameById.get(selected.partyId) ?? "客商"}」与所选 PLM 成员。`,
      );
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "旧归属映射失败");
    } finally {
      setBusy(false);
    }
  };
  const verifyMirror = async (item: PartyMapping) => {
    setError("");
    try {
      const result = await readJson<{
        records: MirrorRecord[];
        total: number;
        lastSyncedAt: string | null;
      }>(
        `/api/daily-reporting/k3-party-mirror?kind=${item.kind}&q=${encodeURIComponent(item.k3Number)}`,
      );
      setMirrorByMapping((current) => ({ ...current, [item.id]: result }));
      setVerifiedAt((current) => ({
        ...current,
        [item.id]: new Date().toISOString(),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "K3 客商核验失败");
    }
  };
  const confirmMapping = async (item: PartyMapping) => {
    if (busy) return;
    const partyId = mappingSelections[item.id];
    if (!partyId) {
      setError("请先选择 PLM 中的目标客户/供应商。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await writeJson(
        `/api/daily-reporting/party-mappings/${encodeURIComponent(item.id)}`,
        "PUT",
        { partyId },
      );
      setNotice(
        `K3 ${item.k3Number} 已人工映射到「${partyNameById.get(partyId) ?? "所选客商"}」。`,
      );
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "客商映射保存失败");
    } finally {
      setBusy(false);
    }
  };

  const assignmentNeedsReview = (item: Assignment) =>
    item.status !== "mapped" ||
    !data?.parties.some(
      (party) =>
        party.id === item.partyId && party.kind === item.kind && party.active,
    ) ||
    !data?.members.some(
      (member) => member.id === item.userId && !member.disabled,
    );
  const mappingNeedsReview = (item: PartyMapping) =>
    item.status !== "MANUAL" ||
    !data?.parties.some(
      (party) =>
        party.id === item.partyId && party.kind === item.kind && party.active,
    );
  const assignmentPending =
    data?.assignments.filter(assignmentNeedsReview).length ?? 0;
  const mappingPending =
    data?.partyMappings.filter(mappingNeedsReview).length ?? 0;
  const manualMappings =
    data?.partyMappings.filter((item) => !mappingNeedsReview(item)).length ?? 0;
  const conflictBatches =
    data?.importBatches.filter((item) => item.conflicts > 0).length ?? 0;

  return (
    <section className="iw-card dr-admin" aria-label="日报业务设置">
      <div className="iw-card-head">
        <div>
          <div className="iw-eyebrow">DAILY REPORTING / ADMIN</div>
          <h1>
            {page === "daily-parties" ||
            page === "daily-parties-new" ||
            page === "daily-parties-edit"
              ? `${page === "daily-parties-new" ? (partyKind === "customer" ? "新增客户" : "新增供应商") : page === "daily-parties-edit" ? (partyKind === "customer" ? "编辑客户" : "编辑供应商") : "客户 / 供应商主档"}`
              : page.startsWith("daily-rates")
                ? "月汇率"
                : page === "daily-assignments"
                  ? "归属管理"
                  : page === "daily-mappings"
                    ? "K3 映射"
                    : page === "daily-imports"
                      ? "导入批次"
                      : "日报业务设置"}
          </h1>
          <p>
            按当前 tenant / organization / account 隔离。只有管理员和 PLM
            经理能维护主档、汇率、归属与 K3 映射；不会创建用户或扩大权限。
          </p>
        </div>
        <button
          className="iw-button iw-secondary iw-small"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <RefreshCw size={13} />
          刷新
        </button>
      </div>
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
      {allowed === false && (
        <div className="iw-empty" role="alert">
          无权访问此页面。日报业务设置仅向获授权的管理员或 PLM 经理开放。
        </div>
      )}
      {data && allowed !== false && (
        <>
          <section className="dr-admin-overview" aria-label="待办概览">
            <div className="dr-admin-overview-copy">
              <b>运维待办指引</b>
              <span>
                先处理未完成的归属与 K3
                映射，再检查有冲突的导入批次。映射候选不等于 PLM
                人工确认；保存后刷新以查看后端最新状态。
              </span>
            </div>
            <div className="dr-admin-stats">
              <div>
                <b>{assignmentPending}</b>
                <span>归属待匹配</span>
              </div>
              <div>
                <b>{mappingPending}</b>
                <span>K3待人工确认</span>
              </div>
              <div>
                <b>{manualMappings}</b>
                <span>PLM已人工确认</span>
              </div>
              <div className={conflictBatches ? "has-risk" : ""}>
                <b>{conflictBatches}</b>
                <span>有冲突批次</span>
              </div>
            </div>
          </section>
          {(page === "daily-parties-new" || page === "daily-parties-edit") && (
            <div className="dr-admin-stack">
              <form
                className="dr-admin-form dr-admin-standalone-form"
                onSubmit={submitParty}
              >
                <div className="dr-admin-form-heading">
                  <h2>
                    {editingPartyId
                      ? `编辑${KIND_LABEL[partyKind]}主档`
                      : `新增${KIND_LABEL[partyKind]}主档`}
                  </h2>
                  <button
                    type="button"
                    className="iw-button iw-secondary iw-small"
                    disabled={busy}
                    onClick={() => {
                      resetPartyForm();
                      onNavigate("daily-parties");
                    }}
                  >
                    ← 返回客商列表
                  </button>
                </div>
                <label>
                  主档类型
                  <select
                    value={partyKind}
                    onChange={(event) =>
                      setPartyKind(event.target.value as PartyKind)
                    }
                  >
                    <option value="customer">客户</option>
                    <option value="supplier">供应商</option>
                  </select>
                </label>
                <label>
                  名称
                  <input
                    value={partyName}
                    onChange={(event) => setPartyName(event.target.value)}
                    maxLength={120}
                    required
                  />
                </label>
                <label className="dr-admin-wide">
                  别名（逗号分隔）
                  <input
                    value={partyAliases}
                    onChange={(event) => setPartyAliases(event.target.value)}
                    placeholder="用于人工查找，不会自动合并"
                  />
                </label>
                <label>
                  K3 编码（可选）
                  <input
                    value={partyK3}
                    onChange={(event) => setPartyK3(event.target.value)}
                    maxLength={128}
                  />
                </label>
                <label>
                  旧公司代码
                  <input
                    value={legacyCompanyCode}
                    onChange={(event) =>
                      setLegacyCompanyCode(event.target.value)
                    }
                    placeholder="如 FNS / NBHH"
                    maxLength={32}
                  />
                </label>
                <label className="dr-admin-wide">
                  旧主键
                  <input
                    value={legacyId}
                    onChange={(event) => setLegacyId(event.target.value)}
                    maxLength={128}
                  />
                </label>
                <div className="dr-admin-form-actions">
                  <button
                    className="iw-button iw-approve iw-small"
                    disabled={busy}
                  >
                    <Save size={13} />
                    {editingPartyId ? "保存修改" : "新增主档"}
                  </button>
                  <button
                    type="button"
                    className="iw-button iw-secondary iw-small"
                    disabled={busy}
                    onClick={() => {
                      resetPartyForm();
                      onNavigate("daily-parties");
                    }}
                  >
                    取消
                  </button>
                </div>
                <p className="dr-admin-help">
                  名称、别名、K3
                  编码和旧系统主键均会做账套内重复检查。旧系统导入记录只作为 PLM
                  日报主档，不写入 K3Cloud 镜像。
                </p>
              </form>
            </div>
          )}

          {page === "daily-parties" && (
            <div className="dr-admin-stack">
              <div className="dr-admin-page-actions">
                <h3>客户 / 供应商主档</h3>
                <button
                  className="iw-button iw-approve iw-small"
                  onClick={() => {
                    resetPartyForm();
                    setPartyKind("customer");
                    onNavigate("daily-parties-new");
                  }}
                >
                  <Save size={13} />
                  新增客商
                </button>
              </div>
              <div className="dr-admin-table-block">
                <h3>当前账套主档 · {partyList.length} 条</h3>
                <div className="iw-table-wrap dr-admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>类型 / 状态</th>
                        <th>名称 / 别名</th>
                        <th>K3 / 旧系统键</th>
                        <th>来源</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partyList.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {KIND_LABEL[item.kind]}
                            <small>{item.active ? "启用" : "停用"}</small>
                          </td>
                          <td>
                            <b>{item.name}</b>
                            <small>{item.aliases.join("、") || "—"}</small>
                          </td>
                          <td>
                            {item.k3Number || "—"}
                            <small>
                              {item.legacyCompanyCode && item.legacyId
                                ? `${item.legacyCompanyCode} / ${item.legacyId}`
                                : "—"}
                            </small>
                          </td>
                          <td>
                            {item.source === "legacy-import"
                              ? "旧系统候选"
                              : "PLM 手工"}
                          </td>
                          <td>
                            <div className="dr-admin-actions">
                              <button
                                className="iw-button iw-secondary iw-small"
                                onClick={() => {
                                  editParty(item);
                                  onNavigate("daily-parties-edit");
                                }}
                              >
                                编辑
                              </button>
                              <button
                                className="iw-button iw-secondary iw-small"
                                onClick={() => void toggleParty(item)}
                                disabled={busy}
                              >
                                {item.active ? "停用" : "启用"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!partyList.length && (
                    <div className="iw-empty">
                      尚无客户或供应商主档。可先手工新增，或由管理员后续导入旧系统候选数据。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {page === "daily-rates-new" && (
            <div className="dr-admin-stack">
              <form
                className="dr-admin-form dr-admin-standalone-form"
                onSubmit={saveRate}
              >
                <div className="dr-admin-form-heading">
                  <h2>维护 USD → CNY 月汇率</h2>
                  <button
                    type="button"
                    className="iw-button iw-secondary iw-small"
                    disabled={busy}
                    onClick={() => onNavigate("daily-rates")}
                  >
                    ← 返回月汇率列表
                  </button>
                </div>
                <label>
                  月份
                  <input
                    type="month"
                    value={rateMonth}
                    onChange={(event) => setRateMonth(event.target.value)}
                    required
                  />
                </label>
                <label>
                  汇率
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={rateValue}
                    onChange={(event) => setRateValue(event.target.value)}
                    placeholder="例如 7.1234"
                    required
                  />
                </label>
                <div className="dr-admin-form-actions">
                  <button
                    className="iw-button iw-approve iw-small"
                    disabled={busy}
                  >
                    <Save size={13} />
                    保存月汇率
                  </button>
                  <button
                    type="button"
                    className="iw-button iw-secondary iw-small"
                    disabled={busy}
                    onClick={() => onNavigate("daily-rates")}
                  >
                    取消
                  </button>
                </div>
                <p className="dr-admin-help">
                  月汇率保存后，录入 USD
                  日报时按业务日期自动带入；表单仍允许逐笔调整。日报中已保存的历史汇率与人民币金额不会被改写。
                </p>
              </form>
            </div>
          )}
          {page === "daily-rates" && (
            <div className="dr-admin-stack">
              <div className="dr-admin-page-actions">
                <h3>USD → CNY 月汇率</h3>
                <button
                  className="iw-button iw-approve iw-small"
                  onClick={() => {
                    setRateMonth(new Date().toISOString().slice(0, 7));
                    setRateValue("");
                    onNavigate("daily-rates-new");
                  }}
                >
                  <Save size={13} />
                  新增 / 维护汇率
                </button>
              </div>
              <div className="dr-admin-table-block">
                <h3>月汇率历史 · {data.exchangeRates.length} 个月</h3>
                <div className="iw-table-wrap dr-admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>月份</th>
                        <th>汇率方向</th>
                        <th>汇率</th>
                        <th>来源 / 公司</th>
                        <th>更新</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.exchangeRates]
                        .sort((a, b) => b.month.localeCompare(a.month))
                        .map((item) => (
                          <tr key={item.id}>
                            <td>
                              <b>{item.month}</b>
                            </td>
                            <td>USD → CNY</td>
                            <td>{item.rate}</td>
                            <td>
                              {item.source === "legacy-import"
                                ? `旧系统${item.legacyCompanyCode ? ` · ${item.legacyCompanyCode}` : ""}`
                                : "PLM 手工"}
                            </td>
                            <td>{dateTime(item.updatedAt)}</td>
                            <td>
                              <button
                                className="iw-button iw-secondary iw-small"
                                onClick={() => editRate(item)}
                              >
                                维护
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data.exchangeRates.length && (
                    <div className="iw-empty">
                      尚无月汇率；新增后将用于对应月份新录入的 USD 日报。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {page === "daily-assignments" && (
            <div className="dr-admin-stack">
              <form className="dr-admin-inline-form" onSubmit={saveAssignments}>
                <b>设置客商归属</b>
                <label>
                  类型
                  <select
                    value={assignmentKind}
                    onChange={(event) => {
                      setAssignmentKind(event.target.value as PartyKind);
                      setAssignmentPartyId("");
                      setAssignmentUserIds([]);
                    }}
                  >
                    <option value="customer">客户</option>
                    <option value="supplier">供应商</option>
                  </select>
                </label>
                <label>
                  客商
                  <select
                    value={assignmentPartyId}
                    onChange={(event) => {
                      const partyId = event.target.value;
                      setAssignmentPartyId(partyId);
                      setAssignmentUserIds((data?.assignments ?? [])
                        .filter((item) => item.kind === assignmentKind && item.partyId === partyId && item.userId)
                        .map((item) => item.userId!));
                    }}
                    required
                  >
                    <option value="">选择启用客商</option>
                    {activeParties
                      .filter((item) => item.kind === assignmentKind)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="dr-admin-members">
                  PLM 成员（可多选）
                  <select
                    multiple
                    value={assignmentUserIds}
                    onChange={(event) =>
                      setAssignmentUserIds(
                        [...event.currentTarget.selectedOptions].map(
                          (option) => option.value,
                        ),
                      )
                    }
                  >
                    {members.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName} · {roleLabel(item.role)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="iw-button iw-approve iw-small"
                  disabled={busy || !assignmentPartyId}
                >
                  <Save size={13} />
                  保存归属
                </button>
              </form>
              <p className="dr-admin-help dr-admin-assignment-warning" role="note">
                {assignmentPartyId ? `当前客商已有 ${existingPartyUserIds.length} 位成员；已自动预选现有成员。保存会整体替换现有成员列表，取消选择即移除对应成员。` : "先选择客商以查看并预选其现有成员；保存将整体替换成员列表。"}
                只能从当前账套中选择已启用成员；不会邀请用户或扩大 PLM 权限。成员日报表单只显示分配给该成员的客商。
              </p>
              <div className="dr-admin-table-block">
                <h3>
                  归属关系 · {data.assignments.length} 条（待匹配{" "}
                  {assignmentPending}）
                </h3>
                <div
                  className="dr-admin-filters"
                  role="tablist"
                  aria-label="归属状态筛选"
                >
                  {(
                    [
                      ["all", "全部"],
                      ["pending", `待处理 ${assignmentPending}`],
                      [
                        "confirmed",
                        `已匹配 ${data.assignments.length - assignmentPending}`,
                      ],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={assignmentFilter === key}
                      className={assignmentFilter === key ? "is-active" : ""}
                      onClick={() => setAssignmentFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="iw-table-wrap dr-admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>旧关系</th>
                        <th>PLM 客商</th>
                        <th>PLM 成员</th>
                        <th>状态 / 处理原因</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.assignments
                        .filter(
                          (item) =>
                            assignmentFilter === "all" ||
                            (assignmentFilter === "pending"
                              ? assignmentNeedsReview(item)
                              : !assignmentNeedsReview(item)),
                        )
                        .map((item) => {
                          const selected = assignmentSelections[item.id] ?? {
                            partyId: item.partyId ?? "",
                            userId: item.userId ?? "",
                          };
                          const partyRecord = data.parties.find(
                            (party) =>
                              party.id === item.partyId &&
                              party.kind === item.kind,
                          );
                          const partyMissing =
                            !partyRecord || !partyRecord.active;
                          const memberRecord = item.userId
                            ? memberById.get(item.userId)
                            : undefined;
                          const memberMissing =
                            !item.userId ||
                            !memberRecord ||
                            memberRecord.disabled;
                          const unresolved = assignmentNeedsReview(item);
                          const reason =
                            [
                              partyMissing
                                ? partyRecord
                                  ? "客商已停用，需选择启用主档"
                                  : "客商未匹配"
                                : "",
                              memberMissing
                                ? memberRecord?.disabled
                                  ? "成员已停用，需重新分配"
                                  : "成员未匹配"
                                : "",
                              item.status !== "mapped" &&
                              !partyMissing &&
                              !memberMissing
                                ? "关联对象已选定，仍需保存确认"
                                : "",
                            ]
                              .filter(Boolean)
                              .join("；") || "客商与成员均有效且已关联";
                          return (
                            <tr key={item.id}>
                              <td>
                                {KIND_LABEL[item.kind]} ·{" "}
                                {item.legacyCompanyCode || "PLM"} /{" "}
                                {item.legacyPartyId || "—"}
                                <small>
                                  {item.legacyUserName ||
                                    item.legacyUsername ||
                                    item.legacyUserId ||
                                    "当前 PLM 归属"}
                                </small>
                              </td>
                              <td>
                                {partyMissing ? (
                                  <select
                                    value={selected.partyId}
                                    onChange={(event) =>
                                      setAssignmentSelections((current) => ({
                                        ...current,
                                        [item.id]: {
                                          ...selected,
                                          partyId: event.target.value,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">选择匹配客商</option>
                                    {activeParties
                                      .filter(
                                        (party) => party.kind === item.kind,
                                      )
                                      .map((party) => (
                                        <option key={party.id} value={party.id}>
                                          {party.name}
                                        </option>
                                      ))}
                                  </select>
                                ) : (
                                  (partyNameById.get(item.partyId!) ??
                                  "已关联客商")
                                )}
                              </td>
                              <td>
                                {memberMissing ? (
                                  <select
                                    value={selected.userId}
                                    onChange={(event) =>
                                      setAssignmentSelections((current) => ({
                                        ...current,
                                        [item.id]: {
                                          ...selected,
                                          userId: event.target.value,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">选择当前账套成员</option>
                                    {members.map((member) => (
                                      <option key={member.id} value={member.id}>
                                        {member.displayName} ·{" "}
                                        {roleLabel(member.role)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  memberRecord?.displayName
                                )}
                              </td>
                              <td>
                                <span
                                  className={`dr-admin-status ${unresolved ? "unmapped" : "mapped"}`}
                                >
                                  {unresolved ? "待处理" : "已匹配"}
                                </span>
                                <small>
                                  {reason}
                                  {item.updatedAt
                                    ? ` · 最近变更 ${dateTime(item.updatedAt)}`
                                    : ""}
                                </small>
                              </td>
                              <td>
                                {unresolved && (
                                  <div className="dr-admin-actions">
                                    <button
                                      className="iw-button iw-secondary iw-small"
                                      onClick={() =>
                                        void mapLegacyAssignment(item)
                                      }
                                      disabled={
                                        busy ||
                                        !selected.partyId ||
                                        !selected.userId
                                      }
                                    >
                                      确认映射
                                    </button>
                                    <button
                                      className="iw-button iw-secondary iw-small"
                                      onClick={() =>
                                        onNavigate("daily-parties")
                                      }
                                    >
                                      维护客商
                                    </button>
                                    {memberMissing && canManageUsers && (
                                      <button
                                        className="iw-button iw-secondary iw-small"
                                        onClick={() => onNavigate("users")}
                                      >
                                        维护成员
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {!data.assignments.length && (
                    <div className="iw-empty">
                      暂无归属记录。可在上方按客商直接分配现有 PLM 成员。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {page === "daily-mappings" && (
            <div className="dr-admin-stack">
              <div className="dr-admin-banner">
                <Database size={15} />
                <span>
                  当前 K3Cloud 镜像：客户 {data.k3Parties.customerCount}{" "}
                  条、供应商 {data.k3Parties.supplierCount} 条；镜像最近同步时间{" "}
                  {dateTime(data.k3Parties.lastSyncedAt ?? "")}
                  。核验仅查询镜像，不代表人工确认；逐条核验结果仅为本次会话记录，刷新后需重新核验。运维下一步：由管理员确认 K3 镜像同步新鲜度；命中候选后仍须业务负责人核对主数据并点“确认映射”，未命中或镜像过期时先排查同步/编码后再处理。
                </span>
              </div>
              <div
                className="dr-admin-filters"
                role="tablist"
                aria-label="K3映射状态筛选"
              >
                {(
                  [
                    ["all", "全部"],
                    ["pending", `待处理 ${mappingPending}`],
                    ["confirmed", `PLM已确认 ${manualMappings}`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={mappingFilter === key}
                    className={mappingFilter === key ? "is-active" : ""}
                    onClick={() => setMappingFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="iw-table-wrap dr-admin-table dr-mapping-table">
                <table>
                  <thead>
                    <tr>
                      <th>旧 M13 / K3 客商</th>
                      <th>PLM 当前客商</th>
                      <th>K3 镜像核验</th>
                      <th>状态 / 旧候选</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.partyMappings
                      .filter(
                        (item) =>
                          mappingFilter === "all" ||
                          (mappingFilter === "pending"
                            ? mappingNeedsReview(item)
                            : !mappingNeedsReview(item)),
                      )
                      .map((item) => {
                        const mirror = mirrorByMapping[item.id];
                        const exact = mirror?.records.find(
                          (record) => record.number === item.k3Number,
                        );
                        const selectedId =
                          mappingSelections[item.id] ?? item.partyId ?? "";
                        const backendConfirmed = !mappingNeedsReview(item);
                        return (
                          <tr key={item.id}>
                            <td>
                              <b>
                                {KIND_LABEL[item.kind]} · {item.k3Number}
                              </b>
                              <small>
                                {item.k3Name} · 旧 {item.legacyCompanyCode}/
                                {item.legacyPartyId || "—"}
                              </small>
                            </td>
                            <td>
                              <select
                                value={selectedId}
                                onChange={(event) =>
                                  setMappingSelections((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">选择当前 PLM 客商</option>
                                {activeParties
                                  .filter((party) => party.kind === item.kind)
                                  .map((party) => (
                                    <option key={party.id} value={party.id}>
                                      {party.name}
                                      {party.k3Number
                                        ? ` · ${party.k3Number}`
                                        : ""}
                                    </option>
                                  ))}
                              </select>
                              {item.updatedAt && (
                                <small>
                                  最近变更 {dateTime(item.updatedAt)}
                                </small>
                              )}
                            </td>
                            <td>
                              <button
                                className="iw-button iw-secondary iw-small"
                                onClick={() => void verifyMirror(item)}
                              >
                                <RefreshCw size={12} />
                                核验 K3 编码
                              </button>
                              <small
                                className={
                                  mirror
                                    ? exact
                                      ? "dr-admin-match"
                                      : "dr-admin-no-match"
                                    : ""
                                }
                              >
                                {mirror
                                  ? exact
                                    ? backendConfirmed
                                      ? "镜像已命中；PLM 映射已确认"
                                      : "镜像已命中但待人工确认"
                                    : "镜像未命中"
                                  : "尚未核验"}
                                {mirror
                                  ? ` · ${exact ? `${exact.number} ${exact.name} · ${exact.status}` : `编码 ${item.k3Number}`} · 检索 ${mirror.records.length}/${mirror.total}`
                                  : ""}
                                <br />
                                核验时间：
                                {verifiedAt[item.id]
                                  ? `${dateTime(verifiedAt[item.id])}（本页临时记录，刷新需重新核验）`
                                  : "未记录"}
                                {mirror?.lastSyncedAt
                                  ? ` · 镜像时间 ${dateTime(mirror.lastSyncedAt)}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <span
                                className={`dr-admin-status ${backendConfirmed ? "MANUAL" : "PENDING"}`}
                              >
                                {backendConfirmed
                                  ? "PLM 已人工确认"
                                  : item.status === "MANUAL"
                                    ? "原确认目标已失效，需重选"
                                    : "待人工确认"}
                              </span>
                              <small>
                                旧状态（非 PLM 确认）：{item.legacyStatus}
                                {item.candidates.length
                                  ? ` · 旧候选：${item.candidates
                                      .slice(0, 3)
                                      .map((candidate) => candidate.name)
                                      .join("、")}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              {(!backendConfirmed ||
                                selectedId !== item.partyId) && (
                                <button
                                  className="iw-button iw-approve iw-small"
                                  onClick={() => void confirmMapping(item)}
                                  disabled={busy || !selectedId}
                                >
                                  <Check size={12} />
                                  确认映射
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {!data.partyMappings.length && (
                  <div className="iw-empty">
                    暂无待复核的 K3 客商映射。导入旧系统候选后会显示在此处；旧
                    AUTO/MANUAL 状态不会被直接信任。
                  </div>
                )}
              </div>
            </div>
          )}

          {page === "daily-imports" && (
            <DailyReportImportHistory migration={<div className="dr-admin-batches dr-admin-imports">
              <h3>
                <Archive size={13} /> 旧数据导入批次审计 ·{" "}
                {data.importBatches.length} 批
              </h3>
              <p className="dr-admin-help">
                此处为只读来源与审计记录。冲突数量大于 0
                表示仍需人工处理，不代表导入成功；接口未提供逐条错误明细，不展示臆测原因。
              </p>
              <div className="iw-table-wrap dr-admin-table">
                <table>
                  <thead>
                    <tr>
                      <th>类别 / 公司</th>
                      <th>行数</th>
                      <th>新增 / 跳过 / 冲突</th>
                      <th>状态</th>
                      <th>时间 / 审计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.importBatches.slice((batchPage - 1) * batchPageSize, batchPage * batchPageSize).map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          {batch.category} · {batch.sourceCompanyCode}
                        </td>
                        <td>{batch.rowCount}</td>
                        <td>
                          {batch.inserted} / {batch.skipped} / {batch.conflicts}
                        </td>
                        <td>
                          <span
                            className={`dr-admin-status ${batch.conflicts ? "UNMATCHED" : "mapped"}`}
                          >
                            {batch.conflicts
                              ? `需人工处理 · ${batch.conflicts} 项冲突`
                              : "无记录冲突"}
                          </span>
                        </td>
                        <td>
                          {dateTime(batch.createdAt)}
                          <small>
                            来源 {batch.createdBy || "未记录"} · 审计摘要{" "}
                            {batch.digest || "未提供"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.importBatches.length > batchPageSize && (
                  <div className="dr-admin-pagination" aria-label="迁移批次分页">
                    <button className="iw-button iw-secondary iw-small" disabled={batchPage <= 1} onClick={() => setBatchPage((pageNo) => Math.max(1, pageNo - 1))}>上一页</button>
                    <span>第 {batchPage} / {Math.ceil(data.importBatches.length / batchPageSize)} 页 · 显示 {(batchPage - 1) * batchPageSize + 1}–{Math.min(batchPage * batchPageSize, data.importBatches.length)} / {data.importBatches.length} 批</span>
                    <button className="iw-button iw-secondary iw-small" disabled={batchPage >= Math.ceil(data.importBatches.length / batchPageSize)} onClick={() => setBatchPage((pageNo) => Math.min(Math.ceil(data.importBatches.length / batchPageSize), pageNo + 1))}>下一页</button>
                  </div>
                )}
                {!data.importBatches.length && (
                  <div className="iw-empty">
                    暂无导入批次记录；这不代表数据已导入或导入完成。
                  </div>
                )}
              </div>
            </div>} />
          )}
        </>
      )}
      {loading && <div className="iw-empty">正在加载日报业务设置…</div>}
    </section>
  );
}
