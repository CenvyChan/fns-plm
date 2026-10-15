import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { Router, type Request, type RequestHandler, type Response } from 'express'
import { nanoid } from 'nanoid'
import { db, getAppState, recordSecurityEvent, setAppState } from './database.js'
import { dingtalkSsoStatus, exchangeDingTalkAuthCode } from './dingtalk-sso.js'
import { migrateLegacyWorkspace } from './workspace-store.js'

const scrypt = promisify(scryptCallback)
const COOKIE_NAME = 'momentum_session'
const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MOBILE_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const PASSWORD_ACTIVATION_TTL_MS = 48 * 60 * 60 * 1000
const roles = ['admin', 'plm_manager', 'reviewer', 'member'] as const
export type UserRole = typeof roles[number]
export interface AuthUser {
  id: string; email: string; displayName: string; role: UserRole; disabled: boolean; createdAt: string; isPlatformAdmin: boolean
  tenantId: string; tenantName: string; organizationId: string; organizationName: string; accountId: string; accountName: string; membershipId: string
}
export type UserScope = Pick<AuthUser, 'tenantId' | 'tenantName' | 'organizationId' | 'organizationName' | 'accountId' | 'accountName' | 'membershipId' | 'role'>

declare module 'express-serve-static-core' {
  interface Request { authUser?: AuthUser; sessionTokenHash?: string }
}

type StoredUser = { id: string; email: string; displayName: string; passwordHash: string; passwordEnabled: boolean; createdAt: string; disabled: boolean; isPlatformAdmin: boolean }
type RateBucket = { count: number; resetAt: number }
const loginAttempts = new Map<string, RateBucket>()

function normalizeEmail(value: unknown): string { return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : '' }
function validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
function stringField(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function safeCode(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32) : ''
  return candidate || fallback
}
function bool(value: unknown): boolean { return Boolean(value) }
function tokenDigest(token: string): string { return createHash('sha256').update(token).digest('hex') }

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64) as Buffer
  return `${salt}:${derived.toString('hex')}`
}
async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, expectedHex] = encoded.split(':')
  if (!salt || !expectedHex || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) return false
  const actual = await scrypt(password, salt, 64) as Buffer
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const raw of header.split(';')) {
    const item = raw.trim(), split = item.indexOf('=')
    if (split < 0 || item.slice(0, split) !== name) continue
    try { return decodeURIComponent(item.slice(split + 1)) } catch { return undefined }
  }
  return undefined
}
function requestToken(req: Request): string | undefined {
  const header = req.get('authorization')
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/i)
  return match?.[1] ?? readCookie(req, COOKIE_NAME)
}
function writeSessionCookie(res: Response, token: string, ttlMs: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(ttlMs / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`)
}
function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`)
}
function logEvent(req: Request, event: string, userId?: string, subject?: string, scope?: Pick<AuthUser, 'tenantId' | 'organizationId' | 'accountId'>): void {
  const active = req.authUser
  recordSecurityEvent({ userId, tenantId: scope?.tenantId ?? active?.tenantId, organizationId: scope?.organizationId ?? active?.organizationId, accountId: scope?.accountId ?? active?.accountId, event, subject, ip: req.ip, userAgent: req.get('user-agent') })
}
function getUser(email: string): StoredUser | undefined {
  const row = db.prepare(`SELECT id,email,display_name AS displayName,password_hash AS passwordHash,password_enabled AS passwordEnabled,created_at AS createdAt,disabled,is_platform_admin AS isPlatformAdmin FROM users WHERE email=? COLLATE NOCASE`).get(email) as { id: string; email: string; displayName: string; passwordHash: string; passwordEnabled: number; createdAt: string; disabled: number; isPlatformAdmin: number } | undefined
  return row ? { id: row.id, email: row.email, displayName: row.displayName, passwordHash: row.passwordHash, passwordEnabled: bool(row.passwordEnabled), createdAt: row.createdAt, disabled: bool(row.disabled), isPlatformAdmin: bool(row.isPlatformAdmin) } : undefined
}
function getUserById(userId: string): StoredUser | undefined {
  const row = db.prepare(`SELECT id,email,display_name AS displayName,password_hash AS passwordHash,password_enabled AS passwordEnabled,created_at AS createdAt,disabled,is_platform_admin AS isPlatformAdmin FROM users WHERE id=?`).get(userId) as { id: string; email: string; displayName: string; passwordHash: string; passwordEnabled: number; createdAt: string; disabled: number; isPlatformAdmin: number } | undefined
  return row ? { id: row.id, email: row.email, displayName: row.displayName, passwordHash: row.passwordHash, passwordEnabled: bool(row.passwordEnabled), createdAt: row.createdAt, disabled: bool(row.disabled), isPlatformAdmin: bool(row.isPlatformAdmin) } : undefined
}
function defaultAccountForUser(userId: string): string | undefined {
  const row = db.prepare(`SELECT account_id AS accountId FROM tenant_memberships WHERE user_id=? AND disabled=0 ORDER BY created_at LIMIT 1`).get(userId) as { accountId: string } | undefined
  return row?.accountId
}
function scopesForUser(userId: string) {
  return db.prepare(`SELECT m.id AS membershipId,m.role,a.id AS accountId,a.name AS accountName,a.code AS accountCode,
      o.id AS organizationId,o.name AS organizationName,o.code AS organizationCode,t.id AS tenantId,t.name AS tenantName,t.code AS tenantCode
    FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id JOIN organizations o ON o.id=m.organization_id AND o.tenant_id=m.tenant_id
      JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=? AND m.disabled=0 AND a.status='active' AND o.status='active' AND t.status='active'
    ORDER BY t.name,o.name,a.name`).all(userId) as Array<UserScope & { tenantCode: string; organizationCode: string; accountCode: string }>
}
function resolveSession(token: string): { user: AuthUser; digest: string } | undefined {
  const digest = tokenDigest(token)
  let row = db.prepare(`SELECT s.user_id AS userId,s.active_account_id AS accountId,u.email,u.display_name AS displayName,u.created_at AS createdAt,
      u.disabled AS userDisabled,u.is_platform_admin AS isPlatformAdmin,m.id AS membershipId,m.role,m.disabled AS membershipDisabled,
      a.name AS accountName,o.id AS organizationId,o.name AS organizationName,t.id AS tenantId,t.name AS tenantName
    FROM sessions s JOIN users u ON u.id=s.user_id
      LEFT JOIN accounts a ON a.id=s.active_account_id
      LEFT JOIN organizations o ON o.id=a.organization_id
      LEFT JOIN tenants t ON t.id=a.tenant_id
      LEFT JOIN tenant_memberships m ON m.user_id=u.id AND m.account_id=a.id AND m.disabled=0 AND a.status='active' AND o.status='active' AND t.status='active'
    WHERE s.token_hash=? AND s.expires_at>?`).get(digest, new Date().toISOString()) as Record<string, unknown> | undefined
  if (!row) return undefined
  if (!row.accountId) {
    const accountId = defaultAccountForUser(String(row.userId))
    if (!accountId) return undefined
    db.prepare('UPDATE sessions SET active_account_id=? WHERE token_hash=?').run(accountId, digest)
    return resolveSession(token)
  }
  if (row.userDisabled || row.membershipDisabled || !row.membershipId || !row.tenantId || !row.organizationId) return undefined
  return { digest, user: {
    id: String(row.userId), email: String(row.email), displayName: String(row.displayName), role: String(row.role) as UserRole,
    disabled: false, createdAt: String(row.createdAt), isPlatformAdmin: bool(row.isPlatformAdmin),
    tenantId: String(row.tenantId), tenantName: String(row.tenantName), organizationId: String(row.organizationId),
    organizationName: String(row.organizationName), accountId: String(row.accountId), accountName: String(row.accountName), membershipId: String(row.membershipId),
  } }
}
function createSession(userId: string, accountId: string, req: Request, res: Response, mobile = false): string {
  const token = randomBytes(32).toString('base64url')
  const now = new Date(), ttl = mobile ? MOBILE_SESSION_TTL_MS : WEB_SESSION_TTL_MS
  const digest = tokenDigest(token)
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString())
  db.prepare('INSERT INTO sessions(token_hash,user_id,active_account_id,created_at,expires_at) VALUES(?,?,?,?,?)').run(digest, userId, accountId, now.toISOString(), new Date(now.getTime() + ttl).toISOString())
  if (!mobile) writeSessionCookie(res, token, ttl)
  req.sessionTokenHash = digest
  return token
}
export function authenticatedUser(req: Request): AuthUser | undefined {
  if (req.authUser) return req.authUser
  const token = requestToken(req)
  if (!token || token.length > 128) return undefined
  const result = resolveSession(token)
  if (!result) return undefined
  req.sessionTokenHash = result.digest
  req.authUser = result.user
  return result.user
}

