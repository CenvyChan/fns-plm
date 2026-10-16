import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const miniappDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const storage = new Map()
const calls = { requests: [], navigation: [], alerts: [], stoppedRefreshes: 0 }
let apiBaseUrl = 'https://workspace.mock.invalid'
let route = async () => ({ status: 404, data: { message: 'mock route missing' } })
let mockAuthCode = `mock-auth-${randomUUID()}`
let mockSession = `mock-session-${randomUUID()}`
let authCodeResult = { authCode: mockAuthCode }

globalThis.getApp = () => ({ globalData: { apiBaseUrl } })
globalThis.dd = {
  getStorageSync({ key }) { return storage.has(key) ? { data: storage.get(key) } : { data: '' } },
  setStorageSync({ key, data }) { storage.set(key, data) },
  removeStorageSync({ key }) { storage.delete(key) },
  httpRequest(options) {
    calls.requests.push(options)
    Promise.resolve().then(() => route(options)).then((result) => {
      const response = { status: result.status ?? 200, data: result.data }
      options.success?.(response)
    }).catch((error) => options.fail?.({ message: error.message }))
  },
  getAuthCode(options) { options.success?.(authCodeResult) },
  redirectTo(options) { calls.navigation.push({ type: 'redirectTo', ...options }) },
  navigateTo(options) { calls.navigation.push({ type: 'navigateTo', ...options }) },
  navigateBack(options = {}) { calls.navigation.push({ type: 'navigateBack', ...options }) },
  stopPullDownRefresh() { calls.stoppedRefreshes += 1 },
  alert(options) { calls.alerts.push(options); options.success?.() },
}

const api = await import('../utils/api.js')

function reset({ baseUrl = 'https://workspace.mock.invalid', handler } = {}) {
  apiBaseUrl = baseUrl
  storage.clear()
  calls.requests.length = 0
  calls.navigation.length = 0
  calls.alerts.length = 0
  calls.stoppedRefreshes = 0
  route = handler ?? (async () => ({ status: 404, data: { message: 'mock route missing' } }))
  mockAuthCode = `mock-auth-${randomUUID()}`
  mockSession = `mock-session-${randomUUID()}`
  authCodeResult = { authCode: mockAuthCode }
}

