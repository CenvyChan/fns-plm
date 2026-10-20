import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NODE_ENV = 'test'
process.env.BPMN_MODELER_ALLOW_TEST_MOCK = 'true'
const { startProcessDefinition } = await import('../dist/integrations/flowable.js')
const cfg = (baseUrl) => ({ baseUrl, username: 'mock-user', password: 'mock-pass', timeoutMs: 80 })
const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = (server) => new Promise(resolve => server.close(resolve))

test('runtime router enforces authentication and manager role; unpublished models cannot start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plm-bpmn-runtime-router-'))
  process.env.DATABASE_FILE = join(dir, 'runtime.sqlite')
  process.env.CONNECTOR_DEFAULT_TENANT_ID = 'tenant-a'
  process.env.CONNECTOR_DEFAULT_ORGANIZATION_ID = 'org-a'
  process.env.CONNECTOR_DEFAULT_ACCOUNT_ID = 'account-a'
  process.env.APP_ENCRYPTION_KEY = 'ef'.repeat(32)
  await import('../dist/bpmn-modeler.js')
  const { createBpmnRuntimeRouter } = await import('../dist/bpmn-runtime.js')
  const flowable = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [] })) })
  process.env.FLOWABLE_BASE_URL = await listen(flowable)
  process.env.FLOWABLE_USERNAME = 'mock-user'; process.env.FLOWABLE_PASSWORD = 'mock-pass'
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => {
    const role = req.get('x-role')
    if (role) req.authUser = { id: 'actor-a', displayName: 'Actor A', role, tenantId: req.get('x-tenant') || 'tenant-a', tenantName: 'Tenant', organizationId: req.get('x-org') || 'org-a', organizationName: 'Org', accountId: req.get('x-account') || 'account-a', accountName: 'Account', isPlatformAdmin: false }
    next()
  })
  app.use('/bpmn-models', createBpmnRuntimeRouter())
  const server = createServer(app), origin = await listen(server)
  try {
    const call = (role, extra = {}) => fetch(`${origin}/bpmn-models/model-x/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'request-123456', ...(role ? { 'x-role': role } : {}), ...extra }, body: '{}', signal:AbortSignal.timeout(3000) })
    assert.equal((await call(null)).status, 401)
    assert.equal((await call('reviewer')).status, 403)
    const manager = await call('plm_manager')
    assert.equal(manager.status, 404)
    assert.equal((await call('admin', { 'x-tenant': 'tenant-other', 'x-org': 'org-other', 'x-account': 'account-other' })).status, 503, 'a different scope must not inherit the default scope connector')
  } finally { server.closeAllConnections(); flowable.closeAllConnections(); await close(server); await close(flowable); const {db}=await import('../dist/database.js');db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('custom runtime starts the exact immutable definition ID only after scoped repository verification', async () => {
  const calls = []
  const mock = createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url })
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET') {
      assert.equal(req.url, '/repository/process-definitions/def-123')
      res.end(JSON.stringify({ id: 'def-123', key: 'published_key', deploymentId: 'dep-123', tenantId: 'tenant:t:organization:o:account:a' }))
      return
    }
    let text = ''; for await (const chunk of req) text += chunk
    const payload = JSON.parse(text)
    assert.equal(payload.processDefinitionId, 'def-123')
    assert.equal(payload.processDefinitionKey, undefined, 'never resolve or start by caller-supplied key')
    assert.equal(payload.tenantId, undefined, 'Flowable forbids tenantId alongside exact processDefinitionId')
    res.end(JSON.stringify({ id: 'instance-1', tenantId: payload.tenantId, processDefinitionId: 'def-123' }))
  })
  const baseUrl = await listen(mock)
  try {
    const result = await startProcessDefinition('def-123', [], { tenantId: 'tenant:t:organization:o:account:a', expectedDefinition: { key: 'published_key', deploymentId: 'dep-123' } }, cfg(baseUrl))
    assert.equal(result.id, 'instance-1')
    assert.deepEqual(calls.map(x => x.method), ['GET', 'POST'])
  } finally { await close(mock) }
})

test('definition tenant/deployment/key mismatch fails closed before start', async () => {
  let posts = 0
  const mock = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') posts++
    res.end(JSON.stringify({ id: 'def-123', key: 'forged_key', deploymentId: 'dep-elsewhere', tenantId: 'other-tenant' }))
  })
  const baseUrl = await listen(mock)
  try {
    await assert.rejects(startProcessDefinition('def-123', [], { tenantId: 'tenant:t:organization:o:account:a', expectedDefinition: { key: 'published_key', deploymentId: 'dep-123' } }, cfg(baseUrl)), /does not match the published scoped definition/)
    assert.equal(posts, 0)
  } finally { await close(mock) }
})

test('start timeout is surfaced once and never retried', async () => {
  let posts = 0
  const mock = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET') { res.end(JSON.stringify({ id: 'def-123', key: 'k', deploymentId: 'dep', tenantId: 'scoped' })); return }
    posts++
    await new Promise(resolve => setTimeout(resolve, 160))
    if (!res.destroyed) res.end(JSON.stringify({ id: 'late' }))
  })
  const baseUrl = await listen(mock)
  try {
    await assert.rejects(startProcessDefinition('def-123', [], { tenantId: 'scoped', expectedDefinition: { key: 'k', deploymentId: 'dep' } }, cfg(baseUrl)), /timed out/)
    assert.equal(posts, 1)
  } finally { await close(mock) }
})
