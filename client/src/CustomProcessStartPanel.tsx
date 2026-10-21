import { useEffect, useRef, useState } from 'react'
import { apiFetch, type AuthUser } from './api'
import { classifyStartFailure } from './customStartOutcome'

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
  const currentModelId = useRef(modelId)
  const currentStorageKey = useRef(storageKey)
  currentModelId.current = modelId
  currentStorageKey.current = storageKey
  const currentRefreshKey = useRef(refreshKey)
  currentRefreshKey.current = refreshKey
  const requestGeneration = useRef(0)
  type ContextRequest = { generation: number; model: string; key: string; refresh: number }
  const contextOwner = useRef<ContextRequest | null>(null)
  const isCurrent = (model: string, key: string) => currentModelId.current === model && currentStorageKey.current === key
  const isCurrentRequest = (request: ContextRequest) => requestGeneration.current === request.generation && isCurrent(request.model, request.key) && currentRefreshKey.current === request.refresh
  const contextIsCurrent = !!contextOwner.current && isCurrentRequest(contextOwner.current)
  const permitted = currentUser?.role === 'admin' || currentUser?.role === 'plm_manager'
  const remember = (value: Attempt | null, key = storageKey, model = modelId) => { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); if (isCurrent(model, key)) setAttempt(value) }
  const loadContext = async (request: ContextRequest, versionChanged = false) => {
    try {
      const response = await apiFetch(`/api/bpmn-models/${encodeURIComponent(request.model)}/start-context`)
      if (!response.ok) throw Error(versionChanged ? `版本已变化，但无法刷新启动上下文（HTTP ${response.status}）；请稍后重新读取。` : `无法读取已发布启动上下文（HTTP ${response.status}）`)
      const data: StartContext = await response.json()
      if (isCurrentRequest(request)) { contextOwner.current = request; setContext(data) }
    } catch (e) {
      if (isCurrentRequest(request)) { contextOwner.current = null; setContext(null); setError(e instanceof Error ? e.message : '读取失败') }
    }
  }
  useEffect(() => {
    const request = { generation: ++requestGeneration.current, model: modelId, key: storageKey, refresh: refreshKey }
    contextOwner.current = null
    setContext(null); setOpen(false); setConfirmed(false); setError(''); setTitle(''); setBusinessId(''); setChangeSummary('')
    try { setAttempt(JSON.parse(sessionStorage.getItem(storageKey) || 'null')) } catch { setAttempt({ key: '', state: 'uncertain' }) }
    if (modelId) void loadContext(request)
    // Invalidate both effect reads and any in-flight 409 refresh on cleanup/unmount.
    return () => { ++requestGeneration.current }
  }, [modelId, storageKey, refreshKey])
  const start = async () => {
    if (sending.current || busy || attempt || !contextIsCurrent || !permitted || !context?.canStart || !context.versionId || !confirmed || !title.trim()) return
    const operationModel = modelId, operationKey = storageKey
    const operationRequest = contextOwner.current!
    const operationContext = context
    const operationTitle = title.trim(), operationBusinessId = businessId.trim(), operationChangeSummary = changeSummary.trim()
    sending.current = true; setBusy(true); setError('')
    const next: Attempt = { key: crypto.randomUUID(), state: 'pending' }
    try {
      // Persist before dispatch: a lost response or remount must never silently create another instance.
      remember(next, operationKey, operationModel)
      const response = await apiFetch(`/api/bpmn-models/${encodeURIComponent(operationModel)}/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': next.key },
        body: JSON.stringify({ title: operationTitle, ...(operationBusinessId ? { businessId: operationBusinessId } : {}), ...(operationChangeSummary ? { changeSummary: operationChangeSummary } : {}), expectedVersionId: operationContext.versionId }),
      })
      let data: Record<string, unknown>
      try { data = await response.json() as Record<string, unknown> }
      catch { throw Error('启动响应无法解析，结果不明确，禁止重复提交。') }
      if (!response.ok) {
        const outcome = classifyStartFailure(response.status, data.error)
        const uncertain = outcome === 'uncertain'
        remember(uncertain ? { ...next, state: 'uncertain' } : null, operationKey, operationModel)
        if (response.status === 409 && data.error === 'published_version_changed') {
          // A late POST response must not supersede a newer effect/scope refresh.
          if (!isCurrentRequest(operationRequest)) return
          const request = { ...operationRequest, generation: ++requestGeneration.current }
          contextOwner.current = null
          setContext(null); setConfirmed(false); setOpen(true); setError('流程发布版本已更新。已重新读取最新的不可变流程及表单版本；请核对新版并重新确认后再试。')
          await loadContext(request, true)
          return
        }
        if (!uncertain && isCurrent(operationModel, operationKey)) setConfirmed(false)
        throw Error(uncertain ? '启动结果不明确，禁止重复提交。请由管理员按下方请求标识核对引擎和启动记录。' : `服务端确认未启动：${data.message || data.error || response.status}。请重新确认后重试。`)
      }
      if (typeof data.processInstanceId !== 'string' || !data.processInstanceId) throw Error('启动响应缺少实例 ID，须人工核对，禁止重试。')
      remember({ ...next, state: 'started', processInstanceId: data.processInstanceId }, operationKey, operationModel); if (isCurrent(operationModel, operationKey)) setOpen(false)
    } catch (e) {
      // Unknown transport/parsing outcome remains locked; never automatically retry a POST.
      const saved = sessionStorage.getItem(operationKey)
      if (saved) { const value = JSON.parse(saved) as Attempt; if (value.state === 'pending') remember({ ...value, state: 'uncertain' }, operationKey, operationModel) }
      if (isCurrent(operationModel, operationKey)) { setAttempt(current => current?.state === 'pending' ? { ...current, state: 'uncertain' } : current); setError(e instanceof Error ? e.message : '连接中断，结果不明确，禁止重复提交。') }
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
    {!open && !attempt && <button className="bpmn-button primary" disabled={!contextIsCurrent || !permitted || !context?.canStart || !context.versionId || busy} onClick={() => { setOpen(true); setConfirmed(false); }}>启动已发布自定义流程</button>}
    {open && !attempt && <form onSubmit={e => { e.preventDefault(); void start() }}>
      <label>流程标题<input required maxLength={240} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label>业务编号（可选）<input maxLength={240} value={businessId} disabled={busy} onChange={e => setBusinessId(e.target.value)} /></label>
      <label>启动说明（可选）<textarea maxLength={4000} value={changeSummary} disabled={busy} onChange={e => setChangeSummary(e.target.value)} /></label>
      <label className="bpmn-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />确认启动已发布 v{context?.publishedVersion}，沿用以上固定表单版本；未保存草稿不会生效。</label>
      <button type="submit" className="bpmn-button primary" disabled={busy || !contextIsCurrent || !confirmed || !title.trim() || !context?.canStart}>确认启动自定义流程</button>
      <button type="button" className="bpmn-button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
    </form>}
  </section>
}
