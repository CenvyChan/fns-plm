import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tempDir = mkdtempSync(join(tmpdir(), 'connector-http-policy-'))
const previous = Object.fromEntries(['NODE_ENV', 'ALLOW_INSECURE_CONNECTOR_HTTP', 'FLOWABLE_HTTP_ALLOWLIST', 'DATABASE_FILE', 'APP_ENCRYPTION_KEY'].map(key => [key, process.env[key]]))
const staging = 'http://flowable-stage.example.invalid:18081/flowable-rest/service'
const rollback = 'http://flowable-rollback.example.invalid:18080/flowable-rest/service'
process.env.NODE_ENV = 'production'
process.env.ALLOW_INSECURE_CONNECTOR_HTTP = 'true'
process.env.FLOWABLE_HTTP_ALLOWLIST = `${staging},${rollback}`
process.env.DATABASE_FILE = join(tempDir, 'connector-config.sqlite')
process.env.APP_ENCRYPTION_KEY = '5d'.repeat(32)
const { getFlowableStatus, health } = await import('../dist/integrations/flowable.js')
const { saveConnectorConfig } = await import('../dist/integrations/configuration.js')
const { db } = await import('../dist/database.js')
const scope = { tenantId: 'policy-tenant', organizationId: 'policy-org', accountId: 'policy-account' }
const timestamp = new Date().toISOString()
db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('policy-user', 'policy@example.test', 'Policy test', 'not-a-login-hash', timestamp, timestamp)
db.prepare('INSERT INTO tenants(id,name,code,created_at,updated_at) VALUES(?,?,?,?,?)').run(scope.tenantId, 'Policy tenant', 'policy-tenant', timestamp, timestamp)
db.prepare('INSERT INTO organizations(id,tenant_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(scope.organizationId, scope.tenantId, 'Policy org', 'policy-org', timestamp, timestamp)
db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(scope.accountId, scope.tenantId, scope.organizationId, 'Policy account', 'policy-account', timestamp, timestamp)
const credentials = { username: 'tester', password: 'not-a-real-secret' }
const statusFor = baseUrl => getFlowableStatus({ ...credentials, baseUrl })

after(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

  test('production accepts only exact environment-allowlisted Flowable HTTP base URLs', () => {
    for (const baseUrl of [staging, `${staging}/`, rollback, `${rollback}/`]) {
      assert.equal(statusFor(baseUrl).configured, true, baseUrl)
      assert.doesNotThrow(() => saveConnectorConfig(scope, 'flowable', { baseUrl, ...credentials }, 'policy-user'))
    }
    for (const baseUrl of [
      `${staging}?x=1`, `${staging}#x`, `${staging}/extra`, staging.replace('18081', '18082'),
      staging.replace('flowable-stage', 'other'), rollback.replace('18080', '18081'),
      'http://user:pass@flowable-stage.example.invalid:18081/flowable-rest/service',
    ]) {
      assert.equal(statusFor(baseUrl).configured, false, baseUrl)
      assert.throws(() => saveConnectorConfig(scope, 'flowable', { baseUrl, ...credentials }, 'policy-user'), /URL|HTTP/i, baseUrl)
    }
  })

  test('HTTPS does not require the HTTP allowlist and unrelated providers stay restricted', () => {
    assert.equal(statusFor('https://flowable.example.invalid/flowable-rest/service').configured, true)
    assert.equal(statusFor('http://localhost:8080/flowable-rest/service').configured, false)
    const k3 = { accountId: 'erp-account', username: 'erp-user', organization: 'org', appId: 'app', appSecret: 'fake-secret' }
    assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: staging }, 'policy-user'), /HTTPS/)
    assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: 'http://localhost:8080/flowable-rest/service' }, 'policy-user'), /HTTPS/)
    assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: 'http://other.example.invalid/erp' }, 'policy-user'), /HTTPS/)
    assert.throws(() => saveConnectorConfig(scope, 'dingtalk', { webhookUrl: 'http://oapi.dingtalk.com/robot/send?access_token=fake' }, 'policy-user'), /HTTPS/)
    assert.throws(() => saveConnectorConfig(scope, 'dingtalk', { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=fake', publicAppUrl: 'http://localhost:8080/app' }, 'policy-user'), /HTTPS/)
  })

  test('non-production connector configuration continues to allow loopback HTTP', () => {
    process.env.NODE_ENV = 'test'
    try { assert.doesNotThrow(() => saveConnectorConfig(scope, 'flowable', { baseUrl: 'http://localhost:8080/flowable-rest/service', ...credentials }, 'policy-user')) }
    finally { process.env.NODE_ENV = 'production' }
  })

  test('Flowable authenticated requests do not follow redirects', async () => {
    const originalFetch = globalThis.fetch
    let options
    globalThis.fetch = async (_url, init) => { options = init; throw new TypeError('redirect blocked') }
    try {
      const result = await health({ baseUrl: rollback, ...credentials })
      assert.equal(options.redirect, 'error')
      assert.equal(result.connected, false)
    } finally { globalThis.fetch = originalFetch }
  })
