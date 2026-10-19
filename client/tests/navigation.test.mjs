import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../src/navigation.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const navigation = await import(moduleUrl)

const users = {
  member: { role: 'member', isPlatformAdmin: false },
  admin: { role: 'admin', isPlatformAdmin: false },
  platform: { role: 'member', isPlatformAdmin: true },
  adminPlatform: { role: 'admin', isPlatformAdmin: true },
}
const allIds = ['overview', 'tasks', 'projects', 'timeline', 'materials', 'boms', 'documents', 'reports', 'kpi', 'workflow', 'users', 'settings', 'tenants']

test('navigation groups preserve expected labels and page grouping', () => {
  assert.deepEqual(navigation.navigationGroups.map(({ id, items }) => [id, items.map(item => item.id)]), [
    ['personal', ['overview', 'tasks', 'projects', 'timeline']],
    ['product', ['materials', 'boms', 'documents']],
    ['operations', ['reports', 'kpi']],
    ['collaboration', ['workflow']],
    ['administration', ['users', 'settings', 'tenants']],
  ])
  assert.ok(navigation.navigationGroups.every(group => group.label && group.description))
})

test('navigation contains all 13 original page IDs exactly once', () => {
  const ids = navigation.navigationGroups.flatMap(group => group.items.map(item => item.id))
  assert.equal(ids.length, 13)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual([...ids].sort(), [...allIds].sort())
})

test('all four roles × platform flag keep menu and deep-link authorization aligned', () => {
  for (const role of ['admin', 'plm_manager', 'reviewer', 'member']) {
    for (const isPlatformAdmin of [false, true]) {
      const user = { role, isPlatformAdmin }
      const expected = allIds.filter(id => ['users', 'settings'].includes(id) ? role === 'admin' : id === 'tenants' ? isPlatformAdmin : true)
      const groups = navigation.visibleNavigation(user)
      assert.deepEqual(groups.flatMap(group => group.items.map(item => item.id)), expected, `${role}/${isPlatformAdmin} pages`)
      assert.ok(groups.every(group => group.items.length > 0))
      for (const id of allIds) {
        assert.equal(navigation.resolveNavigationPage(id, user), expected.includes(id) ? id : 'overview')
        assert.equal(navigation.pageFromSearch(`?page=${id}`, user), expected.includes(id) ? id : 'overview')
      }
    }
  }
})

test('restricted and unknown deep links fall back to overview', () => {
  assert.equal(navigation.resolveNavigationPage('tenants', users.member), 'overview')
  assert.equal(navigation.resolveNavigationPage('users', users.platform), 'overview')
  assert.equal(navigation.resolveNavigationPage('missing', users.adminPlatform), 'overview')
  assert.equal(navigation.resolveNavigationPage(null, users.adminPlatform), 'overview')
  assert.equal(navigation.resolveNavigationPage('reports', users.member), 'reports')
})

test('navigationUrl retains tenant-related and unrelated query parameters and hash', () => {
  const href = 'https://workspace.example/app?tenantId=t-42&organizationId=o-7&accountId=a-3&filter=open&page=tasks#reports'
  const result = new URL(navigation.navigationUrl(href, 'reports'), 'https://workspace.example')
  assert.equal(result.pathname, '/app')
  assert.equal(result.searchParams.get('page'), 'reports')
  assert.equal(result.searchParams.get('tenantId'), 't-42')
  assert.equal(result.searchParams.get('organizationId'), 'o-7')
  assert.equal(result.searchParams.get('accountId'), 'a-3')
  assert.equal(result.searchParams.get('filter'), 'open')
  assert.equal(result.hash, '#reports')
})

test('pageFromSearch resolves every original page as a refresh/deep-link entry point', () => {
  for (const id of allIds) {
    assert.equal(navigation.pageFromSearch(`?tenantId=t-42&page=${id}`, users.adminPlatform), id, `refresh page=${id}`)
  }
  for (const id of ['users', 'settings', 'tenants']) {
    assert.equal(navigation.pageFromSearch(`?page=${id}`, users.member), 'overview', `restricted refresh page=${id}`)
  }
  assert.equal(navigation.pageFromSearch('?page=unknown', users.adminPlatform), 'overview')
  assert.equal(navigation.pageFromSearch('?tenantId=t-42', users.adminPlatform), 'overview')
})
