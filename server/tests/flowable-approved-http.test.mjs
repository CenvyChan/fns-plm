import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const tempDir = mkdtempSync(join(tmpdir(), 'connector-http-policy-'))
const previousNodeEnv = process.env.NODE_ENV
const previousFlag = process.env.ALLOW_INSECURE_CONNECTOR_HTTP
const previousDatabaseFile = process.env.DATABASE_FILE
const previousEncryptionKey = process.env.APP_ENCRYPTION_KEY
process.env.NODE_ENV = 'production'
process.env.ALLOW_INSECURE_CONNECTOR_HTTP = 'true'
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

test('preserves the existing exact production Flowable LAN endpoint without broadening it', () => {
  const exact = 'http://172.16.77.80:18081/flowable-rest/service'
  assert.equal(statusFor(exact).configured, true)
  assert.doesNotThrow(() => saveConnectorConfig(scope, 'flowable', { baseUrl: exact, ...credentials }, 'policy-user'))
  for (const baseUrl of [exact+'/', exact+'?', exact+'#', exact+'/extra', exact.replace('18081','18080'), exact.replace('77.80','77.81'), exact.replace('http://','HTTP://')]) {
    assert.equal(statusFor(baseUrl).configured, false, baseUrl)
    assert.throws(() => saveConnectorConfig(scope, 'flowable', { baseUrl, ...credentials }, 'policy-user'), /HTTPS/, baseUrl)
  }
})

test('production accepts only exact approved Flowable HTTP endpoints on rollback port 18080 and staging port 18081', () => {
  for (const baseUrl of ['http://100.83.138.26:18080/flowable-rest/service', 'http://100.83.138.26:18080/flowable-rest/service/', 'http://100.83.138.26:18081/flowable-rest/service', 'http://100.83.138.26:18081/flowable-rest/service/']) {
    assert.equal(statusFor(baseUrl).configured, true, baseUrl)
  }
  assert.equal(statusFor('https://flowable.example/flowable-rest/service').configured, true)
  assert.equal(statusFor('http://localhost:8080/flowable-rest/service').configured, false)
})

test('production saveConnectorConfig permits only approved Flowable HTTP endpoints and rejects other providers despite override flag', () => {
  for (const port of ['18080', '18081']) assert.doesNotThrow(() => saveConnectorConfig(scope, 'flowable', { baseUrl: `http://100.83.138.26:${port}/flowable-rest/service`, ...credentials }, 'policy-user'))
  const k3 = { accountId: 'erp-account', username: 'erp-user', organization: 'org', appId: 'app', appSecret: 'fake-secret' }
  assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: 'http://100.83.138.26:18080/flowable-rest/service' }, 'policy-user'), /HTTPS/)
  assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: 'http://localhost:8080/flowable-rest/service' }, 'policy-user'), /HTTPS/)
  assert.throws(() => saveConnectorConfig(scope, 'k3cloud', { ...k3, baseUrl: 'http://other.example/erp' }, 'policy-user'), /HTTPS/)
  assert.throws(() => saveConnectorConfig(scope, 'dingtalk', { webhookUrl: 'http://oapi.dingtalk.com/robot/send?access_token=fake' }, 'policy-user'), /HTTPS/)
  assert.throws(() => saveConnectorConfig(scope, 'dingtalk', { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=fake', publicAppUrl: 'http://localhost:8080/app' }, 'policy-user'), /HTTPS/)
})

test('non-production connector configuration continues to allow loopback HTTP', () => {
  process.env.NODE_ENV = 'test'
  try {
    assert.doesNotThrow(() => saveConnectorConfig(scope, 'flowable', { baseUrl: 'http://localhost:8080/flowable-rest/service', ...credentials }, 'policy-user'))
  } finally { process.env.NODE_ENV = 'production' }
})

test('production rejects other HTTP hosts, ports, paths, URL decorations; global flag cannot override', () => {
  for (const baseUrl of [
    'http://100.83.138.26/flowable-rest/service',
    'http://100.83.138.26:18082/flowable-rest/service',
    'http://100.83.138.26:18081/other',
    'http://100.83.138.26:18081/flowable-rest/service/extra',
    'http://other.example:18081/flowable-rest/service',
    'http://100.83.138.27:18081/flowable-rest/service',
    'http://100.83.138.26:18080/other',
    'http://100.83.138.26:18080/flowable-rest/service/extra',
    'http://other.example:18080/flowable-rest/service',
    'http://user:pass@100.83.138.26:18080/flowable-rest/service',
    'http://100.83.138.26:18080/flowable-rest/service?x=1',
    'http://100.83.138.26:18080/flowable-rest/service#x',
  ]) assert.equal(statusFor(baseUrl).configured, false, baseUrl)
})

test('Flowable authenticated requests do not follow redirects', async () => {
  const originalFetch = globalThis.fetch
  let options
  globalThis.fetch = async (_url, init) => {
    options = init
    throw new TypeError('redirect blocked')
  }
  try {
    const result = await health({ baseUrl: 'http://100.83.138.26:18080/flowable-rest/service', ...credentials })
    assert.equal(options.redirect, 'error')
    assert.equal(result.connected, false)
  } finally {
    globalThis.fetch = originalFetch
    db.close()
    rmSync(tempDir, { recursive: true, force: true })
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousFlag === undefined) delete process.env.ALLOW_INSECURE_CONNECTOR_HTTP
    else process.env.ALLOW_INSECURE_CONNECTOR_HTTP = previousFlag
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    if (previousEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = previousEncryptionKey
  }
})
