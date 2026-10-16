import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Database, Download, FileClock, RefreshCw, Save, Send, ShieldCheck, Upload, Wallet } from 'lucide-react'
import { apiFetch } from './api'
import DailyReportingManagement from './DailyReportingManagement'
import './daily-reporting.css'

type Kind = 'sales' | 'purchase'
type Channel = 'email' | 'dingtalk'
type Link = { id: string; k3RowId: string; allocatedAmount: number; allocatedQuantity: number; k3Row?: K3Row }
type DailyReport = { id: string; type: Kind; date: string; partyName: string; partyId?: string; documentNo: string; quantity: number; currency: string; originalAmount: number; exchangeRate: number; amountCny: number; note: string; createdAt: string; createdByName: string; allocatedAmount: number; links: Link[]; canEdit?: boolean }
type PartyOption = { id: string; kind: 'customer' | 'supplier'; name: string; aliases: string[]; active: boolean; k3Number: string }
type MonthlyRate = { month: string; rate: string; currency: string; targetCurrency: string }
type K3Row = { id: string; kind: string; type: Kind; billNo: string; date: string; partyName: string; materialName: string; quantity: number; unit: string; unitPrice?: number; currency: string; originalAmount: number; amountCny: number; settledAmountCny: number; taxAmountCny?: number; outstandingAmountCny?: number; status: string; upstreamId?: string; upstreamBillNo?: string; modifiedAt?: string; linkedDocuments?: Array<{ id: string; kind: string; billNo: string; date: string; partyName: string; materialName: string; quantity: number; unit: string; unitPrice?: number; currency: string; amountCny: number; status: string }>; allocatedAmount: number; remainingAmount: number; overAllocatedAmount: number; related?: Array<{ reportId: string; reportDate: string | null; allocatedAmount: number }> }
type Reconciliation = { dailyCoverage: { reportCount: number; totalAmount: number; coveredAmount: number; coverageRate: number | null }; monthDifference: { systemAmount: number; k3Amount: number; difference: number; differenceRate: number | null; isComplete: boolean }; yearDifference: { systemAmount: number; k3Amount: number; difference: number; differenceRate: number | null; isComplete: boolean }; k3Allocation: { rowCount: number; originalAmount: number; allocatedAmount: number; remainingAmount: number; overAllocatedAmount: number; crossDateCount: number } }
type Summary = { reportDate: string; source: string; isMock: boolean; liveErpConnected: boolean; mockSnapshotAt?: string | null; k3Sync?: { lastSyncedAt: string; rowCounts: Record<string, number>; changedRowCounts?: Record<string, number>; mode?: 'full' | 'incremental' | 'mixed'; incrementalFrom?: string | null } | null; notice: string; access?: { sales: boolean; purchase: boolean; canManage: boolean; canWrite: boolean }; sales?: { daily: { count: number; quantity: number; amountCny: number }; reconciliation: Reconciliation }; purchase?: { daily: { count: number; quantity: number; amountCny: number }; reconciliation: Reconciliation }; orders: { sales: { count: number; amountCny: number; rows: K3Row[] }; purchase: { count: number; amountCny: number; rows: K3Row[] } }; fulfillment: { sales: { count: number; amountCny: number; rows: K3Row[] }; purchase: { count: number; amountCny: number; rows: K3Row[] } }; invoices: { sales: { count: number; amountCny: number; rows: K3Row[] }; purchase: { count: number; amountCny: number; rows: K3Row[] } }; balances: { receivables: { count: number; documentAmountCny: number; settledAmountCny: number; outstandingAmountCny: number; rows: K3Row[] }; payables: { count: number; documentAmountCny: number; settledAmountCny: number; outstandingAmountCny: number; rows: K3Row[] } }; warnings: Array<{ type: string; billNo: string; overAllocatedAmount: number; crossDate: boolean }> }
type Snapshot = { id: string; reportDate: string; scope: string; version: number; createdAt: string; source: string; isComplete: boolean; warnings: string[] }
type Delivery = { id: string; channel: Channel; status: string; message: string; createdAt: string }
type Correction = { id: string; originalDate: string; type: string; affectedReport: Kind; referenceId: string; originalValue: number | null; newValue: number | null; diffAmount: number; reason: string; detectedAt: string; reportedInSnapshotId: string | null }
type DraftLink = { k3RowId: string; allocatedAmount: number; allocatedQuantity: number }
type FormState = { type: Kind; date: string; partyName: string; partyId: string; documentNo: string; quantity: string; currency: string; originalAmount: string; exchangeRate: string; note: string }
type DailyImportRow = { line: number; status: 'invalid' | 'duplicate' | 'ready'; data?: Partial<DailyReport>; errors: string[]; duplicateReason?: 'existing' | 'same_batch' }
type DailyImportPreview = { previewId: string; fileName: string; expiresAt: string; headers: string[]; mappedFields: string[]; totalRows: number; validRows: number; duplicateRows: number; importableRows: number; errorRows: number; rows: DailyImportRow[] }

const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const initialDay = () => { const value = new Date(); value.setDate(value.getDate() - 1); return day(value) }
const money = (value: number | null | undefined) => value == null ? '—' : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN') : '—'
const defaultForm = (date: string, type: Kind = 'sales'): FormState => ({ type, date, partyName: '', partyId: '', documentNo: '', quantity: '', currency: 'CNY', originalAmount: '', exchangeRate: '1', note: '' })

async function apiError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
  return body?.message || body?.error || `${fallback}（HTTP ${response.status}）`
}
async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url)
  if (!response.ok) throw new Error(await apiError(response, '加载失败'))
  return response.json() as Promise<T>
}

