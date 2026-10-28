import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const evidence = new URL('../../qa-evidence/workspace-tab-manager/', import.meta.url).pathname
const user = { id: 'preview-user', email: 'preview@example.test', displayName: '隔离预览员', role: 'admin', disabled: false, isPlatformAdmin: false, createdAt: '2026-10-21', tenantId: 'preview', tenantName: '本地样式预览', organizationId: 'preview-org', organizationName: '预览组织', accountId: 'preview-account', accountName: '预览账套', membershipId: 'preview-membership' }
const workspace = Object.fromEntries(['tasks', 'projects', 'kpiRules', 'reviews', 'materials', 'boms', 'salesBomSnapshots', 'documents', 'projectPhases', 'projectMilestones', 'projectEvents', 'projectEventReviews', 'projectReports', 'projectTemplates'].map(key => [key, []]))
async function runFixture(fn) {
  mkdirSync(evidence, { recursive: true })
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], writes = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.hostname !== '127.0.0.1') return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (request.method() !== 'GET') { writes.push(request.url()); return route.abort() }
      let data = {}
      if (url.pathname === '/api/auth/status') data = { setupRequired: false }
      else if (url.pathname === '/api/auth/me') data = { user, scopes: [user] }
      else if (url.pathname === '/api/workspace') data = workspace
      else if (url.pathname === '/api/daily-reports/summary') data = { access: {} }
      return route.fulfill({ json: data })
    })
    await fn(page, `http://127.0.0.1:${server.httpServer.address().port}`)
    assert.deepEqual(errors, [])
    assert.deepEqual(writes, [], 'no live data or configuration writes')
  } finally { await browser.close(); await server.close() }
}
const triggerFor = page => page.getByRole('button', { name: /^管理页签/ })
const dialogFor = page => page.locator('dialog.workspace-manager')
const waitCount = (page, count) => page.getByRole('button', { name: `管理页签，已打开 ${count} 个页签`, exact: true }).waitFor()

