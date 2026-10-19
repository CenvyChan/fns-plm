import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarClock,
  Plus,
  ChevronRight,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { apiFetch } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import "./reports-workbench.css";

type Schedule = {
  id: string;
  name: string;
  cadence: "daily" | "weekly";
  time: string;
  dayOfWeek?: number | string;
  timezone: string;
  enabled: boolean;
  deliveryConfigured?: boolean;
  schedulerState?: string;
  lastRunAt?: string;
  lastResult?: string;
};
type ReportPreview = {
  [key: string]: unknown;
  title?: string;
  summary?: string;
  text?: string;
  content?: string;
  channelStatus?: unknown;
  channels?: unknown;
};
type Props = {
  page: string;
  onNavigate: (page: string) => void;
  canManage: boolean;
};
const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const render = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  return (
    body?.message || body?.error || `${fallback}（HTTP ${response.status}）`
  );
}
export default function ReportsWorkbench({
  page,
  onNavigate,
  canManage,
}: Props) {
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [errorPreview, setErrorPreview] = useState("");
  const [errorSchedules, setErrorSchedules] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(
    null,
  );
  const [sendNotice, setSendNotice] = useState("");
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [name, setName] = useState("经营日报");
  const [time, setTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  );
  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    setErrorPreview("");
    try {
      const response = await apiFetch("/api/reports/preview");
      if (!response.ok)
        throw new Error(await responseError(response, "预览加载失败"));
      setPreview((await response.json()) as ReportPreview);
    } catch (error) {
      setErrorPreview(
        error instanceof Error ? error.message : "无法加载报告预览",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, []);
  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    setErrorSchedules("");
    try {
      const response = await apiFetch("/api/reports/schedules");
      if (!response.ok)
        throw new Error(await responseError(response, "计划加载失败"));
      const result = (await response.json()) as
        Schedule[] | { schedules?: Schedule[] };
      setSchedules(Array.isArray(result) ? result : (result.schedules ?? []));
    } catch (error) {
      setErrorSchedules(
        error instanceof Error ? error.message : "无法加载发送计划",
      );
    } finally {
      setLoadingSchedules(false);
    }
  }, []);
  useEffect(() => {
    void loadPreview();
    void loadSchedules();
  }, [loadPreview, loadSchedules]);
  const channelStatus = preview?.channelStatus as
    { configured?: boolean; connected?: boolean; message?: string } | undefined;
  const channelReady = Boolean(channelStatus?.configured);
  const isForm =
    page === "report-schedules-new" || page === "report-schedules-edit";
  const editing = page === "report-schedules-edit";
  const selectedSchedule = useMemo(
    () => schedules.find((item) => item.id === editingScheduleId),
    [schedules, editingScheduleId],
  );
  const clearEditor = () => {
    setEditingScheduleId(null);
    setName("经营日报");
    setCadence("daily");
    setTime("09:00");
    setDayOfWeek("1");
    setTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    );
  };
  useEffect(() => {
    if (page === "report-schedules-new") clearEditor();
  }, [page]);
  const goList = () => {
    if (saving) return;
    clearEditor();
    onNavigate("report-schedules");
  };
  const startEdit = (schedule: Schedule) => {
    setEditingScheduleId(schedule.id);
    setName(schedule.name);
    setCadence(schedule.cadence);
    setTime(schedule.time);
    setDayOfWeek(String(schedule.dayOfWeek ?? 1));
    setTimezone(schedule.timezone);
    setNotice("");
    setErrorSchedules("");
    onNavigate("report-schedules-edit");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || saving || (editing && !selectedSchedule)) return;
    setSaving(true);
    setNotice("");
    setErrorSchedules("");
    const id = editing ? editingScheduleId : null;
    const body = {
      name: name.trim(),
      cadence,
      time,
      ...(cadence === "weekly" ? { dayOfWeek: Number(dayOfWeek) } : {}),
      timezone,
      ...(!id ? { enabled: channelReady } : {}),
    };
    try {
      const response = await apiFetch(
        id
          ? `/api/reports/schedules/${encodeURIComponent(id)}`
          : "/api/reports/schedules",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok)
        throw new Error(
          await responseError(response, id ? "更新计划失败" : "保存计划失败"),
        );
      setNotice(
        id
          ? "计划已更新"
          : channelReady
            ? "发送计划已保存并启用"
            : "已保存为停用计划；配置钉钉机器人后可启用",
      );
      clearEditor();
      await loadSchedules();
      onNavigate("report-schedules");
    } catch (error) {
      setErrorSchedules(
        error instanceof Error ? error.message : "保存计划失败",
      );
    } finally {
      setSaving(false);
    }
  };
  const sendNow = async () => {
    if (!canManage || sending || !channelReady) return;
    setSending(true);
    setSendNotice("");
    setSendError("");
    try {
      const response = await apiFetch("/api/reports/send", { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        ok?: boolean;
        status?: string;
        sentAt?: string;
        generatedAt?: string;
      };
      if (!response.ok)
        throw new Error(
          result.message ||
            result.error ||
            `推送失败（HTTP ${response.status}）`,
        );
      if (result.ok === false)
        throw new Error(result.message || "服务端未确认发送成功");
      setSendNotice(
        `推送成功 · 状态：${result.status || "已发送"}${result.sentAt ? ` · 时间：${result.sentAt}` : result.generatedAt ? ` · 报告生成时间：${result.generatedAt}` : ""}`,
      );
      await Promise.all([loadPreview(), loadSchedules()]);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "报告推送失败");
    } finally {
      setSending(false);
    }
  };
  const runScheduleNow = async (schedule: Schedule) => {
    if (!canManage || runningScheduleId || !channelReady) return;
    setRunningScheduleId(schedule.id);
    setNotice("");
    setErrorSchedules("");
    try {
      const response = await apiFetch(
        `/api/reports/schedules/${encodeURIComponent(schedule.id)}/run`,
        { method: "POST" },
      );
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        ok?: boolean;
      };
      if (!response.ok)
        throw new Error(
          result.message ||
            result.error ||
            `执行失败（HTTP ${response.status}）`,
        );
      if (result.ok === false)
        throw new Error(result.message || "服务端未确认发送成功");
      setNotice(`“${schedule.name}”已执行并发送到已配置渠道。`);
      await loadSchedules();
    } catch (error) {
      setErrorSchedules(
        error instanceof Error ? error.message : "计划执行失败",
      );
    } finally {
      setRunningScheduleId(null);
    }
  };
  const update = async (schedule: Schedule, patch: Partial<Schedule>) => {
    if (!canManage) return;
    setErrorSchedules("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/reports/schedules/${encodeURIComponent(schedule.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!response.ok)
        throw new Error(await responseError(response, "更新失败"));
      setNotice(
        patch.enabled === undefined
          ? "计划已更新"
          : patch.enabled
            ? "计划已启用"
            : "计划已停用",
      );
      await loadSchedules();
    } catch (error) {
      setErrorSchedules(
        error instanceof Error ? error.message : "更新计划失败",
      );
    }
  };
  const remove = async (schedule: Schedule) => {
    if (!canManage || deleting) return;
    setDeleting(true);
    setErrorSchedules("");
    setNotice("");
    try {
      const response = await apiFetch(
        `/api/reports/schedules/${encodeURIComponent(schedule.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok)
        throw new Error(await responseError(response, "删除计划失败"));
      if (editingScheduleId === schedule.id) clearEditor();
      setPendingDelete(null);
      setNotice(`“${schedule.name}”已删除`);
      await loadSchedules();
    } catch (error) {
      setErrorSchedules(
        error instanceof Error ? error.message : "删除计划失败",
      );
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };
  const schedulerLabel = (item: Schedule) =>
    item.enabled && !channelReady
      ? "已启用，但缺少机器人配置（阻止发送）"
      : item.schedulerState === "scheduled"
        ? "已排程"
        : item.schedulerState === "blocked-missing-webhook"
          ? "缺少 Webhook"
          : item.schedulerState === "inactive"
            ? "未排程"
            : "已停用";
  const lastResultLabel = (result?: string) =>
    result === "sent"
      ? "发送成功"
      : result?.startsWith("failed:")
        ? `发送失败：${result.slice(7)}`
        : result || "已运行";
  return (
    <section className="iw-page">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除发送计划"
        description={`确认删除“${pendingDelete?.name ?? ""}”？删除后该计划不再定时执行，不影响已生成的报告。`}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />

      <header className="iw-heading">
        <div>
          <div className="iw-eyebrow">经营分析 / REPORTING</div>
          <h1>
            {isForm
              ? editing
                ? "编辑发送计划"
                : "新增发送计划"
              : page === "report-schedules"
                ? "发送计划"
                : "报告展示"}
          </h1>
          <p>
            {isForm
              ? "配置固定内置工作区报告的发送时间与周期；尚不绑定新增的销售/采购日报定义。"
              : page === "report-schedules"
                ? "查看和管理现有日报、周报发送计划。"
                : "查看固定内置报告生成的内容，并管理推送；推送由已配置渠道及计划决定。"}
          </p>
        </div>
        <button
          className="iw-button iw-secondary"
          onClick={() => {
            void loadPreview();
            void loadSchedules();
          }}
          disabled={loadingPreview || loadingSchedules}
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </header>
      {isForm && (
        <nav className="rw-breadcrumb">
          <button onClick={goList} disabled={saving}>
            发送计划
          </button>
          <ChevronRight size={14} />
          <span>{editing ? "编辑计划" : "新增计划"}</span>
        </nav>
      )}
      {(errorSchedules || notice) && (
        <div
          className={`iw-alert ${errorSchedules ? "iw-error" : "iw-success"}`}
        >
          {errorSchedules || notice}
        </div>
      )}
      {isForm ? (
        editing && !selectedSchedule ? (
          <section className="iw-card">
            <h2>未找到可编辑的计划</h2>
            <p>
              该计划可能已删除，或刷新页面后编辑记录无法恢复。请返回计划列表重新选择。
            </p>
            <button className="iw-button iw-secondary" onClick={goList}>
              返回计划列表
            </button>
          </section>
        ) : (
          <section className="iw-card rw-form-card">
            <div className="iw-card-head">
              <div>
                <h2>
                  {editing
                    ? `编辑：${selectedSchedule?.name ?? name}`
                    : "计划设置"}
                </h2>
                <p>仅调整报告发送计划，不会生成或修改报表定义。</p>
              </div>
            </div>
            <form className="rw-form" onSubmit={save}>
              <label>
                计划名称
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                发送周期
                <select
                  value={cadence}
                  onChange={(event) =>
                    setCadence(event.target.value as "daily" | "weekly")
                  }
                >
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                </select>
              </label>
              {cadence === "weekly" && (
                <label>
                  发送日
                  <select
                    value={dayOfWeek}
                    onChange={(event) => setDayOfWeek(event.target.value)}
                  >
                    {weekdays.map((day, index) => (
                      <option value={index} key={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                发送时间
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
              <label>
                时区
                <input
                  required
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
              <div className="rw-form-note">
                渠道状态：
                {channelReady
                  ? "已配置"
                  : channelStatus?.message ||
                    "钉钉渠道未配置；新计划将保存为停用状态。"}
              </div>
              <div className="rw-form-actions">
                <button
                  type="button"
                  className="iw-button iw-secondary"
                  onClick={goList}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  className="iw-button iw-approve"
                  type="submit"
                  disabled={!canManage || saving}
                >
                  {saving ? "保存中…" : "保存并返回列表"}
                </button>
              </div>
              {!canManage && (
                <p className="rw-permission">仅管理员可修改发送计划。</p>
              )}
            </form>
          </section>
        )
      ) : page === "report-schedules" ? (
        <section className="iw-card">
          <div className="iw-card-head">
            <div>
              <h2>已配置计划</h2>
              <p>启停、立即运行或编辑现有计划。</p>
            </div>
            {canManage && (
              <button
                className="iw-button iw-approve"
                onClick={() => {
                  clearEditor();
                  onNavigate("report-schedules-new");
                }}
              >
                新增计划
              </button>
            )}
          </div>
          {loadingSchedules ? (
            <div className="iw-empty">正在加载发送计划…</div>
          ) : schedules.length ? (
            <div className="iw-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>计划</th>
                    <th>周期</th>
                    <th>时间</th>
                    <th>时区</th>
                    <th>状态</th>
                    <th>上次运行</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <b>{item.name}</b>
                      </td>
                      <td>
                        {item.cadence === "weekly"
                          ? `每周${weekdays[Number(item.dayOfWeek ?? 0)]}`
                          : "每天"}
                      </td>
                      <td>{item.time}</td>
                      <td>{item.timezone}</td>
                      <td>
                        <div>{schedulerLabel(item)}</div>
                        {canManage && (
                          <button
                            className={`iw-toggle ${item.enabled ? "is-on" : ""}`}
                            onClick={() =>
                              void update(item, { enabled: !item.enabled })
                            }
                            disabled={!item.enabled && !channelReady}
                            title={
                              !item.enabled && !channelReady
                                ? "请先配置钉钉机器人"
                                : undefined
                            }
                          >
                            {item.enabled
                              ? "已启用（点击停用）"
                              : "已停用（点击启用）"}
                          </button>
                        )}
                      </td>
                      <td>
                        {item.lastRunAt ? (
                          <>
                            <time>
                              {new Date(item.lastRunAt).toLocaleString("zh-CN")}
                            </time>
                            <small>{lastResultLabel(item.lastResult)}</small>
                          </>
                        ) : (
                          "从未运行"
                        )}
                      </td>
                      <td>
                        {canManage ? (
                          <>
                            <button
                              className="iw-icon-action"
                              aria-label={`编辑 ${item.name}`}
                              title="编辑计划"
                              onClick={() => startEdit(item)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="iw-icon-action"
                              aria-label={`立即运行 ${item.name}`}
                              title={
                                !channelReady
                                  ? "请先配置钉钉机器人"
                                  : "立即运行此计划"
                              }
                              disabled={
                                Boolean(runningScheduleId) || !channelReady
                              }
                              onClick={() => void runScheduleNow(item)}
                            >
                              <Play size={14} />
                            </button>
                            <button
                              className="iw-icon-action"
                              aria-label={`删除 ${item.name}`}
                              title="删除计划"
                              onClick={() => setPendingDelete(item)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="iw-empty">
              暂无计划。请先确认固定内置工作区报告及渠道配置；发送计划尚不绑定新增日报定义。
            </div>
          )}
        </section>
      ) : (
        <div className="iw-columns iw-report-columns">
          <section className="iw-card">
            <div className="iw-card-head">
              <div>
                <h2>报告展示</h2>
                <p>{preview?.title || "摘要与文本内容"}</p>
              </div>
              <div className="rw-report-actions">
                <button
                  className="iw-button iw-secondary iw-small"
                  onClick={() => onNavigate("report-definitions")}
                >
                  报表定义
                </button>{" "}
                <button
                  className="iw-button iw-secondary iw-small"
                  onClick={() => onNavigate("report-definitions-new")}
                >
                  新增定义
                </button>{" "}
                {canManage && (
                  <button
                    className="iw-button iw-approve iw-small"
                    onClick={() => void sendNow()}
                    disabled={sending || loadingPreview || !channelReady}
                    title={!channelReady ? "请先配置钉钉机器人" : undefined}
                  >
                    {sending ? "推送中…" : "立即推送"}
                  </button>
                )}{" "}
                <button
                  className="iw-button iw-secondary iw-small"
                  onClick={() => void loadPreview()}
                  disabled={loadingPreview}
                >
                  <RefreshCw size={14} />
                  刷新预览
                </button>
              </div>
            </div>
            {!channelReady && (
              <div className="iw-alert">
                {channelStatus?.message ||
                  "钉钉渠道未配置，无法推送；请先配置机器人。"}
              </div>
            )}
            {sendError && <div className="iw-alert iw-error">{sendError}</div>}
            {sendNotice && (
              <div className="iw-alert iw-success">{sendNotice}</div>
            )}
            {errorPreview && (
              <div className="iw-alert iw-error">{errorPreview}</div>
            )}
            {loadingPreview ? (
              <div className="iw-empty">正在生成预览…</div>
            ) : (
              preview && (
                <>
                  <div className="iw-report-summary">
                    <span>报告摘要</span>
                    <p>
                      {preview.summary ? render(preview.summary) : "暂无摘要"}
                    </p>
                  </div>
                  <div className="iw-report-text">
                    <b>文本预览</b>
                    <pre>
                      {render(preview.text ?? preview.content ?? preview)}
                    </pre>
                  </div>
                </>
              )
            )}
          </section>
          <section className="iw-card rw-schedule-link">
            <div className="iw-card-head">
              <div>
                <h2>
                  <CalendarClock size={17} /> 发送计划
                </h2>
                <p>{schedules.length} 个现有计划</p>
              </div>
            </div>
            <p>计划管理独立于报告预览，可查看状态、运行记录并管理已有计划。</p>
            <button
              className="iw-button iw-secondary"
              onClick={() => onNavigate("report-schedules")}
            >
              查看发送计划
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
