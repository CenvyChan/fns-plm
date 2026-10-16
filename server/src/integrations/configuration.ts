import { nanoid } from 'nanoid'
import { db, decryptConfig, encryptConfig, getConnectorRow } from '../database.js'
import type { WorkspaceScope } from '../scope.js'

export type ConnectorProvider = 'k3cloud' | 'flowable' | 'dingtalk'
export type ConnectorConfig = Record<string, unknown>
type ConnectorScope = Pick<WorkspaceScope, 'tenantId' | 'organizationId' | 'accountId'>
const secretFields: Record<ConnectorProvider, string[]> = {
  k3cloud: ['appSecret', 'password', 'clientSecret'],
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
  if (provider === 'flowable') return { baseUrl: process.env.FLOWABLE_BASE_URL?.trim() ?? '', username: process.env.FLOWABLE_USERNAME?.trim() ?? '', password: process.env.FLOWABLE_PASSWORD ?? '', timeoutMs: Number(process.env.FLOWABLE_TIMEOUT_MS ?? 10000), userMap: jsonObjectEnv('FLOWABLE_USER_MAP_JSON') }
  if (provider === 'k3cloud') return {
    baseUrl: process.env.K3CLOUD_BASE_URL?.trim() ?? '', accountId: process.env.K3CLOUD_ACCOUNT_ID?.trim() ?? '', username: process.env.K3CLOUD_USERNAME?.trim() ?? '', organization: process.env.K3CLOUD_ORGANIZATION?.trim() ?? '',
    appId: process.env.K3CLOUD_APP_ID?.trim() ?? '', appSecret: process.env.K3CLOUD_APP_SECRET ?? '', password: process.env.K3CLOUD_PASSWORD ?? '', lcid: String(process.env.K3CLOUD_LCID ?? 2052), timeoutMs: Number(process.env.K3CLOUD_TIMEOUT_MS ?? 20000), formAllowlist: jsonObjectEnv('K3CLOUD_QUERY_ALLOWLIST'),
  }
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
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname) && process.env.ALLOW_INSECURE_CONNECTOR_HTTP !== 'true') throw new Error('External connector URLs must use HTTPS in production; local loopback services are allowed over HTTP.')
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
  if (provider === 'flowable' && config.userMap !== undefined && (!config.userMap || typeof config.userMap !== 'object' || Array.isArray(config.userMap))) throw new Error('Flowable userMap must be an email-to-engine-user JSON object.')
  if (provider === 'dingtalk' && config.userMapping !== undefined && (!config.userMapping || typeof config.userMapping !== 'object' || Array.isArray(config.userMapping))) throw new Error('DingTalk userMapping must be a corpId:userId-to-engine-user JSON object.')
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.length > 2000) throw new Error(`${key} is too long.`)
    if (secretFields[provider].includes(key) && value !== undefined && typeof value !== 'string') throw new Error(`${key} must be text.`)
  }
}

export function saveConnectorConfig(scope: WorkspaceScope, provider: ConnectorProvider, incoming: ConnectorConfig, updatedBy: string): { revision: number; updatedAt: string } {
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
  const now = new Date().toISOString(), revision = (previous?.revision ?? 0) + 1
  db.prepare(`INSERT INTO connector_configs(id,tenant_id,organization_id,account_id,provider,encrypted_config,revision,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,provider) DO UPDATE SET tenant_id=excluded.tenant_id,organization_id=excluded.organization_id,encrypted_config=excluded.encrypted_config,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(previous?.id ?? nanoid(), scope.tenantId, scope.organizationId, scope.accountId, provider, encryptConfig(next), revision, updatedBy, now)
  return { revision, updatedAt: now }
}

export function connectorSummary(scope: WorkspaceScope, provider: ConnectorProvider) {
  const row = getConnectorRow(scope, provider), config = getConnectorConfig(scope, provider), missingFields = requiredFields(provider, config), safe: Record<string, unknown> = {}
  const safeFields = provider === 'k3cloud'
    ? ['baseUrl', 'accountId', 'username', 'organization', 'appId', 'lcid', 'timeoutMs', 'formAllowlist']
    : provider === 'flowable' ? ['baseUrl', 'username', 'timeoutMs', 'userMap'] : ['webhookUrl', 'appKey', 'templateId', 'corpId', 'publicAppUrl', 'userMapping']
  for (const key of safeFields) if (config[key] !== undefined && config[key] !== '') safe[key] = config[key]
  const presentSecrets = secretFields[provider].filter(key => typeof config[key] === 'string' && String(config[key]).length > 0)
  const source = row ? 'encrypted-scope-setting' : environmentScopeMatches(scope) ? 'environment-scope-default' : 'unconfigured'
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
