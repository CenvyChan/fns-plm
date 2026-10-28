import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";
import { apiFetch } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import "./daily-report-import.css";

type Kind = "sales" | "purchase";
type PreviewRow = {
  rowNumber: number;
  date: string;
  partyName: string;
  documentNo: string;
  quantity: number;
  currency: string;
  originalAmount: number;
  exchangeRate: number;
  amountCny: number;
  duplicate?: boolean;
};
type ImportError = { rowNumber: number; field: string; message: string };
type Preview = {
  previewId: string;
  kind: Kind;
  rows: PreviewRow[];
  errors: ImportError[];
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  canCommit: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  expiresAt: string;
};
type CommitResult = {
  inserted: number;
  skipped: number;
  batchId?: string;
  dateFrom: string | null;
  dateTo: string | null;
};

const labels: Record<Kind, { title: string; noun: string; listPage: string }> =
  {
    sales: { title: "导入往期销售日报", noun: "销售", listPage: "daily-sales" },
    purchase: {
      title: "导入往期采购日报",
      noun: "采购",
      listPage: "daily-purchase",
    },
  };
const endpoint = (kind: Kind) => `/api/daily-reports/imports/${kind}`;
const formatAmount = (value: number, currency = "") =>
  `${Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
const dateRange = (from?: string | null, to?: string | null) =>
  from && to ? (from === to ? from : `${from} 至 ${to}`) : "—";

async function requestJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null;
  if (!response.ok)
    throw new Error(
      body?.message || body?.error || `请求失败（HTTP ${response.status}）`,
    );
  if (!body) throw new Error("服务器返回内容无法读取，请稍后重试。");
  return body;
}

export default function DailyReportImport({
  kind,
  onNavigate,
}: {
  kind: Kind;
  onNavigate: (page: string) => void;
}) {
  const config = labels[kind];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [rowPage, setRowPage] = useState(1);
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / pageSize));
  const shownRows = useMemo(() => preview?.rows.slice((rowPage - 1) * pageSize, rowPage * pageSize) ?? [], [preview, rowPage]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setPreview(null);
    setResult(null);
    setError("");
  };
  const downloadTemplate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`${endpoint(kind)}/template`);
      if (!response.ok) await requestJson(response);
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(
        /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
      );
      const name = filename
        ? decodeURIComponent(filename[1] || filename[2])
        : `${kind}-daily-report-template.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模板下载失败。");
    } finally {
      setBusy(false);
    }
  };
  const uploadPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !file) {
      if (!file) setError("请先选择 XLSX 或 CSV 文件。");
      return;
    }
    setBusy(true);
    setError("");
    setPreview(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`${endpoint(kind)}/preview`, {
        method: "POST",
        body,
      });
      const data = await requestJson<Preview>(response);
      if (
        data.kind !== kind ||
        !data.previewId ||
        !Array.isArray(data.rows) ||
        !Array.isArray(data.errors)
      )
        throw new Error("预览响应字段不完整或类型不匹配。");
      setRowPage(1);
      setPreview(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件预览失败。");
    } finally {
      setBusy(false);
    }
  };
  const commitImport = async () => {
    if (busy || !preview?.canCommit || preview.errors.length || result) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`${endpoint(kind)}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      setResult(await requestJson<CommitResult>(response));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "正式导入失败；预览仍保留，可修正后重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dr-import" aria-label={`${config.noun}日报导入`}>
      <ConfirmDialog
        open={confirming}
        title={`确认导入往期${config.noun}日报`}
        description={`将“${file?.name ?? ""}”中通过校验的 ${preview?.validRows ?? 0} 行用于当前账套的${config.noun}日报导入，其中重复 ${preview?.duplicateRows ?? 0} 行将跳过。已存在的记录不会被覆盖；发现冲突则整批停止。`}
        confirmLabel="确认正式导入"
        danger={false}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void commitImport();
        }}
      />
      <header className="dr-import-head">
        <div>
          <div className="dr-import-eyebrow">DAILY REPORTING / IMPORT</div>
          <h1>{config.title}</h1>
          <p>先预览并校验文件，确认没有错误后再正式导入。数据写入当前账套。</p>
        </div>
        <div className="dr-import-head-actions">
          <button
            type="button"
            className="dr-import-button secondary"
            onClick={() => onNavigate(config.listPage)}
            disabled={busy}
          >
            <ArrowLeft size={15} />
            返回{config.noun}日报
          </button>
          <button
            type="button"
            className="dr-import-button secondary"
            onClick={() => void downloadTemplate()}
            disabled={busy}
          >
            <Download size={15} />
            下载导入模板
          </button>
        </div>
      </header>
      <aside className="dr-import-help">
        <b>操作说明</b>
        <ol>
          <li>
            建议先下载 XLSX 模板，按模板列名和格式填写；也可上传 XLSX 或 CSV
            文件。
          </li>
          <li>选择单个文件后点击“上传并预览”，检查数据行与错误详情。</li>
          <li>
            仅在校验允许且无错误时可正式导入；正式导入成功后不可重复提交。
          </li>
        </ol>
      </aside>
      <form className="dr-import-card" onSubmit={uploadPreview}>
        <label
          className={`dr-import-drop${file ? " has-file" : ""}`}
          htmlFor="dr-import-file"
        >
          <span className="dr-import-file-icon">
            <FileSpreadsheet size={24} />
          </span>
          <strong>{file ? file.name : "选择或拖入文件"}</strong>
          <span>支持 .xlsx / .csv，一次一个文件</span>
          <input
            ref={fileInput}
            id="dr-import-file"
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={chooseFile}
            disabled={busy}
          />
        </label>
        {file && (
          <div className="dr-import-file-info">
            已选择 {file.name} · {(file.size / 1024).toFixed(1)} KB{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setPreview(null);
                setResult(null);
                setError("");
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              移除文件
            </button>
          </div>
        )}
        <div className="dr-import-actions">
          <button
            className="dr-import-button primary"
            type="submit"
            disabled={busy || !file || Boolean(result)}
          >
            {busy ? (
              <LoaderCircle size={15} className="dr-import-spin" />
            ) : (
              <UploadCloud size={15} />
            )}
            上传并预览
          </button>
          {preview && (
            <button
              className="dr-import-button commit"
              type="button"
              onClick={() => setConfirming(true)}
              disabled={
                busy ||
                !preview.canCommit ||
                preview.errors.length > 0 ||
                Boolean(result)
              }
            >
              <CheckCircle2 size={15} />
              正式导入
            </button>
          )}
        </div>
      </form>
      {error && (
        <div className="dr-import-alert error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="dr-import-alert success" role="status">
          <b>正式导入成功</b>
          <span>
            已入库 {result.inserted} 条；跳过 {result.skipped} 条。日期范围：
            {dateRange(result.dateFrom, result.dateTo)}。
          </span>
          {result.batchId && <span>审计批次：{result.batchId}</span>}
          <button type="button" className="dr-import-button secondary" onClick={() => onNavigate("daily-imports")}>查看导入审计</button>
          <button
            type="button"
            className="dr-import-button secondary"
            onClick={() => {
              if (result.dateFrom) {
                const url = new URL(window.location.href);
                url.searchParams.set("date", result.dateFrom);
                window.history.replaceState({}, "", url);
              }
              onNavigate(config.listPage);
            }}
          >
            查看{config.noun}日报
          </button>
        </div>
      )}
      {preview && (
        <section className="dr-import-preview" aria-live="polite">
          <div className="dr-import-section-head">
            <div>
              <h2>预览与校验</h2>
              <p>
                预览 ID：{preview.previewId} · 有效期至{" "}
                {new Date(preview.expiresAt).toLocaleString("zh-CN")}
              </p>
            </div>
            <span
              className={
                preview.canCommit && preview.errors.length === 0
                  ? "dr-import-badge ready"
                  : "dr-import-badge blocked"
              }
            >
              {preview.canCommit && preview.errors.length === 0
                ? result
                  ? "已完成，预览已使用"
                  : "可正式导入"
                : "需先处理校验问题"}
            </span>
          </div>
          <div className="dr-import-stats">
            <article>
              <small>文件行数</small>
              <b>{preview.totalRows}</b>
            </article>
            <article>
              <small>有效行</small>
              <b>{preview.validRows}</b>
            </article>
            <article>
              <small>重复行</small>
              <b>{preview.duplicateRows}</b>
            </article>
            <article>
              <small>错误数</small>
              <b>{preview.errors.length}</b>
            </article>
            <article>
              <small>日期范围</small>
              <b>{dateRange(preview.dateFrom, preview.dateTo)}</b>
            </article>
          </div>
          {preview.errors.length > 0 && (
            <div className="dr-import-errors">
              <h3>错误列表（共 {preview.errors.length} 项）</h3>
              <div className="dr-import-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>字段</th>
                      <th>错误说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((item, index) => (
                      <tr key={`${item.rowNumber}-${item.field}-${index}`}>
                        <td>{item.rowNumber}</td>
                        <td>{item.field}</td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="dr-import-rows-head">
            <h3>数据行预览</h3>
            <span>
              第 {rowPage} / {pageCount} 页 · 本页 {shownRows.length} / 共 {preview.rows.length} 条（完整错误列表见上方）
            </span>
          </div>
          <div className="dr-import-table-wrap dr-import-data-table">
            <table>
              <thead>
                <tr>
                  <th>行号</th>
                  <th>校验状态</th>
                  <th>日期</th>
                  <th>客户 / 供应商</th>
                  <th>单据编号</th>
                  <th>数量</th>
                  <th>币种</th>
                  <th>原币金额</th>
                  <th>汇率</th>
                  <th>人民币金额</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.length ? (
                  shownRows.map((row, index) => (
                    <tr key={`${row.rowNumber}-${index}`}>
                      <td>{row.rowNumber}</td>
                      <td>{row.duplicate ? "重复 · 将跳过" : "有效行"}</td>
                      <td>{row.date}</td>
                      <td>{row.partyName}</td>
                      <td>{row.documentNo}</td>
                      <td>
                        {Number(row.quantity).toLocaleString("zh-CN", {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td>{row.currency}</td>
                      <td>{formatAmount(row.originalAmount)}</td>
                      <td>
                        {Number(row.exchangeRate).toLocaleString("zh-CN", {
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td>{formatAmount(row.amountCny, "CNY")}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="dr-import-empty">
                      此预览没有可展示的数据行。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className="dr-import-actions" aria-label="导入预览分页">
            <button type="button" className="dr-import-button secondary" disabled={rowPage <= 1} onClick={() => setRowPage(value => value - 1)}>上一页</button>
            <span>第 {rowPage} / {pageCount} 页</span>
            <button type="button" className="dr-import-button secondary" disabled={rowPage >= pageCount} onClick={() => setRowPage(value => value + 1)}>下一页</button>
          </nav>
          <p className="dr-import-readonly">
            此处仅展示服务端预览结果；文件未在浏览器端解析或保存。
          </p>
        </section>
      )}
    </section>
  );
}
