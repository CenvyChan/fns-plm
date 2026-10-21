import { useEffect, useRef, useState } from 'react'
import { apiFetch, type AuthUser } from './api'

export type StartContext = {
  canStart: boolean; reason?: string; engineMode: 'mock-test' | 'flowable' | 'unconfigured' | 'blocked'
  publishedVersion: number | null; versionId?: string
  formBindings: { nodeId: string; formKey: string; formVersion: number }[]
}
export const engineLabel = (mode?: string) => ({ 'mock-test': '隔离测试模式（可连接模拟或真实测试引擎）', flowable: '已验证补丁的 Flowable 连接', unconfigured: '未配置引擎', blocked: '安全策略阻断' }[mode || ''] || '以服务端安全策略为准')
type Attempt = { key: string; state: 'pending' | 'uncertain' | 'started'; processInstanceId?: string }
export default function CustomProcessStartPanel({ modelId, currentUser, refreshKey }: { modelId: string; currentUser?: AuthUser; refreshKey: number }) {
  const [context, setContext] = useState<StartContext | null>(null), [open, setOpen] = useState(false)
  const [title, setTitle] = useState(''), [businessId, setBusinessId] = useState(''), [changeSummary, setChangeSummary] = useState('')
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState<Attempt | null>(null)
  const sending = useRef(false)
  const storageKey = `plm-custom-start:${currentUser?.id}:${currentUser?.tenantId}:${currentUser?.organizationId}:${currentUser?.accountId}:${modelId}`
  const permitted = currentUser?.role === 'admin' || currentUser?.role === 'plm_manager'
  const remember = (value: Attempt | null) => { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); setAttempt(value) }
  useEffect(() => {
    let active = true
    setContext(null); setOpen(false); setConfirmed(false); setError(''); setTitle(''); setBusinessId(''); setChangeSummary('')
    try { setAttempt(JSON.parse(sessionStorage.getItem(storageKey) || 'null')) } catch { setAttempt({ key: '', state: 'uncertain' }) }
    if (!modelId) return
    void (async () => {
      try {
        const response = await apiFetch(`/api/bpmn-models/${encodeURIComponent(modelId)}/start-context`)
        if (!response.ok) throw Error(`无法读取已发布启动上下文（HTTP ${response.status}）`)
        const data: StartContext = await response.json()
        if (active) setContext(data)
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '读取失败') }
    })()
    return () => { active = false }
  }, [modelId, storageKey, refreshKey])
  const start = async () => {
    if (sending.current || busy || attempt || !permitted || !context?.canStart || !context.versionId || !confirmed || !title.trim()) return
    sending.current = true; setBusy(true); setError('')
    const next: Attempt = { key: crypto.randomUUID(), state: 'pending' }
    try {
      // Persist before dispatch: a lost response or remount must never silently create another instance.
      remember(next)
      const response = await apiFetch(`/api/bpmn-models/${encodeURIComponent(modelId)}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': next.key },
        body: JSON.stringify({ title: title.trim(), ...(businessId.trim() ? { businessId: businessId.trim() } : {}), ...(changeSummary.trim() ? { changeSummary: changeSummary.trim() } : {}), expectedVersionId: context.versionId }),
      })
      const data = await response.json()
      if (!response.ok) {
        const uncertain = response.status >= 500 || /uncertain|in_progress|recorded/.test(data.error || '')
        remember(uncertain ? { ...next, state: 'uncertain' } : null)
        throw Error(uncertain ? '启动结果不明确，禁止重复提交。请由管理员按下方请求标识核对引擎和启动记录。' : `启动被拒绝：${data.message || data.error || response.status}。请重新选择模型以刷新已发布版本与权限。`)
      }
      if (!data.processInstanceId) throw Error('启动响应缺少实例 ID，须人工核对，禁止重试。')
      remember({ ...next, state: 'started', processInstanceId: data.processInstanceId }); setOpen(false)
    } catch (e) {
      // Unknown transport/parsing outcome remains locked; never automatically retry a POST.
      setAttempt(current => current?.state === 'pending' ? { ...current, state: 'uncertain' } : current)
      const saved = sessionStorage.getItem(storageKey)
      if (saved) { const value = JSON.parse(saved) as Attempt; if (value.state === 'pending') remember({ ...value, state: 'uncertain' }) }
      setError(e instanceof Error ? e.message : '连接中断，结果不明确，禁止重复提交。')
    } finally { sending.current = false; setBusy(false) }
  }
  if (!modelId) return null
  return <section className="custom-process-start" aria-label="已发布自定义流程启动">
    <div><b>启动自定义流程</b><p>独立于四个内置业务流程入口；仅启动本模型最新成功发布的不可变版本，不使用当前草稿或最新表单替换绑定。</p></div>
    <p>{engineLabel(context?.engineMode)}{context?.publishedVersion ? ` · 已发布 v${context.publishedVersion}` : ' · 尚无可启动的发布版本'}</p>
    {context?.formBindings?.length ? <ul>{context.formBindings.map(binding => <li key={binding.nodeId}>{binding.nodeId} → 表单 {binding.formKey} 固定 v{binding.formVersion}</li>)}</ul> : <p>此已发布版本未绑定任务表单。</p>}
    {!permitted && <p>仅工作区管理员或 PLM 管理员可启动；服务端会再次校验权限与当前账套。</p>}
    {context?.reason && <p>{context.reason}</p>}
    {error && <p role="alert">{error}</p>}
    {attempt && <div role="status"><p>{attempt.state === 'started' ? `自定义流程已启动 · 实例 ID：${attempt.processInstanceId}` : '启动结果待核对；已锁定重复启动，请勿通过刷新或更换请求标识重试。'}</p><small>请求标识：{attempt.key}</small>{attempt.state === 'started' && <button className="bpmn-button" disabled={busy} onClick={() => { remember(null); setConfirmed(false); setTitle(''); setBusinessId(''); setChangeSummary(''); }}>准备另一次独立启动</button>}</div>}
    {!open && !attempt && <button className="bpmn-button primary" disabled={!permitted || !context?.canStart || !context.versionId || busy} onClick={() => { setOpen(true); setConfirmed(false); }}>启动已发布自定义流程</button>}
    {open && !attempt && <form onSubmit={e => { e.preventDefault(); void start() }}>
      <label>流程标题<input required maxLength={240} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label>业务编号（可选）<input maxLength={240} value={businessId} disabled={busy} onChange={e => setBusinessId(e.target.value)} /></label>
      <label>启动说明（可选）<textarea maxLength={4000} value={changeSummary} disabled={busy} onChange={e => setChangeSummary(e.target.value)} /></label>
      <label className="bpmn-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />确认启动已发布 v{context?.publishedVersion}，沿用以上固定表单版本；未保存草稿不会生效。</label>
      <button type="submit" className="bpmn-button primary" disabled={busy || !confirmed || !title.trim() || !context?.canStart}>确认启动自定义流程</button>
      <button type="button" className="bpmn-button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
    </form>}
  </section>
}
