import { useId } from "react";
import "./daily-analysis-charts.css";

export type DailyAnalysisPoint = { period: string; count: number; quantity: number; amountCny: number };
export type DailyAnalysisCounterpart = { label: string; count: number; quantity: number; amountCny: number };
type Props = {
  kind: "sales" | "purchase";
  dailyTrend: DailyAnalysisPoint[];
  monthlyTrend: DailyAnalysisPoint[];
  counterpartRank: DailyAnalysisCounterpart[];
};

type MetricPoint = { label: string; value: number; count: number; quantity: number };
const money = (value: number) => `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (value: number) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
const axisMoney = (value: number) => {
  const magnitude = Math.abs(value), unit = magnitude >= 1e8 ? 1e8 : magnitude >= 1e4 ? 1e4 : 1;
  return `${value < 0 ? "−" : ""}¥${(magnitude / unit).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit === 1e8 ? "亿" : unit === 1e4 ? "万" : ""}`;
};

function DataTable({ title, points }: { title: string; points: MetricPoint[] }) {
  return <details className="dac-details">
    <summary>展开完整数据表（{points.length} 项）</summary>
    <div className="dac-table-wrap"><table><caption>{title}完整数据；金额为折合人民币</caption><thead><tr><th scope="col">期间 / 名称</th><th scope="col">记录数</th><th scope="col">数量</th><th scope="col">折合人民币</th></tr></thead>
      <tbody>{points.map((point, index) => <tr key={`${point.label}-${index}`}><th scope="row">{point.label || "（未命名）"}</th><td>{point.count}</td><td>{quantity(point.quantity)}</td><td>{money(point.value)}</td></tr>)}</tbody>
    </table>{!points.length && <p className="dac-empty">当前筛选没有数据。</p>}</div>
  </details>;
}

function TrendChart({ title, points, color, gradientId, description }: { title: string; points: MetricPoint[]; color: string; gradientId: string; description: string }) {
  const width = 720, height = 260, left = 68, right = 18, top = 18, bottom = 58;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = points.map(point => point.value);
  const minValue = Math.min(0, ...values), maxValue = Math.max(0, ...values);
  const span = maxValue - minValue;
  const y = (value: number) => top + (span === 0 ? plotH / 2 : (maxValue - value) / span * plotH);
  const x = (index: number) => points.length <= 1 ? left + plotW / 2 : left + index * plotW / (points.length - 1);
  const zeroY = y(0);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`).join(" ");
  const area = points.length > 1 ? `${line} L${x(points.length - 1)},${zeroY} L${x(0)},${zeroY} Z` : "";
  const tickValues = span === 0 ? [0] : [minValue, minValue + span / 4, minValue + span / 2, minValue + span * 3 / 4, maxValue, 0].filter((v, i, arr) => arr.findIndex(n => Math.abs(v - n) < 1e-9) === i);
  const labelIndices = points.length <= 6 ? points.map((_, i) => i) : [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  const chartLabel = `${title}；纵轴为折合人民币金额；${description}`;
  return <section className="dac-card" aria-label={title}>
    <h3>{title}</h3><p className="dac-note">金额纵轴以零为基线，负值按实际方向显示；日期仅显示有记录期间，点位按分类均匀排列，非连续时间比例。</p>
    <div className="dac-svg-scroll"><svg className="dac-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chartLabel}>
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".24"/><stop offset="100%" stopColor={color} stopOpacity=".025"/></linearGradient></defs>
      {tickValues.map((value, index) => <g key={`${value}-${index}`}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className={value === 0 ? "dac-zero" : "dac-gridline"}/><text x={left - 9} y={y(value) + 4} textAnchor="end" className="dac-axis-label">{axisMoney(value)}</text></g>)}
      {area && <path d={area} fill={`url(#${gradientId})`}/>}
      {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>}
      {points.map((point, index) => <g key={`${point.label}-${index}`}><circle cx={x(index)} cy={y(point.value)} r="4" fill={color} stroke="white" strokeWidth="1.5"/><title>{`${point.label}：${money(point.value)}，${point.count} 条，数量 ${quantity(point.quantity)}`}</title></g>)}
      {labelIndices.map(index => <text key={index} x={x(index)} y={height - 31} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="dac-axis-label">{points[index]?.label}</text>)}
    </svg></div>
    {!points.length && <p className="dac-empty">当前筛选没有数据。</p>}
    <DataTable title={title} points={points}/>
  </section>;
}

function RankChart({ title, points }: { title: string; points: MetricPoint[] }) {
  const width = 720, left = 216, right = 106, top = 14, rowHeight = 38;
  const height = Math.max(88, top + points.length * rowHeight + 24);
  const min = Math.min(0, ...points.map(point => point.value)), max = Math.max(0, ...points.map(point => point.value));
  const span = max - min;
  const axisX = (value: number) => left + (span === 0 ? 0 : (value - min) / span * (width - left - right));
  const zeroX = axisX(0);
  return <section className="dac-card" aria-label={title}>
    <h3>{title}</h3><p className="dac-note">按接口返回排名顺序展示；横轴为折合人民币金额，零基线支持负值。</p>
    <div className="dac-svg-scroll"><svg className="dac-svg dac-rank-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}横向柱状图；横轴金额为折合人民币，零基线，完整数据可展开查看`}>
      <line x1={zeroX} x2={zeroX} y1={top} y2={height - 12} className="dac-zero"/>
      {points.map((point, index) => {
        const cy = top + index * rowHeight + 15, endX = axisX(point.value), barX = Math.min(zeroX, endX), barWidth = Math.abs(endX - zeroX);
        const label = point.label || "（未命名）";
        return <g key={`${label}-${index}`}><text x={left - 12} y={cy + 4} textAnchor="end" className="dac-rank-label"><title>{label}</title>{label.length > 19 ? `${label.slice(0, 18)}…` : label}</text><rect x={barX} y={cy - 9} width={barWidth} height="18" rx="3" className="dac-bar"/><text x={width - right + 8} y={cy + 4} textAnchor="start" className="dac-value-label">{money(point.value)}</text><title>{`${label}：${money(point.value)}，${point.count} 条，数量 ${quantity(point.quantity)}`}</title></g>;
      })}
    </svg></div>
    {!points.length && <p className="dac-empty">当前筛选没有数据。</p>}
    <DataTable title={title} points={points}/>
  </section>;
}

export default function DailyAnalysisCharts({ kind, dailyTrend, monthlyTrend, counterpartRank }: Props) {
  const id = useId().replace(/:/g, "");
  const counterpartTitle = kind === "sales" ? "客户排名（前10）" : "供应商排名（前10）";
  const mapTrend = (rows: DailyAnalysisPoint[]): MetricPoint[] => rows.map(row => ({ label: row.period, value: row.amountCny, count: row.count, quantity: row.quantity }));
  const rank = counterpartRank.map(row => ({ label: row.label, value: row.amountCny, count: row.count, quantity: row.quantity }));
  return <div className="dac-grid" aria-label="日报金额趋势与客商排名">
    <TrendChart title="按日趋势" points={mapTrend(dailyTrend)} color="#10a6b8" gradientId={`dac-day-${id}`} description="日期以接口现有数据点为准。"/>
    <TrendChart title="按月趋势" points={mapTrend(monthlyTrend)} color="#7961c7" gradientId={`dac-month-${id}`} description="月份以接口现有数据点为准。"/>
    <RankChart title={counterpartTitle} points={rank}/>
  </div>;
}
