import { useEffect, useId, useState, type ReactNode } from "react";
import { Archive, RefreshCw } from "lucide-react";
import { apiFetch } from "./api";

type DailyKind = "sales" | "purchase";
export type DailyImportBatch = {
  id: string;
  actorId: string;
  actorName?: string;
  scopeKey: string;
  type: DailyKind | "mixed";
  fileName?: string;
  digest: string;
  completedAt: string;
  inserted: number;
  skipped: number;
  dateFrom: string | null;
  dateTo: string | null;
};
const PAGE_SIZE = 20;

export default function DailyReportImportHistory({ migration }: { migration: ReactNode }) {
  const id = useId();
  const [tab, setTab] = useState<"migration" | "daily">("migration");
  const [kind, setKind] = useState<"all" | DailyKind>("all");
  const [page, setPage] = useState(1);
  const [batches, setBatches] = useState<DailyImportBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (tab !== "daily") return;
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (kind !== "all") query.set("type", kind);
    apiFetch(`/api/daily-reports/imports?${query}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { batches?: DailyImportBatch[]; total?: number; error?: string; message?: string } | null;
        if (!response.ok) throw new Error(body?.message || body?.error || `请求失败（HTTP ${response.status}）`);
        if (!body || !Array.isArray(body.batches) || typeof body.total !== "number") throw new Error("日报导入审计接口返回格式无效");
        if (active) { setBatches(body.batches); setTotal(body.total); }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "日报导入审计加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, kind, page, revision]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectKind = (value: "all" | DailyKind) => { setKind(value); setPage(1); };
  return <div className="dr-admin-import-history">
    <div className="dr-admin-tabs" role="tablist" aria-label="导入批次类型">
      <button id={`${id}-migration-tab`} aria-controls={`${id}-migration-panel`} type="button" role="tab" aria-selected={tab === "migration"} className={tab === "migration" ? "is-active" : ""} onClick={() => setTab("migration")}>基础资料迁移批次</button>
      <button id={`${id}-daily-tab`} aria-controls={`${id}-daily-panel`} type="button" role="tab" aria-selected={tab === "daily"} className={tab === "daily" ? "is-active" : ""} onClick={() => setTab("daily")}>销售 / 采购日报批次</button>
    </div>
    {tab === "migration" ? <section id={`${id}-migration-panel`} role="tabpanel" aria-labelledby={`${id}-migration-tab`}>{migration}</section> : <section id={`${id}-daily-panel`} role="tabpanel" aria-labelledby={`${id}-daily-tab`}>
      <h3><Archive size={13} /> 销售 / 采购日报导入审计 · {total} 批</h3>
      <p className="dr-admin-help">只读已完成的导入批次，与基础资料迁移分开；按服务端分页读取全部历史。失败的预览或提交不会标成完成批次；本页不代表另有失败日志。旧入口的混合批次会同时出现在销售和采购筛选中。</p>
      <div className="dr-admin-import-filters" aria-label="日报批次筛选">
        <label>日报类型 <select value={kind} onChange={(event) => selectKind(event.target.value as "all" | DailyKind)}><option value="all">全部</option><option value="sales">销售</option><option value="purchase">采购</option></select></label>
        <button type="button" className="iw-button iw-secondary iw-small" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />刷新日报审计</button>
      </div>
      {loading && <div className="iw-empty" role="status">正在加载日报导入审计…</div>}
      {error && <div className="iw-empty dr-admin-import-error" role="alert">日报导入审计加载失败：{error}</div>}
      {!loading && !error && <><div className="iw-table-wrap dr-admin-table"><table><thead><tr><th>批次 ID / 文件</th><th>类型</th><th>操作者</th><th>完成时间</th><th>SHA-256</th><th>插入 / 跳过</th><th>日期范围</th></tr></thead><tbody>
        {batches.map((batch) => <tr key={batch.id}><td>{batch.id}{batch.fileName && <small>{batch.fileName}</small>}</td><td>{batch.type === "sales" ? "销售" : batch.type === "purchase" ? "采购" : "销售 / 采购"}</td><td>{batch.actorName || batch.actorId || "未记录"}<small>{batch.actorName ? batch.actorId : ""}</small></td><td>{batch.completedAt ? new Date(batch.completedAt).toLocaleString("zh-CN") : "—"}</td><td><code>{batch.digest || "未提供"}</code></td><td>{batch.inserted} / {batch.skipped}</td><td>{batch.dateFrom || "—"} – {batch.dateTo || "—"}</td></tr>)}
      </tbody></table>{!batches.length && <div className="iw-empty">暂无符合筛选条件的日报导入审计记录。</div>}</div>
      <div className="dr-admin-pagination" aria-label="日报批次分页"><button type="button" className="iw-button iw-secondary iw-small" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button><span>第 {page} / {pageCount} 页 · 共 {total} 批</span><button type="button" className="iw-button iw-secondary iw-small" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>下一页</button></div></>}
    </section>}
  </div>;
}
