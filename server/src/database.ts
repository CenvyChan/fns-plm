import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))
export const databasePath = resolve(process.env.DATABASE_FILE?.trim() || resolve(moduleDir, '../data/momentum.sqlite'))
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o750 })

export const db = new Database(databasePath, { timeout: 5_000 })
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','plm_manager','reviewer','member')),
    is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0,1)),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
    password_enabled INTEGER NOT NULL DEFAULT 1 CHECK (password_enabled IN (0,1)),
    dingtalk_user_id TEXT,
    dingtalk_union_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL COLLATE NOCASE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, code)
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL COLLATE NOCASE,
    erp_system TEXT NOT NULL DEFAULT 'k3cloud',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, code)
  );
  CREATE TABLE IF NOT EXISTS tenant_memberships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin','plm_manager','reviewer','member')),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
    created_at TEXT NOT NULL,
    UNIQUE(user_id, account_id)
  );
  CREATE INDEX IF NOT EXISTS memberships_user_idx ON tenant_memberships(user_id, account_id);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_account_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS password_activation_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS password_activation_user_idx ON password_activation_tokens(user_id, expires_at);
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    tenant_id TEXT,
    organization_id TEXT,
    account_id TEXT,
    event TEXT NOT NULL,
    subject TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS security_events_time_idx ON security_events(created_at DESC);
  CREATE TABLE IF NOT EXISTS connector_configs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('k3cloud','flowable','dingtalk')),
    encrypted_config TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, provider)
  );
  CREATE INDEX IF NOT EXISTS connector_configs_scope_idx ON connector_configs(tenant_id, organization_id, account_id, provider);
  CREATE TABLE IF NOT EXISTS document_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    sha256 TEXT NOT NULL,
    revision TEXT NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    sha256 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_files_scope_idx ON project_files(tenant_id, organization_id, account_id, project_id, created_at DESC);
`)

function ensureColumn(table: string, column: string, declaration: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
}
ensureColumn('users', 'is_platform_admin', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'password_enabled', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('users', 'dingtalk_user_id', 'TEXT')
ensureColumn('users', 'dingtalk_union_id', 'TEXT')
ensureColumn('app_state', 'revision', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('sessions', 'active_account_id', 'TEXT')
ensureColumn('security_events', 'tenant_id', 'TEXT')
ensureColumn('security_events', 'organization_id', 'TEXT')
ensureColumn('security_events', 'account_id', 'TEXT')
ensureColumn('document_files', 'tenant_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('document_files', 'organization_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('document_files', 'account_id', "TEXT NOT NULL DEFAULT ''")
ensureColumn('tenant_memberships', 'disabled', 'INTEGER NOT NULL DEFAULT 0')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_dingtalk_user_id_uq ON users(dingtalk_user_id) WHERE dingtalk_user_id IS NOT NULL AND dingtalk_user_id <> \'\'')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_dingtalk_union_id_uq ON users(dingtalk_union_id) WHERE dingtalk_union_id IS NOT NULL AND dingtalk_union_id <> \'\'')
db.exec('CREATE INDEX IF NOT EXISTS document_files_scope_idx ON document_files(tenant_id, organization_id, account_id, document_id, created_at DESC)')

export function hasAppState(key: string): boolean {
  return Boolean(db.prepare('SELECT 1 AS present FROM app_state WHERE key = ?').get(key))
}

export function getAppState<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  return JSON.parse(row.value) as T
}

export function getAppStateVersioned<T>(key: string, fallback: T): { value: T; revision: number } {
  const row = db.prepare('SELECT value,revision FROM app_state WHERE key = ?').get(key) as { value: string; revision: number } | undefined
  if (!row) return { value: fallback, revision: 0 }
  return { value: JSON.parse(row.value) as T, revision: row.revision }
}

export function setAppState(key: string, value: unknown): void {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO app_state(key, value, updated_at,revision) VALUES(?, ?, ?,1)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at,revision=app_state.revision+1`)
    .run(key, JSON.stringify(value), now)
}

export class StateConflictError extends Error {
  constructor() { super('The workspace changed in another request; reload and retry.'); this.name = 'StateConflictError' }
}
export function setAppStateIfRevision(key: string, value: unknown, expectedRevision: number): number {
  const now = new Date().toISOString(), json = JSON.stringify(value)
  if (expectedRevision === 0) {
    try { db.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,1)').run(key, json, now); return 1 }
    catch (error) { if (String(error).includes('UNIQUE')) throw new StateConflictError(); throw error }
  }
  const result = db.prepare('UPDATE app_state SET value=?,updated_at=?,revision=revision+1 WHERE key=? AND revision=?').run(json, now, key, expectedRevision)
  if (result.changes !== 1) throw new StateConflictError()
  return expectedRevision + 1
}

export function recordSecurityEvent(input: { userId?: string; tenantId?: string; organizationId?: string; accountId?: string; event: string; subject?: string; ip?: string; userAgent?: string }): void {
  db.prepare(`INSERT INTO security_events(user_id,tenant_id,organization_id,account_id,event,subject,ip,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(input.userId ?? null, input.tenantId ?? null, input.organizationId ?? null, input.accountId ?? null, input.event.slice(0, 80), input.subject?.slice(0, 200) ?? null, input.ip?.slice(0, 80) ?? null, input.userAgent?.slice(0, 240) ?? null, new Date().toISOString())
}

export function getConnectorRow(accountId: string, provider: 'k3cloud' | 'flowable' | 'dingtalk') {
  return db.prepare(`SELECT id,tenant_id AS tenantId,organization_id AS organizationId,account_id AS accountId,provider,encrypted_config AS encryptedConfig,revision,updated_at AS updatedAt
    FROM connector_configs WHERE account_id=? AND provider=?`).get(accountId, provider) as { id: string; tenantId: string; organizationId: string; accountId: string; provider: string; encryptedConfig: string; revision: number; updatedAt: string } | undefined
}

const encryptionKeyFile = resolve(process.env.APP_ENCRYPTION_KEY_FILE?.trim() || resolve(dirname(databasePath), '.app-encryption-key'))
let encryptionKey: Buffer
if (process.env.APP_ENCRYPTION_KEY?.trim()) {
  const configured = process.env.APP_ENCRYPTION_KEY.trim()
  if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error('APP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.')
  encryptionKey = Buffer.from(configured, 'hex')
} else {
  mkdirSync(dirname(encryptionKeyFile), { recursive: true, mode: 0o750 })
  if (!existsSync(encryptionKeyFile)) {
    try { writeFileSync(encryptionKeyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }) } catch { /* another process may create it first */ }
  }
  if (!existsSync(encryptionKeyFile)) throw new Error('Cannot initialize the connector encryption key.')
  chmodSync(encryptionKeyFile, 0o600)
  const key = readFileSync(encryptionKeyFile)
  if (key.length !== 32) throw new Error('The connector encryption key file must contain exactly 32 bytes.')
  encryptionKey = key
}

export function encryptConfig(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptConfig<T>(value: string): T {
  const [version, ivEncoded, tagEncoded, cipherEncoded] = value.split('.')
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !cipherEncoded) throw new Error('Unsupported connector configuration cipher text.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivEncoded, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(cipherEncoded, 'base64url')), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext) as T
}

export function databaseHealth(): { ok: boolean; journalMode: string; tenantTablesReady: boolean } {
  db.prepare('SELECT 1').get()
  const row = db.pragma('journal_mode', { simple: true }) as string
  const tenantTablesReady = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_memberships'").get())
  return { ok: true, journalMode: row, tenantTablesReady }
}
