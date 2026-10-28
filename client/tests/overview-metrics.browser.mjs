import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// All API responses are local fixtures: this test never uses real accounts or writes data.
test('overview metrics retain colors and stay aligned on desktop and mobile', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })
  const evidence = new URL('../../qa-evidence/overview-metrics/', import.meta.url).pathname
  mkdirSync(evidence, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const user = { id: 'preview-user', email: 'preview@example.test', displayName: '预览用户', role: 'admin', disabled: false, isPlatformAdmin: false, createdAt: '2026-10-21', tenantId: 'preview', tenantName: '本地样式预览', organizationId: 'preview-org', organizationName: '预览组织', accountId: 'preview-account', accountName: '预览账套', membershipId: 'preview-membership' }
    const workspace = Object.fromEntries(['tasks', 'projects', 'kpiRules', 'reviews', 'materials', 'boms', 'salesBomSnapshots', 'documents', 'projectPhases', 'projectMilestones', 'projectEvents', 'projectEventReviews', 'projectReports', 'projectTemplates'].map(key => [key, []]))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname !== '127.0.0.1') return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      let data = {}
      if (url.pathname === '/api/auth/status') data = { setupRequired: false }
      else if (url.pathname === '/api/auth/me') data = { user, scopes: [user] }
      else if (url.pathname === '/api/workspace') data = workspace
      else if (url.pathname === '/api/daily-reports/summary') data = { access: {} }
      return route.fulfill({ json: data })
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?page=overview`)
    const metrics = page.locator('.overview-metrics')
    await metrics.waitFor()
    assert.equal(await metrics.locator('.stat-card').count(), 4)
    for (const removed of ['把注意力留给真正重要的事。今天也会是稳稳向前的一天。', '保持轻盈，一次专注一件', '当前账套中的项目记录', '完成一项，就向前一步', '按本周截止日期统计', '专注当下，按自己的节奏来。']) assert.equal(await page.getByText(removed, { exact: true }).count(), 0)
    const readLayout = () => metrics.locator('.stat-card').evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y, width: card.getBoundingClientRect().width, border: getComputedStyle(card).borderLeftWidth, shadow: getComputedStyle(card).boxShadow })))
    const desktop = await readLayout()
    assert.ok(desktop.every(card => card.y === desktop[0].y))
    assert.deepEqual(desktop.map(card => card.border), ['0px', '1px', '1px', '1px'])
    assert.ok(desktop.every(card => card.shadow === 'none'))
    const colors = await metrics.locator('.stat-icon').evaluateAll(icons => icons.map(icon => getComputedStyle(icon).color))
    assert.deepEqual(colors, ['rgb(136, 117, 237)', 'rgb(83, 173, 137)', 'rgb(229, 156, 102)', 'rgb(111, 153, 223)'])
    await metrics.screenshot({ path: `${evidence}/metrics-desktop.png` })
    await page.screenshot({ path: `${evidence}/overview-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: /^管理页签/ }).click()
    await page.locator('dialog.workspace-manager').waitFor()
    assert.equal(await page.locator('#workspace-manager-help').count(), 0)
    assert.equal(await page.locator('dialog.workspace-manager').getAttribute('aria-describedby'), null)
    await page.getByRole('button', { name: '关闭页签管理' }).click()
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 })
      // Let responsive sidebar transitions finish before visual assertions/screenshots.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
      const cards = await readLayout()
      if (width <= 760) {
        assert.equal(cards[0].y, cards[1].y)
        assert.equal(cards[2].y, cards[3].y)
        assert.ok(cards[2].y > cards[0].y)
        assert.deepEqual(cards.map(card => card.border), ['0px', '1px', '0px', '1px'])
      }
      assert.equal(await metrics.evaluate(node => node.scrollWidth <= node.clientWidth), true)
      if (width === 390) await metrics.screenshot({ path: `${evidence}/metrics-mobile.png` })
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close() }
})
