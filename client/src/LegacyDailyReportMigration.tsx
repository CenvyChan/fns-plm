import { useState, type ChangeEvent } from 'react'
import { ArrowDownToLine, CheckCircle2, FileUp, LoaderCircle } from 'lucide-react'
import { apiFetch } from './api'

type Row = Record<string, unknown>
type LegacyCompany = {
  company: { code: string; name: string; active: boolean } | null
  error?: string
  salesReports?: Row[]; purchaseReports?: Row[]; parties?: Row[]; exchangeRates?: Row[]
  assignments?: Row[]; memberships?: Row[]; partyMappings?: Row[]; k3Headers?: Row[]; k3Lines?: Row[]
}
type Bundle = { schemaVersion: number; source: string; companies: Record<string, LegacyCompany> }
type Scope = { tenantName: string; organizationName: string; accountName: string; accountCode: string }
type Counts = { sales: number; purchase: number; parties: number; rates: number; assignments: number; memberships: number; mappings: number; k3Headers: number; k3Lines: number }

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
const reportCsv = (rows: Row[], type: 'sales' | 'purchase') => {
  const fields: Array<[string, string]> = [
    ['type', 'type'], ['date', 'date'], ['partyName', 'partyName'], ['documentNo', 'documentNo'],
    ['quantity', 'quantity'], ['currency', 'currency'], ['originalAmount', 'originalAmount'],
    ['exchangeRate', 'exchangeRate'], ['amountCny', 'amountCny'], ['note', 'note'],
    ['sourceIdempotencyKey', 'sourceIdempotencyKey'], ['legacyCompanyCode', 'legacyCompanyCode'],
    ['legacyPartyId', 'legacyPartyId'], ['legacyUserId', 'legacyUserId'], ['legacyUsername', 'legacyUsername'],
    ['legacyUserDisplayName', 'legacyUserName'], ['legacySourceFile', 'legacySourceFile'],
    ['legacyImportBatch', 'legacyImportBatch'], ['legacySourceRow', 'legacySourceRow'], ['legacyBusinessType', 'legacyBusinessType'],
  ]
  return [fields.map(([header]) => csvCell(header)).join(','), ...rows.map(row => fields.map(([header, key]) => csvCell(key === 'type' ? type : row[key])).join(','))].join('\r\n')
}
async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { message?: string; error?: string }) | null
  if (!response.ok) throw new Error(body?.message || body?.error || `请求失败（HTTP ${response.status}）`)
  return body as T
}
async function postJson(path: string, payload: unknown) {
  const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) })
  const body = await responseJson<Record<string, unknown>>(response)
  if (Number(body.conflicts ?? 0) > 0) throw new Error(`迁移发现 ${Number(body.conflicts)} 条冲突，冲突未覆盖；已完成部分可安全重跑。`)
  return body
}