test('topbar tab label sits next to a usable bell, without a content banner or overflow', async () => runFixture(async (page, origin) => {
  await page.goto(`${origin}/?page=overview`)
  await waitCount(page, 1)
  assert.equal(await page.locator('.workspace-tabs-toolbar').count(), 0)
  assert.equal(await page.locator('.content-area .workspace-manage-button').count(), 0)
  assert.equal(await page.locator('.topbar .workspace-manage-button').count(), 1)
  // Navigate in-app so the count is the real workspace state, not a fixture count.
  await page.locator('.sidebar .nav-item').filter({ hasText: '我的待办' }).click()
  await waitCount(page, 2)
  await page.getByRole('tab', { name: '总览', exact: true }).click()
  const samples = []
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(320)
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
      return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, trigger: rect('.workspace-manage-button'), bell: rect('.notification-button'), header: rect('.topbar'), actions: rect('.topbar-actions') }
    })
    assert.ok(layout.trigger.right <= layout.bell.x, `${width}: counter and bell do not overlap`)
    assert.ok(layout.bell.x - layout.trigger.right <= 12, `${width}: counter remains next to bell`)
    assert.ok(layout.trigger.width > 0 && layout.bell.width >= 30, `${width}: both controls visible`)
    assert.ok(layout.actions.right <= width && layout.actions.x >= 0, `${width}: actions fit viewport`)
    assert.ok(layout.pageWidth <= width, `${width}: no document overflow`)
    const bell = page.getByRole('button', { name: /^待办提醒，/ })
    await bell.click()
    await page.getByRole('region', { name: '待办提醒', exact: true }).waitFor()
    const popover = await page.locator('.notification-popover').boundingBox()
    assert.ok(popover.x >= 0 && popover.x + popover.width <= width, `${width}: bell popover fits`)
    await bell.click()
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${evidence}/topbar-${width}.png`, fullPage: true, animations: 'disabled' })
    await triggerFor(page).focus()
    await page.keyboard.press('Enter')
    await dialogFor(page).waitFor()
    assert.equal(await triggerFor(page).getAttribute('aria-expanded'), 'true')
    const box = await dialogFor(page).boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900, `${width}: dialog fits`)
    assert.equal(await dialogFor(page).evaluate(node => node.scrollWidth <= node.clientWidth), true)
    // Native modal focus cannot tab out to header controls.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await dialogFor(page).evaluate(node => node.contains(document.activeElement) || document.activeElement === document.body), true)
    }
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${evidence}/manager-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.keyboard.press('Escape')
    assert.equal(await triggerFor(page).getAttribute('aria-expanded'), 'false')
    assert.equal(await triggerFor(page).evaluate(node => node === document.activeElement), true)
    samples.push({ ...layout, dialog: box })
  }
  writeFileSync(`${evidence}/layout-samples.json`, JSON.stringify(samples, null, 2) + '\n')
} ))

test('relocated trigger uses existing close planning, draft confirmation and retained panels', async () => runFixture(async (page, origin) => {
  await page.goto(`${origin}/tests/fixtures/workspace-tabs-harness.html`)
  await waitCount(page, 1)
  await page.getByRole('button', { name: '进入任务', exact: true }).click()
  await page.getByLabel('tasks草稿内容', { exact: true }).fill('必须保留的草稿')
  await page.getByRole('button', { name: '进入物料', exact: true }).click()
  await waitCount(page, 3)
  await triggerFor(page).click()
  await page.getByRole('button', { name: '选择其他已保存页签', exact: true }).click()
  assert.equal(await dialogFor(page).locator('input:checked').count(), 1, 'current and dirty tabs excluded')
  await page.getByRole('button', { name: '清空选择', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '关闭所选（0）' }).isDisabled(), true)
  await dialogFor(page).locator('.workspace-manager-row').filter({ hasText: '我的待办' }).getByRole('checkbox').check()
  await dialogFor(page).locator('.workspace-manager-row').filter({ hasText: '总览' }).getByRole('checkbox').check()
  let confirms = []
  const dismiss = async dialog => { confirms.push(dialog.message()); await dialog.dismiss() }
  page.once('dialog', dismiss)
  await page.getByRole('button', { name: '关闭所选（2）' }).click()
  await waitCount(page, 3)
  assert.equal(await dialogFor(page).isVisible(), true, 'cancel leaves manager and selection intact')
  assert.equal(await dialogFor(page).locator('input:checked').count(), 2)
  assert.equal(confirms.length, 1)
  assert.match(confirms[0], /1 项未保存内容/)
  assert.match(confirms[0], /全部 2 项/)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /^我的待办/ }).click()
  assert.equal(await page.getByLabel('tasks草稿内容', { exact: true }).inputValue(), '必须保留的草稿')
  await triggerFor(page).click()
  await page.getByRole('button', { name: '选择其他已保存页签', exact: true }).click()
  await page.getByRole('button', { name: '关闭所选（2）' }).click()
  await waitCount(page, 1)
  assert.equal(await page.getByLabel('tasks草稿内容', { exact: true }).inputValue(), '必须保留的草稿', 'unselected tab and draft retained')
  await triggerFor(page).click()
  await page.getByRole('button', { name: '全选', exact: true }).click()
  page.once('dialog', async dialog => { confirms.push(dialog.message()); await dialog.accept() })
  await page.getByRole('button', { name: '关闭所选（1）' }).click()
  await waitCount(page, 1)
  await page.getByRole('tab', { name: '总览', exact: true }).waitFor()
  assert.equal(await page.getByLabel('tasks草稿内容', { exact: true }).count(), 0)
  assert.equal(confirms.length, 2)
  // Closing the last clean tab also returns a single overview, never an empty workspace.
  await triggerFor(page).click()
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('button', { name: '关闭所选（1）' }).click()
  await waitCount(page, 1)
  assert.equal(await page.getByRole('tab').count(), 1)
  await page.getByRole('button', { name: '进入物料', exact: true }).click()
  await page.getByRole('tab', { name: '物料', exact: false }).press('Home')
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '总览')
  await page.getByRole('tab', { name: '总览', exact: true }).press('End')
  assert.match(await page.getByRole('tab', { selected: true }).textContent(), /物料/)
  // Many tabs stay bounded at the required narrow viewport.
  await page.evaluate(() => sessionStorage.setItem('tab-manager-browser-fixture', JSON.stringify(['overview', 'tasks', 'materials', 'projects', 'timeline', 'documents', 'boms', 'kpi'].map(id => ({ id, page: id, url: `/?page=${id}` })))))
  await page.reload()
  await waitCount(page, 8)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.getByRole('status').filter({ hasText: '页签较多' }).waitFor()
  await triggerFor(page).click()
  assert.equal(await dialogFor(page).getByRole('checkbox').count(), 8)
  assert.equal(await dialogFor(page).evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await page.screenshot({ path: `${evidence}/manager-many-390.png`, fullPage: true, animations: 'disabled' })
}))