export const requireAuthenticated: RequestHandler = (req, res, next) => {
  const user = authenticatedUser(req)
  if (!user || user.disabled) return res.status(401).json({ error: 'authentication_required', message: '请登录后继续。' })
  const scopeHeaders = [req.get('x-tenant-id'), req.get('x-organization-id'), req.get('x-account-id')]
  if (scopeHeaders.some(value => !value)) return res.status(400).json({ error: 'workspace_scope_required', message: '受保护的 API 必须包含当前会话对应的租户、组织与账套范围。' })
  if (scopeHeaders[0] !== user.tenantId || scopeHeaders[1] !== user.organizationId || scopeHeaders[2] !== user.accountId) return res.status(403).json({ error: 'workspace_scope_mismatch', message: '请求范围与服务端验证的成员关系不一致。' })
  req.authUser = user
  next()
}
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, res, next) => {
    const user = authenticatedUser(req)
    if (!user) return res.status(401).json({ error: 'authentication_required', message: '请登录后继续。' })
    if (!allowed.includes(user.role)) return res.status(403).json({ error: 'forbidden', message: '当前账套角色没有执行此操作的权限。' })
    req.authUser = user
    next()
  }
}
export const requirePlatformAdmin: RequestHandler = (req, res, next) => {
  const user = authenticatedUser(req)
  if (!user) return res.status(401).json({ error: 'authentication_required', message: '请登录后继续。' })
  if (!user.isPlatformAdmin) return res.status(403).json({ error: 'platform_admin_required', message: '只有平台管理员可以执行此操作。' })
  req.authUser = user
  next()
}
export const sameOriginGuard: RequestHandler = (req, res, next) => {
  if (req.path === '/dingtalk/cards/callback') return next()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (!origin) return next()
  const allowed = new Set([...(process.env.CORS_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean), 'capacitor://localhost', 'http://localhost', 'https://localhost'])
  const requestHost = (req.get('host') ?? '').toLowerCase()
  let originHost = ''
  try { originHost = new URL(origin).host.toLowerCase() } catch { return res.status(403).json({ error: 'invalid_origin' }) }
  if (originHost !== requestHost && !allowed.has(origin)) return res.status(403).json({ error: 'cross_site_request_blocked' })
  next()
}

