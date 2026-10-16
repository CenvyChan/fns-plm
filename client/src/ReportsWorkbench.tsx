import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react'
import { apiFetch } from './api'
import DailyReportingWorkbench from './DailyReportingWorkbench'

type Schedule = {
  id: string
  name: string
  cadence: 'daily' | 'weekly'
  time: string
  dayOfWeek?: number | string
  timezone: string
  enabled: boolean
  deliveryConfigured?: boolean
  schedulerState?: string
  lastRunAt?: string
  lastResult?: string
}
type ReportPreview = { [key: string]: unknown; title?: string; summary?: string; text?: string; content?: string; channelStatus?: unknown; channels?: unknown }
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const render = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
  return body?.message || body?.error || `${fallback}（HTTP ${response.status}）`
}

export default function ReportsWorkbench() {
  const [preview, setPreview] = useState<ReportPreview | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [errorPreview, setErrorPreview] = useState('')
  const [errorSchedules, setErrorSchedules] = useState('')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null)
  const [sendNotice, setSendNotice] = useState('')
  const [sendError, setSendError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily')
  const [name, setName] = useState('经营日报')
  const [time, setTime] = useState('09:00')
  const [dayOfWeek, setDayOfWeek] = useState('1')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true)
    setErrorPreview('')
    try {
      const response = await apiFetch('/api/reports/preview')
      if (!response.ok) throw new Error(await responseError(response, '预览加载失败'))
      setPreview(await response.json() as ReportPreview)
    } catch (error) {
      setErrorPreview(error instanceof Error ? error.message : '无法加载报告预览')
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true)
    setErrorSchedules('')
    try {
      const response = await apiFetch('/api/reports/schedules')
      if (!response.ok) throw new Error(await responseError(response, '计划加载失败'))
      const result = await response.json() as Schedule[] | { schedules?: Schedule[] }
      setSchedules(Array.isArray(result) ? result : result.schedules ?? [])
    } catch (error) {
      setErrorSchedules(error instanceof Error ? error.message : '无法加载发送计划')
    } finally {
      setLoadingSchedules(false)
    }
  }, [])

  useEffect(() => { void loadPreview(); void loadSchedules() }, [loadPreview, loadSchedules])

  const channel = preview?.channelStatus ?? preview?.channels
  const channelStatus = preview?.channelStatus as { configured?: boolean; connected?: boolean; message?: string } | undefined
  const channelReady = Boolean(channelStatus?.configured)

  const clearEditor = () => {
    setEditingScheduleId(null)
    setName('经营日报')
    setCadence('daily')
    setTime('09:00')
    setDayOfWeek('1')
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
  }

  const startEdit = (schedule: Schedule) => {
    setEditingScheduleId(schedule.id)
    setName(schedule.name)
    setCadence(schedule.cadence)
    setTime(schedule.time)
    setDayOfWeek(String(schedule.dayOfWeek ?? 1))
    setTimezone(schedule.timezone)
    setNotice(`正在编辑“${schedule.name}”`)
    setErrorSchedules('')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNotice('')
    setErrorSchedules('')
    const editing = editingScheduleId
    const body = {
      name: name.trim(), cadence, time,
      ...(cadence === 'weekly' ? { dayOfWeek: Number(dayOfWeek) } : {}),
      timezone,
      ...(!editing ? { enabled: channelReady } : {}),
    }
    try {
      const response = await apiFetch(editing ? `/api/reports/schedules/${encodeURIComponent(editing)}` : '/api/reports/schedules', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, editing ? '更新计划失败' : '保存计划失败'))
      setNotice(editing ? '计划已更新' : channelReady ? '发送计划已保存并启用' : '已保存为停用计划；配置钉钉机器人后可启用')
      clearEditor()
      await loadSchedules()
    } catch (error) {
      setErrorSchedules(error instanceof Error ? error.message : '保存计划失败')
    } finally {
      setSaving(false)
    }
  }

  const sendNow = async () => {
    if (sending || !channelReady) return
    setSending(true)
    setSendNotice('')
    setSendError('')
    try {
      const response = await apiFetch('/api/reports/send', { method: 'POST' })
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string; ok?: boolean; status?: string; sentAt?: string; generatedAt?: string }
      if (!response.ok) throw new Error(result.message || result.error || `推送失败（HTTP ${response.status}）`)
      if (result.ok === false) throw new Error(result.message || '服务端未确认发送成功')
      const sentStatus = result.status || (result.ok ? '已发送' : '已发送')
      setSendNotice(`推送成功 · 状态：${sentStatus}${result.sentAt ? ` · 时间：${result.sentAt}` : result.generatedAt ? ` · 报告生成时间：${result.generatedAt}` : ''}`)
      await Promise.all([loadPreview(), loadSchedules()])
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '报告推送失败')
    } finally {
      setSending(false)
    }
  }

  const runScheduleNow = async (schedule: Schedule) => {
    if (runningScheduleId || !channelReady) return
    setRunningScheduleId(schedule.id)
    setNotice('')
    setErrorSchedules('')
    try {
      const response = await apiFetch(`/api/reports/schedules/${encodeURIComponent(schedule.id)}/run`, { method: 'POST' })
      const result = await response.json().catch(() => ({})) as { message?: string; error?: string; ok?: boolean }
      if (!response.ok) throw new Error(result.message || result.error || `执行失败（HTTP ${response.status}）`)
      if (result.ok === false) throw new Error(result.message || '服务端未确认发送成功')
      setNotice(`“${schedule.name}”已执行并发送到已配置渠道。`)
      await loadSchedules()
    } catch (error) {
      setErrorSchedules(error instanceof Error ? error.message : '计划执行失败')
    } finally {
      setRunningScheduleId(null)
    }
  }

  const update = async (schedule: Schedule, patch: Partial<Schedule>) => {
    setErrorSchedules('')
    setNotice('')
    try {
      const response = await apiFetch(`/api/reports/schedules/${encodeURIComponent(schedule.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(await responseError(response, '更新失败'))
      setNotice(patch.enabled === undefined ? '计划已更新' : patch.enabled ? '计划已启用' : '计划已停用')
      await loadSchedules()
    } catch (error) {
      setErrorSchedules(error instanceof Error ? error.message : '更新计划失败')
    }
  }

  const remove = async (schedule: Schedule) => {
    setErrorSchedules('')
    setNotice('')
    try {
      const response = await apiFetch(`/api/reports/schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, '删除计划失败'))
      if (editingScheduleId === schedule.id) clearEditor()
      setNotice(`“${schedule.name}”已删除`)
      await loadSchedules()
    } catch (error) {
      setErrorSchedules(error instanceof Error ? error.message : '删除计划失败')
    }
  }

  const schedulerLabel = (item: Schedule) => {
    if (item.enabled && !channelReady) return '已启用，但缺少机器人配置（阻止发送）'
    if (item.schedulerState === 'scheduled') return '已排程'
    if (item.schedulerState === 'blocked-missing-webhook') return '缺少 Webhook'
    if (item.schedulerState === 'inactive') return '未排程'
    return '已停用'
  }
  const lastResultLabel = (result?: string) => result === 'sent' ? '发送成功' : result?.startsWith('failed:') ? `发送失败：${result.slice(7)}` : result || '已运行'

  return <main className="iw-page">
    <header className="iw-heading">
      <div><div className="iw-eyebrow">经营分析 / REPORTING</div><h1>报告中心</h1><p>预览报告内容并管理日报、周报计划；推送由已配置渠道及计划决定。</p></div>
      <button className="iw-button iw-secondary" onClick={() => { void loadPreview(); void loadSchedules() }} disabled={loadingPreview || loadingSchedules}><RefreshCw size={15}/>刷新</button>
    </header>
    <DailyReportingWorkbench />
    <div className="iw-columns iw-report-columns">
      <section className="iw-card">
        <div className="iw-card-head"><div><h2>报告预览</h2><p>{preview?.title || '摘要与文本内容'}</p></div><div><button className="iw-button iw-approve iw-small" onClick={() => void sendNow()} disabled={sending || loadingPreview || !channelReady} title={!channelReady ? '请先配置钉钉机器人' : undefined}>{sending ? '推送中…' : '立即推送'}</button> <button className="iw-button iw-secondary iw-small" onClick={() => void loadPreview()} disabled={loadingPreview}><RefreshCw size={14}/>刷新预览</button></div></div>
        {!channelReady && <div className="iw-alert">{channelStatus?.message || '钉钉渠道未配置，无法推送；请先配置机器人。'}</div>}
        {sendError && <div className="iw-alert iw-error">{sendError}</div>}
        {sendNotice && <div className="iw-alert iw-success">{sendNotice}</div>}
        {errorPreview && <div className="iw-alert iw-error">{errorPreview}</div>}
        {loadingPreview ? <div className="iw-empty">正在生成预览…</div> : preview && <><div className="iw-report-summary"><span>报告摘要</span><p>{preview.summary ? render(preview.summary) : '暂无摘要'}</p></div><div className="iw-report-text"><b>文本预览</b><pre>{render(preview.text ?? preview.content ?? preview)}</pre></div></>}
      </section>
      <section className="iw-card">
        <div className="iw-card-head"><div><h2>计划管理</h2><p>设置日报 / 周报的定时计划</p></div><CalendarClock size={19}/></div>
        {errorSchedules && <div className="iw-alert iw-error">{errorSchedules}</div>}
        {notice && !errorSchedules && <div className="iw-alert iw-success" role="status">{notice}</div>}
        <div className="iw-channel"><b>渠道配置状态</b><span>{channelStatus?.message || (channel ? render(channel) : '未配置渠道状态')}</span><small>未配置前不会推送。此页面不会自动发送报告。</small></div>
        <form className="iw-schedule-form" onSubmit={save}>
          <label>计划名称<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required/></label>
          <div className="iw-form-row"><label>频率<select value={cadence} onChange={event => setCadence(event.target.value as 'daily' | 'weekly')}><option value="daily">日报</option><option value="weekly">周报</option></select></label><label>时间<input type="time" value={time} onChange={event => setTime(event.target.value)} required/></label></div>
          {cadence === 'weekly' && <label>每周<select value={dayOfWeek} onChange={event => setDayOfWeek(event.target.value)}>{weekdays.map((day, index) => <option key={index} value={index}>{day}</option>)}</select></label>}
          <label>时区<input value={timezone} onChange={event => setTimezone(event.target.value)} maxLength={64} required/></label>
          <div className="iw-form-row"><button className="iw-button iw-approve" disabled={saving}>{saving ? '保存中…' : editingScheduleId ? '保存修改' : '保存计划'}</button>{editingScheduleId && <button type="button" className="iw-button iw-secondary" onClick={clearEditor} disabled={saving}>取消编辑</button>}</div>
        </form>
      </section>
    </div>
    <section className="iw-card iw-schedule-table">
      <div className="iw-card-head"><div><h2>已有计划</h2><p>{schedules.length} 条计划</p></div></div>
      {loadingSchedules ? <div className="iw-empty">正在加载计划…</div> : schedules.length ? <div className="iw-table-wrap"><table><thead><tr><th>计划</th><th>频率</th><th>时间</th><th>时区</th><th>调度状态</th><th>最近运行</th><th>操作</th></tr></thead><tbody>{schedules.map(item => <tr key={item.id}>
        <td><b>{item.name}</b></td><td>{item.cadence === 'weekly' ? `周报 · ${weekdays[Number(item.dayOfWeek)] ?? item.dayOfWeek}` : '日报'}</td><td>{item.time}</td><td>{item.timezone}</td>
        <td><div>{schedulerLabel(item)}</div><button className={`iw-toggle ${item.enabled ? 'is-on' : ''}`} onClick={() => void update(item, { enabled: !item.enabled })} disabled={!item.enabled && !channelReady} title={!item.enabled && !channelReady ? '请先配置钉钉机器人' : undefined}>{item.enabled ? '已启用（点击停用）' : '已停用（点击启用）'}</button></td>
        <td>{item.lastRunAt ? <><time>{new Date(item.lastRunAt).toLocaleString('zh-CN')}</time><small>{lastResultLabel(item.lastResult)}</small></> : '从未运行'}</td>
        <td><button className="iw-icon-action" aria-label={`编辑 ${item.name}`} title="编辑计划" onClick={() => startEdit(item)}><Pencil size={14}/></button><button className="iw-icon-action" aria-label={`立即运行 ${item.name}`} title={!channelReady ? '请先配置钉钉机器人' : '立即运行此计划'} disabled={Boolean(runningScheduleId) || !channelReady} onClick={() => void runScheduleNow(item)}><Play size={14}/></button><button className="iw-icon-action" aria-label={`删除 ${item.name}`} title="删除计划" onClick={() => void remove(item)}><Trash2 size={15}/></button></td>
      </tr>)}</tbody></table></div> : <div className="iw-empty">暂无计划，请创建日报或周报计划。</div>}
    </section>
  </main>
}
