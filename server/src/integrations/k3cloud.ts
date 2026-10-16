import { createHash } from 'node:crypto'
import { cacheGet, cacheSet } from './cache.js'
import { summarizeK3Metadata } from '../k3cloud-metadata.js'

const LOGIN_PATH = '/Kingdee.BOS.WebApi.ServicesStub.AuthService.LoginByAppSecret.common.kdsvc'
const QUERY_PATH = '/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc'
const METADATA_PATH = '/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.QueryBusinessInfo.common.kdsvc'
const QUERY_TTL_SECONDS = 60
const MAX_FILTER_LENGTH = 4_000
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/
const FIELD_KEYS_PATTERN = /^[A-Za-z0-9_.,\[\] ]{1,2000}$/

export type K3CloudConfig = {
  baseUrl: string; accountId: string; username: string; appId: string; appSecret: string; lcid: string | number; organization: string; timeoutMs?: number
}
type NormalizedConfig = Omit<K3CloudConfig, 'lcid'> & { lcid: string; timeoutMs: number }
type Session = { cookie: string; expiresAt: number }

type LoginPayload = { acctID: string; username: string; appid: string; appsecret: string; lcid: string }
export type K3CloudStatus = { configured: boolean; ready: boolean; authenticated: boolean; accountConfigured: boolean; organizationConfigured: boolean; lastError: string | null }
export type K3CloudQueryInput = { formId: string; fieldKeys: string; filterString?: string; limit: number; startRow?: number; orderString?: string }
export type K3CloudQueryResult = { fields: string[]; rows: Array<Record<string, string | null>>; rawRows: unknown[][]; cached: boolean }

const sessions = new Map<string, Session>()
const loginInFlight = new Map<string, Promise<string>>()
const lastErrors = new Map<string, string>()

function getConfig(input?: Partial<K3CloudConfig>): NormalizedConfig | undefined {
  const source = input ?? {}
  const values = {
    baseUrl: String(source.baseUrl ?? '').trim(), accountId: String(source.accountId ?? '').trim(), username: String(source.username ?? '').trim(),
    appId: String(source.appId ?? '').trim(), appSecret: String(source.appSecret ?? ''), lcid: String(source.lcid ?? '').trim(), organization: String(source.organization ?? '').trim(),
    timeoutMs: Number(source.timeoutMs ?? process.env.K3CLOUD_TIMEOUT_MS ?? 20000),
  }
  if (Object.values({ baseUrl: values.baseUrl, accountId: values.accountId, username: values.username, appId: values.appId, appSecret: values.appSecret, lcid: values.lcid, organization: values.organization }).some(value => !value)) return undefined
  try {
    const parsed = new URL(values.baseUrl)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined
    values.baseUrl = parsed.origin + parsed.pathname.replace(/\/$/, '')
  } catch { return undefined }
  if (process.env.NODE_ENV === 'production' && new URL(values.baseUrl).protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(new URL(values.baseUrl).hostname) && process.env.ALLOW_INSECURE_CONNECTOR_HTTP !== 'true') return undefined
  if (!Number.isFinite(values.timeoutMs) || values.timeoutMs < 1000) values.timeoutMs = 20000
  values.timeoutMs = Math.min(values.timeoutMs, 120000)
  return values
}
function configKey(config: NormalizedConfig, scopeKey = ''): string {
  return createHash('sha256').update([scopeKey, config.baseUrl, config.accountId, config.organization, config.appId, config.username, config.appSecret].join(String.fromCharCode(0))).digest('hex')
}
function recordFailure(key: string): void { lastErrors.set(key, new Date().toISOString()) }
function endpoint(baseUrl: string, path: string): string { return `${baseUrl.replace(/\/$/, '')}${path}` }

function cookieFromResponse(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
  const parts = cookies.flatMap(cookie => cookie.split(/,(?=[^;,]+=)/g)).map(cookie => cookie.trim().split(';', 1)[0]).filter(part => part.includes('='))
  return parts.length ? [...new Set(parts)].join('; ') : undefined
}