function roleValid(value: unknown): value is UserRole { return typeof value === 'string' && (roles as readonly string[]).includes(value) }
function userCount(): number { return (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count }
function issuePasswordActivation(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url'), now = new Date(), expiresAt = new Date(now.getTime() + PASSWORD_ACTIVATION_TTL_MS).toISOString()
  db.prepare('DELETE FROM password_activation_tokens WHERE user_id=?').run(userId)
  db.prepare('INSERT INTO password_activation_tokens(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(tokenDigest(token), userId, now.toISOString(), expiresAt)
  return { token, expiresAt }
}
function rateLimitKey(req: Request): string { return (req.ip || 'unknown').slice(0, 80) }
function checkLoginRate(req: Request, res: Response): boolean {
  const key = rateLimitKey(req), now = Date.now(), existing = loginAttempts.get(key)
  if (!existing || existing.resetAt <= now) { loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 }); return true }
  if (existing.count >= 10) { res.setHeader('Retry-After', Math.max(1, Math.ceil((existing.resetAt - now) / 1000))); res.status(429).json({ error: 'rate_limited', message: '尝试次数过多，请稍后再试。' }); return false }
  return true
}
function recordLoginFailure(req: Request): void {
  const key = rateLimitKey(req), current = loginAttempts.get(key) ?? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 }
  current.count++; loginAttempts.set(key, current)
  if (loginAttempts.size > 10_000) for (const [ip, item] of loginAttempts) if (item.resetAt <= Date.now()) loginAttempts.delete(ip)
}
function nextLoginRateSuccess(req: Request): void { loginAttempts.delete(rateLimitKey(req)) }
function insertScope(ids: { tenantId: string; organizationId: string; accountId: string; userId: string; role: UserRole }, names: { tenantName: string; tenantCode: string; organizationName: string; organizationCode: string; accountName: string; accountCode: string }, now: string): void {
  db.prepare('INSERT INTO tenants(id,name,code,status,created_at,updated_at) VALUES(?,?,?,\'active\',?,?)').run(ids.tenantId, names.tenantName, names.tenantCode, now, now)
  db.prepare('INSERT INTO organizations(id,tenant_id,name,code,status,created_at,updated_at) VALUES(?,?,?,?,\'active\',?,?)').run(ids.organizationId, ids.tenantId, names.organizationName, names.organizationCode, now, now)
  db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,\'k3cloud\',\'active\',?,?)').run(ids.accountId, ids.tenantId, ids.organizationId, names.accountName, names.accountCode, now, now)
  db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,?,0,?)').run(nanoid(), ids.userId, ids.tenantId, ids.organizationId, ids.accountId, ids.role, now)
}
function activeScope(req: Request): AuthUser {
  if (!req.authUser) throw new Error('authenticated scope missing')
  return req.authUser
}
function scopeReply(scope: UserScope & { tenantCode?: string; organizationCode?: string; accountCode?: string }) { return scope }

