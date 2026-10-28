import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
const evidenceDir = new URL('../../qa-evidence/custom-process-start-generation/', import.meta.url).pathname

for (const scenario of [
  { name: 'same-key stale success', outcome: 'success', action: '刷新测试上下文' },
  { name: 'same-key stale HTTP error', outcome: 'http-error', action: '刷新测试上下文' },
  { name: 'same-key stale transport error', outcome: 'network-error', action: '刷新测试上下文' },
  { name: 'same-key stale JSON error', outcome: 'json-error', action: '刷新测试上下文' },
  { name: 'user scope changes', outcome: 'success', action: '切换测试账套' },
  { name: 'model changes', outcome: 'success', action: '切换测试模型' },
  { name: 'late POST conflict cannot trigger obsolete refresh', outcome: 'success', action: '刷新测试上下文', mode: 'late-post' },
]) {
  test(`browser: ${scenario.name} cannot replace latest immutable context or submit stale version`, async () => {
    const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'spa' })
    await server.listen()
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage(), errors = [], outbound = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', route => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') { outbound.push(route.request().url()); return route.abort() }
        return route.continue()
      })
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/custom-start-refresh-race.html?mode=${scenario.mode || 'refresh'}`)
      await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
      await page.getByLabel('流程标题').fill('initial v7 attempt')
      await page.getByLabel(/确认启动已发布 v7/).check()
      await page.getByRole('button', { name: '确认启动自定义流程' }).click()
      await page.waitForFunction(latePost => window.__test.calls.length === (latePost ? 1 : 2) && window.__test.submissions.length === 1, !!scenario.mode)
      await page.getByRole('button', { name: scenario.action, exact: true }).click()
      await page.locator('section.custom-process-start > p').filter({ hasText: '已发布 v9' }).waitFor()
      await page.getByText(/pinnedForm 固定 v4/).waitFor()
      await page.evaluate(outcome => window.__test.releaseOld(outcome), scenario.outcome)
      await page.waitForFunction(() => window.__test.oldCompleted)
      // A browser task boundary plus React commit frames drains the released async chain.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.locator('section.custom-process-start > p').filter({ hasText: '已发布 v9' }).count(), 1)
      assert.equal(await page.getByText(/pinnedForm 固定 v4/).count(), 1)
      assert.equal(await page.getByText(/已发布 v8|pinnedForm 固定 v3/).count(), 0)
      assert.equal(await page.getByRole('alert').count(), 0)
      assert.equal(await page.evaluate(() => window.__test.submissions.length), 1)
      assert.equal(await page.evaluate(() => window.__test.calls.length), scenario.mode ? 2 : 3)
      await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
      await page.getByLabel('流程标题').fill('latest v9 only')
      assert.equal(await page.getByLabel(/确认启动已发布 v9/).isChecked(), false)
      assert.equal(await page.getByRole('button', { name: '确认启动自定义流程' }).isDisabled(), true)
      // Bypass disabled HTML submit: the component guard must still reject an unconfirmed start.
      await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      assert.equal(await page.evaluate(() => window.__test.submissions.length), 1)
      await page.getByLabel(/确认启动已发布 v9/).check()
      await page.getByRole('button', { name: '确认启动自定义流程' }).click()
      await page.getByText(/自定义流程已启动.*local-latest-v9/).waitFor()
      const state = await page.evaluate(() => ({ calls: window.__test.calls, submissions: window.__test.submissions }))
      assert.deepEqual(state.submissions.map(body => body.expectedVersionId), ['immutable-v7', 'immutable-v9'])
      assert.deepEqual(errors, [])
      assert.deepEqual(outbound, [])
      mkdirSync(evidenceDir, { recursive: true })
      const slug = scenario.name.replaceAll(' ', '-')
      writeFileSync(`${evidenceDir}/${slug}.json`, JSON.stringify({ scenario, checks: { latestFlowVersion: 9, latestFormVersion: 4, staleStateIgnored: true, reconfirmationRequired: true, requestVersions: state.submissions.map(body => body.expectedVersionId), contextRequests: state.calls.length, pageErrors: errors, outboundRequests: outbound } }, null, 2) + '\n')
      if (scenario.name === 'same-key stale success') await page.screenshot({ path: `${evidenceDir}/latest-version-start.png`, fullPage: true })
    } finally { await browser.close(); await server.close() }
  })
}
