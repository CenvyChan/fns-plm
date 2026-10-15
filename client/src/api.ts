export type UserRole = 'admin' | 'plm_manager' | 'reviewer' | 'member'
export type AuthUser = {
  id: string; email: string; displayName: string; role: UserRole; disabled: boolean; createdAt: string; isPlatformAdmin: boolean
  tenantId: string; tenantName: string; organizationId: string; organizationName: string; accountId: string; accountName: string; membershipId: string
}
export type UserScope = {
  membershipId: string; role: UserRole; accountId: string; accountName: string; accountCode?: string
  organizationId: string; organizationName: string; organizationCode?: string; tenantId: string; tenantName: string; tenantCode?: string
}

type ScopeIdentity = Pick<AuthUser, 'tenantId' | 'organizationId' | 'accountId'>
declare global {
  interface Window { __MOMENTUM_NATIVE__?: boolean; __MOMENTUM_CONFIG__?: { apiBaseUrl?: string } }
}

const TOKEN_KEY = 'momentum.mobile-token'
const SCOPE_KEY = 'momentum.verified-scope'
const API_BASE_KEY = 'momentum.api-base-url'
const buildApiBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL?.trim() ?? ''
const nativeBuild = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_NATIVE_APP === 'true'

export function isNativeApp(): boolean { return nativeBuild || window.__MOMENTUM_NATIVE__ === true }
export function getApiToken(): string { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export function setApiToken(value: string): void { try { if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY) } catch { /* native cookie-only mode remains supported */ } }
export function setApiScope(scope: ScopeIdentity | null | undefined): void {
  try {
    if (!scope || !scope.tenantId || !scope.organizationId || !scope.accountId) localStorage.removeItem(SCOPE_KEY)
    else localStorage.setItem(SCOPE_KEY, JSON.stringify({ tenantId: scope.tenantId, organizationId: scope.organizationId, accountId: scope.accountId }))
  } catch { /* API authorization still comes from the server session */ }
}
function getApiScope(): ScopeIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? 'null') as Partial<ScopeIdentity> | null
    return value?.tenantId && value.organizationId && value.accountId
      ? { tenantId: value.tenantId, organizationId: value.organizationId, accountId: value.accountId }
      : null
  } catch { return null }
}
export function getApiBaseUrl(): string {
  try { return (localStorage.getItem(API_BASE_KEY) || window.__MOMENTUM_CONFIG__?.apiBaseUrl || buildApiBase || '').trim().replace(/\/$/, '') } catch { return (window.__MOMENTUM_CONFIG__?.apiBaseUrl || buildApiBase || '').trim().replace(/\/$/, '') }
}
export function setApiBaseUrl(value: string): void {
  const raw = value.trim()
  if (!raw) { try { localStorage.removeItem(API_BASE_KEY) } catch { /* ignore */ }; return }
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error('服务器地址必须是没有路径、账号或查询参数的 HTTP(S) 地址。')
  if (isNativeApp() && parsed.protocol !== 'https:') throw new Error('移动客户端仅允许使用 HTTPS 服务端地址，避免在明文网络中传输账号凭证。')
  try { localStorage.setItem(API_BASE_KEY, parsed.origin) } catch { /* ignored */ }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/')) throw new Error('API 路径必须以 / 开头。')
  const base = getApiBaseUrl()
  const headers = new Headers(init.headers)
  const token = getApiToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const scope = getApiScope()
  if (scope) {
    headers.set('X-Tenant-ID', scope.tenantId)
    headers.set('X-Organization-ID', scope.organizationId)
    headers.set('X-Account-ID', scope.accountId)
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${base}${path}`, { ...init, headers, credentials: 'include' })
}

export async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init)
  let body: unknown = null
  try { body = await response.json() } catch { /* error below has stable status */ }
  if (!response.ok) {
    const message = body && typeof body === 'object' ? (body as Record<string, unknown>).message ?? (body as Record<string, unknown>).error : undefined
    throw new Error(typeof message === 'string' ? message : `请求失败（HTTP ${response.status}）`)
  }
  return body as T
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
}