export default function LegacyDailyReportMigration({ scope, onChanged }: { scope: Scope; onChanged: () => void }) {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [sourceCode, setSourceCode] = useState<'FNS' | 'NBHH'>('FNS')
  const [fileLabel, setFileLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [complete, setComplete] = useState('')

  const currentFnsScope = scope.tenantName === 'PLM-FNSIOSS' && scope.organizationName === 'Fns运营中心' && scope.accountName === 'Mian-Fns'
  const selected = bundle?.companies?.[sourceCode]
  const counts: Counts | null = selected ? {
    sales: selected.salesReports?.length ?? 0, purchase: selected.purchaseReports?.length ?? 0,
    parties: selected.parties?.length ?? 0, rates: selected.exchangeRates?.length ?? 0,
    assignments: selected.assignments?.length ?? 0, memberships: selected.memberships?.length ?? 0,
    mappings: selected.partyMappings?.length ?? 0, k3Headers: selected.k3Headers?.length ?? 0, k3Lines: selected.k3Lines?.length ?? 0,
  } : null

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setError(''); setComplete(''); setProgress('')
    if (file.size > 60 * 1024 * 1024) { setBundle(null); setFileLabel(''); setError('迁移包超过 60 MB；请按公司拆分后再导入。'); return }
    try {
      const parsed = JSON.parse(await file.text()) as Bundle
      if (parsed.schemaVersion !== 1 || parsed.source !== 'dailyReport' || !parsed.companies || typeof parsed.companies !== 'object') throw new Error('文件不是受支持的 dailyReport 迁移包。')
      for (const code of ['FNS', 'NBHH']) {
        const company = parsed.companies[code]
        if (!company) continue
        if (company.company?.code !== code || company.error) throw new Error(`${code} 公司信息缺失或不匹配。`)
        for (const key of ['salesReports', 'purchaseReports', 'parties', 'exchangeRates', 'assignments', 'memberships', 'partyMappings', 'k3Headers', 'k3Lines'] as const) {
          if (company[key] !== undefined && !Array.isArray(company[key])) throw new Error(`${code} 的 ${key} 必须为数组。`)
        }
      }
      setBundle(parsed); setFileLabel(file.name)
    } catch (caught) { setBundle(null); setFileLabel(''); setError(caught instanceof Error ? caught.message : '无法读取迁移包。') }
    finally { input.value = '' }
  }

  const importReports = async (code: string, type: 'sales' | 'purchase', rows: Row[]) => {
    if (!rows.length) return
    const form = new FormData()
    form.append('type', type)
    form.append('file', new Blob([reportCsv(rows, type)], { type: 'text/csv;charset=utf-8' }), `${code}-${type}-dailyreport.csv`)
    const preview = await responseJson<{ previewId: string; migration: boolean; sourceCompanyCode?: string; totalRows: number; validRows: number; errorRows: number; duplicateRows: number }>(await apiFetch('/api/daily-reports/import/preview', { method: 'POST', body: form }))
    if (!preview.migration || preview.sourceCompanyCode !== code || preview.totalRows !== rows.length) throw new Error(`${type} 导入预览的公司代码/迁移标记不符，已停止提交。`)
    if (preview.errorRows) throw new Error(`${type} 有 ${preview.errorRows} 条校验错误；未提交日报。请先修复迁移源。`)
    setProgress(`日报 ${type === 'sales' ? '销售' : '采购'}：预览 ${preview.totalRows} 条，有效 ${preview.validRows} 条，已有重复 ${preview.duplicateRows} 条；正在按原精确金额提交…`)
    await postJson('/api/daily-reports/import/commit', { previewId: preview.previewId })
  }

  const runImport = async () => {
    if (!selected || !counts) return
    if (sourceCode === 'FNS' && !currentFnsScope) { setError('当前 PLM 账套不是 PLM-FNSIOSS / Fns运营中心 / Mian-Fns；为防止跨账套误写，已阻止 FNS 导入。'); return }
    if (sourceCode === 'NBHH') { setError('NBHH 必须导入到独立的新 scope；当前没有可验证的 NBHH 目标 scope，因此禁止写入。'); return }
    setBusy(true); setError(''); setComplete(''); setProgress('开始迁移…')
    try {
      const code = sourceCode
      const runCategory = async (label: string, path: string, rows: Row[]) => {
        if (!rows.length) return
        setProgress(`${label}：提交 ${rows.length} 条…`)
        const result = await postJson(path, { companyCode: code, rows })
        setProgress(`${label}：新增 ${Number(result.inserted ?? 0)}，跳过 ${Number(result.skipped ?? 0)}。`)
      }
      await runCategory('M03 客户/供应商', '/api/daily-reporting/migration/parties', selected.parties ?? [])
      await runCategory('M04 汇率', '/api/daily-reporting/migration/rates', selected.exchangeRates ?? [])
      await runCategory('M05 客商归属（用户不自动映射）', '/api/daily-reporting/migration/assignments', selected.assignments ?? [])
      await runCategory('M08 旧成员待核对（不建 PLM 用户/角色）', '/api/daily-reporting/migration/memberships', selected.memberships ?? [])
      await runCategory('M13 K3 客商映射（旧状态不视作确认）', '/api/daily-reporting/migration/party-mappings', selected.partyMappings ?? [])

      const headers = selected.k3Headers ?? [], lines = selected.k3Lines ?? []
      if (lines.length && !headers.length) throw new Error('M06 存在 K3 明细但无表头；已停止，未发布该批次。')
      if (headers.length) {
        const chunkSize = 1000
        for (let start = 0; start < headers.length; start += chunkSize) {
          const end = Math.min(start + chunkSize, headers.length)
          setProgress(`M06 K3 表头：${end.toLocaleString()} / ${headers.length.toLocaleString()}`)
          await postJson('/api/daily-reporting/migration/k3/headers', { companyCode: code, expectedCount: headers.length, rows: headers.slice(start, end) })
        }
        for (let start = 0; start < lines.length; start += chunkSize) {
          const end = Math.min(start + chunkSize, lines.length)
          setProgress(`M06 K3 明细：${end.toLocaleString()} / ${lines.length.toLocaleString()}`)
          await postJson('/api/daily-reporting/migration/k3/lines', { companyCode: code, expectedCount: lines.length, rows: lines.slice(start, end) })
        }
        setProgress('M06 核对表头/明细总数、精确金额和停用记录，原子发布快照…')
        await postJson('/api/daily-reporting/migration/k3/finalize', { companyCode: code, expectedHeaders: headers.length, expectedLines: lines.length })
      }

      await importReports(code, 'sales', selected.salesReports ?? [])
      await importReports(code, 'purchase', selected.purchaseReports ?? [])
      setComplete(`迁移完成：M03 ${counts.parties}、M04 ${counts.rates}、M05 ${counts.assignments}、M08 ${counts.memberships}、M13 ${counts.mappings}、M06 ${counts.k3Headers} 个头单 / ${counts.k3Lines} 条明细、M01 ${counts.sales} 条销售日报、M02 ${counts.purchase} 条采购日报。所有导入均写入当前 scope 并保留旧公司代码；旧用户与客商匹配仍需人工确认。`)
      setProgress('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '迁移未完成。已成功提交的类别采用稳定旧主键/批次幂等，可修复后安全重跑。')
    } finally { setBusy(false) }
  }

  return <section className="dr-admin-table-block dr-migration-import" aria-label="dailyReport 历史迁移">
    <h3><ArrowDownToLine size={15}/> dailyReport 历史迁移</h3>
    <p className="dr-admin-help">受保护的管理员迁移入口。先核对当前 PLM scope，再选择旧公司迁移包。原精确 CNY 金额、旧主键、责任人事实与 K3 停用状态会保留；未迁移口令/会话/MFA，不创建 PLM 用户或角色，也不把旧 AUTO/MANUAL 客商映射当作已确认。</p>
    <div className="dr-admin-inline-form">
      <label>当前目标 scope<input readOnly value={`${scope.tenantName} / ${scope.organizationName} / ${scope.accountName} · ${scope.accountCode}`} /></label>
      <label>旧公司代码<select value={sourceCode} onChange={event => { setSourceCode(event.target.value as 'FNS' | 'NBHH'); setError(''); setComplete('') }} disabled={busy}><option value="FNS">FNS（重用 Mian-Fns）</option><option value="NBHH">NBHH（必须独立新 scope）</option></select></label>
      <label>迁移包（JSON）<input type="file" accept=".json,application/json" onChange={event => void chooseFile(event)} disabled={busy}/></label>
      <button className="iw-button iw-approve iw-small" onClick={() => void runImport()} disabled={busy || !selected || (sourceCode === 'FNS' && !currentFnsScope) || sourceCode === 'NBHH'}>{busy ? <LoaderCircle size={13} className="spin"/> : <FileUp size={13}/>}开始迁移</button>
    </div>
    {fileLabel && <p className="dr-admin-help">已读取：<b>{fileLabel}</b>{selected?.company ? ` · ${selected.company.code} / ${selected.company.name}` : ''}</p>}
    {counts && <div className="dr-admin-banner"><CheckCircle2 size={15}/><span>待迁移：M01 销售 {counts.sales.toLocaleString()}；M02 采购 {counts.purchase.toLocaleString()}；M03 客商 {counts.parties.toLocaleString()}；M04 汇率 {counts.rates.toLocaleString()}；M05 归属 {counts.assignments.toLocaleString()}；M08 成员 {counts.memberships.toLocaleString()}；M13 映射 {counts.mappings.toLocaleString()}；M06 K3 {counts.k3Headers.toLocaleString()} 头单 / {counts.k3Lines.toLocaleString()} 明细。</span></div>}
    {sourceCode === 'NBHH' && <div className="iw-alert iw-error" role="status">NBHH 独立 scope 尚未完成可验证创建；不能把数据导入 FNS 或其他账套。</div>}
    {progress && <div className="iw-alert" role="status">{progress}</div>}
    {error && <div className="iw-alert iw-error" role="alert">{error}</div>}
    {complete && <div className="iw-alert iw-success" role="status">{complete}</div>}
  </section>
}
