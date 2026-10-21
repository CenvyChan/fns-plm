// Isolated UI/API fixture. No production config, connector mutation, external traffic or notifications.
// Run after building server/client. Only loopback listeners and a new temporary SQLite database.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
const root = resolve(import.meta.dirname, '../..'), work = mkdtempSync(join(tmpdir(), 'custom-start-ui-'))
const port = Number(process.env.CUSTOM_UI_PORT || 4560), apiPort = port + 1, mockPort = port + 2
const origin = `http://127.0.0.1:${apiPort}`
let child, token, scope, deployment = 0, starts = [], calls = [], definitions = new Map()
let healthUnavailable = false
const mock = createServer(async (req, res) => {
  let body = ''; for await (const b of req) body += b
  calls.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json')
  const url = new URL(req.url, 'http://127.0.0.1')
  if (healthUnavailable && url.pathname === '/runtime/tasks') { res.statusCode = 503; return res.end(JSON.stringify({ error: 'isolated_health_unavailable' })) }
  if (req.method === 'POST' && url.pathname === '/repository/deployments') return res.end(JSON.stringify({ id: `isolated-deployment-${++deployment}` }))
  if (url.pathname === '/repository/process-definitions') {
    const def = { id: `${url.searchParams.get('key')}:1:isolated-${deployment}`, key: url.searchParams.get('key'), deploymentId: `isolated-deployment-${deployment}`, tenantId: url.searchParams.get('tenantId') }
    definitions.set(def.id, def); return res.end(JSON.stringify({ data: [def] }))
  }
  if (url.pathname.startsWith('/repository/process-definitions/')) return res.end(JSON.stringify(definitions.get(decodeURIComponent(url.pathname.split('/').pop())) || {}))
  if (req.method === 'POST' && url.pathname === '/runtime/process-instances') {
    const input = JSON.parse(body), def = definitions.get(input.processDefinitionId)
    assert(def); assert(!input.processDefinitionKey); assert(!input.tenantId)
    const record = { id: `isolated-custom-instance-${starts.length + 1}`, processDefinitionId: def.id, tenantId: def.tenantId }
    starts.push({ ...record, input }); writeFileSync(join(work, 'engine-starts.json'), JSON.stringify(starts, null, 2))
    if (input.variables.some(v => v.name === 'title' && v.value === 'UAT uncertain outcome')) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'test_uncertain' })) }
    return res.end(JSON.stringify(record))
  }
  res.end(JSON.stringify({ data: [] }))
})
await new Promise(r => mock.listen(mockPort, '127.0.0.1', r))
const env = { PATH: process.env.PATH, HOME: work, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort), DATABASE_FILE: join(work, 'ui.sqlite'), DOTENV_CONFIG_PATH: join(work, 'absent.env'), APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY_FILE: join(work, 'key'), DATA_FILE: join(work, 'absent.json'), LEGACY_DATA_FILE: join(work, 'absent.json'), DOCUMENT_STORAGE_DIR: join(work, 'documents'), INTEGRATION_DATA_DIR: join(work, 'integrations'), BPMN_MODELER_ALLOW_TEST_MOCK: 'true', REDIS_URL: '', FLOWABLE_BASE_URL: `http://127.0.0.1:${mockPort}`, FLOWABLE_USERNAME: 'isolated-mock', FLOWABLE_PASSWORD: 'isolated-mock', FLOWABLE_USER_MAP_JSON: '{}', DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', K3CLOUD_BASE_URL: '' }
async function boot() {
  child = spawn(process.execPath, ['dist/index.js'], { cwd: join(root, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', b => writeFileSync(join(work, 'api.log'), b, { flag: 'a' })); child.stderr.on('data', b => writeFileSync(join(work, 'api.log'), b, { flag: 'a' }))
  for (let i = 0; i < 200; i++) { assert(child.exitCode === null, 'API exited'); try { if ((await fetch(origin + '/api/health')).ok) return } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw Error('API unavailable')
}
async function stopChild() { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) }
async function api(path, method = 'GET', body, status = 200) {
  const response = await fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'X-Tenant-ID': scope.tenantId, 'X-Organization-ID': scope.organizationId, 'X-Account-ID': scope.accountId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data
}
await boot()
const password = 'Isolated-browser-2026!'
const setup = await api('/auth/mobile/setup', 'POST', { email: 'custom-admin@example.test', displayName: '自定义流程验收管理员', password }, 201)
token = setup.accessToken; scope = setup.user
await stopChild()
Object.assign(env, { CONNECTOR_DEFAULT_TENANT_ID: scope.tenantId, CONNECTOR_DEFAULT_ORGANIZATION_ID: scope.organizationId, CONNECTOR_DEFAULT_ACCOUNT_ID: scope.accountId })
await boot()
for (const role of ['plm_manager', 'reviewer', 'member']) {
  const created = await api('/auth/users', 'POST', { email: `custom-${role}@example.test`, displayName: `UAT ${role}`, role }, 201)
  await api('/auth/activate', 'POST', { token: created.activationToken, password })
}
const definition = { dslVersion: 1, fields: [{ id: 'decision', label: '审批说明', type: 'text', required: true }] }
await api('/forms', 'POST', { key: 'uatPinnedForm', name: 'UAT 固定版本表单', definition }, 201)
await api('/forms/uatPinnedForm/publish', 'POST', { revision: 1 }, 201)
const graph = { key: 'uatCustomApproval', name: 'UAT 自定义流程（已发布）', nodes: [{ id: 'Start', type: 'startEvent', name: '开始', x: 120, y: 180 }, { id: 'Review', type: 'userTask', name: '审批', assignment: { kind: 'assignee', userIds: [scope.id] }, formBinding: { formKey: 'uatPinnedForm', formVersion: 1 }, x: 300, y: 180 }, { id: 'End', type: 'endEvent', name: '结束', x: 550, y: 180 }], flows: [{ id: 'f1', source: 'Start', target: 'Review' }, { id: 'f2', source: 'Review', target: 'End' }] }
const model = await api('/bpmn-models', 'POST', { graph }, 201)
await api(`/bpmn-models/${model.id}/versions`, 'POST', { expectedRevision: 1 }, 201)
const preview = await api(`/bpmn-models/${model.id}/preview`, 'POST', { version: 1 })
await api(`/bpmn-models/${model.id}/publish`, 'POST', { version: 1, confirmationToken: preview.confirmationToken, confirm: true })
await api('/forms/uatPinnedForm', 'PUT', { name: 'UAT 固定版本表单 v2', definition: { ...definition, fields: [...definition.fields, { id: 'newField', label: '仅 v2 新增字段', type: 'text' }] }, revision: 1 })
await api('/forms/uatPinnedForm/publish', 'POST', { revision: 2 }, 201)
await api('/bpmn-models', 'POST', { graph: { ...graph, key: 'uatDraftOnly', name: 'UAT 自定义流程（未发布）' } }, 201)
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png' }
const web = createServer((req, res) => {
  if (req.url === '/__test-control/unavailable' && req.method === 'POST') { healthUnavailable = true; return res.end('isolated health unavailable') }
  if (req.url === '/__test-control/restore' && req.method === 'POST') { healthUnavailable = false; return res.end('isolated health restored') }
  if (req.url === '/__test-evidence') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ work, modelId: model.id, healthUnavailable, starts, calls }, null, 2)) }
  if (req.url.startsWith('/api/')) {
    const upstream = request(origin + req.url, { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}`, origin } }, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res) })
    upstream.on('error', () => { res.writeHead(502); res.end() }); req.pipe(upstream); return
  }
  let path = resolve(root, 'client/dist', '.' + new URL(req.url, 'http://localhost').pathname)
  if (!path.startsWith(resolve(root, 'client/dist') + '/') || !existsSync(path)) path = join(root, 'client/dist/index.html')
  res.setHeader('Content-Type', mime[extname(path)] || 'text/html'); res.end(readFileSync(path))
})
await new Promise(r => web.listen(port, '127.0.0.1', r))
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/?page=workflow`, work, modelId: model.id, email: 'custom-admin@example.test', password, mode: 'TEMP DB + loopback mock; zero connector mutations' }))
process.on('SIGTERM', () => { child.kill('SIGTERM'); web.close(); mock.close(); process.exit(0) })
