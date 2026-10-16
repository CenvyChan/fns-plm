import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson, jsonRequest } from './api'
import { Activity, CheckCircle2, Cloud, Database, KeyRound, RefreshCw, Save, Send, Workflow } from 'lucide-react'
import './connector-settings.css'

type Provider = 'flowable' | 'k3cloud' | 'dingtalk'
type Summary = { provider: Provider; configured: boolean; missingFields: string[]; config: Record<string, unknown>; secrets: Record<string, boolean>; revision: number; updatedAt: string | null; source: string }
type ConnectorPayload = { providers: Record<Provider, Summary> }
type StatusResult = { connected?: boolean; configured?: boolean; message?: string; ready?: boolean; authenticated?: boolean; lastError?: string | null; ok?: boolean }
type K3QueryResult = { fields?: string[]; rows?: Array<Record<string, unknown>>; cached?: boolean }
const providerNames: Record<Provider, string> = { flowable: 'Flowable 审批引擎', k3cloud: '金蝶云星空 K3Cloud', dingtalk: '钉钉机器人与通知' }
const secretFields: Record<Provider, string[]> = { flowable: ['password'], k3cloud: ['appSecret', 'password'], dingtalk: ['webhookSecret', 'cardCallbackSecret', 'appSecret'] }
const emptyProviders = { flowable: { provider: 'flowable', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' }, k3cloud: { provider: 'k3cloud', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' }, dingtalk: { provider: 'dingtalk', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' } } as unknown as Record<Provider, Summary>

export default function ConnectorWorkbench() {
  const [providers, setProviders] = useState<Record<Provider, Summary>>(emptyProviders)
  const [active, setActive] = useState<Provider>('flowable')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [allowlistText, setAllowlistText] = useState('{}')
  const [userMapText, setUserMapText] = useState('{}')
  const [groupMapText, setGroupMapText] = useState('{}')
  const [dingtalkMapText, setDingtalkMapText] = useState('{}')
  const [clearSecrets, setClearSecrets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshNotice, setRefreshNotice] = useState('')
  const [testResult, setTestResult] = useState<StatusResult | null>(null)
  const [queryFormId, setQueryFormId] = useState('')
  const [queryFields, setQueryFields] = useState<string[]>([])
  const [queryLimit, setQueryLimit] = useState(50)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [queryResult, setQueryResult] = useState<K3QueryResult | null>(null)

  const load = useCallback(async (manual = false) => {
    setLoading(true); setError('')
    if (manual) setRefreshNotice('')
    try {
      const result = await apiJson<ConnectorPayload>('/api/integrations/settings')
      setProviders(result.providers)
      if (manual) setRefreshNotice('连接器配置已重新读取。')
    } catch (value) { setError(value instanceof Error ? value.message : '连接器设置读取失败。') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const current = providers[active]
  const savedAllowlist = useMemo(() => {
    const value = current?.config?.formAllowlist
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, string[]>
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([formId, fields]) => [
      [formId, Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string' && field.length > 0) : []],
    ])) as Record<string, string[]>
  }, [current?.config])
  const availableForms = Object.keys(savedAllowlist).filter(formId => savedAllowlist[formId].length > 0)
  const selectedFields = savedAllowlist[queryFormId] ?? []
  useEffect(() => {
    const config = current?.config ?? {}
    setDraft(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])))
    setAllowlistText(JSON.stringify(config.formAllowlist ?? {}, null, 2))
    setUserMapText(JSON.stringify(config.userMap ?? {}, null, 2))
    setGroupMapText(JSON.stringify(config.groupMap ?? {}, null, 2))
    setDingtalkMapText(JSON.stringify(config.userMapping ?? {}, null, 2))
    setClearSecrets([]); setTestResult(null); setNotice('')
    setQueryFormId(''); setQueryFields([]); setQueryResult(null); setQueryError('')
  }, [active, current?.revision, loading])

  useEffect(() => {
    if (!availableForms.includes(queryFormId)) { setQueryFormId(availableForms[0] ?? ''); setQueryFields([]) }
  }, [availableForms.join('\0'), queryFormId])

  const setValue = (key: string, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  const toggleClear = (key: string) => setClearSecrets(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])

  const save = async () => {
    setSaving(true); setError(''); setNotice(''); setTestResult(null)
    setRefreshNotice('')
    try {
      const config: Record<string, unknown> = { ...draft, clearSecrets }
      if (active === 'k3cloud') {
        let allowlist: unknown
        try { allowlist = JSON.parse(allowlistText) } catch { throw new Error('K3Cloud allowlist 必须是有效 JSON 对象。') }
        if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) throw new Error('K3Cloud allowlist 必须是 FormId 到字段数组的 JSON 对象。')
        config.formAllowlist = allowlist
        if (draft.lcid) config.lcid = draft.lcid
        if (draft.timeoutMs) config.timeoutMs = Number(draft.timeoutMs)
      }
      if (active === 'flowable') {
        if (draft.timeoutMs) config.timeoutMs = Number(draft.timeoutMs)
        try { config.userMap = JSON.parse(userMapText) } catch { throw new Error('Flowable 用户映射必须是有效 JSON 对象。') }
        try { config.groupMap = JSON.parse(groupMapText) } catch { throw new Error('Flowable 候选组映射必须是有效 JSON 对象。') }
      }
      if (active === 'dingtalk') {
        try { config.userMapping = JSON.parse(dingtalkMapText) } catch { throw new Error('钉钉用户映射必须是有效 JSON 对象。') }
      }
      const result = await apiJson<{ settings: Summary }>(`/api/integrations/settings/${active}`, jsonRequest('PUT', config))
      setProviders(previous => ({ ...previous, [active]: result.settings })); setDraft(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !secretFields[active].includes(key))))
      setClearSecrets([]); setNotice('连接器配置已加密保存；密钥不会再次显示。')
    } catch (value) { setError(value instanceof Error ? value.message : '配置保存失败。') }
    finally { setSaving(false) }
  }

  const test = async () => {
    setTesting(true); setError(''); setNotice(''); setTestResult(null)
    setRefreshNotice('')
    try {
      const result = await apiJson<{ status: StatusResult }>(`/api/integrations/settings/${active}/test`, jsonRequest('POST', {}))
      setTestResult(result.status)
      if (result.status?.connected || result.status?.ok || result.status?.authenticated) setNotice('测试完成，连接成功。')
      else setError(result.status?.message || '测试未通过；请核对配置与服务端网络。')
    } catch (value) { setError(value instanceof Error ? value.message : '连接测试失败。') }
    finally { setTesting(false) }
  }

  const runK3Query = async () => {
    setQueryError(''); setQueryResult(null)
    if (!testResult?.authenticated) { setQueryError('请先成功测试当前 K3Cloud 连接，再执行手动查询。'); return }
    if (!queryFormId || !savedAllowlist[queryFormId]?.length) { setQueryError('当前服务端保存的 allowlist 中没有可查询的 FormId/字段。'); return }
    if (!queryFields.length) { setQueryError('请选择至少一个 allowlist 中的字段。'); return }
    if (!Number.isInteger(queryLimit) || queryLimit < 1 || queryLimit > 200) { setQueryError('返回行数必须为 1–200 的整数。'); return }
    setQueryLoading(true)
    try {
      const result = await apiJson<K3QueryResult>('/api/k3cloud/query', jsonRequest('POST', { formId: queryFormId, fieldKeys: queryFields.join(','), limit: queryLimit }))
      setQueryResult(result)
    } catch (value) { setQueryError(value instanceof Error ? value.message : 'K3Cloud 查询失败。') }
    finally { setQueryLoading(false) }
  }

  const icon = useMemo(() => active === 'flowable' ? <Workflow size={18}/> : active === 'k3cloud' ? <Database size={18}/> : <Cloud size={18}/>, [active])
  const secretStatus = (key: string) => current?.secrets?.[key] ? '已设置；当前不会回显' : '尚未设置'
  const secretInput = (key: string, label: string) => <label className="connector-field"><span>{label}<small>{secretStatus(key)}</small></span><input type="password" autoComplete="new-password" value={draft[key] ?? ''} onChange={event => setValue(key, event.target.value)} placeholder={current?.secrets?.[key] ? '留空保持现有密钥' : '输入密钥'} />{current?.secrets?.[key] && <button type="button" className={`secret-clear ${clearSecrets.includes(key) ? 'checked' : ''}`} onClick={() => toggleClear(key)}>{clearSecrets.includes(key) ? '将清除' : '清除现有值'}</button>}</label>
  const textInput = (key: string, label: string, placeholder = '') => <label className="connector-field"><span>{label}</span><input value={draft[key] ?? ''} onChange={event => setValue(key, event.target.value)} placeholder={placeholder}/></label>

  return <div className="connector-page">
    <header className="connector-heading"><div><span className="connector-overline"><KeyRound size={14}/> ENTERPRISE CONNECTORS</span><h1>系统集成与连接器</h1><p>配置按当前账套隔离并使用 AES-256-GCM 加密保存。密钥只写不读回；真实第三方连接需填写本企业正式租户凭证。</p></div><button className="connector-refresh" aria-busy={loading} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15}/>{loading ? '刷新中…' : '刷新'}</button></header>
    {refreshNotice && <div className="connector-notice" role="status"><CheckCircle2 size={15}/>{refreshNotice}</div>}
    <div className="connector-status-strip"><span><i className="status-dot"/>当前账套</span><b>配置修改仅作用于所选组织/账套</b><small>环境变量配置作为新账套默认值；加密账套配置优先。</small></div>
    <div className="connector-layout">
      <nav className="connector-nav" aria-label="连接器">{(['flowable', 'k3cloud', 'dingtalk'] as Provider[]).map(provider => <button key={provider} className={active === provider ? 'selected' : ''} onClick={() => setActive(provider)}><span>{provider === 'flowable' ? <Workflow size={17}/> : provider === 'k3cloud' ? <Database size={17}/> : <Cloud size={17}/>}</span><b>{providerNames[provider]}</b><small className={providers[provider].configured ? 'ready' : ''}>{providers[provider].configured ? '已配置' : '待配置'}</small></button>)}</nav>
      <section className="connector-card">
        <div className="connector-card-head"><span className="connector-provider-icon">{icon}</span><div><span className="connector-overline">{active.toUpperCase()}</span><h2>{providerNames[active]}</h2></div><span className={`connector-badge ${current?.configured ? 'configured' : ''}`}>{current?.configured ? '配置完整' : '尚未就绪'}</span></div>
        {loading ? <div className="connector-loading">正在读取加密配置…</div> : <>
          {active === 'flowable' && <div className="connector-fields"><div className="connector-help"><b>审批引擎连接</b><span>使用 Flowable REST API；每个账套首次发起真实流程时，服务端会按 tenantId 部署 PLM BPMN 定义。用户映射用于登录身份到 Flowable 用户的绑定；候选组映射也按当前组织/账套隔离。</span></div>{textInput('baseUrl', 'REST API Base URL', 'http://127.0.0.1:8090/flowable-rest/process-api')}{textInput('username', '服务账号', 'flowable-admin')}{secretInput('password', 'Basic Auth 密码')}{textInput('timeoutMs', '请求超时（毫秒）', '10000')}<label className="connector-field connector-json-field"><span>Flowable 用户映射（JSON）<small>键为 Momentum 登录邮箱，值为 Flowable 用户 ID</small></span><textarea rows={5} spellCheck={false} value={userMapText} onChange={event => setUserMapText(event.target.value)} placeholder={'{\n  "engineer@company.com": "flowable-user-id"\n}'}/></label><label className="connector-field connector-json-field"><span>Flowable 候选组映射（JSON）<small>键为 Flowable 用户 ID，值为该用户可处理的候选组 ID 数组</small></span><textarea rows={5} spellCheck={false} value={groupMapText} onChange={event => setGroupMapText(event.target.value)} placeholder={'{\n  "flowable-user-id": ["material-reviewers"]\n}'}/></label></div>}
          {active === 'k3cloud' && <div className="connector-fields"><div className="connector-help"><b>金蝶云星空 WebAPI（只读）</b><span>查询接口受 FormId/FieldKeys 服务端 allowlist 控制。此配置不会提供写单据能力。</span></div>{textInput('baseUrl', 'WebAPI Base URL', 'https://erp.example.com/k3cloud')}{textInput('accountId', '账套 ID')}{textInput('username', '接口用户名')}{textInput('organization', '组织标识')}{textInput('appId', '第三方应用 AppId')}{secretInput('appSecret', 'AppSecret')}{textInput('lcid', '语言 ID（LCID）', '2052')}<label className="connector-field connector-json-field"><span>只读查询 allowlist（JSON）<small>键为 FormId，值为允许查询的字段数组</small></span><textarea rows={8} spellCheck={false} value={allowlistText} onChange={event => setAllowlistText(event.target.value)} placeholder={'{\n  "BD_MATERIAL": ["FMATERIALID", "FNumber", "FName"]\n}'}/></label></div>}
          {active === 'dingtalk' && <div className="connector-fields"><div className="connector-help"><b>钉钉机器人通知</b><span>测试按钮会向当前账套配置的群机器人发送一条明确标注的测试消息。卡片回调还需在钉钉开放平台配置回调地址与身份映射。</span></div>{textInput('webhookUrl', '自定义机器人 Webhook', 'https://oapi.dingtalk.com/robot/send?access_token=…')}{secretInput('webhookSecret', '机器人签名密钥')}{textInput('publicAppUrl', '应用 HTTPS 公网地址（用于通知链接）', 'https://plm.company.com')}{textInput('corpId', '企业 CorpId')}{textInput('appKey', '钉钉应用 AppKey')}{secretInput('appSecret', '钉钉应用 AppSecret')}{textInput('templateId', '互动卡片模板 ID')}{secretInput('cardCallbackSecret', '互动卡片回调签名密钥')}<label className="connector-field connector-json-field"><span>钉钉身份映射（JSON）<small>键 corpId:userId，值为 Flowable assignee 用户 ID</small></span><textarea rows={5} spellCheck={false} value={dingtalkMapText} onChange={event => setDingtalkMapText(event.target.value)} placeholder={'{\n  "ding-corp:ding-user-id": "flowable-user-id"\n}'}/></label></div>}
          {active === 'k3cloud' && <section className="connector-fields" aria-label="K3Cloud 手动只读查询"><div className="connector-help"><b>手动只读查询</b><span>仅使用当前服务端已保存的 FormId/字段 allowlist；查询只会在点击下方按钮后发起，不提供自由过滤表达式。</span></div>
            {!current?.configured && <div className="connector-help" role="status">K3Cloud 尚未配置，请先保存连接配置与服务端 allowlist。</div>}
            {current?.configured && availableForms.length === 0 && <div className="connector-help" role="status">当前服务端保存的配置没有有效 allowlist（FormId → 字段数组），请配置并保存后再查询。</div>}
            {current?.configured && availableForms.length > 0 && <>
              {!testResult?.authenticated && <div className="connector-help" role="status">查询前必须先成功测试连接；尚无本次页面会话中的成功连接测试。</div>}
              <label className="connector-field"><span>FormId</span><select value={queryFormId} onChange={event => { setQueryFormId(event.target.value); setQueryFields([]); setQueryResult(null) }}>{availableForms.map(formId => <option key={formId} value={formId}>{formId}</option>)}</select></label>
              <fieldset className="connector-field"><legend>允许字段</legend>{selectedFields.map(field => <label key={field} style={{ display: 'inline-flex', gap: 6, marginRight: 14, alignItems: 'center' }}><input type="checkbox" checked={queryFields.includes(field)} onChange={event => setQueryFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field))}/>{field}</label>)}</fieldset>
              <label className="connector-field"><span>最大返回行数（1–200）</span><input type="number" min={1} max={200} step={1} value={queryLimit} onChange={event => setQueryLimit(Number(event.target.value))}/></label>
              <button type="button" className="secondary-button" onClick={() => void runK3Query()} disabled={queryLoading || !testResult?.authenticated || !queryFields.length}>{queryLoading ? '查询中…' : '手动执行只读查询'}</button>
              {queryError && <div className="connector-error" role="alert">{queryError}</div>}
              {queryResult && <div className="connector-test-result" role="status">返回 {queryResult.rows?.length ?? 0} 行{queryResult.cached ? '（缓存结果）' : ''}。</div>}
              {queryResult?.rows && queryResult.rows.length > 0 && <div style={{ overflowX: 'auto', maxHeight: 360 }}><table><thead><tr>{(queryResult.fields ?? queryFields).map(field => <th key={field}>{field}</th>)}</tr></thead><tbody>{queryResult.rows.slice(0, 20).map((row, index) => <tr key={index}>{(queryResult.fields ?? queryFields).map(field => <td key={field}>{String(row[field] ?? '—').slice(0, 300)}</td>)}</tr>)}</tbody></table><small>最多预览 20 行；单元格最多显示 300 个字符。</small></div>}
            </>}
          </section>}
          <div className="connector-meta"><span>配置来源：{current?.source === 'encrypted-account-setting' ? '账套加密配置' : current?.source === 'environment-default' ? '服务器环境变量默认值' : '尚未配置'}</span><span>版本：{current?.revision ?? 0}{current?.updatedAt ? ` · 更新于 ${new Date(current.updatedAt).toLocaleString()}` : ''}</span></div>
          {error && <div className="connector-error" role="alert">{error}</div>}{notice && <div className="connector-notice" role="status"><CheckCircle2 size={15}/>{notice}</div>}
          {testResult && <div className="connector-test-result"><Activity size={15}/>{testResult.message ?? (testResult.connected || testResult.ok ? '连接成功。' : '测试完成。')}</div>}
          {active !== 'k3cloud' && !current?.configured && <div className="connector-help" role="status">当前连接器尚未配置完整；请先填写并加密保存有效配置，再执行测试。</div>}
          <div className="connector-actions"><button className="secondary-button" onClick={() => void test()} disabled={testing || saving || !current?.configured}>{active === 'dingtalk' ? <Send size={15}/> : <Activity size={15}/>} {testing ? '测试中…' : active === 'dingtalk' ? '发送测试消息' : '测试连接'}</button><button className="primary-button" onClick={() => void save()} disabled={saving || testing}><Save size={15}/>{saving ? '保存中…' : '加密保存配置'}</button></div>
        </>}
      </section>
    </div>
    <div className="connector-footnote">生产安全：请为每个环境设置固定的 APP_ENCRYPTION_KEY，并通过 HTTPS 保护浏览器与 API。更换数据库时须同时备份该密钥；丢失密钥后，已加密的外部连接凭证不可恢复。</div>
  </div>
}
