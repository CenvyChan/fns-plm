import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, after } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'k3-private-http-'))
const savedEnv = { ...process.env }
process.env.NODE_ENV = 'production'
process.env.DATABASE_FILE = join(directory, 'test.sqlite')
process.env.APP_ENCRYPTION_KEY = '6e'.repeat(32)
delete process.env.ALLOW_INSECURE_CONNECTOR_HTTP
const { saveConnectorConfig, getConnectorConfig } = await import('../dist/integrations/configuration.js')
const { k3cloudStatus, testK3CloudConnection, queryK3Cloud, discoverK3CloudFormMetadata } = await import('../dist/integrations/k3cloud.js')
const { db } = await import('../dist/database.js')
const config = { baseUrl: 'http://172.16.77.90/k3cloud', accountId: 'external-account', username: 'test', organization: 'ORG001', appId: 'test-app', appSecret: 'fake-secret', lcid: '2052' }
const now = new Date().toISOString()
db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('user', 'policy@example.test', 'Policy', 'not-a-password', now, now)
function createScope(tenantId, organizationId, accountId) {
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,code,created_at,updated_at) VALUES(?,?,?,?,?)').run(tenantId, tenantId, tenantId, now, now)
  db.prepare('INSERT OR IGNORE INTO organizations(id,tenant_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(organizationId, tenantId, organizationId, organizationId, now, now)
  db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(accountId, tenantId, organizationId, accountId, accountId, now, now)
  return { tenantId, organizationId, accountId }
}
const home = createScope('tenant-a', 'org-a', 'account-a')
const siblings = [createScope('tenant-a', 'org-a', 'account-b'), createScope('tenant-a', 'org-b', 'account-c'), createScope('tenant-b', 'org-c', 'account-d')]
after(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
})

test('production save and runtime both accept only private-IP HTTP without an override', () => {
  for (const host of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.254', '[fd12:3456::1]', '[fc00::1]']) {
    const candidate = { ...config, baseUrl: `http://${host}:8080/k3cloud/` }
    assert.doesNotThrow(() => saveConnectorConfig(home, 'k3cloud', candidate, 'user'), host)
    assert.equal(k3cloudStatus(candidate).configured, true, host)
  }
  assert.equal(k3cloudStatus({ ...config, baseUrl: 'https://erp.example.com/k3cloud' }).configured, true)
})

test('public, loopback, metadata, DNS tricks, malformed URLs and global bypass flag are rejected consistently', () => {
  process.env.ALLOW_INSECURE_CONNECTOR_HTTP = 'true'
  try {
    for (const baseUrl of [
      'http://8.8.8.8/k3cloud', 'http://172.15.255.255', 'http://172.32.0.1', 'http://192.169.0.1',
      'http://100.83.138.26:18080/flowable-rest/service', 'http://127.0.0.1', 'http://localhost', 'http://[::1]',
      'http://169.254.169.254', 'http://0.0.0.0', 'http://[fe80::1]', 'http://[::ffff:192.168.1.1]',
      'http://[2001:db8::1]', 'http://erp.internal/k3cloud', 'http://192.168.1.1.example.com',
      'http://192.168.1.1@evil.example', 'http://user:pass@192.168.1.1', 'http://192.168.1.1?x=1',
      'http://192.168.1.1#x', 'ftp://192.168.1.1', 'not a url',
    ]) {
      assert.throws(() => saveConnectorConfig(home, 'k3cloud', { ...config, baseUrl }, 'user'), undefined, baseUrl)
      assert.equal(k3cloudStatus({ ...config, baseUrl }).configured, false, baseUrl)
    }
  } finally { delete process.env.ALLOW_INSECURE_CONNECTOR_HTTP }
})

test('private HTTP settings remain encrypted and isolated across tenant, organization and account', () => {
  saveConnectorConfig(home, 'k3cloud', config, 'user')
  for (const sibling of siblings) assert.deepEqual(getConnectorConfig(sibling, 'k3cloud'), {})
  for (const forged of [{ ...home, tenantId: 'tenant-b' }, { ...home, organizationId: 'org-b' }]) {
    assert.deepEqual(getConnectorConfig(forged, 'k3cloud'), {})
    assert.throws(() => saveConnectorConfig(forged, 'k3cloud', config, 'user'), /connector_scope_mismatch/)
  }
  const row = db.prepare('SELECT encrypted_config FROM connector_configs WHERE account_id=? AND provider=?').get(home.accountId, 'k3cloud')
  assert.equal(row.encrypted_config.includes(config.appSecret), false)
})

test('production private HTTP login and queries work; scope-specific sessions/cache stay isolated; organization is not sent', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    assert.equal(init.redirect, 'error')
    if (url.includes('LoginByAppSecret')) return new Response('{}', { headers: { 'set-cookie': `session=session-${calls.length}; Path=/` } })
    return Response.json([['M001']])
  }
  try {
    const input = { formId: 'BD_MATERIAL', fieldKeys: 'FNumber', limit: 1 }
    const key = scope => JSON.stringify([scope.tenantId, scope.organizationId, scope.accountId])
    for (const scope of [home, ...siblings]) {
      const result = await queryK3Cloud(input, config, key(scope))
      assert.equal(result.rows[0].FNumber, 'M001')
      assert.equal(result.cached, false)
    }
    assert.equal(calls.filter(call => call.url.includes('LoginByAppSecret')).length, 4)
    assert.deepEqual(JSON.parse(calls[0].init.body), { acctID: config.accountId, username: config.username, appid: config.appId, appsecret: config.appSecret, lcid: config.lcid })
    for (const call of calls.filter(call => call.url.includes('ExecuteBillQuery'))) {
      assert.equal(JSON.parse(JSON.parse(call.init.body)[0]).FilterString, '')
    }
  } finally { globalThis.fetch = originalFetch }
})

test('login, query and metadata fail closed when a redirect is blocked', async () => {
  const originalFetch = globalThis.fetch
  const paths = []
  globalThis.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error')
    paths.push(url)
    throw new TypeError('redirect blocked')
  }
  try {
    assert.ok((await testK3CloudConnection(config, 'redirect-login')).lastError)
    const existingSessionKey = JSON.stringify([home.tenantId, home.organizationId, home.accountId])
    await assert.rejects(queryK3Cloud({ formId: 'BD_MATERIAL', fieldKeys: 'FNumber', limit: 1 }, config, existingSessionKey, { fresh: true }), /query failed/)
    await assert.rejects(discoverK3CloudFormMetadata('BD_MATERIAL', config, existingSessionKey), /metadata query failed/)
    assert.equal(paths.length, 3)
    assert.ok(paths[0].includes('LoginByAppSecret'))
    assert.ok(paths[1].includes('ExecuteBillQuery'))
    assert.ok(paths[2].includes('QueryBusinessInfo'))
  } finally { globalThis.fetch = originalFetch }
})
