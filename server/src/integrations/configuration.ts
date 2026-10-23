import { nanoid } from 'nanoid'
import { db, decryptConfig, encryptConfig, getConnectorRow } from '../database.js'
import { K3_MASTER_DATA_FIELDS } from '../k3cloud-master-data.js'
import type { WorkspaceScope } from '../scope.js'
import { materialSourceFingerprint } from '../material-source-identity.js'
import { isK3CloudUrlAllowed } from './k3cloud-url-policy.js'

export type ConnectorProvider = 'k3cloud' | 'flowable' | 'dingtalk'
export type ConnectorConfig = Record<string, unknown>
type ConnectorScope = Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>
const secretFields: Record<ConnectorProvider, string[]> = {
  k3cloud: ['appId', 'appSecret', 'password', 'clientSecret'],
  flowable: ['password', 'clientSecret'],
  dingtalk: ['webhookSecret', 'cardCallbackSecret', 'appSecret', 'clientSecret'],
}
function jsonObjectEnv(name: string): Record<string, unknown> {
  try { const value = JSON.parse(process.env[name] ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} } catch { return {} }
}
function environmentScopeMatches(scope: ConnectorScope): boolean {
  const tenantId = process.env.CONNECTOR_DEFAULT_TENANT_ID?.trim() ?? ''
  const organizationId = process.env.CONNECTOR_DEFAULT_ORGANIZATION_ID?.trim() ?? ''
  const accountId = process.env.CONNECTOR_DEFAULT_ACCOUNT_ID?.trim() ?? ''
  return Boolean(tenantId && organizationId && accountId && tenantId === scope.tenantId && organizationId === scope.organizationId && accountId === scope.accountId)
}
function envConfig(scope: ConnectorScope, provider: ConnectorProvider): ConnectorConfig {
  // Global environment values are never implicitly shared across tenants. They are
  // available only when an operator explicitly binds them to this exact scope.
  if (!environmentScopeMatches(scope)) return {}
  if (provider === 'flowable') return { baseUrl: process.env.FLOWABLE_BASE_URL?.trim() ?? '', username: process.env.FLOWABLE_USERNAME?.trim() ?? '', password: process.env.FLOWABLE_PASSWORD ?? '', timeoutMs: Number(process.env.FLOWABLE_TIMEOUT_MS ?? 10000), userMap: jsonObjectEnv('FLOWABLE_USER_MAP_JSON'), groupMap: jsonObjectEnv('FLOWABLE_GROUP_MAP_JSON') }
  // K3Cloud connection settings are configured only through PLM's encrypted,
  // scope-bound record. The transport may separately use a non-secret timeout override.
  if (provider === 'k3cloud') return {}
  return {
    webhookUrl: process.env.DINGTALK_WEBHOOK_URL?.trim() || process.env.DINGTALK_ROBOT_WEBHOOK?.trim() || '', webhookSecret: process.env.DINGTALK_WEBHOOK_SECRET ?? process.env.DINGTALK_ROBOT_SECRET ?? '',
    cardCallbackSecret: process.env.DINGTALK_CARD_CALLBACK_SECRET ?? '', appKey: process.env.DINGTALK_APP_KEY?.trim() ?? '', appSecret: process.env.DINGTALK_APP_SECRET ?? '',
    templateId: process.env.DINGTALK_CARD_TEMPLATE_ID?.trim() ?? '', corpId: process.env.DINGTALK_CORP_ID?.trim() ?? '', publicAppUrl: process.env.PUBLIC_APP_URL?.trim() ?? '', userMapping: jsonObjectEnv('DINGTALK_USER_MAP_JSON'),
  }
}
function requiredFields(provider: ConnectorProvider, config: ConnectorConfig): string[] {
  if (provider === 'flowable') return ['baseUrl', 'username', 'password'].filter(key => !String(config[key] ?? '').trim())
  if (provider === 'k3cloud') return ['baseUrl', 'accountId', 'username', 'organization', 'appId', 'appSecret'].filter(key => !String(config[key] ?? '').trim())
  return typeof config.webhookUrl === 'string' && config.webhookUrl.trim() ? [] : ['webhookUrl']
}
function validateBaseUrl(value: unknown, provider: ConnectorProvider): void {
  if (value === undefined || value === '') return
  if (typeof value !== 'string' || value.length > 500) throw new Error(`${provider} baseUrl must be a URL.`)
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${provider} baseUrl must be a valid URL.`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`${provider} baseUrl must use HTTP(S) without embedded credentials, query or fragment.`)
  if (url.protocol === 'http:' && process.env.NODE_ENV === 'production') {
    const approvedFlowable = provider === 'flowable' && (value === 'http://172.16.77.80:18081/flowable-rest/service' || (url.hostname === '100.83.138.26' && ['18080', '18081'].includes(url.port) && (url.pathname === '/flowable-rest/service' || url.pathname === '/flowable-rest/service/')))
    const privateK3Cloud = provider === 'k3cloud' && isK3CloudUrlAllowed(url)
    if (!approvedFlowable && !privateK3Cloud) throw new Error('Connector URLs must use HTTPS in production; only private-IP K3Cloud URLs and the approved Flowable endpoint may use HTTP.')
  }
}
function validateConfig(provider: ConnectorProvider, config: ConnectorConfig): void {
  if (provider === 'flowable' || provider === 'k3cloud') validateBaseUrl(config.baseUrl, provider)
  if (provider === 'dingtalk' && config.webhookUrl) {
    let url: URL
    try { url = new URL(String(config.webhookUrl)) } catch { throw new Error('DingTalk webhook must be a valid HTTPS URL.') }
    if (url.protocol !== 'https:' || !['oapi.dingtalk.com', 'api.dingtalk.com'].includes(url.hostname)) throw new Error('DingTalk webhook must use an official HTTPS API host.')
  }
  if (provider === 'dingtalk' && config.publicAppUrl) validateBaseUrl(config.publicAppUrl, provider)
  if (provider === 'k3cloud' && config.formAllowlist !== undefined) {
    const allowlist = config.formAllowlist
    if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) throw new Error('K3Cloud formAllowlist must be a FormId-to-FieldKeys object.')
    for (const [formId, fields] of Object.entries(allowlist as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(formId) || !Array.isArray(fields) || fields.length > 100 || fields.some(field => typeof field !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(field))) throw new Error('K3Cloud formAllowlist contains invalid FormId/FieldKeys.')
    }
  }
  if (provider === 'k3cloud' && config.materialSource !== undefined) {
    const source = config.materialSource as Record<string, unknown>
    const names = ['id', 'number', 'name', 'specification', 'unit', 'groupNumber', 'groupId', 'organization']
    if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.formId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(source.formId) || !source.fields || typeof source.fields !== 'object' || Array.isArray(source.fields)) throw new Error('K3Cloud materialSource must contain an explicit formId and field mapping.')
    const fields = source.fields as Record<string, unknown>
    if (Object.keys(fields).length !== names.length || names.some(name => typeof fields[name] !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(String(fields[name]))) || new Set(Object.values(fields)).size !== names.length) throw new Error('K3Cloud materialSource requires eight distinct mapped fields: id, number, name, specification, unit, groupNumber, groupId, organization.')
  }
  if (provider === 'k3cloud' && config.dailyReportSources !== undefined) {
    const sources = config.dailyReportSources
    const kinds = new Set(['shipment', 'purchase-receipt', 'sales-order', 'purchase-order', 'receivable', 'payable', 'sales-invoice', 'purchase-invoice'])
    const canonicalFields = new Set(['id', 'billNo', 'date', 'modifiedAt', 'partyNumber', 'partyName', 'materialName', 'quantity', 'unit', 'unitPrice', 'currency', 'originalAmount', 'amountCny', 'settledAmountCny', 'status', 'upstreamId', 'upstreamBillNo', 'upstreamLineId', 'taxAmount', 'taxAmountCny'])
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new Error('K3Cloud dailyReportSources must be a document-kind mapping object.')
    for (const [kind, raw] of Object.entries(sources as Record<string, unknown>)) {
      if (!kinds.has(kind) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('K3Cloud dailyReportSources contains an invalid document kind or mapping.')
      const mapping = raw as Record<string, unknown>, fields = mapping.fields
      if (typeof mapping.formId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(mapping.formId) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`K3Cloud ${kind} mapping must include a valid formId and fields object.`)
      for (const [canonical, field] of Object.entries(fields as Record<string, unknown>)) if (!canonicalFields.has(canonical) || typeof field !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(field)) throw new Error(`K3Cloud ${kind} mapping contains an invalid canonical or ERP field name.`)
    }
  }
  if (provider === 'k3cloud' && config.masterDataSources !== undefined) {
    const sources = config.masterDataSources
    const kinds = new Set(['customer', 'supplier', 'salesperson', 'user'])
    const canonicalFields = new Set<string>(K3_MASTER_DATA_FIELDS)
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new Error('K3Cloud masterDataSources must be a master-data-kind mapping object.')
    for (const [kind, raw] of Object.entries(sources as Record<string, unknown>)) {
      if (!kinds.has(kind) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('K3Cloud masterDataSources contains an invalid kind or mapping.')
      const mapping = raw as Record<string, unknown>, fields = mapping.fields
      if (typeof mapping.formId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(mapping.formId) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`K3Cloud ${kind} master-data mapping must include a valid formId and fields object.`)
      for (const [canonical, field] of Object.entries(fields as Record<string, unknown>)) if (!canonicalFields.has(canonical) || typeof field !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(field)) throw new Error(`K3Cloud ${kind} mapping contains an invalid or unsupported master-data field.`)
    }
  }
  if (provider === 'k3cloud' && config.k3DataSyncSchedule !== undefined) {
    const schedule = config.k3DataSyncSchedule
    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw new Error('K3Cloud k3DataSyncSchedule must be an object.')
    const value = schedule as Record<string, unknown>
    if (typeof value.enabled !== 'boolean' || ![1, 6, 12, 24].includes(Number(value.intervalHours))) throw new Error('K3Cloud sync schedule must use enabled=true/false and an interval of 1, 6, 12 or 24 hours.')
    if (value.enabled) {
      const docs = config.dailyReportSources && typeof config.dailyReportSources === 'object' ? config.dailyReportSources as Record<string, unknown> : {}
      const masters = config.masterDataSources && typeof config.masterDataSources === 'object' ? config.masterDataSources as Record<string, unknown> : {}
      if (['shipment', 'purchase-receipt', 'sales-order', 'purchase-order', 'receivable', 'payable', 'sales-invoice', 'purchase-invoice'].some(kind => !docs[kind]) || ['customer', 'supplier', 'salesperson', 'user'].some(kind => !masters[kind])) throw new Error('启用 K3Cloud 定时同步前，必须配置八类销售/采购单据、销项发票/采购收票及客户、供应商、业务员、ERP 用户四类主数据映射。')
    }
  }
  if (provider === 'flowable' && config.userMap !== undefined && (!config.userMap || typeof config.userMap !== 'object' || Array.isArray(config.userMap))) throw new Error('Flowable userMap must be an email-to-engine-user JSON object.')
  if (provider === 'flowable' && config.groupMap !== undefined) {
    const groupMap = config.groupMap
    if (!groupMap || typeof groupMap !== 'object' || Array.isArray(groupMap)) throw new Error('Flowable groupMap must be an engine-user-to-candidate-groups JSON object.')
    for (const [userId, groups] of Object.entries(groupMap as Record<string, unknown>)) {
      if (!userId.trim() || userId.length > 160 || !Array.isArray(groups) || groups.length > 100 || groups.some(group => typeof group !== 'string' || !group.trim() || group.length > 160 || /[\u0000-\u001f\u007f]/.test(group))) throw new Error('Flowable groupMap entries must map engine user IDs to at most 100 valid candidate group IDs.')
    }
  }
  if (provider === 'dingtalk' && config.userMapping !== undefined && (!config.userMapping || typeof config.userMapping !== 'object' || Array.isArray(config.userMapping))) throw new Error('DingTalk userMapping must be a corpId:userId-to-engine-user JSON object.')
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.length > 2000) throw new Error(`${key} is too long.`)
    if (secretFields[provider].includes(key) && value !== undefined && typeof value !== 'string') throw new Error(`${key} must be text.`)
  }
}

export function saveConnectorConfig(scope: WorkspaceScope, provider: ConnectorProvider, incoming: ConnectorConfig, updatedBy: string): { revision: number; updatedAt: string } {
  return db.transaction(() => {
    const previous = getConnectorRow(scope, provider)
    const conflicting = db.prepare(`SELECT id,tenant_id AS tenantId,organization_id AS organizationId FROM connector_configs WHERE account_id=? AND provider=?`).get(scope.accountId, provider) as { id: string; tenantId: string; organizationId: string } | undefined
    if (conflicting && (conflicting.tenantId !== scope.tenantId || conflicting.organizationId !== scope.organizationId)) throw new Error('connector_scope_mismatch')
    const existing = previous ? decryptConfig<ConnectorConfig>(previous.encryptedConfig) : envConfig(scope, provider)
    const next: ConnectorConfig = { ...existing, ...incoming }
    for (const key of secretFields[provider]) if (incoming[key] === '' || incoming[key] === undefined) next[key] = existing[key] ?? ''
    const clear = Array.isArray(incoming.clearSecrets) ? incoming.clearSecrets.filter((key): key is string => typeof key === 'string') : []
    for (const key of clear) if (secretFields[provider].includes(key)) next[key] = ''
    delete next.clearSecrets
    validateConfig(provider, next)
    if (provider === 'k3cloud') {
      // Track identity at configuration changes, not just successful scans: A -> B -> A
      // without an intermediate refresh must not revive drafts. Credentials are excluded.
      const identity = (config: ConnectorConfig): string | null => { try { return materialSourceFingerprint(config) } catch { return null } }
      const previousIdentity = identity(existing), nextIdentity = identity(next)
      delete next.materialSourceEpoch
      if (nextIdentity) next.materialSourceEpoch = nextIdentity === previousIdentity && typeof existing.materialSourceEpoch === 'string' && existing.materialSourceEpoch ? existing.materialSourceEpoch : nanoid()
    }
    const now = new Date().toISOString(), revision = (previous?.revision ?? 0) + 1
    db.prepare(`INSERT INTO connector_configs(id,tenant_id,organization_id,account_id,provider,encrypted_config,revision,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,provider) DO UPDATE SET tenant_id=excluded.tenant_id,organization_id=excluded.organization_id,encrypted_config=excluded.encrypted_config,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(previous?.id ?? nanoid(), scope.tenantId, scope.organizationId, scope.accountId, provider, encryptConfig(next), revision, updatedBy, now)
    return { revision, updatedAt: now }
  }).immediate()
}

