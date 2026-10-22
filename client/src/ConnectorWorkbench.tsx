import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson, jsonRequest } from './api'
import { Activity, CheckCircle2, Cloud, Database, KeyRound, RefreshCw, Save, Send, Workflow } from 'lucide-react'
import './connector-settings.css'
import { K3CloudDirectoryPanel, K3CloudQueryPanel, type K3MasterDataKind, type K3MasterDataPayload, type K3QueryResult } from './K3CloudPanels'
import { K3CloudFormsPanel, type K3FormCatalogItem, type K3FormMetadata, type K3MappingTarget } from './K3CloudFormsPanel'
import { FlowableSettingsPanel, DingTalkSettingsPanel } from './ConnectorProviderPanels'
import { K3CloudConnectionPanel, K3CloudMappingPanel } from './K3CloudSettings'
import { flowableTestDisabledReason } from './flowable-settings-diagnostics'

type Provider = 'flowable' | 'k3cloud' | 'dingtalk'
type Summary = { provider: Provider; configured: boolean; missingFields: string[]; config: Record<string, unknown>; secrets: Record<string, boolean>; revision: number; updatedAt: string | null; source: string }
type ConnectorPayload = { providers: Record<Provider, Summary> }
type StatusResult = { connected?: boolean; configured?: boolean; message?: string; ready?: boolean; authenticated?: boolean; lastError?: string | null; ok?: boolean }
type K3SyncStatus = { schedule?: { enabled: boolean; intervalHours: number; timezone: string; ready: boolean; readinessMessage: string; schedulerState: string }; lastRun?: { finishedAt?: string; status?: string; source?: string; error?: string; businessSyncMode?: 'full' | 'incremental' | 'mixed'; businessRowCounts?: Record<string, number>; businessChangedRowCounts?: Record<string, number>; masterDataRowCounts?: Record<string, number> }; masterDataLastSyncedAt?: string | null; masterDataRowCounts?: Record<string, number> }
type K3WorkspaceSection = 'directory' | 'form-fields' | 'connection' | 'mapping' | 'query'
const k3WorkspaceSections: { id: K3WorkspaceSection; label: string; hint: string }[] = [
  { id: 'directory', label: '基础资料', hint: '只读目录' },
  { id: 'form-fields', label: '表单与字段', hint: '元数据发现' },
  { id: 'connection', label: '连接设置', hint: '凭证与 allowlist' },
  { id: 'mapping', label: '采集映射', hint: '字段与同步计划' },
  { id: 'query', label: '手动查询', hint: '受控只读查询' },
]
const providerNames: Record<Provider, string> = { flowable: 'Flowable 审批引擎', k3cloud: '金蝶云星空 K3Cloud', dingtalk: '钉钉机器人与通知' }
const secretFields: Record<Provider, string[]> = { flowable: ['password'], k3cloud: ['appId', 'appSecret', 'password'], dingtalk: ['webhookSecret', 'cardCallbackSecret', 'appSecret'] }
const emptyProviders = { flowable: { provider: 'flowable', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' }, k3cloud: { provider: 'k3cloud', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' }, dingtalk: { provider: 'dingtalk', configured: false, missingFields: [], config: {}, secrets: {}, revision: 0, updatedAt: null, source: '' } } as unknown as Record<Provider, Summary>

