import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir = '', databaseFile = '', origin = '', child, token = ''
const scopes = new Map()
async function allocatePort() {
  const server = createServer()
  const port = await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)).once('error', reject))
  await new Promise(resolve => server.close(resolve))
  return port
}
async function startServer() {
  const port = await allocatePort(); origin = `http://127.0.0.1:${port}`
  const env = { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'),
    DATA_FILE: join(tempDir, 'missing-legacy.json'), LEGACY_DATA_FILE: join(tempDir, 'missing-legacy.json'),
    DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir, REDIS_URL: '', CORS_ORIGIN: '',
    FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}',
    DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '',
    CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdoutText = ''; child.stderrText = ''; child.stdout.on('data', x => child.stdoutText += x); child.stderr.on('data', x => child.stderrText += x)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited: ${child.stderrText}`)
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become healthy: ${child.stderrText}`)
}
async function stopServer() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
async function api(path, { method = 'GET', body, auth = token } = {}) {
  const headers = {}
  if (auth) { headers.Authorization = `Bearer ${auth}`; const s = scopes.get(auth); if (s) { headers['X-Tenant-ID'] = s.tenantId; headers['X-Organization-ID'] = s.organizationId; headers['X-Account-ID'] = s.accountId } }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { response, data }
}
before(async () => { tempDir = mkdtempSync(join(tmpdir(), 'daily-empty-state-isolation-')); databaseFile = join(tempDir, 'isolated.sqlite'); await startServer() })
after(async () => { await stopServer(); if (tempDir) rmSync(tempDir, { recursive: true, force: true }) })

test('a fresh tenant gets independent daily-reporting arrays after another scope imports FNS data', { concurrency: false }, async () => {
  const setup = await api('/api/auth/mobile/setup', { method: 'POST', auth: '', body: { displayName: '隔离回归管理员', email: 'scope-isolation@example.test', password: 'test-password-12345' } })
  assert.equal(setup.response.status, 201, JSON.stringify(setup.data)); token = setup.data.accessToken; scopes.set(token, setup.data.user)
  const imported = async (path, rows) => { const r = await api(path, { method: 'POST', body: { companyCode: 'FNS', rows } }); assert.equal(r.response.status, 201, JSON.stringify(r.data)) }
  await imported('/api/daily-reporting/migration/parties', [{ kind: 'customer', name: 'FNS唯一主档', aliases: [], legacyCompanyCode: 'FNS', legacyId: 'party-fns-001', k3Number: '' }])
  await imported('/api/daily-reporting/migration/rates', [{ month: '2026-01', rate: '7.1', legacyCompanyCode: 'FNS' }])
  await imported('/api/daily-reporting/migration/assignments', [{ kind: 'customer', legacyCompanyCode: 'FNS', legacyPartyId: 'party-fns-001', legacyUserId: 'user-fns-001', legacyUsername: 'fns.user', legacyUserName: 'FNS用户' }])
  await imported('/api/daily-reporting/migration/party-mappings', [{ kind: 'customer', k3Number: 'K3-FNS-01', k3Name: 'FNS映射', legacyCompanyCode: 'FNS', legacyPartyId: 'party-fns-001', status: 'MANUAL', candidates: [] }])
  await imported('/api/daily-reporting/migration/memberships', [{ legacyUserId: 'user-fns-001', legacyUsername: 'fns.user', legacyUserName: 'FNS用户', active: true, groups: ['FNS'], mustChangePassword: false }])
  const fns = await api('/api/daily-reporting/management')
  assert.equal(fns.response.status, 200); assert.equal(fns.data.parties.length, 1)

  const created = await api('/api/auth/tenants', { method: 'POST', body: { tenantName: 'NBHH隔离新租户', organizationName: 'NBHH组织', accountName: 'NBHH账套' } })
  assert.equal(created.response.status, 201, JSON.stringify(created.data))
  const switched = await api('/api/auth/switch-scope', { method: 'POST', body: { accountId: created.data.scope.accountId } })
  assert.equal(switched.response.status, 200, JSON.stringify(switched.data)); scopes.set(token, switched.data.user)
  const beforeMembership = await api('/api/daily-reporting/management')
  assert.equal(beforeMembership.response.status, 200); assert.equal(beforeMembership.data.parties.length, 0, 'fresh tenant must not inherit FNS parties')
  for (const key of ['exchangeRates', 'assignments', 'partyMappings', 'legacyMemberships', 'importBatches']) assert.deepEqual(beforeMembership.data[key], [], `${key} is empty in new scope`)
  const membership = await api('/api/daily-reporting/migration/memberships', { method: 'POST', body: { companyCode: 'NBHH', rows: [{ legacyUserId: 'nbhh-user-01', legacyUsername: 'nbhh.user', legacyUserName: 'NBHH用户', active: true, groups: ['NBHH'], mustChangePassword: false }] } })
  assert.equal(membership.response.status, 201, JSON.stringify(membership.data))
  const afterMembership = await api('/api/daily-reporting/management')
  assert.equal(afterMembership.response.status, 200)
  assert.deepEqual(afterMembership.data.parties, [], 'membership-only import cannot materialize or inherit FNS parties')
  for (const key of ['exchangeRates', 'assignments', 'partyMappings']) assert.deepEqual(afterMembership.data[key], [], `${key} remains isolated`)
  assert.equal(afterMembership.data.legacyMemberships.length, 1); assert.equal(afterMembership.data.legacyMemberships[0].legacyCompanyCode, 'NBHH')
  assert.deepEqual(afterMembership.data.importBatches.map(x => x.category), ['M08-memberships'])
})