export function createAuthRouter() {
  const router = Router()
  router.use(sameOriginGuard)
  router.get('/status', (_req, res) => res.json({ setupRequired: userCount() === 0, authMode: 'password-session', passwordLoginAvailable: true, dingtalkSso: dingtalkSsoStatus(), tenancy: 'tenant-organization-account' }))

  router.post('/activate', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'invalid_activation', message: '激活链接无效，或新密码不符合要求（至少 12 位）。' })
    const digest = tokenDigest(token), now = new Date().toISOString()
    const valid = db.prepare(`SELECT t.user_id AS userId FROM password_activation_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>? AND u.disabled=0`).get(digest, now) as { userId: string } | undefined
    if (!valid) return res.status(410).json({ error: 'activation_expired', message: '激活链接已失效或已使用，请联系管理员重新生成。' })
    try {
      const passwordHash = await hashPassword(password)
      const transaction = db.transaction(() => {
        const consume = db.prepare('UPDATE password_activation_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?').run(now, digest, now)
        if (consume.changes !== 1) throw new Error('activation_expired')
        const update = db.prepare('UPDATE users SET password_hash=?,password_enabled=1,updated_at=? WHERE id=? AND disabled=0').run(passwordHash, now, valid.userId)
        if (update.changes !== 1) throw new Error('activation_expired')
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(valid.userId)
        db.prepare('DELETE FROM password_activation_tokens WHERE user_id=? AND token_hash<>?').run(valid.userId, digest)
      })
      transaction()
      recordSecurityEvent({ userId: valid.userId, event: 'password_activated', subject: 'one_time_activation', ip: req.ip, userAgent: req.get('user-agent') })
      return res.json({ ok: true, message: '密码已设置，请返回登录页使用个人密码登录。' })
    } catch (error) {
      if (error instanceof Error && error.message === 'activation_expired') return res.status(410).json({ error: 'activation_expired', message: '激活链接已失效或已使用，请联系管理员重新生成。' })
      console.error('Password activation failed.', error)
      return res.status(500).json({ error: 'activation_failed', message: '密码激活暂时失败，请稍后重试。' })
    }
  })

  async function setup(req: Request, res: Response, mobile: boolean) {
    if (userCount() !== 0) return res.status(409).json({ error: 'setup_already_complete', message: '管理员账户已初始化。' })
    const displayName = stringField(req.body?.displayName, 80), email = normalizeEmail(req.body?.email)
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const tenantName = stringField(req.body?.tenantName, 100) || '平台管理'
    const organizationName = stringField(req.body?.organizationName, 100) || '平台组织'
    const accountName = stringField(req.body?.accountName, 100) || '系统管理账套'
    if (!displayName || !validEmail(email) || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'invalid_setup', message: '请填写姓名、有效邮箱，并设置至少 12 位密码。' })
    const passwordHash = await hashPassword(password), now = new Date().toISOString()
    const userId = nanoid(), tenantId = nanoid(), organizationId = nanoid(), accountId = nanoid()
    const codes = { tenantCode: safeCode(req.body?.tenantCode, `TENANT_${tenantId.slice(0, 6).toUpperCase()}`), organizationCode: safeCode(req.body?.organizationCode, `ORG_${organizationId.slice(0, 6).toUpperCase()}`), accountCode: safeCode(req.body?.accountCode, `MAIN_${accountId.slice(0, 6).toUpperCase()}`) }
    const transaction = db.transaction(() => {
      if (userCount() !== 0) throw new Error('setup_already_complete')
      db.prepare('INSERT INTO users(id,email,display_name,password_hash,role,is_platform_admin,disabled,created_at,updated_at) VALUES(?,?,?,?,\'admin\',1,0,?,?)').run(userId, email, displayName, passwordHash, now, now)
      insertScope({ userId, tenantId, organizationId, accountId, role: 'admin' }, { tenantName, tenantCode: codes.tenantCode, organizationName, organizationCode: codes.organizationCode, accountName, accountCode: codes.accountCode }, now)
      migrateLegacyWorkspace({ tenantId, tenantName, organizationId, organizationName, accountId, accountName, role: 'admin', isPlatformAdmin: true })
      for (const [oldKey, namespace] of [['workflow', 'workflow'], ['workflow-audit', 'workflow-audit'], ['report-schedules', 'report-schedules']] as const) {
        const value = getAppState<unknown | null>(oldKey, null)
        if (value) setAppState(`integration:${tenantId}:${organizationId}:${accountId}:${namespace}`, value)
      }
    })
    try {
      transaction()
      const token = createSession(userId, accountId, req, res, mobile)
      const result = resolveSession(token)!
      req.authUser = result.user
      logEvent(req, 'initial_admin_created', userId, email)
      return res.status(201).json({ user: result.user, scopes: scopesForUser(userId), ...(mobile ? { accessToken: token, expiresIn: MOBILE_SESSION_TTL_MS / 1000 } : {}) })
    } catch (error) {
      if (error instanceof Error && error.message === 'setup_already_complete') return res.status(409).json({ error: 'setup_already_complete', message: '管理员账户已初始化。' })
      if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'duplicate_scope_code', message: '租户、组织或账套编码重复。' })
      console.error('Initial tenant setup failed.', error)
      return res.status(500).json({ error: 'setup_failed', message: '企业工作区初始化失败，请检查服务端日志。' })
    }
  }
  router.post('/setup', (req, res) => { void setup(req, res, false) })
  router.post('/mobile/setup', (req, res) => { void setup(req, res, true) })

  async function login(req: Request, res: Response, mobile: boolean) {
    if (!checkLoginRate(req, res)) return
    const email = normalizeEmail(req.body?.email), password = typeof req.body?.password === 'string' ? req.body.password : ''
    const user = email && password.length <= 200 ? getUser(email) : undefined
    const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password || 'invalid-password', '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000')
    if (!user || user.disabled || !user.passwordEnabled || !valid) {
      recordLoginFailure(req); logEvent(req, 'login_failed', user?.id, email || 'invalid-email')
      return res.status(401).json({ error: 'invalid_credentials', message: '邮箱或密码不正确。' })
    }
    const scopes = scopesForUser(user.id)
    if (!scopes.length) { logEvent(req, 'login_denied_no_membership', user.id, user.email); return res.status(403).json({ error: 'no_workspace_membership', message: '账号尚未加入任何启用的组织和账套。' }) }
    const requestedAccount = typeof req.body?.accountId === 'string' ? req.body.accountId : ''
    const selected = (requestedAccount ? scopes.find(scope => scope.accountId === requestedAccount) : undefined) ?? scopes[0]
    if (requestedAccount && !selected) return res.status(403).json({ error: 'scope_not_allowed', message: '该账号没有权限进入所选账套。' })
    nextLoginRateSuccess(req)
    const token = createSession(user.id, selected.accountId, req, res, mobile)
    const result = resolveSession(token)!
    req.authUser = result.user
    logEvent(req, 'login_succeeded', user.id, user.email, result.user)
    return res.json({ user: result.user, scopes: scopes.map(scopeReply), ...(mobile ? { accessToken: token, expiresIn: MOBILE_SESSION_TTL_MS / 1000 } : {}) })
  }
  router.post('/login', (req, res) => { void login(req, res, false).catch(error => { console.error('Login processing failed.', error); if (!res.headersSent) res.status(500).json({ error: 'login_failed', message: '登录服务暂时不可用。' }) }) })
  router.post('/mobile/login', (req, res) => { void login(req, res, true).catch(error => { console.error('Mobile login processing failed.', error); if (!res.headersSent) res.status(500).json({ error: 'login_failed', message: '登录服务暂时不可用。' }) }) })
  router.post('/dingtalk/mobile-login', (req, res) => {
    void (async () => {
      if (!dingtalkSsoStatus().configured) return res.status(503).json({ error: 'dingtalk_sso_not_configured', message: '钉钉企业免登尚未配置，请联系系统管理员。' })
      if (!checkLoginRate(req, res)) return
      const authCode = typeof req.body?.authCode === 'string' ? req.body.authCode.trim() : ''
      if (!authCode || authCode.length > 1024) return res.status(400).json({ error: 'invalid_auth_code', message: '未取得有效的钉钉免登授权码，请重试。' })
      let identity: Awaited<ReturnType<typeof exchangeDingTalkAuthCode>>
      try { identity = await exchangeDingTalkAuthCode(authCode) }
      catch (error) {
        recordLoginFailure(req)
        recordSecurityEvent({ event: 'dingtalk_identity_exchange_failed', subject: 'authorization_code_exchange', ip: req.ip, userAgent: req.get('user-agent') })
        console.error('DingTalk SSO identity verification failed.', error instanceof Error ? error.message : 'unknown error')
        return res.status(502).json({ error: 'dingtalk_identity_verification_failed', message: '钉钉身份验证暂时失败，请重试或联系管理员。' })
      }
      const candidates = db.prepare(`SELECT id FROM users WHERE dingtalk_user_id=? OR (?<>'' AND dingtalk_union_id=?)`).all(identity.userId, identity.unionId ?? '', identity.unionId ?? '') as Array<{ id: string }>
      const mappedIds = [...new Set(candidates.map(row => row.id))]
      if (mappedIds.length !== 1) {
        recordLoginFailure(req)
        recordSecurityEvent({ event: 'dingtalk_login_denied_unbound', subject: 'identity_not_uniquely_bound', ip: req.ip, userAgent: req.get('user-agent') })
        return res.status(403).json({ error: 'dingtalk_identity_unbound', message: '此钉钉身份尚未绑定到已存在的工作区成员，请联系系统管理员。' })
      }
      const user = getUserById(mappedIds[0]!)
      if (!user || user.disabled) {
        recordLoginFailure(req)
        recordSecurityEvent({ userId: user?.id, event: 'dingtalk_login_denied_disabled', subject: 'disabled_member', ip: req.ip, userAgent: req.get('user-agent') })
        return res.status(403).json({ error: 'dingtalk_member_disabled', message: '此工作区成员已停用，请联系系统管理员。' })
      }
      const scopes = scopesForUser(user.id)
      if (!scopes.length) {
        recordLoginFailure(req)
        recordSecurityEvent({ userId: user.id, event: 'dingtalk_login_denied_no_membership', subject: user.email, ip: req.ip, userAgent: req.get('user-agent') })
        return res.status(403).json({ error: 'no_workspace_membership', message: '此账号没有启用的组织和账套访问权限。' })
      }
      const requestedAccount = typeof req.body?.accountId === 'string' ? req.body.accountId : ''
      const selected = (requestedAccount ? scopes.find(scope => scope.accountId === requestedAccount) : undefined) ?? scopes[0]
      if (requestedAccount && !scopes.some(scope => scope.accountId === requestedAccount)) return res.status(403).json({ error: 'scope_not_allowed', message: '该账号没有权限进入所选账套。' })
      nextLoginRateSuccess(req)
      const token = createSession(user.id, selected!.accountId, req, res, true)
      const result = resolveSession(token)!
      req.authUser = result.user
      logEvent(req, 'dingtalk_login_succeeded', user.id, user.email, result.user)
      return res.json({ user: result.user, scopes: scopes.map(scopeReply), accessToken: token, expiresIn: MOBILE_SESSION_TTL_MS / 1000 })
    })().catch(error => {
      console.error('DingTalk mobile login failed.', error instanceof Error ? error.message : 'unknown error')
      if (!res.headersSent) res.status(500).json({ error: 'dingtalk_login_failed', message: '钉钉登录暂时不可用。' })
    })
  })
  router.post('/logout', (req, res) => {
    const user = authenticatedUser(req)
    if (req.sessionTokenHash) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionTokenHash)
    clearSessionCookie(res)
    if (user) logEvent(req, 'logout', user.id, user.email, user)
    res.json({ ok: true })
  })
  router.get('/me', (req, res) => {
    const user = authenticatedUser(req)
    if (!user) return res.status(401).json({ error: 'authentication_required', message: '请登录后继续。' })
    return res.json({ user, scopes: scopesForUser(user.id).map(scopeReply) })
  })

  router.use(requireAuthenticated)
  router.get('/scopes', (req, res) => res.json({ scopes: scopesForUser(req.authUser!.id).map(scopeReply), activeAccountId: req.authUser!.accountId }))
  router.post('/switch-scope', (req, res) => {
    const user = activeScope(req), accountId = stringField(req.body?.accountId, 100)
    const target = scopesForUser(user.id).find(scope => scope.accountId === accountId)
    if (!target) return res.status(403).json({ error: 'scope_not_allowed', message: '没有此组织/账套的访问权限。' })
    if (!req.sessionTokenHash) return res.status(401).json({ error: 'session_required', message: '请重新登录后切换范围。' })
    db.prepare('UPDATE sessions SET active_account_id=? WHERE token_hash=?').run(accountId, req.sessionTokenHash)
    const result = resolveSession(requestToken(req)!)!
    req.authUser = result.user
    logEvent(req, 'workspace_scope_switched', user.id, target.accountName, result.user)
    return res.json({ user: result.user, scopes: scopesForUser(user.id).map(scopeReply) })
  })

  router.get('/users', requireRole('admin'), (req, res) => {
    const scope = activeScope(req)
    const users = db.prepare(`SELECT u.id,u.email,u.display_name AS displayName,m.role,
      CASE WHEN u.disabled=1 OR m.disabled=1 THEN 1 ELSE 0 END AS disabled,u.password_enabled AS passwordEnabled,
      u.created_at AS createdAt,m.id AS membershipId,u.is_platform_admin AS isPlatformAdmin,
      CASE WHEN ?=1 THEN u.dingtalk_user_id ELSE NULL END AS dingtalkUserId,
      CASE WHEN ?=1 THEN u.dingtalk_union_id ELSE NULL END AS dingtalkUnionId
      FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.organization_id=? AND m.account_id=? ORDER BY u.created_at`)
      .all(scope.isPlatformAdmin ? 1 : 0, scope.isPlatformAdmin ? 1 : 0, scope.tenantId, scope.organizationId, scope.accountId) as Array<Record<string, unknown>>
    users.forEach(row => { row.disabled = bool(row.disabled); row.passwordEnabled = bool(row.passwordEnabled); row.isPlatformAdmin = bool(row.isPlatformAdmin) })
    return res.json({ users })
  })
  router.post('/users', requireRole('admin'), async (req, res) => {
    const scope = activeScope(req), displayName = stringField(req.body?.displayName, 80), email = normalizeEmail(req.body?.email)
    const role = req.body?.role
    if (!displayName || !validEmail(email) || !roleValid(role)) return res.status(400).json({ error: 'invalid_user', message: '请填写姓名、有效邮箱和有效账套角色。' })
    let user = getUser(email)
    if (user && user.disabled) return res.status(409).json({ error: 'user_disabled', message: '此用户已被全局停用，请先由平台管理员启用。' })
    let activation: { token: string; expiresAt: string } | undefined
    const transaction = db.transaction(() => {
      if (!user) {
        const now = new Date().toISOString(), id = nanoid()
        const passwordHash = `disabled:${randomBytes(32).toString('hex')}`
        db.prepare('INSERT INTO users(id,email,display_name,password_hash,password_enabled,role,is_platform_admin,disabled,created_at,updated_at) VALUES(?,?,?,?,0,?,0,0,?,?)').run(id, email, displayName, passwordHash, role, now, now)
        user = { id, email, displayName, passwordHash, passwordEnabled: false, createdAt: now, disabled: false, isPlatformAdmin: false }
      }
      const already = db.prepare('SELECT 1 FROM tenant_memberships WHERE user_id=? AND account_id=?').get(user!.id, scope.accountId)
      if (already) throw new Error('membership_exists')
      db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,?,0,?)').run(nanoid(), user!.id, scope.tenantId, scope.organizationId, scope.accountId, role, new Date().toISOString())
      if (!user!.passwordEnabled) activation = issuePasswordActivation(user!.id)
    })
    try {
      transaction()
      logEvent(req, 'account_membership_created', scope.id, email, scope)
      return res.status(201).json({ user: { id: user!.id, email, displayName: user!.displayName, role, disabled: false, passwordEnabled: user!.passwordEnabled }, ...(activation ? { activationToken: activation.token, activationExpiresAt: activation.expiresAt } : {}) })
    } catch (error) {
      if (error instanceof Error && error.message === 'membership_exists') return res.status(409).json({ error: 'membership_exists', message: '此用户已在当前账套中。' })
      if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'email_exists', message: '邮箱或成员关系已存在。' })
      console.error('User membership creation failed.', error)
      return res.status(500).json({ error: 'user_create_failed', message: '创建成员失败。' })
    }
  })
  router.post('/users/:id/activation', requireRole('admin'), (req, res) => {
    const scope = activeScope(req), userId = String(req.params.id)
    if (!scope.isPlatformAdmin) return res.status(403).json({ error: 'platform_admin_required', message: '仅平台管理员可以重置全局账号的密码激活链接。' })
    if (userId === scope.id) return res.status(409).json({ error: 'cannot_reset_self', message: '不能为当前账号生成重置链接。' })
    const target = db.prepare(`SELECT u.email,u.disabled AS userDisabled,m.disabled AS membershipDisabled FROM users u
      JOIN tenant_memberships m ON m.user_id=u.id WHERE u.id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?`)
      .get(userId, scope.tenantId, scope.organizationId, scope.accountId) as { email: string; userDisabled: number; membershipDisabled: number } | undefined
    if (!target) return res.status(404).json({ error: 'user_not_found', message: '该账号不属于当前账套。' })
    if (target.userDisabled || target.membershipDisabled) return res.status(409).json({ error: 'user_disabled', message: '已停用成员不能生成密码激活链接。' })
    const now = new Date().toISOString(), dummyHash = `disabled:${randomBytes(32).toString('hex')}`
    let activation: { token: string; expiresAt: string }
    try {
      const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET password_hash=?,password_enabled=0,updated_at=? WHERE id=?').run(dummyHash, now, userId)
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
        activation = issuePasswordActivation(userId)
      })
      transaction()
    } catch (error) {
      console.error('Password activation link reset failed.', error)
      return res.status(500).json({ error: 'activation_reset_failed', message: '无法生成新的激活链接。' })
    }
    logEvent(req, 'password_activation_link_reset', scope.id, target.email, scope)
    return res.json({ activationToken: activation!.token, activationExpiresAt: activation!.expiresAt })
  })
  router.patch('/users/:id', requireRole('admin'), (req, res) => {
    const scope = activeScope(req), userId = String(req.params.id)
    const target = db.prepare(`SELECT m.id AS membershipId,m.role,m.disabled,u.email,u.display_name AS displayName,u.disabled AS userDisabled,
        u.dingtalk_user_id AS dingtalkUserId,u.dingtalk_union_id AS dingtalkUnionId
    FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.tenant_id=? AND m.organization_id=? AND m.account_id=?`).get(userId, scope.tenantId, scope.organizationId, scope.accountId) as { membershipId: string; role: UserRole; disabled: number; email: string; displayName: string; userDisabled: number; dingtalkUserId: string | null; dingtalkUnionId: string | null } | undefined
    if (!target) return res.status(404).json({ error: 'user_not_found', message: '该账号不属于当前账套。' })
    const role = req.body?.role === undefined ? target.role : req.body.role
    const disabled = req.body?.disabled === undefined ? Boolean(target.disabled) : req.body.disabled
    const displayName = req.body?.displayName === undefined ? target.displayName : stringField(req.body.displayName, 80)
    const bindingUpdated = Object.hasOwn(req.body ?? {}, 'dingtalkUserId') || Object.hasOwn(req.body ?? {}, 'dingtalkUnionId')
    if (req.body?.password !== undefined) return res.status(400).json({ error: 'password_activation_required', message: '请生成一次性密码激活链接，不要由管理员直接设置成员密码。' })
    if (bindingUpdated && !scope.isPlatformAdmin) return res.status(403).json({ error: 'platform_admin_required', message: '仅平台管理员可以维护全局钉钉身份绑定。' })
    if (!displayName || !roleValid(role) || typeof disabled !== 'boolean') return res.status(400).json({ error: 'invalid_user_update', message: '用户资料、角色或状态无效。' })
    if (userId === scope.id && (disabled || role !== 'admin')) return res.status(409).json({ error: 'cannot_lock_self', message: '不能停用当前账套管理员或移除自己的管理员角色。' })
    if (target.role === 'admin' && (disabled || role !== 'admin')) {
      const admins = db.prepare("SELECT COUNT(*) AS count FROM tenant_memberships WHERE account_id=? AND role='admin' AND disabled=0").get(scope.accountId) as { count: number }
      if (admins.count <= 1) return res.status(409).json({ error: 'last_admin', message: '当前账套至少需要一位启用状态的管理员。' })
    }
    if (bindingUpdated && ((req.body?.dingtalkUserId !== undefined && typeof req.body.dingtalkUserId !== 'string') || (req.body?.dingtalkUnionId !== undefined && typeof req.body.dingtalkUnionId !== 'string'))) return res.status(400).json({ error: 'invalid_dingtalk_identity', message: '钉钉 userId 和 unionId 必须为文本。' })
    if (bindingUpdated && ((typeof req.body?.dingtalkUserId === 'string' && req.body.dingtalkUserId.trim().length > 128) || (typeof req.body?.dingtalkUnionId === 'string' && req.body.dingtalkUnionId.trim().length > 128))) return res.status(400).json({ error: 'invalid_dingtalk_identity', message: '钉钉身份标识最多 128 个字符。' })
    const dingtalkUserId = bindingUpdated && req.body?.dingtalkUserId !== undefined ? stringField(req.body.dingtalkUserId, 128) : target.dingtalkUserId
    const dingtalkUnionId = bindingUpdated && req.body?.dingtalkUnionId !== undefined ? stringField(req.body.dingtalkUnionId, 128) : target.dingtalkUnionId
    const now = new Date().toISOString()
    try {
      const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET display_name=?,dingtalk_user_id=?,dingtalk_union_id=?,updated_at=? WHERE id=?').run(displayName, dingtalkUserId || null, dingtalkUnionId || null, now, userId)
        db.prepare('UPDATE tenant_memberships SET role=?,disabled=? WHERE id=?').run(role, disabled ? 1 : 0, target.membershipId)
        if (disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
      })
      transaction()
    } catch (error) {
      if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'dingtalk_identity_already_bound', message: '此钉钉身份已绑定到其他工作区用户。' })
      throw error
    }
    logEvent(req, bindingUpdated ? 'dingtalk_identity_binding_updated' : 'account_membership_updated', scope.id, target.email, scope)
    return res.json({ user: { id: userId, email: target.email, displayName, role, disabled, passwordEnabled: true } })
  })

  router.post('/tenants', requirePlatformAdmin, (req, res) => {
    const tenantName = stringField(req.body?.tenantName, 100), organizationName = stringField(req.body?.organizationName, 100), accountName = stringField(req.body?.accountName, 100)
    if (!tenantName || !organizationName || !accountName) return res.status(400).json({ error: 'required_names', message: '租户、组织和首个账套名称均为必填项。' })
    const ids = { tenantId: nanoid(), organizationId: nanoid(), accountId: nanoid(), userId: req.authUser!.id, role: 'admin' as const }
    const names = { tenantName, tenantCode: safeCode(req.body?.tenantCode, `TENANT_${ids.tenantId.slice(0,6).toUpperCase()}`), organizationName, organizationCode: safeCode(req.body?.organizationCode, `ORG_${ids.organizationId.slice(0,6).toUpperCase()}`), accountName, accountCode: safeCode(req.body?.accountCode, `MAIN_${ids.accountId.slice(0,6).toUpperCase()}`) }
    try {
      const transaction = db.transaction(() => insertScope(ids, names, new Date().toISOString()))
      transaction()
      logEvent(req, 'tenant_created', ids.userId, names.tenantName, { tenantId: ids.tenantId, organizationId: ids.organizationId, accountId: ids.accountId })
      return res.status(201).json({ scope: { ...ids, ...names } })
    } catch (error) { if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'duplicate_scope_code', message: '编码重复，请换一个编码。' }); return res.status(500).json({ error: 'tenant_create_failed' }) }
  })
  router.post('/organizations', requireRole('admin'), (req, res) => {
    const user = activeScope(req), organizationName = stringField(req.body?.organizationName, 100), accountName = stringField(req.body?.accountName, 100)
    if (!organizationName || !accountName) return res.status(400).json({ error: 'required_names', message: '组织和首个账套名称均为必填项。' })
    const organizationId = nanoid(), accountId = nanoid(), now = new Date().toISOString()
    const orgCode = safeCode(req.body?.organizationCode, `ORG_${organizationId.slice(0,6).toUpperCase()}`), accountCode = safeCode(req.body?.accountCode, `MAIN_${accountId.slice(0,6).toUpperCase()}`)
    try {
      const transaction = db.transaction(() => {
        db.prepare('INSERT INTO organizations(id,tenant_id,name,code,status,created_at,updated_at) VALUES(?,?,?, ?,\'active\',?,?)').run(organizationId, user.tenantId, organizationName, orgCode, now, now)
        db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,\'k3cloud\',\'active\',?,?)').run(accountId, user.tenantId, organizationId, accountName, accountCode, now, now)
        db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,\'admin\',0,?)').run(nanoid(), user.id, user.tenantId, organizationId, accountId, now)
      })
      transaction()
      logEvent(req, 'organization_account_created', user.id, organizationName, { tenantId: user.tenantId, organizationId, accountId })
      return res.status(201).json({ organization: { id: organizationId, name: organizationName, code: orgCode }, account: { id: accountId, name: accountName, code: accountCode } })
    } catch (error) { if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'duplicate_scope_code', message: '组织或账套编码重复。' }); return res.status(500).json({ error: 'organization_create_failed' }) }
  })
  router.post('/accounts', requireRole('admin'), (req, res) => {
    const user = activeScope(req), name = stringField(req.body?.accountName, 100), code = safeCode(req.body?.accountCode, `MAIN_${nanoid(6).toUpperCase()}`)
    if (!name) return res.status(400).json({ error: 'account_name_required', message: '账套名称为必填项。' })
    const id = nanoid(), now = new Date().toISOString()
    try {
      const transaction = db.transaction(() => {
        db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,\'k3cloud\',\'active\',?,?)').run(id, user.tenantId, user.organizationId, name, code, now, now)
        db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,\'admin\',0,?)').run(nanoid(), user.id, user.tenantId, user.organizationId, id, now)
      })
      transaction()
      logEvent(req, 'account_created', user.id, name, { tenantId: user.tenantId, organizationId: user.organizationId, accountId: id })
      return res.status(201).json({ account: { id, tenantId: user.tenantId, organizationId: user.organizationId, name, code, status: 'active' } })
    } catch (error) { if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'duplicate_account_code', message: '此组织内账套编码已存在。' }); return res.status(500).json({ error: 'account_create_failed' }) }
  })
  return router
}

export const publicApiAllowlist = (req: Request): boolean => req.path === '/health'
  || req.path === '/auth/status' || req.path === '/auth/setup' || req.path === '/auth/mobile/setup' || req.path === '/auth/activate' || req.path === '/auth/login' || req.path === '/auth/mobile/login' || req.path === '/auth/dingtalk/mobile-login' || req.path === '/auth/logout'
  || req.path === '/dingtalk/cards/callback'
export const sessionGate: RequestHandler = (req, res, next) => {
  if (publicApiAllowlist(req)) return next()
  return requireAuthenticated(req, res, next)
}