async function login(config: NormalizedConfig, scopeKey = ''): Promise<string> {
  const key = configKey(config, scopeKey), cached = sessions.get(key)
  if (cached && Date.now() < cached.expiresAt) return cached.cookie
  sessions.delete(key)
  let pending = loginInFlight.get(key)
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(endpoint(config.baseUrl, LOGIN_PATH), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ acctID: config.accountId, username: config.username, appid: config.appId, appsecret: config.appSecret, lcid: config.lcid } satisfies LoginPayload),
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        const cookie = cookieFromResponse(response)
        if (!response.ok || !cookie) throw new Error('login failed')
        sessions.set(key, { cookie, expiresAt: Date.now() + 15 * 60_000 })
        lastErrors.delete(key)
        return cookie
      } catch { recordFailure(key); throw new Error('K3Cloud authentication failed') }
      finally { loginInFlight.delete(key) }
    })()
    loginInFlight.set(key, pending)
  }
  return pending
}

export function k3cloudStatus(input?: Partial<K3CloudConfig>, scopeKey = ''): K3CloudStatus {
  const config = getConfig(input)
  const source = input ?? {}, key = config ? configKey(config, scopeKey) : ''
  return {
    configured: Boolean(config), ready: Boolean(config), authenticated: Boolean(key && sessions.get(key) && Date.now() < sessions.get(key)!.expiresAt),
    accountConfigured: Boolean(String(source.accountId ?? '').trim()), organizationConfigured: Boolean(String(source.organization ?? '').trim()), lastError: key ? lastErrors.get(key) ?? null : null,
  }
}

export async function testK3CloudConnection(input?: Partial<K3CloudConfig>, scopeKey = ''): Promise<K3CloudStatus> {
  const config = getConfig(input)
  if (!config) return k3cloudStatus(input, scopeKey)
  try { await login(config, scopeKey); return k3cloudStatus(config, scopeKey) }
  catch { return { ...k3cloudStatus(config, scopeKey), lastError: new Date().toISOString() } }
}