export default function DailyReportingWorkbench() {
  const [reportDate, setReportDate] = useState(initialDay)
  const [reports, setReports] = useState<DailyReport[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<K3Row[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [mockEnabled, setMockEnabled] = useState(false)
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([])
  const [masterDataConfigured, setMasterDataConfigured] = useState(false)
  const [monthlyRates, setMonthlyRates] = useState<MonthlyRate[]>([])
  const [form, setForm] = useState<FormState>(() => defaultForm(initialDay()))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState('')
  const [draftLinks, setDraftLinks] = useState<Record<string, DraftLink>>({})
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('')
  const [channel, setChannel] = useState<Channel>('dingtalk')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [importType, setImportType] = useState<Kind>('sales')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<DailyImportPreview | null>(null)
  const [importInputKey, setImportInputKey] = useState(0)

  const selectedReport = useMemo(() => reports.find(report => report.id === selectedReportId), [reports, selectedReportId])
  const reconciliation = selectedReport?.type === 'purchase' ? summary?.purchase?.reconciliation : summary?.sales?.reconciliation
  const hasK3Snapshot = Boolean(summary?.mockSnapshotAt || summary?.k3Sync?.lastSyncedAt)
  const canViewSales = summary?.access?.sales ?? true
  const canViewPurchase = summary?.access?.purchase ?? true
  const canManage = summary?.access?.canManage ?? true
  const canWrite = summary?.access?.canWrite ?? true
  const currentMonthRate = monthlyRates.find(item => item.month === form.date.slice(0, 7))

  const loadData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [reportResult, summaryResult, snapshotResult] = await Promise.all([
        getJson<{ reports: DailyReport[]; mockEnabled: boolean }>(`/api/daily-reports?from=${encodeURIComponent(reportDate)}&to=${encodeURIComponent(reportDate)}`),
        getJson<Summary>(`/api/daily-reports/summary?date=${encodeURIComponent(reportDate)}`),
        getJson<{ snapshots: Snapshot[]; deliveries: Delivery[]; corrections: Correction[] }>(`/api/daily-reports/snapshots`),
      ])
      setReports(reportResult.reports); setMockEnabled(reportResult.mockEnabled); setSummary(summaryResult)
      setSnapshots(snapshotResult.snapshots); setDeliveries(snapshotResult.deliveries); setCorrections(snapshotResult.corrections)
      setSelectedReportId(current => reportResult.reports.some(item => item.id === current) ? current : reportResult.reports[0]?.id ?? '')
      setSelectedSnapshotId(current => snapshotResult.snapshots.some(item => item.id === current) ? current : snapshotResult.snapshots[0]?.id ?? '')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '日报数据加载失败') }
    finally { setLoading(false) }
  }, [reportDate])

  const loadK3Rows = useCallback(async (kind: Kind) => {
    try {
      const response = await getJson<{ rows: K3Row[] }>(`/api/daily-reports/k3-lines?type=${kind}`)
      setRows(response.rows)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'K3 快照行加载失败') }
  }, [])

  const loadPartyOptions = useCallback(async (kind: Kind) => {
    const partyKind = kind === 'sales' ? 'customer' : 'supplier'
    setPartyOptions([])
    try {
      const result = await getJson<{ parties: PartyOption[]; masterDataConfigured: boolean }>(`/api/daily-reporting/party-options?kind=${partyKind}`)
      setPartyOptions(result.parties); setMasterDataConfigured(result.masterDataConfigured)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '客户/供应商选项加载失败') }
  }, [])
  const loadExchangeRates = useCallback(async () => {
    try {
      const result = await getJson<{ rates: MonthlyRate[] }>('/api/daily-reporting/exchange-rates')
      setMonthlyRates(result.rates)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '月汇率加载失败') }
  }, [])

  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => { void loadPartyOptions(form.type) }, [form.type, loadPartyOptions])
  useEffect(() => { void loadExchangeRates() }, [loadExchangeRates])
  useEffect(() => {
    if (!summary?.access) return
    const nextType: Kind | undefined = !summary.access.sales && summary.access.purchase ? 'purchase' : summary.access.sales && !summary.access.purchase ? 'sales' : undefined
    if (nextType) setForm(current => current.type === nextType ? current : { ...current, type: nextType, partyId: '', partyName: '' })
  }, [summary?.access?.sales, summary?.access?.purchase])
  useEffect(() => {
    if (editingId || form.currency !== 'USD') return
    const rate = monthlyRates.find(item => item.month === form.date.slice(0, 7))
    if (rate) setForm(current => current.currency === 'USD' && current.date.slice(0, 7) === rate.month ? { ...current, exchangeRate: rate.rate } : current)
  }, [editingId, form.currency, form.date, monthlyRates])
  useEffect(() => {
    const type = selectedReport?.type ?? form.type
    void loadK3Rows(type)
    if (selectedReport) {
      const next: Record<string, DraftLink> = {}
      for (const link of selectedReport.links ?? []) next[link.k3RowId] = { k3RowId: link.k3RowId, allocatedAmount: link.allocatedAmount, allocatedQuantity: link.allocatedQuantity }
      setDraftLinks(next)
    } else setDraftLinks({})
  }, [selectedReportId, selectedReport?.type, selectedReport?.links, form.type, loadK3Rows])

  const changeForm = (key: keyof FormState, value: string) => setForm(current => ({ ...current, [key]: value, ...(key === 'currency' && value === 'CNY' ? { exchangeRate: '1' } : {}), ...(key === 'type' ? { partyId: '', partyName: '' } : {}) }))
  const selectParty = (id: string) => {
    const party = partyOptions.find(item => item.id === id)
    setForm(current => ({ ...current, partyId: id, partyName: party?.name ?? '' }))
  }
  const saveReport = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    if (!editingId && form.currency === 'USD' && masterDataConfigured && !currentMonthRate) { setError(`尚未维护 ${form.date.slice(0, 7)} USD→CNY 月汇率，请联系日报管理员。`); return }
    setBusy(true); setError(''); setNotice('')
    const payload = { ...form, partyId: form.partyId || undefined, quantity: Number(form.quantity || 0), originalAmount: Number(form.originalAmount), exchangeRate: Number(form.exchangeRate || 1), source: 'manual' }
    try {
      const response = await apiFetch(editingId ? `/api/daily-reports/${encodeURIComponent(editingId)}` : '/api/daily-reports', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error(await apiError(response, '日报保存失败'))
      const saved = await response.json() as DailyReport
      setReportDate(saved.date); setEditingId(null); setForm(defaultForm(saved.date, saved.type)); setNotice(editingId ? '日报已更新；如旧日期已归档，更正将保留在后续快照中。' : '日报已保存。')
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '日报保存失败') }
    finally { setBusy(false) }
  }
  const editReport = (report: DailyReport) => {
    setSelectedReportId(report.id); setEditingId(report.id); setReportDate(report.date)
    setForm({ type: report.type, date: report.date, partyName: report.partyName, partyId: report.partyId ?? '', documentNo: report.documentNo, quantity: String(report.quantity), currency: report.currency, originalAmount: String(report.originalAmount), exchangeRate: String(report.exchangeRate), note: report.note })
    setNotice(`正在编辑 ${report.documentNo || (report.type === 'sales' ? '销售日报' : '采购日报')}`)
  }
  const cancelEdit = () => { setEditingId(null); setForm(defaultForm(reportDate)); setNotice('已取消编辑。') }

  const saveLinks = async () => {
    if (!selectedReport || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch(`/api/daily-reports/${encodeURIComponent(selectedReport.id)}/links`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: Object.values(draftLinks) }) })
      if (!response.ok) throw new Error(await apiError(response, '关联保存失败'))
      const result = await response.json() as { links: Link[]; warnings: string[] }
      setNotice(result.warnings.length ? `分摊已保存。${result.warnings.join(' ')}` : '关联与金额分摊已保存。')
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '关联保存失败') }
    finally { setBusy(false) }
  }
  const toggleLink = (row: K3Row, checked: boolean) => setDraftLinks(current => {
    const next = { ...current }
    if (!checked) delete next[row.id]
    else next[row.id] = { k3RowId: row.id, allocatedAmount: row.amountCny, allocatedQuantity: row.quantity }
    return next
  })
  const setLinkValue = (rowId: string, key: 'allocatedAmount' | 'allocatedQuantity', value: string) => setDraftLinks(current => ({ ...current, [rowId]: { ...(current[rowId] ?? { k3RowId: rowId, allocatedAmount: 0, allocatedQuantity: 0 }), [key]: Number(value || 0) } }))

  const refreshMock = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch('/api/daily-reports/mock-refresh', { method: 'POST' })
      if (!response.ok) throw new Error(await apiError(response, '刷新本地演示数据失败'))
      const result = await response.json() as { message?: string }
      setNotice(result.message || '本地隔离快照已刷新；没有连接真实 K3Cloud。')
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '演示快照刷新失败') }
    finally { setBusy(false) }
  }
  const syncK3 = async () => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch('/api/daily-reports/k3-sync', { method: 'POST' })
      if (!response.ok) throw new Error(await apiError(response, 'K3Cloud 同步失败'))
      const result = await response.json() as { totalRows: number; refreshedAt: string; mode?: string; incrementalFrom?: string | null }
      const modeLabel = result.mode === 'incremental' ? '增量' : result.mode === 'mixed' ? '增量 + 全量回扫' : '首轮/全量'
      setNotice(`K3Cloud 只读数据同步完成：本次新增/更新 ${result.totalRows} 行（${modeLabel}）${result.incrementalFrom ? `，回看起点 ${dateTime(result.incrementalFrom)}` : ''}；${dateTime(result.refreshedAt)}。`)
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'K3Cloud 同步失败') }
    finally { setBusy(false) }
  }
  const createSnapshot = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const access = summary?.access
      const scope = access?.sales && access.purchase ? 'both' : access?.sales ? 'sales' : access?.purchase ? 'purchase' : 'both'
      const response = await apiFetch('/api/daily-reports/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportDate, scope }) })
      if (!response.ok) throw new Error(await apiError(response, '生成快照失败'))
      const result = await response.json() as Snapshot
      setSelectedSnapshotId(result.id); setNotice(`不可变快照 v${result.version} 已归档。${result.warnings.length ? ` 警告 ${result.warnings.length} 项。` : ''}`)
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '快照生成失败') }
    finally { setBusy(false) }
  }
  const exportSnapshot = async (format: 'html' | 'xlsx') => {
    if (!selectedSnapshotId || busy) return
    setBusy(true); setError('')
    try {
      const response = await apiFetch(`/api/daily-reports/snapshots/${encodeURIComponent(selectedSnapshotId)}/export.${format}`)
      if (!response.ok) throw new Error(await apiError(response, '导出失败'))
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `daily-report-${reportDate}.${format}`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
      setNotice(`${format.toUpperCase()} 文件已生成。`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '文件导出失败') }
    finally { setBusy(false) }
  }
  const simulateDelivery = async () => {
    if (!selectedSnapshotId || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch(`/api/daily-reports/snapshots/${encodeURIComponent(selectedSnapshotId)}/deliveries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) })
      if (!response.ok) throw new Error(await apiError(response, '模拟推送失败'))
      const result = await response.json() as Delivery
      setNotice(result.message); await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模拟推送失败') }
    finally { setBusy(false) }
  }

  const previewImport = async () => {
    if (!importFile || busy) return
    setBusy(true); setError(''); setNotice(''); setImportPreview(null)
    try {
      const formData = new FormData(); formData.append('file', importFile); formData.append('type', importType)
      const response = await apiFetch('/api/daily-reports/import/preview', { method: 'POST', body: formData })
      if (!response.ok) throw new Error(await apiError(response, '导入预览失败'))
      const preview = await response.json() as DailyImportPreview
      setImportPreview(preview)
      setNotice(`预览完成：${preview.importableRows} 条可导入，${preview.duplicateRows} 条重复将跳过，${preview.errorRows} 行有错误。`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '导入预览失败') }
    finally { setBusy(false) }
  }
  const commitImport = async () => {
    if (!importPreview || importPreview.errorRows || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch('/api/daily-reports/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId: importPreview.previewId }) })
      if (!response.ok) throw new Error(await apiError(response, '批量导入失败'))
      const result = await response.json() as { importedCount: number; skippedDuplicates: number; message: string }
      setNotice(result.message); setImportPreview(null); setImportFile(null); setImportInputKey(value => value + 1)
      await loadData()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量导入失败') }
    finally { setBusy(false) }
  }

  const coverageLabel = (value: number | null | undefined) => value == null ? '待判定' : `${value.toFixed(1)}%`
  const reconciliationCard = (dimension: 1 | 2 | 3, label: string, value?: Reconciliation) => value ? <div className="dr-recon-card" key={label}><b>{label}</b>{dimension === 1 ? <><span>日报总金额 <strong>{money(value.dailyCoverage.totalAmount)}</strong></span><span>封顶后已覆盖 <strong>{money(value.dailyCoverage.coveredAmount)}</strong></span><span>关联覆盖率 <strong>{coverageLabel(value.dailyCoverage.coverageRate)}</strong></span><small>按绝对金额计算；单条日报覆盖额不超过日报金额。</small></> : dimension === 2 ? <><span>月累计差额 <strong>{value.monthDifference.isComplete ? money(value.monthDifference.difference) : '待判定'}</strong></span><span>月系统 / K3 <strong>{value.monthDifference.isComplete ? `${money(value.monthDifference.systemAmount)} / ${money(value.monthDifference.k3Amount)}` : '数据不完整'}</strong></span><span>年累计差额 <strong>{value.yearDifference.isComplete ? money(value.yearDifference.difference) : '待判定'}</strong></span><small>差额 = 手工日报系统金额 − 同期间 K3Cloud 金额；缺数据不按零判定。</small></> : <><span>K3 原金额 <strong>{money(value.k3Allocation.originalAmount)}</strong></span><span>累计分摊 / 剩余 <strong>{money(value.k3Allocation.allocatedAmount)} / {money(value.k3Allocation.remainingAmount)}</strong></span><span>超额分摊 <strong className={value.k3Allocation.overAllocatedAmount ? 'dr-warning-text' : ''}>{money(value.k3Allocation.overAllocatedAmount)}</strong></span><small>{value.k3Allocation.rowCount} 行 · 跨日 {value.k3Allocation.crossDateCount} 行；超额/跨日均显式警告。</small></>}</div> : null
  const reportType = (kind: Kind) => kind === 'sales' ? '销售' : '采购'
  const documentKindLabel = (kind: string) => ({ 'sales-order': '销售订单', 'purchase-order': '采购订单', shipment: '销售出库', 'purchase-receipt': '采购入库', 'sales-invoice': '销项发票', 'purchase-invoice': '采购收票', receivable: '应收单', payable: '应付单' } as Record<string, string>)[kind] ?? kind
  const businessDocumentTable = (title: string, items: K3Row[], balance = false) => <div className="dr-business-doc-group" key={title}><h3>{title} · {items.length} 笔</h3><div className="iw-table-wrap"><table><thead><tr><th>单号 / 日期</th><th>客户 / 供应商</th><th>数量</th><th>单价</th><th>原币 / CNY 金额</th>{balance && <><th>已收 / 付</th><th>未收 / 付</th></>}<th>上下游关联</th><th>状态</th></tr></thead><tbody>{items.slice(0, 12).map(item => <tr key={item.id}><td><b>{item.billNo}</b><small>{item.date}</small></td><td>{item.partyName}<small>{item.materialName}</small></td><td>{item.quantity ? `${item.quantity} ${item.unit}` : '—'}</td><td>{item.unitPrice ? money(item.unitPrice) : '—'}</td><td>{item.currency} {money(item.originalAmount)}<small>CNY {money(item.amountCny)}{item.taxAmountCny != null ? ` · 税额 ${money(item.taxAmountCny)}` : ''}</small></td>{balance && <><td>{money(item.settledAmountCny)}</td><td>{money(item.outstandingAmountCny)}</td></>}<td>{item.upstreamBillNo ? <span>来源 {item.upstreamBillNo}</span> : '—'}{item.linkedDocuments?.map(link => <small key={link.id}>{documentKindLabel(link.kind)}：{link.billNo}</small>)}</td><td>{item.status}</td></tr>)}</tbody></table>{!items.length && <div className="iw-empty">当前报表日期/范围没有明细。</div>}{items.length > 12 && <small>仅显示前 12 笔；汇总按全部 {items.length} 笔计算。</small>}</div></div>
  const importFieldName = (field: string) => ({ type: '类型', date: '日期', partyName: '客户/供应商', documentNo: '单据编号', quantity: '数量', currency: '币种', originalAmount: '原币金额', exchangeRate: '汇率', note: '备注' }[field] ?? field)

  return <section className="dr-section" aria-label="销售与采购日报">
    <header className="dr-header"><div><div className="iw-eyebrow">日报管理 / DAILY REPORTING</div><h2>{canViewSales && canViewPurchase ? '销售 / 采购日报与 K3Cloud 对账' : canViewSales ? '销售日报与 K3Cloud 对账' : '采购日报与 K3Cloud 对账'}</h2><p>手工日报、K3Cloud 订单与往来单据、历史更正和多维对账。</p></div><div className="dr-header-actions"><label>报表日期<input type="date" value={reportDate} onChange={event => { setReportDate(event.target.value); setForm(current => ({ ...current, date: event.target.value })) }}/></label><button className="iw-button iw-secondary iw-small" onClick={() => void loadData()} disabled={loading}><RefreshCw size={14}/>刷新</button>{canManage && <button className="iw-button iw-approve iw-small" onClick={() => void syncK3()} disabled={busy}><Database size={14}/>{busy ? '同步中…' : '同步真实 K3Cloud'}</button>}{canManage && mockEnabled && <button className="iw-button iw-secondary iw-small" onClick={() => void refreshMock()} disabled={busy}>刷新本地演示快照</button>}</div></header>
    {summary && <div className={`dr-source-banner ${summary.isMock ? 'dr-mock' : ''}`}><ShieldCheck size={17}/><div><b>{summary.isMock ? '本地隔离演示数据（非真实 ERP）' : summary.liveErpConnected ? 'K3Cloud 只读快照' : '数据来源与完整性'}</b><span>{summary.notice}{summary.k3Sync?.lastSyncedAt ? ` 最近同步：${dateTime(summary.k3Sync.lastSyncedAt)}（${summary.k3Sync.mode === 'incremental' ? '增量' : summary.k3Sync.mode === 'mixed' ? '混合' : '全量'}）。本次更新 ${Object.values(summary.k3Sync.changedRowCounts ?? {}).reduce((sum, count) => sum + count, 0)} 行；当前快照订单 ${summary.k3Sync.rowCounts['sales-order'] ?? 0}/${summary.k3Sync.rowCounts['purchase-order'] ?? 0} 行，出入库 ${summary.k3Sync.rowCounts.shipment ?? 0}/${summary.k3Sync.rowCounts['purchase-receipt'] ?? 0} 行，销项/收票 ${summary.k3Sync.rowCounts['sales-invoice'] ?? 0}/${summary.k3Sync.rowCounts['purchase-invoice'] ?? 0} 行，应收/应付 ${summary.k3Sync.rowCounts.receivable ?? 0}/${summary.k3Sync.rowCounts.payable ?? 0} 行。` : ''}</span></div></div>}
    {error && <div className="iw-alert iw-error" role="alert">{error}</div>}{notice && <div className="iw-alert iw-success" role="status">{notice}</div>}
    {summary && <div className="dr-summary-grid">
      {canViewSales && <><article><small>销售日报 · {reportDate}</small><b>{money(summary.sales?.daily.amountCny ?? 0)}</b><span>{summary.sales?.daily.count ?? 0} 笔 · 数量 {summary.sales?.daily.quantity ?? 0}</span></article><article><small>销售订单（非日报金额）</small><b>{hasK3Snapshot ? money(summary.orders.sales.amountCny) : '待快照'}</b><span>{hasK3Snapshot ? `${summary.orders.sales.count} 笔订单` : '缺少 K3Cloud 快照'}</span></article><article><small>应收未收余额</small><b>{hasK3Snapshot ? money(summary.balances.receivables.outstandingAmountCny) : '待快照'}</b><span>{hasK3Snapshot ? `${summary.balances.receivables.count} 笔 · 原额 ${money(summary.balances.receivables.documentAmountCny)}` : '缺少 K3Cloud 快照'}</span></article></>}
      {canViewPurchase && <><article><small>采购日报 · {reportDate}</small><b>{money(summary.purchase?.daily.amountCny ?? 0)}</b><span>{summary.purchase?.daily.count ?? 0} 笔 · 数量 {summary.purchase?.daily.quantity ?? 0}</span></article><article><small>采购订单（非日报金额）</small><b>{hasK3Snapshot ? money(summary.orders.purchase.amountCny) : '待快照'}</b><span>{hasK3Snapshot ? `${summary.orders.purchase.count} 笔订单` : '缺少 K3Cloud 快照'}</span></article><article><small>应付未付余额</small><b>{hasK3Snapshot ? money(summary.balances.payables.outstandingAmountCny) : '待快照'}</b><span>{hasK3Snapshot ? `${summary.balances.payables.count} 笔 · 原额 ${money(summary.balances.payables.documentAmountCny)}` : '缺少 K3Cloud 快照'}</span></article></>}
    </div>}
    {summary?.warnings?.length ? <div className="dr-warning-list"><b>对账警告</b>{summary.warnings.slice(0, 8).map((warning, index) => <span key={`${warning.billNo}-${index}`}>{warning.type === 'sales' ? '销售' : '采购'} · {warning.billNo}{warning.crossDate ? ' · 跨日关联' : ''}{warning.overAllocatedAmount ? ` · 超额 ${money(warning.overAllocatedAmount)}` : ''}</span>)}</div> : null}

    {summary && <section className="iw-card dr-business-documents"><div className="iw-card-head"><div><h2>订单、出入库、发票与往来单据明细</h2><p>单价、数量、原币/人民币金额按映射字段读取；应收/应付为最近同步时点余额。上下游关联依赖已配置的 K3Cloud 来源单据 ID/编号，不以客商名称推断。</p></div><Database size={18}/></div><div className="dr-business-doc-grid">{canViewSales && <>{businessDocumentTable('销售订单', summary.orders.sales.rows)}{businessDocumentTable('销售出库', summary.fulfillment.sales.rows)}{businessDocumentTable('销项发票', summary.invoices.sales.rows)}{businessDocumentTable('应收单', summary.balances.receivables.rows, true)}</>}{canViewPurchase && <>{businessDocumentTable('采购订单', summary.orders.purchase.rows)}{businessDocumentTable('采购入库', summary.fulfillment.purchase.rows)}{businessDocumentTable('采购收票', summary.invoices.purchase.rows)}{businessDocumentTable('应付单', summary.balances.payables.rows, true)}</>}</div></section>}

    <section className="iw-card dr-import-card"><div className="iw-card-head"><div><h2>导入往期销售 / 采购日报</h2><p>上传 CSV / XLSX 后先预览字段与错误行；重复项按当前账套、类型、日期和单据编号识别并跳过。</p></div><Upload size={18}/></div>
      <div className="dr-import-toolbar"><label>默认类型<select value={importType} disabled={busy} onChange={event => { setImportType(event.target.value as Kind); setImportPreview(null) }}><option value="sales">销售日报</option><option value="purchase">采购日报</option></select></label><label className="dr-import-upload"><Upload size={14}/>{importFile ? '更换文件' : '选择 CSV / XLSX'}<input key={importInputKey} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => { setImportFile(event.target.files?.[0] ?? null); setImportPreview(null); setError(''); setNotice('') }}/></label><button className="iw-button iw-secondary iw-small" onClick={() => void previewImport()} disabled={!importFile || busy}><FileClock size={14}/>{busy ? '处理中…' : '预览并校验'}</button><button className="iw-button iw-approve iw-small" onClick={() => void commitImport()} disabled={!importPreview || Boolean(importPreview.errorRows) || busy}><Upload size={14}/>确认导入 {importPreview?.importableRows ?? ''}</button></div>
      {importFile && <small className="dr-import-filename">{importFile.name} · {(importFile.size / 1024).toFixed(1)} KB · 最大 10 MB · 当前导入仅写入已认证账套，不连接 K3Cloud。</small>}
      {importPreview && <><div className="dr-import-summary"><span><b>{importPreview.totalRows}</b> 行</span><span><b>{importPreview.importableRows}</b> 条可导入</span><span><b>{importPreview.duplicateRows}</b> 条重复跳过</span><span className={importPreview.errorRows ? 'has-errors' : ''}><b>{importPreview.errorRows}</b> 行错误</span><span>字段映射：{importPreview.mappedFields.map(importFieldName).join('、') || '未识别'}</span><span>预览有效至 {dateTime(importPreview.expiresAt)}</span></div>
        {importPreview.errorRows > 0 && <div className="dr-import-error" role="alert">存在字段错误行；为保证全批次原子性，必须修正文件并重新预览，当前不会导入任何行。</div>}
        <div className="iw-table-wrap dr-import-table"><table><thead><tr><th>源行</th><th>状态</th><th>类型 / 日期</th><th>单据编号</th><th>客户 / 供应商</th><th>数量</th><th>原币 / CNY</th><th>错误 / 重复说明</th></tr></thead><tbody>{importPreview.rows.map(row => <tr key={row.line} className={row.status === 'invalid' ? 'dr-import-row-invalid' : row.status === 'duplicate' ? 'dr-import-row-duplicate' : ''}><td>{row.line}</td><td>{row.status === 'invalid' ? '错误' : row.status === 'duplicate' ? '重复·跳过' : '可导入'}</td><td>{row.data?.type ? reportType(row.data.type) : '—'}<small>{row.data?.date ?? '—'}</small></td><td>{row.data?.documentNo || '—'}</td><td>{row.data?.partyName || '—'}</td><td>{row.data?.quantity ?? '—'}</td><td>{row.data?.originalAmount == null ? '—' : `${money(row.data.originalAmount)} / ${money(row.data.amountCny)}`}</td><td>{row.errors.join('；') || (row.duplicateReason === 'same_batch' ? '与本文件前序行重复' : row.duplicateReason === 'existing' ? '当前账套已有相同日报' : '—')}</td></tr>)}</tbody></table></div>
      </>}
    </section>

    {summary && <section className="iw-card dr-business-documents"><div className="iw-card-head"><div><h2>订单、出入库、发票与往来单据明细</h2><p>单价、数量、原币/人民币金额按映射字段读取；应收/应付为最近同步时点余额。上下游关联依赖已配置的 K3Cloud 来源单据 ID/编号，不以客商名称推断。</p></div><Database size={18}/></div><div className="dr-business-doc-grid">{businessDocumentTable('销售订单', summary.orders.sales.rows)}{businessDocumentTable('销售出库', summary.fulfillment.sales.rows)}{businessDocumentTable('销项发票', summary.invoices.sales.rows)}{businessDocumentTable('应收单', summary.balances.receivables.rows, true)}{businessDocumentTable('采购订单', summary.orders.purchase.rows)}{businessDocumentTable('采购入库', summary.fulfillment.purchase.rows)}{businessDocumentTable('采购收票', summary.invoices.purchase.rows)}{businessDocumentTable('应付单', summary.balances.payables.rows, true)}</div></section>}

    <div className="dr-workspace-grid">
      {canWrite && <section className="iw-card"><div className="iw-card-head"><div><h2>{editingId ? '编辑日报' : '手工录入日报'}</h2><p>来源仓库的手工录入能力已保留；原币和历史汇率独立存档。</p></div></div>
        <form className="dr-form" onSubmit={saveReport}>
          <label>类型<select value={form.type} onChange={event => changeForm('type', event.target.value)}>{canViewSales && <option value="sales">销售日报</option>}{canViewPurchase && <option value="purchase">采购日报</option>}</select></label>
          <label>业务日期<input type="date" value={form.date} onChange={event => changeForm('date', event.target.value)} required/></label>
          {masterDataConfigured ? <label className="dr-wide">客户 / 供应商<select value={form.partyId} onChange={event => selectParty(event.target.value)} required><option value="">选择已分配的{form.type === 'sales' ? '客户' : '供应商'}</option>{partyOptions.map(party => <option key={party.id} value={party.id}>{party.name}{party.k3Number ? ` · K3 ${party.k3Number}` : ''}</option>)}</select>{!partyOptions.length && <small>当前账套尚未为你分配可用客商；请联系日报管理员。</small>}</label> : <label className="dr-wide">客户 / 供应商<input value={form.partyName} onChange={event => changeForm('partyName', event.target.value)} maxLength={160} required placeholder="名称"/></label>}
          <label>单据编号<input value={form.documentNo} onChange={event => changeForm('documentNo', event.target.value)} maxLength={100} placeholder="可选"/></label>
          <label>数量<input type="number" step="0.001" value={form.quantity} onChange={event => changeForm('quantity', event.target.value)} required/></label>
          <label>币种<select value={form.currency} onChange={event => changeForm('currency', event.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="JPY">JPY 日元</option><option value="EUR">EUR 欧元</option></select></label>
          <label>原币金额<input type="number" step="0.01" value={form.originalAmount} onChange={event => changeForm('originalAmount', event.target.value)} required/></label>
          <label>汇率（兑 CNY）<input type="number" step="0.000001" min="0.000001" value={form.exchangeRate} onChange={event => changeForm('exchangeRate', event.target.value)} disabled={form.currency === 'CNY' || (!editingId && form.currency === 'USD' && Boolean(currentMonthRate))} required/>{form.currency === 'USD' && currentMonthRate && !editingId && <small>新建日报自动使用 {currentMonthRate.month} 月汇率 {currentMonthRate.rate}。</small>}{form.currency === 'USD' && masterDataConfigured && !currentMonthRate && !editingId && <small>该月份尚未维护汇率，需先由日报管理员设置。</small>}</label>
          <label className="dr-wide">备注<textarea value={form.note} onChange={event => changeForm('note', event.target.value)} maxLength={2000} rows={2}/></label>
          <div className="dr-form-actions"><button className="iw-button iw-approve" disabled={busy}><Save size={14}/>{busy ? '保存中…' : editingId ? '保存更正' : '保存日报'}</button>{editingId && <button type="button" className="iw-button iw-secondary" onClick={cancelEdit}>取消</button>}</div>
        </form>
      </section>}
      <section className="iw-card"><div className="iw-card-head"><div><h2>日报历史</h2><p>{reportDate} · {reports.length} 条 · 选择一条进入关联</p></div><FileClock size={18}/></div>
        {loading ? <div className="iw-empty">正在读取…</div> : reports.length ? <div className="dr-history-list">{reports.map(report => <article key={report.id} className={selectedReportId === report.id ? 'is-selected' : ''}>
          <button className="dr-history-select" onClick={() => setSelectedReportId(report.id)}><span>{reportType(report.type)} · {report.date}</span><b>{report.partyName}</b><small>{report.documentNo || '未填写单据号'} · {report.quantity} · 分摊 {money(report.allocatedAmount)}</small><strong>{money(report.amountCny)}</strong></button>{report.canEdit && <button className="iw-button iw-secondary iw-small" onClick={() => editReport(report)} aria-label={`编辑 ${report.documentNo || report.partyName}`}>编辑</button>}
        </article>)}</div> : <div className="iw-empty">该日期没有日报，可在左侧手工录入。</div>}
      </section>
    </div>

    <section className="iw-card dr-link-card"><div className="iw-card-head"><div><h2>关联 K3Cloud 快照行</h2><p>{selectedReport ? `${reportType(selectedReport.type)}日报 ${selectedReport.documentNo || selectedReport.id} · ${selectedReport.date}` : '先选择或创建一条日报'}；允许部分分摊，跨日和超额会警告但保留记录。</p></div><button className="iw-button iw-approve iw-small" onClick={() => void saveLinks()} disabled={!canWrite || !selectedReport || !selectedReport.canEdit || busy}><Save size={13}/>保存关联</button></div>
      {reconciliation && <div className="dr-recon-grid">{reconciliationCard(1, '维度 1 · 日报关联覆盖率', reconciliation)}{reconciliationCard(2, '维度 2 · 同期间金额差异', reconciliation)}{reconciliationCard(3, '维度 3 · K3 明细分摊', reconciliation)}</div>}
      {selectedReport ? <div className="iw-table-wrap dr-k3-table"><table><thead><tr><th>关联</th><th>K3 单号 / 日期</th><th>客商 / 物料</th><th>来源金额</th><th>已分摊</th><th>本次金额</th><th>本次数量</th><th>提醒</th></tr></thead><tbody>{rows.map(row => {
        const active = Boolean(draftLinks[row.id]), draft = draftLinks[row.id]
        const nextAllocated = Object.values(draftLinks).filter(link => link.k3RowId === row.id).reduce((sum, link) => sum + Math.abs(link.allocatedAmount), 0)
        const savedAllocation = active ? Math.abs(selectedReport.links.find(link => link.k3RowId === row.id)?.allocatedAmount ?? 0) : 0
        const over = Math.max(0, row.allocatedAmount - savedAllocation + nextAllocated - Math.abs(row.amountCny))
        const cross = row.date !== selectedReport.date
        return <tr key={row.id}><td><input type="checkbox" checked={active} disabled={!canWrite || !selectedReport.canEdit} onChange={event => toggleLink(row, event.target.checked)} aria-label={`关联 ${row.billNo}`}/></td><td><b>{row.billNo}</b><small>{row.date}</small></td><td>{row.partyName}<small>{row.materialName}</small></td><td>{money(row.amountCny)}</td><td>{money(row.allocatedAmount)}</td><td><input className="dr-number" type="number" step="0.01" disabled={!active || !canWrite || !selectedReport.canEdit} value={draft?.allocatedAmount ?? ''} onChange={event => setLinkValue(row.id, 'allocatedAmount', event.target.value)} aria-label={`${row.billNo} 分摊金额`}/></td><td><input className="dr-number" type="number" step="0.001" disabled={!active || !canWrite || !selectedReport.canEdit} value={draft?.allocatedQuantity ?? ''} onChange={event => setLinkValue(row.id, 'allocatedQuantity', event.target.value)} aria-label={`${row.billNo} 分摊数量`}/></td><td>{cross && <i>跨日</i>}{over > 0 && <i>超额</i>}</td></tr>
      })}</tbody></table>{!rows.length && <div className="iw-empty">当前账套没有该类型的本地 K3 快照行。</div>}</div> : <div className="iw-empty">选择一条日报后可查看同账套的 K3 快照行。</div>}
    </section>

    <section className="dr-bottom-grid">
      <section className="iw-card"><div className="iw-card-head"><div><h2>不可变报表快照</h2><p>每次归档生成新版本；历史快照不覆盖，晚到更正随后续快照附带。归档范围按你的销售/采购权限自动选择。</p></div><button className="iw-button iw-approve iw-small" onClick={() => void createSnapshot()} disabled={!canWrite || busy}><FileClock size={14}/>归档 {reportDate}</button></div>
        <div className="dr-snapshot-toolbar"><select value={selectedSnapshotId} onChange={event => setSelectedSnapshotId(event.target.value)}><option value="">选择已归档快照</option>{snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshot.reportDate} · v{snapshot.version} · {snapshot.source === 'local-mock' ? '隔离演示' : snapshot.scope}</option>)}</select><button className="iw-button iw-secondary iw-small" disabled={!selectedSnapshotId || busy} onClick={() => void exportSnapshot('html')}>导出 HTML</button><button className="iw-button iw-secondary iw-small" disabled={!selectedSnapshotId || busy} onClick={() => void exportSnapshot('xlsx')}><Download size={14}/>多工作表 Excel</button></div>
        {snapshots.length ? <div className="dr-snapshot-list">{snapshots.slice(0, 5).map(snapshot => <button key={snapshot.id} className={snapshot.id === selectedSnapshotId ? 'is-selected' : ''} onClick={() => setSelectedSnapshotId(snapshot.id)}><span>{snapshot.reportDate} · v{snapshot.version}</span><small>{dateTime(snapshot.createdAt)} · {snapshot.isComplete ? '数据快照存在' : '对账暂不可判定'}</small><b>{snapshot.warnings.length ? `${snapshot.warnings.length} 项警告` : '无警告'}</b></button>)}</div> : <div className="iw-empty">尚无归档快照。</div>}
      </section>
      <section className="iw-card"><div className="iw-card-head"><div><h2>渠道与更正记录</h2><p>仅本地模拟投递；不连接 SMTP、钉钉或任何真实收件人 / 群。</p></div><Wallet size={18}/></div>
        <div className="dr-simulate-row"><select value={channel} onChange={event => setChannel(event.target.value as Channel)}><option value="dingtalk">钉钉摘要（本地模拟）</option><option value="email">邮件摘要（本地模拟）</option></select><button className="iw-button iw-secondary iw-small" onClick={() => void simulateDelivery()} disabled={!canWrite || !selectedSnapshotId || busy}><Send size={13}/>模拟推送</button></div>
        {deliveries.length > 0 && <div className="dr-snapshot-list">{deliveries.slice(0, 5).map(item => <div key={item.id}><span>{item.channel === 'email' ? '邮件' : '钉钉'} · {item.status === 'simulated' ? '本地模拟' : item.status}</span><small>{dateTime(item.createdAt)} · {item.message}</small></div>)}</div>}
        <div className="dr-pending-corrections"><b>历史更正记录 · {corrections.length}</b>{corrections.length ? corrections.slice(0, 6).map(item => <span key={item.id}>{item.originalDate} · {item.affectedReport === 'sales' ? '销售' : '采购'} {item.type} · 差额 {money(item.diffAmount)} · {item.reportedInSnapshotId ? '已纳入后续快照' : '待纳入后续快照'} · {item.reason}</span>) : <span>修改已归档日期的数据会形成更正记录；历史快照内容不会被覆盖。</span>}</div>
      </section>
    </section>
    <DailyReportingManagement onChanged={() => { void loadPartyOptions(form.type); void loadExchangeRates() }}/>
  </section>
}