function loadPage(relativePath, injectedApi = api) {
  const filename = join(miniappDir, relativePath)
  const original = readFileSync(filename, 'utf8')
  const source = original.replace(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
  assert.notEqual(source, original, `${relativePath} must have a replaceable API import for isolated interaction tests`)
  let definition
  const context = {
    Page(value) { definition = value },
    dd: globalThis.dd,
    getApp: globalThis.getApp,
    console,
    Promise,
    ...api,
    ...injectedApi,
  }
  vm.runInNewContext(source, context, { filename })
  assert.ok(definition, `${relativePath} must register a page`)
  return definition
}

function pageContext(definition) {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
}

async function settle() {
  await new Promise(resolveTick => setTimeout(resolveTick, 0))
}

function userRecord(overrides = {}) {
  return {
    id: 'mock-user', displayName: 'Mock User', email: 'mock@example.invalid',
    tenantId: 'tenant-mock', organizationId: 'org-mock', accountId: 'account-mock',
    ...overrides,
  }
}

test('API origin must be explicitly configured as a credential-free HTTPS origin', async () => {
  reset({ baseUrl: '' })
  assert.equal(api.isApiBaseConfigured(), false)
  await assert.rejects(api.getAuthStatus(), /API 地址尚未配置/)
  assert.equal(calls.requests.length, 0, 'missing API config must not issue a network request')

  for (const invalid of ['http://workspace.mock.invalid', 'https://user:pass@workspace.mock.invalid', 'https://workspace.mock.invalid/api', 'https://workspace.mock.invalid/?token=x']) {
    reset({ baseUrl: invalid })
    assert.equal(api.isApiBaseConfigured(), false, `${invalid} must not pass API base validation`)
    await assert.rejects(api.getAuthStatus(), /HTTPS origin/)
    assert.equal(calls.requests.length, 0, 'invalid API config must fail before calling DingTalk HTTP')
  }
})

test('DingTalk authCode goes only to the backend; issued token and verified scope are used on later requests', async () => {
  reset({ handler: async (request) => {
    if (request.url.endsWith('/api/auth/dingtalk/mobile-login')) {
      return { data: { accessToken: mockSession, user: userRecord(), scopes: [] } }
    }
    if (request.url.endsWith('/api/workflow/tasks')) {
      return { data: { mode: 'demo', tasks: [{ id: 'demo-task-1', title: 'Mock approval' }] } }
    }
    return { status: 404, data: { message: 'unexpected mock route' } }
  } })

  await api.mobileDingTalkLogin(mockAuthCode)
  const loginRequest = calls.requests[0]
  assert.equal(loginRequest.url, 'https://workspace.mock.invalid/api/auth/dingtalk/mobile-login')
  assert.equal(loginRequest.method, 'POST')
  assert.deepEqual(loginRequest.data, { authCode: mockAuthCode })
  assert.equal(loginRequest.headers.Authorization, undefined, 'SSO exchange must not reuse a previous Bearer session')
  assert.equal(storage.get('momentum.mobile-token'), mockSession)
  assert.deepEqual(JSON.parse(storage.get('momentum.verified-scope')), {
    tenantId: 'tenant-mock', organizationId: 'org-mock', accountId: 'account-mock',
  })

  const taskResponse = await api.getTasks()
  assert.equal(taskResponse.mode, 'demo')
  assert.deepEqual(taskResponse.tasks, [{ id: 'demo-task-1', title: 'Mock approval' }])
  const tasksRequest = calls.requests[1]
  assert.equal(tasksRequest.headers.Authorization, `Bearer ${mockSession}`)
  assert.equal(tasksRequest.headers['X-Tenant-ID'], 'tenant-mock')
  assert.equal(tasksRequest.headers['X-Organization-ID'], 'org-mock')
  assert.equal(tasksRequest.headers['X-Account-ID'], 'account-mock')
})

test('approval completion sends a decision and comment without a client-declared actor', async () => {
  reset({ handler: async () => ({ data: { ok: true } }) })
  storage.set('momentum.mobile-token', `mock-session-${randomUUID()}`)
  storage.set('momentum.verified-scope', JSON.stringify({ tenantId: 'tenant-mock', organizationId: 'org-mock', accountId: 'account-mock' }))

  await api.completeTask('task/with slash', 'approve', '  reviewed in mock  ')
  const request = calls.requests[0]
  assert.equal(request.url, 'https://workspace.mock.invalid/api/workflow/tasks/task%2Fwith%20slash/complete')
  assert.deepEqual(request.data, { decision: 'approve', comment: 'reviewed in mock' })
  assert.equal(Object.hasOwn(request.data, 'actor'), false)
})

test('401 clears local token and scope; malformed login response cannot leave a partial session', async () => {
  reset({ handler: async () => ({ status: 401, data: { message: '请登录后继续' } }) })
  storage.set('momentum.mobile-token', `expired-${randomUUID()}`)
  storage.set('momentum.verified-scope', JSON.stringify({ tenantId: 'tenant-mock', organizationId: 'org-mock', accountId: 'account-mock' }))
  await assert.rejects(api.getTasks(), /请登录后继续/)
  assert.equal(storage.has('momentum.mobile-token'), false)
  assert.equal(storage.has('momentum.verified-scope'), false)

  reset({ handler: async () => ({ data: { accessToken: 'partial-session', user: { id: 'incomplete-user' } } }) })
  storage.set('momentum.mobile-token', `old-${randomUUID()}`)
  storage.set('momentum.verified-scope', JSON.stringify({ tenantId: 'old-tenant', organizationId: 'old-org', accountId: 'old-account' }))
  await assert.rejects(api.mobileDingTalkLogin(mockAuthCode), /完整的租户\/组织\/账套范围/)
  assert.equal(storage.has('momentum.mobile-token'), false)
  assert.equal(storage.has('momentum.verified-scope'), false)
})

test('login page reports missing API configuration and never falls back from failed SSO to password login', async () => {
  reset({ baseUrl: '' })
  const loginPage = loadPage('pages/login/index.js')
  const unconfigured = pageContext(loginPage)
  loginPage.onLoad.call(unconfigured)
  assert.equal(unconfigured.data.apiBaseConfigured, false)
  assert.equal(unconfigured.data.statusLoaded, true)
  assert.equal(calls.requests.length, 0)

  reset({ handler: async (request) => {
    if (request.url.endsWith('/api/auth/status')) return { data: { setupRequired: false, dingtalkSso: { configured: true } } }
    if (request.url.endsWith('/api/auth/dingtalk/mobile-login')) return { status: 403, data: { message: '此钉钉身份尚未绑定' } }
    return { status: 404, data: { message: 'unexpected mock route' } }
  } })
  const page = pageContext(loginPage)
  loginPage.onLoad.call(page)
  await settle()
  assert.equal(page.data.ssoConfigured, true)
  loginPage.onDingTalkLogin.call(page)
  await settle()
  assert.equal(page.data.error, '此钉钉身份尚未绑定')
  assert.ok(calls.requests.some(request => request.url.endsWith('/api/auth/dingtalk/mobile-login')))
  assert.equal(calls.requests.some(request => request.url.endsWith('/api/auth/mobile/login')), false, 'SSO failure must not silently invoke password login')
})

test('personal password login is called only after the explicit fallback is opened and user input is submitted', async () => {
  reset()
  let suppliedCredentials
  const loginPage = loadPage('pages/login/index.js', {
    getCurrentUser: async () => { throw new Error('no saved session') },
    getAuthStatus: async () => ({ dingtalkSso: { configured: false }, setupRequired: false }),
    mobileDingTalkLogin: async () => { throw new Error('not called') },
    mobileLogin: async (...args) => { suppliedCredentials = args; return { user: userRecord(), scopes: [] } },
    switchScope: async () => userRecord(),
  })
  const page = pageContext(loginPage)
  loginPage.onLoad.call(page)
  await settle()
  assert.equal(suppliedCredentials, undefined, 'page load must not attempt password authentication')
  loginPage.showPasswordLogin.call(page)
  const email = `user-${randomUUID()}@mock.invalid`
  const password = randomUUID()
  loginPage.onEmailInput.call(page, { detail: { value: email } })
  loginPage.onPasswordInput.call(page, { detail: { value: password } })
  loginPage.submit.call(page)
  await settle()
  assert.deepEqual(suppliedCredentials, [email, password])
})

test('all exposed page actions bind to handlers and invoke their corresponding API/navigation behavior', async () => {
  reset()
  const pages = {
    home: loadPage('pages/home/index.js', {
      getCurrentUser: async () => userRecord(),
      logout: async () => { calls.loggedOut = true },
    }),
    approvals: loadPage('pages/approvals/index.js', {
      getTasks: async () => ({ mode: 'demo', tasks: [{ id: 'task-1' }] }),
    }),
    detail: loadPage('pages/approval-detail/index.js', {
      getTask: async (id) => ({ mode: 'demo', task: { id, title: 'Mock task' } }),
      completeTask: async (...args) => { calls.completed = args },
    }),
    report: loadPage('pages/report-preview/index.js', {
      getReportPreview: async () => ({ summary: { taskTotal: 3, taskOpen: 2, taskDone: 1 }, markdown: 'mock report' }),
    }),
  }

  for (const [name, definition] of Object.entries(pages)) {
    const axml = readFileSync(join(miniappDir, `pages/${name === 'home' ? 'home' : name === 'detail' ? 'approval-detail' : name === 'report' ? 'report-preview' : 'approvals'}/index.axml`), 'utf8')
    const handlers = [...axml.matchAll(/on(?:Tap|Input|Change)="([A-Za-z_$][\w$]*)"/g)].map(match => match[1])
    for (const handler of handlers) assert.equal(typeof definition[handler], 'function', `${name} template handler ${handler} must exist`)
  }

  const home = pageContext(pages.home)
  pages.home.goApprovals.call(home)
  pages.home.goReport.call(home)
  assert.ok(calls.navigation.some(entry => entry.url === '/pages/approvals/index'))
  assert.ok(calls.navigation.some(entry => entry.url === '/pages/report-preview/index'))
  pages.home.signOut.call(home)
  await settle()
  assert.equal(calls.loggedOut, true)
  assert.ok(calls.navigation.some(entry => entry.type === 'redirectTo' && entry.url === '/pages/login/index'))

  const approvals = pageContext(pages.approvals)
  pages.approvals.onShow.call(approvals)
  await settle()
  assert.equal(approvals.data.mode, 'demo')
  assert.deepEqual(approvals.data.tasks, [{ id: 'task-1' }])
  pages.approvals.openTask.call(approvals, { currentTarget: { dataset: { id: 'task-1' } } })
  assert.ok(calls.navigation.some(entry => entry.url === '/pages/approval-detail/index?id=task-1'))

  const detail = pageContext(pages.detail)
  pages.detail.onLoad.call(detail, { id: 'task-1' })
  await settle()
  pages.detail.onCommentInput.call(detail, { detail: { value: '  reviewed  ' } })
  pages.detail.decide.call(detail, { currentTarget: { dataset: { decision: 'approve' } } })
  await settle()
  assert.deepEqual(calls.completed, ['task-1', 'approve', 'reviewed'])
  assert.ok(calls.alerts.some(entry => entry.title === '已提交同意'))

  const report = pageContext(pages.report)
  pages.report.onLoad.call(report, {})
  await settle()
  assert.equal(report.data.report.title, 'PLM 工作区报告')
  assert.equal(report.data.report.markdown, 'mock report')
  pages.report.onPullDownRefresh.call(report)
  await settle()
  assert.equal(calls.stoppedRefreshes, 1)
})