/** Discover fields from the current account's QueryBusinessInfo metadata; never queries business rows. */
export async function discoverK3CloudFormMetadata(formId: string, connection?: Partial<K3CloudConfig>, scopeKey = '') {
  const config = getConfig(connection)
  if (!config) throw new Error('K3Cloud is not fully configured')
  if (!IDENTIFIER_PATTERN.test(formId)) throw new Error('Invalid K3Cloud FormId')
  const key = configKey(config, scopeKey)
  try {
    const cookie = await login(config, scopeKey)
    const response = await fetch(endpoint(config.baseUrl, METADATA_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([JSON.stringify({ FormId: formId })]),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if (!response.ok) throw new Error('metadata request failed')
    const text = await response.text()
    let payload: unknown = text
    try { payload = JSON.parse(text) as unknown } catch { /* metadata may itself be returned as JSON text */ }
    const result = summarizeK3Metadata(formId, payload)
    lastErrors.delete(key)
    return result
  } catch (error) {
    recordFailure(key)
    if (error instanceof Error && error.message.startsWith('K3Cloud 元数据响应')) throw error
    throw new Error('K3Cloud metadata query failed')
  }
}

function validateQuery(input: K3CloudQueryInput): { fields: string[]; filter: string; startRow: number } {
  if (!IDENTIFIER_PATTERN.test(input.formId)) throw new Error('Invalid K3Cloud FormId')
  if (typeof input.fieldKeys !== 'string' || !FIELD_KEYS_PATTERN.test(input.fieldKeys)) throw new Error('Invalid K3Cloud FieldKeys')
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 2_000) throw new Error('K3Cloud Limit must be an integer from 1 to 2000')
  const startRow = input.startRow ?? 0
  if (!Number.isInteger(startRow) || startRow < 0) throw new Error('Invalid K3Cloud StartRow')
  const filter = input.filterString ?? ''
  if (typeof filter !== 'string' || filter.length > MAX_FILTER_LENGTH) throw new Error('Invalid K3Cloud FilterString')
  if (input.orderString !== undefined && (typeof input.orderString !== 'string' || input.orderString.length > 500)) throw new Error('Invalid K3Cloud OrderString')
  const fields = input.fieldKeys.split(',').map(field => field.trim())
  if (!fields.length || fields.some(field => !field)) throw new Error('Invalid K3Cloud FieldKeys')
  return { fields, filter, startRow }
}
function queryCacheKey(config: NormalizedConfig, input: K3CloudQueryInput, fields: string[], filter: string, startRow: number, scopeKey: string): string {
  const digest = createHash('sha256').update(JSON.stringify([configKey(config, scopeKey), input.formId, fields.join(','), filter, String(input.limit), String(startRow), input.orderString ?? ''])).digest('hex')
  return `k3cloud:v2:${digest}`
}

export async function queryK3Cloud(input: K3CloudQueryInput, connection?: Partial<K3CloudConfig>, scopeKey = ''): Promise<K3CloudQueryResult> {
  const config = getConfig(connection)
  if (!config) throw new Error('K3Cloud is not fully configured')
  const key = configKey(config, scopeKey), { fields, filter, startRow } = validateQuery(input), cacheKey = queryCacheKey(config, input, fields, filter, startRow, scopeKey)
  try {
    const cached = await cacheGet(cacheKey)
    if (cached) { const parsed = JSON.parse(cached) as { rawRows: unknown[][] }; if (Array.isArray(parsed.rawRows)) return mapRows(fields, parsed.rawRows, true) }
  } catch { /* Cache is optional: keep the read-only ERP query available. */ }
  try {
    const cookie = await login(config, scopeKey)
    const payload = { FormId: input.formId, FieldKeys: input.fieldKeys, FilterString: filter, TopRowCount: 0, Limit: input.limit, StartRow: startRow, OrderString: input.orderString ?? '' }
    const response = await fetch(endpoint(config.baseUrl, QUERY_PATH), { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify([JSON.stringify(payload)]), signal: AbortSignal.timeout(config.timeoutMs) })
    if (response.status === 401 || response.status === 403) { sessions.delete(key); throw new Error('query failed') }
    if (!response.ok) throw new Error('query failed')
    const rawRows = extractRows(await response.json())
    const mapped = mapRows(fields, rawRows, false)
    try { await cacheSet(cacheKey, JSON.stringify({ rawRows }), QUERY_TTL_SECONDS) } catch { /* non-fatal */ }
    lastErrors.delete(key)
    return mapped
  } catch { recordFailure(key); throw new Error('K3Cloud query failed') }
}

function extractRows(result: unknown): unknown[][] {
  let value = result
  if (typeof value === 'string') { try { value = JSON.parse(value) as unknown } catch { throw new Error('invalid response') } }
  if (Array.isArray(value) && value.every(row => Array.isArray(row))) return value as unknown[][]
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>, candidate = object.Result ?? object.result ?? object.Data ?? object.data
    if (Array.isArray(candidate) && candidate.every(row => Array.isArray(row))) return candidate as unknown[][]
    if (candidate && typeof candidate === 'object') { const nested = candidate as Record<string, unknown>, rows = nested.Result ?? nested.Rows ?? nested.Data; if (Array.isArray(rows) && rows.every(row => Array.isArray(row))) return rows as unknown[][] }
  }
  throw new Error('invalid response')
}
function mapRows(fields: string[], rawRows: unknown[][], cached: boolean): K3CloudQueryResult {
  return { fields, rows: rawRows.map(raw => Object.fromEntries(fields.map((field, index) => [field, raw[index] === undefined || raw[index] === null ? null : String(raw[index])]))), rawRows, cached }
}
