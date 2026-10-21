import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, FileText, Pencil, Plus, RefreshCw } from "lucide-react";
import { apiFetch } from "./api";
import "./reports-workbench.css";

type Definition = {
  id: string;
  name: string;
  template: "daily-sales" | "daily-purchase";
  filters: { from?: string; to?: string; partyName?: string };
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};
type Preview = {
  source: "local-mock" | "workspace";
  notice: string;
  amountBasis: string;
  definition: Definition;
  rows: {
    id: string;
    date: string;
    partyName: string;
    documentNo: string;
    quantity: number;
    amountCny: number;
    currency: string;
    originalAmount: number;
  }[];
  summary: { count: number; quantity: number; amountCny: number };
  generatedAt: string;
};
type Props = {
  page: string;
  onNavigate: (page: string) => void;
  canManage: boolean;
};
const errorMessage = async (r: Response, fallback: string) => {
  const b = (await r.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  return b?.message || b?.error || `${fallback}（HTTP ${r.status}）`;
};
const basePath = "/api/report-definitions";
export default function ReportDefinitionsWorkbench({
  page,
  onNavigate,
  canManage,
}: Props) {
  const [definitions, setDefinitions] = useState<Definition[]>([]),
    [selected, setSelected] = useState<Definition | null>(null),
    [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState(""),
    [template, setTemplate] = useState<Definition["template"]>("daily-sales"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [partyName, setPartyName] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const search = typeof window === "undefined" ? "" : window.location.search;
  const params = useMemo(() => new URLSearchParams(search), [page, search]);
  const editing = page === "report-definitions-edit",
    creating = page === "report-definitions-new",
    id = params.get("definitionId");
  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch(basePath);
      if (!r.ok) throw new Error(await errorMessage(r, "定义列表加载失败"));
      const b = (await r.json()) as { definitions: Definition[] };
      setDefinitions(b.definitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "定义列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  const loadDetail = useCallback(async (target: string) => {
    setLoading(true);
    setError("");
    try {
      const r = await apiFetch(`${basePath}/${encodeURIComponent(target)}`);
      if (!r.ok) throw new Error(await errorMessage(r, "定义加载失败"));
      const d = (await r.json()) as Definition;
      setSelected(d);
      setName(d.name);
      setTemplate(d.template);
      setFrom(d.filters.from ?? "");
      setTo(d.filters.to ?? "");
      setPartyName(d.filters.partyName ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "定义加载失败");
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadPreview = useCallback(async (target: string) => {
    setPreview(null);
    setError("");
    try {
      const r = await apiFetch(
        `${basePath}/${encodeURIComponent(target)}/preview`,
      );
      if (!r.ok) throw new Error(await errorMessage(r, "预览加载失败"));
      setPreview((await r.json()) as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览加载失败");
    }
  }, []);
  useEffect(() => {
    if (editing && id) {
      void loadDetail(id);
      void loadPreview(id);
    } else {
      setSelected(null);
      setPreview(null);
      if (creating) {
        setName("");
        setFrom("");
        setTo("");
        setPartyName("");
        setTemplate("daily-sales");
      } else {
        void loadList();
        setName("");
        setFrom("");
        setTo("");
        setPartyName("");
        setTemplate("daily-sales");
      }
    }
  }, [page, id, editing, creating, loadDetail, loadList, loadPreview]);
  const navigate = (p: string, target?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", p);
    if (target) url.searchParams.set("definitionId", target);
    else url.searchParams.delete("definitionId");
    window.history.pushState({}, "", url);
    onNavigate(p);
  };
  const openEdit = (d: Definition) => navigate("report-definitions-edit", d.id);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const filters = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(partyName.trim() ? { partyName: partyName.trim() } : {}),
    };
    try {
      let r: Response;
      if (editing) {
        if (!selected) throw new Error("定义尚未加载");
        r = await apiFetch(`${basePath}/${encodeURIComponent(selected.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            template,
            filters,
            expectedVersion: selected.version,
          }),
        });
      } else {
        r = await apiFetch(basePath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), template, filters }),
        });
      }
      if (r.status === 409)
        throw new Error(
          await errorMessage(
            r,
            "定义已被其他管理员更新（409），请重新加载后再试",
          ),
        );
      if (!r.ok) throw new Error(await errorMessage(r, "保存定义失败"));
      const saved = (await r.json()) as Definition;
      // Confirm persisted state from server, then refresh list rather than treating mutation response as local truth.
      const confirm = await apiFetch(
        `${basePath}/${encodeURIComponent(saved.id)}`,
      );
      if (!confirm.ok)
        throw new Error(
          await errorMessage(confirm, "保存成功，但无法重新读取定义"),
        );
      const confirmed = (await confirm.json()) as Definition;
      await loadList();
      setNotice("定义已保存并从服务端重新确认。");
      navigate("report-definitions");
      setSelected(confirmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存定义失败");
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    setError("");
    setNotice("");
    setSelected(null);
    setPreview(null);
    setName("");
    setTemplate("daily-sales");
    setFrom("");
    setTo("");
    setPartyName("");
    navigate("report-definitions-new");
  };
  return (
    <section className="iw-page">
      <header className="iw-heading">
        <div>
          <div className="iw-eyebrow">经营分析 / REPORTING</div>
          <h1>
            {editing ? "编辑报表定义" : creating ? "新增报表定义" : "报表定义"}
          </h1>
          <p>
            {editing || creating
              ? "固定销售/采购日报模板；筛选条件用于后续预览，不会改写历史记录。"
              : "当前租户、组织和账套共享的日报定义；数据行依服务端业务线权限返回。"}
          </p>
        </div>
      </header>
      {error && (
        <div className="iw-alert iw-alert-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="iw-alert" role="status" data-feedback="transient">
          {notice}
        </div>
      )}
      {editing || creating ? (
        <>
          <div className="iw-card rw-form-card">
            <button
              type="button"
              className="iw-button iw-secondary"
              onClick={() => navigate("report-definitions")}
            >
              <ArrowLeft size={15} />
              返回列表
            </button>
            {editing && !id && (
              <div className="iw-alert iw-alert-error" role="alert">
                缺少 definitionId，无法编辑报表定义。
                <button
                  type="button"
                  className="iw-button iw-secondary"
                  onClick={() => navigate("report-definitions")}
                >
                  返回定义列表
                </button>
              </div>
            )}
            {editing && id && error && (
              <button
                type="button"
                className="iw-button iw-secondary"
                onClick={() => {
                  setError("");
                  void loadDetail(id);
                  void loadPreview(id);
                }}
                disabled={loading}
              >
                重新加载定义
              </button>
            )}
            {loading && <p>正在加载定义…</p>}
            {(!editing || selected) && (
              <form className="rw-form" onSubmit={save}>
                <label>
                  定义名称
                  <input
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：华东销售日报"
                  />
                </label>
                <label>
                  日报模板
                  <select
                    value={template}
                    onChange={(e) =>
                      setTemplate(e.target.value as Definition["template"])
                    }
                  >
                    <option value="daily-sales">销售日报</option>
                    <option value="daily-purchase">采购日报</option>
                  </select>
                </label>
                <label>
                  开始日期
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  结束日期
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <label>
                  客商名称（精确匹配）
                  <input
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    placeholder="可留空"
                  />
                </label>
                <p className="rw-form-note">
                  模板与名称、筛选条件持久化；编辑仅影响未来预览。历史报告不变。当前版本：
                  {selected?.version ?? "新建"}
                </p>
                {!canManage && (
                  <p className="rw-permission">仅管理员可维护定义。</p>
                )}
                <div className="rw-form-actions">
                  <button
                    className="iw-button iw-secondary"
                    type="button"
                    onClick={() => navigate("report-definitions")}
                  >
                    取消
                  </button>
                  <button
                    className="iw-button iw-primary"
                    disabled={!canManage || busy || loading}
                  >
                    {busy ? "保存中…" : "保存定义"}
                  </button>
                </div>
              </form>
            )}
          </div>
          {preview && <PreviewPanel preview={preview} />}
        </>
      ) : (
        <>
          <div className="rw-report-actions">
            {canManage && (
              <button className="iw-button iw-primary" onClick={create}>
                <Plus size={15} />
                新增定义
              </button>
            )}
            <button
              className="iw-button iw-secondary"
              onClick={() => void loadList()}
              disabled={loading}
            >
              <RefreshCw size={14} />
              刷新
            </button>
          </div>
          {loading ? (
            <p>正在加载定义…</p>
          ) : (
            <div className="rw-definition-list">
              {definitions.map((d) => (
                <article key={d.id}>
                  <div>
                    <FileText size={20} />
                    <div>
                      <h3>{d.name}</h3>
                      <p>
                        {d.template === "daily-sales" ? "销售日报" : "采购日报"}{" "}
                        · {d.filters.from || "不限开始"} 至{" "}
                        {d.filters.to || "不限结束"}
                        {d.filters.partyName
                          ? ` · 客商：${d.filters.partyName}`
                          : ""}
                      </p>
                      <small>
                        版本 {d.version} · 更新于{" "}
                        {new Date(d.updatedAt).toLocaleString()}
                      </small>
                    </div>
                  </div>
                  <div className="rw-report-actions">
                    <button
                      className="iw-button iw-secondary"
                      onClick={() => {
                        setSelected(d);
                        void loadPreview(d.id);
                      }}
                    >
                      预览
                    </button>
                    {canManage && (
                      <button
                        className="iw-button iw-secondary"
                        onClick={() => openEdit(d)}
                      >
                        <Pencil size={14} />
                        编辑
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!definitions.length && (
                <div className="iw-card">
                  {error
                    ? "暂时无法显示定义。"
                    : "暂无报表定义。管理员可新增销售或采购日报定义。"}
                </div>
              )}
            </div>
          )}
          {selected && preview && !loading && !error && (
            <PreviewPanel preview={preview} />
          )}
        </>
      )}
    </section>
  );
}
function PreviewPanel({ preview: p }: { preview: Preview }) {
  return (
    <section className="iw-card" style={{ marginTop: 16 }}>
      <h2>{p.definition.name} · 预览</h2>
      {p.source === "local-mock" && (
        <div className="iw-alert" role="note">
          演示数据提示：{p.notice}
        </div>
      )}
      {p.source === "workspace" && p.notice && <p role="note">{p.notice}</p>}
      <p>金额与数量口径：{p.amountBasis}</p>
      <div className="iw-stats">
        <div>
          <b>{p.summary.count}</b>
          <span>单据数</span>
        </div>
        <div>
          <b>{p.summary.quantity}</b>
          <span>数量</span>
        </div>
        <div>
          <b>{p.summary.amountCny.toLocaleString()}</b>
          <span>金额（CNY）</span>
        </div>
      </div>
      <p>
        生成于 {new Date(p.generatedAt).toLocaleString()} ·
        仅预览当前数据，编辑定义不会改写历史。
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="iw-table">
          <thead>
            <tr>
              {[
                "日期",
                "客商",
                "单据号",
                "数量",
                "金额（CNY）",
                "原币金额",
                "币种",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.partyName}</td>
                <td>{r.documentNo}</td>
                <td>{r.quantity}</td>
                <td>{r.amountCny.toLocaleString()}</td>
                <td>{r.originalAmount.toLocaleString()}</td>
                <td>{r.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