export default function ConnectorWorkbench() {
  const [providers, setProviders] = useState<Record<Provider, Summary>>(emptyProviders)
  const [active, setActive] = useState<Provider>('flowable')
  const [flowableDraftDirty, setFlowableDraftDirty] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [allowlistText, setAllowlistText] = useState('{}')
  const [dailySourcesText, setDailySourcesText] = useState('{}')
  const [masterSourcesText, setMasterSourcesText] = useState('{}')
  const [k3SyncEnabled, setK3SyncEnabled] = useState(false)
  const [k3SyncIntervalHours, setK3SyncIntervalHours] = useState('1')
  const [k3SyncStatus, setK3SyncStatus] = useState<K3SyncStatus | null>(null)
  const [syncingK3, setSyncingK3] = useState(false)
  const [masterDataKind, setMasterDataKind] = useState<K3MasterDataKind>('customer')
  const [k3Section, setK3Section] = useState<K3WorkspaceSection>('directory')
  const [masterDataSearch, setMasterDataSearch] = useState('')
  const [masterData, setMasterData] = useState<K3MasterDataPayload | null>(null)
  const [masterDataLoading, setMasterDataLoading] = useState(false)
  const [masterDataError, setMasterDataError] = useState('')
  const [formCatalog, setFormCatalog] = useState<K3FormCatalogItem[]>([])
  const [formCatalogNote, setFormCatalogNote] = useState('')
  const [formCatalogLoading, setFormCatalogLoading] = useState(false)
  const [formCatalogError, setFormCatalogError] = useState('')
  const [discoverFormId, setDiscoverFormId] = useState('')
  const [formMetadata, setFormMetadata] = useState<K3FormMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [metadataError, setMetadataError] = useState('')
  const [formApplyNotice, setFormApplyNotice] = useState('')
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
      const [result, syncStatus] = await Promise.all([apiJson<ConnectorPayload>('/api/integrations/settings'), apiJson<K3SyncStatus>('/api/k3cloud/sync-status')])
      setProviders(result.providers)
      setK3SyncStatus(syncStatus)
      if (manual) setRefreshNotice('连接器配置已重新读取。')
    } catch (value) { setError(value instanceof Error ? value.message : '连接器设置读取失败。') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let currentRequest = true
    setFormCatalogLoading(true); setFormCatalogError('')
    apiJson<{ entries?: K3FormCatalogItem[]; note?: string }>('/api/k3cloud/form-catalog')
      .then(value => { if (currentRequest) { setFormCatalog(Array.isArray(value.entries) ? value.entries : []); setFormCatalogNote(value.note ?? '') } })
      .catch(value => { if (currentRequest) setFormCatalogError(value instanceof Error ? value.message : 'FormId 目录读取失败。') })
      .finally(() => { if (currentRequest) setFormCatalogLoading(false) })
    return () => { currentRequest = false }
  }, [])
  useEffect(() => {
    let currentRequest = true
    setMasterDataLoading(true); setMasterDataError('')
    apiJson<K3MasterDataPayload>(`/api/k3cloud/master-data?kind=${masterDataKind}`)
      .then(value => { if (currentRequest) setMasterData(value) })
      .catch(value => { if (currentRequest) setMasterDataError(value instanceof Error ? value.message : '主数据读取失败。') })
      .finally(() => { if (currentRequest) setMasterDataLoading(false) })
    return () => { currentRequest = false }
  }, [masterDataKind])

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
  const masterRecords = masterData?.records?.[masterDataKind] ?? []
  const normalizedMasterSearch = masterDataSearch.trim().toLocaleLowerCase()
  const filteredMasterRecords = masterRecords.filter(row => [row.number, row.name, row.status, row.category, row.department, row.ownerNumber, row.ownerName, row.modifiedAt].some(value => String(value ?? '').toLocaleLowerCase().includes(normalizedMasterSearch)))
  useEffect(() => {
    const config = current?.config ?? {}
    setDraft(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])))
    setAllowlistText(JSON.stringify(config.formAllowlist ?? {}, null, 2))
    setDailySourcesText(JSON.stringify(config.dailyReportSources ?? {}, null, 2))
    setMasterSourcesText(JSON.stringify(config.masterDataSources ?? {}, null, 2))
    const syncSchedule = config.k3DataSyncSchedule && typeof config.k3DataSyncSchedule === 'object' ? config.k3DataSyncSchedule as { enabled?: unknown; intervalHours?: unknown } : {}
    setK3SyncEnabled(syncSchedule.enabled === true)
    setK3SyncIntervalHours(String(syncSchedule.intervalHours ?? 1))
    setUserMapText(JSON.stringify(config.userMap ?? {}, null, 2))
    setGroupMapText(JSON.stringify(config.groupMap ?? {}, null, 2))
    setDingtalkMapText(JSON.stringify(config.userMapping ?? {}, null, 2))
    setClearSecrets([]); setTestResult(null); setNotice('')
    setFlowableDraftDirty(false)
    setQueryFormId(''); setQueryFields([]); setQueryResult(null); setQueryError('')
  }, [active, current?.revision, loading])

  useEffect(() => {
    if (!availableForms.includes(queryFormId)) { setQueryFormId(availableForms[0] ?? ''); setQueryFields([]) }
  }, [availableForms.join('\0'), queryFormId])

  const setValue = (key: string, value: string) => { if (active === 'flowable') setFlowableDraftDirty(true); setDraft(previous => ({ ...previous, [key]: value })) }
  const toggleClear = (key: string) => { if (active === 'flowable') setFlowableDraftDirty(true); setClearSecrets(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]) }

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
        let dailySources: unknown
        try { dailySources = JSON.parse(dailySourcesText) } catch { throw new Error('日报单据映射必须是有效 JSON 对象。') }
        if (!dailySources || typeof dailySources !== 'object' || Array.isArray(dailySources)) throw new Error('日报单据映射必须是单据类型到 FormId/字段映射的 JSON 对象。')
        config.dailyReportSources = dailySources
        let masterSources: unknown
        try { masterSources = JSON.parse(masterSourcesText) } catch { throw new Error('K3Cloud 主数据映射必须是有效 JSON 对象。') }
        if (!masterSources || typeof masterSources !== 'object' || Array.isArray(masterSources)) throw new Error('K3Cloud 主数据映射必须是类型到 FormId/字段映射的 JSON 对象。')
        config.masterDataSources = masterSources
        config.k3DataSyncSchedule = { enabled: k3SyncEnabled, intervalHours: Number(k3SyncIntervalHours) }
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
      setClearSecrets([]); if (active === 'flowable') setFlowableDraftDirty(false); setNotice('连接器配置已加密保存；密钥不会再次显示。')
      if (active === 'k3cloud') {
        try { setK3SyncStatus(await apiJson<K3SyncStatus>('/api/k3cloud/sync-status')) }
        catch { setRefreshNotice('配置已保存，但计划状态未能刷新；请点击“刷新”重新核对。') }
      }
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

  const runK3DataSync = async () => {
    setSyncingK3(true); setError(''); setNotice(''); setRefreshNotice('')
    try {
      const result = await apiJson<{ business: { totalRows: number }; masterData: { totalRows: number } }>('/api/k3cloud/sync', jsonRequest('POST', {}))
      setNotice(`K3Cloud 同步完成：业务单据 ${result.business.totalRows} 行，基础资料 ${result.masterData.totalRows} 行。`)
      const [status, snapshot] = await Promise.all([apiJson<K3SyncStatus>('/api/k3cloud/sync-status'), apiJson<K3MasterDataPayload>(`/api/k3cloud/master-data?kind=${masterDataKind}`)])
      setK3SyncStatus(status); setMasterData(snapshot)
    } catch (value) { setError(value instanceof Error ? value.message : 'K3Cloud 同步失败。') }
    finally { setSyncingK3(false) }
  }

  const refreshMasterData = async () => {
    setMasterDataLoading(true); setMasterDataError('')
    try { setMasterData(await apiJson<K3MasterDataPayload>(`/api/k3cloud/master-data?kind=${masterDataKind}`)) }
    catch (value) { setMasterDataError(value instanceof Error ? value.message : '主数据读取失败。') }
    finally { setMasterDataLoading(false) }
  }

  const discoverK3Form = async () => {
    setMetadataError(''); setFormApplyNotice(''); setFormMetadata(null)
    if (!testResult?.authenticated) { setMetadataError('请先成功测试当前 K3Cloud 连接。'); return }
    const formId = discoverFormId.trim()
    if (!formId) { setMetadataError('请输入或选择 FormId。'); return }
    setMetadataLoading(true)
    try {
      const result = await apiJson<K3FormMetadata>('/api/k3cloud/metadata/discover', jsonRequest('POST', { formId }))
      setFormMetadata(result)
      setNotice('已读取当前账套元数据；请核对字段后再应用草稿。')
    } catch (value) { setMetadataError(value instanceof Error ? value.message : 'K3Cloud 元数据发现失败。') }
    finally { setMetadataLoading(false) }
  }

  const applyK3FormDraft = (input: { formId: string; allowFields: string[]; target?: K3MappingTarget; mappingFields?: Record<string, string> }) => {
    if (!formMetadata || formMetadata.formId !== input.formId) { setMetadataError('表单元数据已变化，请重新查询后再应用。'); return }
    const queryable = new Set(formMetadata.fields.filter(field => field.visible && !field.isFlexParent).map(field => field.key))
    const selected = [...new Set(input.allowFields)].filter(field => queryable.has(field))
    if (!selected.length) { setMetadataError('请至少选择一个可查询字段或完成规范映射。'); return }
    try {
      const allowlistValue = JSON.parse(allowlistText) as Record<string, unknown>
      if (!allowlistValue || typeof allowlistValue !== 'object' || Array.isArray(allowlistValue)) throw new Error('K3Cloud allowlist 必须是 JSON 对象。')
      const previousFields = Array.isArray(allowlistValue[input.formId]) ? allowlistValue[input.formId] as unknown[] : []
      allowlistValue[input.formId] = [...new Set([...previousFields.filter((field): field is string => typeof field === 'string'), ...selected])]
      setAllowlistText(JSON.stringify(allowlistValue, null, 2))
      if (input.target) {
        const sourceText = ['customer', 'supplier', 'salesperson', 'user'].includes(input.target) ? masterSourcesText : dailySourcesText
        const sourceValue = JSON.parse(sourceText) as Record<string, unknown>
        if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) throw new Error('映射草稿必须是 JSON 对象。')
        const previous = sourceValue[input.target] && typeof sourceValue[input.target] === 'object' && !Array.isArray(sourceValue[input.target]) ? sourceValue[input.target] as Record<string, unknown> : {}
        const previousFields = previous.formId === input.formId && previous.fields && typeof previous.fields === 'object' && !Array.isArray(previous.fields) ? previous.fields as Record<string, unknown> : {}
        const validPreviousFields = Object.fromEntries(Object.entries(previousFields).filter(([, field]) => typeof field === 'string' && queryable.has(field)))
        const mappingFields = Object.fromEntries(Object.entries(input.mappingFields ?? {}).filter(([key, field]) => Boolean(key) && queryable.has(field)))
        sourceValue[input.target] = { formId: input.formId, fields: { ...validPreviousFields, ...mappingFields } }
        if (['customer', 'supplier', 'salesperson', 'user'].includes(input.target)) setMasterSourcesText(JSON.stringify(sourceValue, null, 2))
        else setDailySourcesText(JSON.stringify(sourceValue, null, 2))
      }
      setFormApplyNotice(`已将 ${selected.length} 个字段加入本地 allowlist 草稿${input.target ? `，并更新 ${input.target} 映射草稿` : ''}；请检查后点击“加密保存配置”。`)
      setMetadataError('')
    } catch (value) { setMetadataError(value instanceof Error ? value.message : '字段草稿应用失败。') }
  }

  const icon = useMemo(() => active === 'flowable' ? <Workflow size={18}/> : active === 'k3cloud' ? <Database size={18}/> : <Cloud size={18}/>, [active])
  const currentSecrets = current?.secrets ?? {}
  const showK3Toolbar = k3Section !== 'directory' || Boolean(error || notice || testResult)

  return (
    <div className="connector-page">
      <header className="connector-heading">
        <div>
          <span className="connector-overline"><KeyRound size={14}/> ENTERPRISE CONNECTORS</span>
          <h1>系统集成与连接器</h1>
          <p>配置按当前账套隔离并使用 AES-256-GCM 加密保存。密钥只写不读回；真实第三方连接需填写本企业正式租户凭证。</p>
        </div>
        <button className="connector-refresh" aria-busy={loading} onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={15}/>{loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      {refreshNotice && <div className="connector-notice" role="status"><CheckCircle2 size={15}/>{refreshNotice}</div>}
      <div className="connector-status-strip">
        <span><i className="status-dot"/>当前账套</span>
        <b>配置修改仅作用于所选组织/账套</b>
        <small>环境配置仅在匹配默认账套范围时回退；加密账套配置优先。</small>
      </div>

      <div className="connector-layout">
        <nav className="connector-nav" aria-label="连接器">
          {(['flowable', 'k3cloud', 'dingtalk'] as Provider[]).map(provider => (
            <button type="button" key={provider} className={active === provider ? 'selected' : ''} onClick={() => setActive(provider)}>
              <span>{provider === 'flowable' ? <Workflow size={17}/> : provider === 'k3cloud' ? <Database size={17}/> : <Cloud size={17}/>}</span>
              <b>{providerNames[provider]}</b>
              <small className={providers[provider].configured ? 'ready' : ''}>{providers[provider].configured ? '已配置' : '待配置'}</small>
            </button>
          ))}
        </nav>

        <section className="connector-card">
          <div className="connector-card-head">
            <span className="connector-provider-icon">{icon}</span>
            <div><span className="connector-overline">{active.toUpperCase()}</span><h2>{providerNames[active]}</h2></div>
            <span className={`connector-badge ${current?.configured ? 'configured' : ''}`}>{current?.configured ? '配置完整' : '尚未就绪'}</span>
          </div>

          {active === 'k3cloud' && (
            <div className="connector-workspace-nav" role="group" aria-label="K3Cloud 工作区">
              {k3WorkspaceSections.map(section => (
                <button type="button" key={section.id} className={k3Section === section.id ? 'selected' : ''} aria-pressed={k3Section === section.id} onClick={() => setK3Section(section.id)}>
                  <b>{section.label}</b><small>{section.hint}</small>
                </button>
              ))}
            </div>
          )}

          {active === 'k3cloud' && showK3Toolbar && (
            <div className="connector-workspace-toolbar">
              <div className="connector-workspace-feedback">
                {error && <div className="connector-error" role="alert">{error}</div>}
                {notice && <div className="connector-notice" role="status"><CheckCircle2 size={15}/>{notice}</div>}
                {testResult && <div className="connector-test-result" role="status"><Activity size={15}/>{testResult.message ?? (testResult.connected || testResult.ok ? '连接成功。' : '测试完成。')}</div>}
              </div>
              {k3Section !== 'directory' && (
                <div className="connector-actions">
                  <button className="secondary-button" onClick={() => void test()} disabled={testing || saving || !current?.configured}>
                    <Activity size={15}/>{testing ? '测试中…' : '测试连接'}
                  </button>
                  {(k3Section === 'connection' || k3Section === 'mapping' || k3Section === 'form-fields') && (
                    <button className="primary-button" onClick={() => void save()} disabled={saving || testing}>
                      <Save size={15}/>{saving ? '保存中…' : '加密保存配置'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {loading ? <div className="connector-loading">正在读取加密配置…</div> : (
            <>
              {active === 'flowable' && (
                <FlowableSettingsPanel
                  draft={draft}
                  missingFields={current?.missingFields ?? ['baseUrl', 'username', 'password']}
                  secrets={currentSecrets}
                  clearSecrets={clearSecrets}
                  onValueChange={setValue}
                  onToggleClear={toggleClear}
                  userMapText={userMapText}
                  onUserMapChange={value => { setUserMapText(value); setFlowableDraftDirty(true) }}
                  groupMapText={groupMapText}
                  onGroupMapChange={value => { setGroupMapText(value); setFlowableDraftDirty(true) }}
                />
              )}
              {active === 'k3cloud' && k3Section === 'connection' && (
                <K3CloudConnectionPanel
                  draft={draft}
                  secrets={currentSecrets}
                  clearSecrets={clearSecrets}
                  onValueChange={setValue}
                  onToggleClear={toggleClear}
                  allowlistText={allowlistText}
                  onAllowlistChange={setAllowlistText}
                  dailySourcesText={dailySourcesText}
                  onDailySourcesChange={setDailySourcesText}
                />
              )}
              {active === 'k3cloud' && k3Section === 'form-fields' && (
                <K3CloudFormsPanel
                  catalog={formCatalog}
                  catalogNote={formCatalogNote}
                  catalogLoading={formCatalogLoading}
                  catalogError={formCatalogError}
                  formId={discoverFormId}
                  onFormIdChange={value => { setDiscoverFormId(value); setFormMetadata(null); setMetadataError(''); setFormApplyNotice('') }}
                  metadata={formMetadata}
                  metadataLoading={metadataLoading}
                  metadataError={metadataError}
                  onDiscover={() => void discoverK3Form()}
                  authenticated={Boolean(testResult?.authenticated)}
                  savedAllowlist={savedAllowlist}
                  dailySourcesText={dailySourcesText}
                  masterSourcesText={masterSourcesText}
                  notice={formApplyNotice}
                  onApply={applyK3FormDraft}
                />
              )}
              {active === 'k3cloud' && k3Section === 'mapping' && (
                <K3CloudMappingPanel
                  masterSourcesText={masterSourcesText}
                  onMasterSourcesChange={setMasterSourcesText}
                  syncEnabled={k3SyncEnabled}
                  onSyncEnabledChange={setK3SyncEnabled}
                  syncIntervalHours={k3SyncIntervalHours}
                  onSyncIntervalChange={setK3SyncIntervalHours}
                  syncStatus={k3SyncStatus}
                  configured={Boolean(current?.configured)}
                  syncing={syncingK3}
                  onSync={() => void runK3DataSync()}
                />
              )}
              {active === 'k3cloud' && k3Section === 'directory' && (
                <K3CloudDirectoryPanel
                  kind={masterDataKind}
                  onKindChange={kind => { setMasterDataKind(kind); setMasterDataSearch('') }}
                  search={masterDataSearch}
                  onSearchChange={setMasterDataSearch}
                  data={masterData}
                  filteredRecords={filteredMasterRecords}
                  loading={masterDataLoading}
                  error={masterDataError}
                  onRefresh={() => void refreshMasterData()}
                />
              )}
              {active === 'k3cloud' && k3Section === 'query' && (
                <K3CloudQueryPanel
                  configured={Boolean(current?.configured)}
                  availableForms={availableForms}
                  formId={queryFormId}
                  onFormIdChange={formId => { setQueryFormId(formId); setQueryFields([]); setQueryResult(null) }}
                  selectedFields={selectedFields}
                  queryFields={queryFields}
                  onFieldToggle={(field, checked) => setQueryFields(previous => checked ? [...previous, field] : previous.filter(item => item !== field))}
                  limit={queryLimit}
                  onLimitChange={setQueryLimit}
                  authenticated={Boolean(testResult?.authenticated)}
                  loading={queryLoading}
                  error={queryError}
                  result={queryResult}
                  onRun={() => void runK3Query()}
                />
              )}
              {active === 'dingtalk' && (
                <DingTalkSettingsPanel
                  draft={draft}
                  secrets={currentSecrets}
                  clearSecrets={clearSecrets}
                  onValueChange={setValue}
                  onToggleClear={toggleClear}
                  userMappingText={dingtalkMapText}
                  onUserMappingChange={setDingtalkMapText}
                />
              )}

              {active !== 'k3cloud' || k3Section !== 'directory' ? (
                <div className="connector-meta">
                  <span>配置来源：{current?.source === 'encrypted-account-setting' ? '账套加密配置' : current?.source === 'environment-default' ? '服务器环境变量默认值' : '尚未配置'}</span>
                  <span>版本：{current?.revision ?? 0}{current?.updatedAt ? ` · 更新于 ${new Date(current.updatedAt).toLocaleString()}` : ''}</span>
                </div>
              ) : null}
              {active !== 'k3cloud' && error && <div className="connector-error" role="alert">{error}</div>}
              {active !== 'k3cloud' && notice && <div className="connector-notice" role="status"><CheckCircle2 size={15}/>{notice}</div>}
              {active !== 'k3cloud' && testResult && <div className="connector-test-result"><Activity size={15}/>{testResult.message ?? (testResult.connected || testResult.ok ? '连接成功。' : '测试完成。')}</div>}
              {active === 'flowable' && (flowableTestDisabledReason(current?.missingFields ?? ['baseUrl', 'username', 'password'], flowableDraftDirty) || !current?.configured) && <div className="connector-help" role="status">{flowableTestDisabledReason(current?.missingFields ?? ['baseUrl', 'username', 'password'], flowableDraftDirty) ?? '测试连接禁用：当前配置尚未完整，请补齐并加密保存后测试。'}</div>}
              {active === 'dingtalk' && !current?.configured && <div className="connector-help" role="status">当前连接器尚未配置完整；请先填写并加密保存有效配置，再执行测试。</div>}
              {active !== 'k3cloud' && (
                <div className="connector-actions">
                  <button className="secondary-button" onClick={() => void test()} disabled={testing || saving || !current?.configured || (active === 'flowable' && flowableDraftDirty)}>
                    {active === 'dingtalk' ? <Send size={15}/> : <Activity size={15}/>}
                    {testing ? '测试中…' : active === 'dingtalk' ? '发送测试消息' : '测试连接'}
                  </button>
                  <button className="primary-button" onClick={() => void save()} disabled={saving || testing}>
                    <Save size={15}/>{saving ? '保存中…' : '加密保存配置'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {(active !== 'k3cloud' || k3Section !== 'directory') && (
        <div className="connector-footnote">生产安全：请为每个环境设置固定的 APP_ENCRYPTION_KEY，并通过 HTTPS 保护浏览器与 API。更换数据库时须同时备份该密钥；丢失密钥后，已加密的外部连接凭证不可恢复。</div>
      )}
    </div>
  )
}