export function connectorSummary(scope: WorkspaceScope, provider: ConnectorProvider) {
  const row = getConnectorRow(scope, provider), config = getConnectorConfig(scope, provider), missingFields = requiredFields(provider, config), safe: Record<string, unknown> = {}
  const safeFields = provider === 'k3cloud'
    ? ['baseUrl', 'accountId', 'username', 'organization', 'lcid', 'timeoutMs', 'formAllowlist', 'dailyReportSources', 'masterDataSources', 'materialSource', 'k3DataSyncSchedule']
    : provider === 'flowable' ? ['baseUrl', 'username', 'timeoutMs', 'userMap', 'groupMap'] : ['webhookUrl', 'appKey', 'templateId', 'corpId', 'publicAppUrl', 'userMapping']
  for (const key of safeFields) if (config[key] !== undefined && config[key] !== '') safe[key] = config[key]
  const presentSecrets = secretFields[provider].filter(key => typeof config[key] === 'string' && String(config[key]).length > 0)
  const source = row ? 'encrypted-scope-setting' : provider !== 'k3cloud' && environmentScopeMatches(scope) ? 'environment-scope-default' : 'unconfigured'
  return { provider, configured: missingFields.length === 0, missingFields, config: safe, secrets: Object.fromEntries(secretFields[provider].map(key => [key, presentSecrets.includes(key)])), revision: row?.revision ?? 0, updatedAt: row?.updatedAt ?? null, source }
}
export function connectorCredentialConfig(scope: WorkspaceScope, provider: ConnectorProvider): ConnectorConfig { return getConnectorConfig(scope, provider) }
export function getConnectorConfig<T extends ConnectorConfig = ConnectorConfig>(scope: WorkspaceScope, provider: ConnectorProvider): T {
  const row = getConnectorRow(scope, provider)
  return (row ? decryptConfig<T>(row.encryptedConfig) : envConfig(scope, provider)) as T
}

