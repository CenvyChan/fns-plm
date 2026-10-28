import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../src/api.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

const localValues = new Map()
const requests = []
globalThis.window = { __MOMENTUM_NATIVE__: true }
globalThis.localStorage = {
  getItem(key) { return localValues.has(key) ? localValues.get(key) : null },
  setItem(key, value) { localValues.set(key, String(value)) },
  removeItem(key) { localValues.delete(key) },
}
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init })
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const api = await import(moduleUrl)

test('Android API origin is runtime-configurable and native mode rejects non-HTTPS or credential-bearing URLs', () => {
  for (const invalid of [
    'http://workspace.mock.invalid',
    'https://user:pass@workspace.mock.invalid',
    'https://workspace.mock.invalid/api',
    'https://workspace.mock.invalid/?token=not-allowed',
  ]) {
    assert.throws(() => api.setApiBaseUrl(invalid), /服务器地址|HTTPS 服务端地址/)
  }
  assert.equal(api.getApiBaseUrl(), '', 'rejected config must not be persisted')

  api.setApiBaseUrl('https://workspace.mock.invalid/')
  assert.equal(api.getApiBaseUrl(), 'https://workspace.mock.invalid')
  api.setApiBaseUrl('')
  assert.equal(api.getApiBaseUrl(), '')
})

test('native API requests use the configured origin with Bearer token and verified scope headers', async () => {
  api.setApiBaseUrl('https://workspace.mock.invalid')
  const token = `runtime-mock-${randomUUID()}`
  api.setApiToken(token)
  api.setApiScope({ tenantId: 'tenant-mock', organizationId: 'organization-mock', accountId: 'account-mock' })

  const response = await api.apiFetch('/api/auth/me')
  assert.equal(response.status, 200)
  assert.equal(requests.at(-1).url, 'https://workspace.mock.invalid/api/auth/me')
  const headers = new Headers(requests.at(-1).init.headers)
  assert.equal(headers.get('Authorization'), `Bearer ${token}`)
  assert.equal(headers.get('X-Tenant-ID'), 'tenant-mock')
  assert.equal(headers.get('X-Organization-ID'), 'organization-mock')
  assert.equal(headers.get('X-Account-ID'), 'account-mock')
  assert.equal(requests.at(-1).init.credentials, 'include')
  assert.equal(new URL(requests.at(-1).url).username, '')
  assert.equal(new URL(requests.at(-1).url).password, '')
})
