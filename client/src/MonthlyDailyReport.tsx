import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Search, CalendarDays } from 'lucide-react';
import { apiFetch } from './api';
import './monthly-daily-report.css';

type Kind = 'sales' | 'purchase';
type View = 'both' | Kind;
type Metric = { count: number; quantity: number; amountCny: number };
type Business = { system: Metric; k3: Metric; difference: number | null };
type Day = { date: string; sales?: Business; purchase?: Business };
type Monthly = { month: string; days: Day[]; totals: { sales?: Business; purchase?: Business }; access: { sales: boolean; purchase: boolean }; mockEnabled: boolean; notice: string; amountBasis: string; k3Available: boolean; k3AvailableByType?: Partial<Record<Kind, boolean>> };
const money = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (value: number | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 6 });
function initialMonth() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const selected = params.get('month') ?? params.get('date')?.slice(0, 7);
  if (selected && /^(2\d{3})-(0[1-9]|1[0-2])$/.test(selected)) return selected;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.message || body?.error || `请求失败（HTTP ${response.status}）`;
}
export default function MonthlyDailyReport({ filterScopeKey }: { filterScopeKey?: string }) {
  const [draftMonth, setDraftMonth] = useState(initialMonth);
  const [appliedMonth, setAppliedMonth] = useState(initialMonth);
  const [view, setView] = useState<View>('both');
  const [data, setData] = useState<Monthly | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async (month: string) => {
    const id = ++sequence.current;
    setLoading(true); setData(null); setError(''); setExportError('');
    try {
      const response = await apiFetch(`/api/daily-reports/monthly?month=${encodeURIComponent(month)}`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const next = await response.json() as Monthly;
      if (id !== sequence.current) return;
      setData(next); setAppliedMonth(month);
      setView(current => current === 'sales' && !next.access.sales ? 'both' : current === 'purchase' && !next.access.purchase ? 'both' : current);
      const url = new URL(window.location.href); url.searchParams.set('month', month); window.history.replaceState({}, '', url);
    } catch (cause) {
      if (id === sequence.current) setError(cause instanceof Error ? cause.message : '月度数据加载失败');
    } finally { if (id === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(initialMonth()); return () => { sequence.current++; }; }, [load, filterScopeKey]);
  const submit = () => {
    if (!/^(2\d{3})-(0[1-9]|1[0-2])$/.test(draftMonth)) { setError('请选择 2000—2999 年范围内的有效月份。'); return; }
    void load(draftMonth);
  };
  const download = async () => {
    setExporting(true); setExportError('');
    try {
      const response = await apiFetch(`/api/daily-reports/monthly/export.xlsx?month=${encodeURIComponent(appliedMonth)}`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `月度采销逐日汇总-${appliedMonth}.xlsx`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : '导出失败，请重试。'); }
    finally { setExporting(false); }
  };
  const kinds = (['purchase', 'sales'] as Kind[]).filter(kind => data?.access[kind]);
  const compare = view !== 'both';
  const selected = data && view !== 'both' ? data.totals[view] : undefined;
  const monthLabel = `${Number(appliedMonth.slice(0, 4))} 年 ${Number(appliedMonth.slice(5))} 月`;
  const label = (kind: Kind) => kind === 'purchase' ? '采购' : '销售';
  const available = compare ? data?.k3AvailableByType?.[view as Kind] ?? data?.k3Available : data?.k3Available;
  const compareCells = (business?: Business) => <>
    <td className="mdr-system">{business?.system.count ?? '—'}</td><td className="mdr-quantity">{quantity(business?.system.quantity)}</td><td className="mdr-system">{money(business?.system.amountCny)}</td>
    <td>{available ? business?.k3.count ?? '—' : '—'}</td><td>{available ? quantity(business?.k3.quantity) : '—'}</td><td>{available ? money(business?.k3.amountCny) : '—'}</td>
    <td className={business?.difference ? 'mdr-difference' : ''}>{available ? money(business?.difference) : '—'}</td>
  </>;
  const bothCells = (row: Pick<Day, Kind>) => kinds.map(kind => <FragmentCells key={kind} business={row[kind]} kind={kind} />);
  return <section className="mdr" aria-label="月度采购与销售逐日汇总">
    <header className="mdr-header"><div><div className="mdr-eyebrow">经营日报 / 月度逐日汇总</div><h1>{compare ? '系统数据 ↔ 金蝶逐日核对' : '月度采购与销售汇总'}</h1><p>{monthLabel} · {compare ? `${label(view as Kind)}${view === 'sales' ? '出库' : '入库'}核对` : '全部日期，一天一行'} · 金额单位：人民币元</p></div>
      <button type="button" onClick={() => void download()} disabled={!data || loading || exporting}><Download size={15} />{exporting ? '正在导出…' : '导出月度 Excel'}</button></header>
    <div className="mdr-filters" role="search" aria-label="月度查询条件" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}>
      <label>查看<select aria-label="查看内容" value={view} onChange={event => setView(event.target.value as View)}><option value="both">采购与销售</option>{(!data || data.access.sales) && <option value="sales">销售出库核对</option>}{(!data || data.access.purchase) && <option value="purchase">采购入库核对</option>}</select></label>
      <label>月份<input aria-label="汇总月份" type="month" min="2000-01" max="2999-12" required value={draftMonth} onChange={event => setDraftMonth(event.target.value)} /></label>
      <button className="mdr-primary" type="button" onClick={submit} disabled={loading}><Search size={15} />{loading ? '查询中…' : '查询'}</button><span>整月展示，不分页</span>
    </div>
    {loading && <div className="mdr-state" role="status">正在读取所选月份的已保存数据…</div>}
    {error && <div className="mdr-state mdr-error" role="alert">{error}<button type="button" onClick={() => void load(draftMonth)}>重试</button></div>}
    {exportError && <p className="mdr-error" role="alert">{exportError}</p>}
    {data && !loading && <>
      <div className="mdr-cards">
        {compare ? <><SummaryCard title="系统金额合计" value={money(selected?.system.amountCny)} detail={`系统笔数 ${selected?.system.count ?? 0} · 数量 ${quantity(selected?.system.quantity)}`} /><SummaryCard title="金蝶金额合计" value={available ? money(selected?.k3.amountCny) : '—'} detail={available ? `金蝶单据 ${selected?.k3.count ?? 0} · 数量 ${quantity(selected?.k3.quantity)}` : '当前没有可用快照，不能按零金额判断'} /><SummaryCard title="金额差（系统 − 金蝶）" value={available ? money(selected?.difference) : '—'} detail="逐日差异见下表；差额不等于漏单结论" accent /></> : <>
          <SummaryCard title="本月采购费用" value={data.access.purchase ? money(data.totals.purchase?.system.amountCny) : '—'} detail={data.access.purchase ? `采购 ${data.totals.purchase?.system.count ?? 0} 笔 · 已保存日报` : '未授权采购数据'} />
          <SummaryCard title="本月销售金额" value={data.access.sales ? money(data.totals.sales?.system.amountCny) : '—'} detail={data.access.sales ? `销售 ${data.totals.sales?.system.count ?? 0} 笔 · 已保存日报` : '未授权销售数据'} />
          <SummaryCard title="本月日报笔数" value={String(kinds.reduce((sum, kind) => sum + (data.totals[kind]?.system.count ?? 0), 0))} detail={`${data.days.length} 个自然日 · 无记录日期也展示`} accent />
        </>}
      </div>
      <div className={`mdr-notice${data.mockEnabled ? ' mdr-mock' : ''}`}><b>{data.mockEnabled ? '本地隔离演示 · 非真实业务数据。' : '当前账套已保存数据。'}</b> {data.notice}<br />{compare ? '系统侧为日报人民币金额，金蝶侧为出/入库发生额（可能含税）；差额仅供人工核查，不使用关联分摊金额。' : '采购费用指采购日报人民币金额，不代表实际付款；销售金额来自销售日报，不代表收款。'} {data.amountBasis}{!available && ' 金蝶快照未提供，核对列显示“—”，不视为零发生额。'}</div>
      <div className="mdr-table-scroll" tabIndex={0} role="region" aria-label={compare ? '整月逐日核对表' : '整月逐日采销表'}>
        <table className="mdr-table"><caption>{monthLabel} · {compare ? `${label(view as Kind)}逐日核对` : '采购与销售逐日汇总'} · 共 {data.days.length} 天</caption>
          <thead>{compare ? <tr><th scope="col">日期</th><th scope="col">系统笔数</th><th scope="col">系统数量</th><th scope="col">系统金额</th><th scope="col">金蝶单据</th><th scope="col">金蝶数量</th><th scope="col">金蝶金额</th><th scope="col">金额差</th></tr> : <><tr><th scope="col" rowSpan={2}>日期</th>{kinds.map(kind => <th key={kind} scope="colgroup" colSpan={3} className={`mdr-${kind}-heading`}>{label(kind)}数据</th>)}</tr><tr>{kinds.map(kind => <ThreeHeaders key={kind} kind={kind} />)}</tr></>}</thead>
          <tbody>{data.days.map(row => {
            const hasData = kinds.some(kind => (row[kind]?.system.count ?? 0) > 0 || (available && (row[kind]?.k3.count ?? 0) > 0));
            return <tr key={row.date} className={hasData ? '' : 'mdr-empty-day'}><th scope="row">{row.date}</th>{compare ? compareCells(row[view as Kind]) : bothCells(row)}</tr>;
          })}</tbody><tfoot><tr><th scope="row">月度合计</th>{compare ? compareCells(selected) : bothCells(data.totals)}</tr></tfoot>
        </table>
      </div><p className="mdr-footnote">{compare ? '金蝶侧读取本地已保存快照，不触发 ERP 同步；数量可能跨计量单位，合计仅供参考。' : '日报无记录显示 0；退款、退货等负数调整保留符号。切换“销售出库核对”或“采购入库核对”可查看截图式逐日差额。'}</p>
    </>}
  </section>;
}
function SummaryCard({ title, value, detail, accent = false }: { title: string; value: string; detail: string; accent?: boolean }) {
  return <article className={`mdr-card${accent ? ' mdr-accent' : ''}`}><div>{title}<CalendarDays size={15} /></div><strong>{value}</strong><small>{detail}</small></article>;
}
function ThreeHeaders({ kind }: { kind: Kind }) { return <><th scope="col">笔数</th><th scope="col">数量</th><th scope="col">{kind === 'purchase' ? '采购费用' : '销售金额'}</th></>; }
function FragmentCells({ business, kind }: { business?: Business; kind: Kind }) { return <><td>{business?.system.count ?? '—'}</td><td className="mdr-quantity">{quantity(business?.system.quantity)}</td><td className={`mdr-${kind}-amount`}>{money(business?.system.amountCny)}</td></>; }