export function listConnectorConfigs(provider: ConnectorProvider): Array<{ scope: WorkspaceScope; config: ConnectorConfig }> {
  const rows = db.prepare(`SELECT t.id AS tenantId,t.name AS tenantName,o.id AS organizationId,o.name AS organizationName,
      a.id AS accountId,a.name AS accountName,c.encrypted_config AS encryptedConfig
    FROM connector_configs c JOIN accounts a ON a.id=c.account_id AND a.tenant_id=c.tenant_id AND a.organization_id=c.organization_id AND a.status='active'
      JOIN organizations o ON o.id=a.organization_id AND o.tenant_id=a.tenant_id AND o.status='active'
      JOIN tenants t ON t.id=a.tenant_id AND t.status='active'
    WHERE c.provider=? ORDER BY t.name,o.name,a.name`).all(provider) as Array<{ tenantId: string; tenantName: string; organizationId: string; organizationName: string; accountId: string; accountName: string; encryptedConfig: string }>
  return rows.map(row => ({ scope: { tenantId: row.tenantId, tenantName: row.tenantName, organizationId: row.organizationId, organizationName: row.organizationName, accountId: row.accountId, accountName: row.accountName, role: 'admin', isPlatformAdmin: false }, config: decryptConfig<ConnectorConfig>(row.encryptedConfig) }))
}
