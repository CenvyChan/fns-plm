import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
const evidenceDir = new URL('../../qa-evidence/custom-process-start-race-review/', import.meta.url).pathname

test('browser: published_version_changed reloads immutable flow/form versions and requires reconfirmation', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'spa' })
  await server.listen()
  const address = server.httpServer.address(), url = `http://127.0.0.1:${address.port}/tests/fixtures/custom-start-version-change.html`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(url)
    await page.getByRole('button', { name: '启动已发布自定义流程' }).waitFor()
    await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
    await page.getByLabel('流程标题').fill('version refresh test')
    await page.getByLabel(/确认启动已发布 v7/).check()
    await page.getByRole('button', { name: '确认启动自定义流程' }).click()
    await page.getByText(/已重新读取最新的不可变流程及表单版本/).waitFor()
    await page.locator('section.custom-process-start > p').filter({ hasText: '已发布 v8' }).waitFor()
    await page.getByText(/pinnedForm 固定 v3/).waitFor()
    assert.equal(await page.getByLabel(/确认启动已发布 v8/).isChecked(), false)
    assert.equal(await page.getByRole('button', { name: '确认启动自定义流程' }).isDisabled(), true)
    await page.getByLabel(/确认启动已发布 v8/).check()
    await page.getByRole('button', { name: '确认启动自定义流程' }).click()
    await page.getByText(/自定义流程已启动.*local-instance-1/).waitFor()
    const state = await page.evaluate(() => (window).__test)
    assert.deepEqual(state.calls, ['GET start-context', 'GET start-context'])
    assert.equal(state.submissions.length, 2)
    assert.equal(state.submissions[0].expectedVersionId, 'immutable-v7')
    assert.equal(state.submissions[1].expectedVersionId, 'immutable-v8')
    assert.deepEqual(errors, [])
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(`${evidenceDir}/published-version-changed-browser.json`, JSON.stringify({ url: 'local loopback Vite page', checks: { firstAttemptWasV7: true, refreshedContextV8AndFormV3: true, confirmationClearedAndSubmitDisabled: true, secondAttemptAfterReconfirmationWasV8: true, startContextFetchCount: state.calls.length, requestVersions: state.submissions.map(x => x.expectedVersionId), pageErrors: errors } }, null, 2) + '\n')
    await page.screenshot({ path: `${evidenceDir}/published-version-changed-browser.png`, fullPage: true })
  } finally { await browser.close(); await server.close() }
})

test('browser: failed refresh clears stale context and blocks repeat submission until reread', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'spa' })
  await server.listen()
  const address = server.httpServer.address(), url = `http://127.0.0.1:${address.port}/tests/fixtures/custom-start-version-change.html?refresh-fails`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(url)
    await page.getByRole('button', { name: '启动已发布自定义流程' }).waitFor()
    await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
    await page.getByLabel('流程标题').fill('failed refresh must not reuse v7')
    await page.getByLabel(/确认启动已发布 v7/).check()
    await page.getByRole('button', { name: '确认启动自定义流程' }).click()
    await page.getByText(/无法刷新启动上下文（HTTP 503）/).waitFor()
    assert.equal(await page.getByText(/已发布 v7/).count(), 0)
    assert.equal(await page.getByRole('button', { name: '确认启动自定义流程' }).isDisabled(), true)
    assert.equal(await page.evaluate(() => (window).__test.submissions.length), 1)
    await page.reload()
    await page.getByRole('button', { name: '启动已发布自定义流程' }).waitFor()
    assert.equal(await page.getByText(/已发布 v7/).count(), 1)
    assert.deepEqual(await page.evaluate(() => (window).__test.submissions.length), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close() }
})

test('browser: delayed old-model version response does not mutate the newly selected panel', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, server: { host: '127.0.0.1', port: 0 }, appType: 'spa' })
  await server.listen()
  const address = server.httpServer.address(), url = `http://127.0.0.1:${address.port}/tests/fixtures/custom-start-version-change.html?delayed-switch`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(url)
    await page.getByRole('button', { name: '启动已发布自定义流程' }).waitFor()
    await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
    await page.getByLabel('流程标题').fill('delayed old model')
    await page.getByLabel(/确认启动已发布 v7/).check()
    await page.getByRole('button', { name: '确认启动自定义流程' }).click()
    await page.getByRole('button', { name: '切换测试模型' }).click()
    await page.locator('section.custom-process-start > p').filter({ hasText: '已发布 v8' }).waitFor()
    await page.waitForTimeout(500)
    assert.equal(await page.getByText(/流程发布版本已更新/).count(), 0)
    assert.equal(await page.getByRole('button', { name: '启动已发布自定义流程' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '启动已发布自定义流程' }).isEnabled(), true)
    assert.equal(await page.evaluate(() => window.__test.submissions.length), 1)
    await page.getByRole('button', { name: '启动已发布自定义流程' }).click()
    await page.getByLabel('流程标题').fill('explicit new model start')
    await page.getByLabel(/确认启动已发布 v8/).check()
    await page.getByRole('button', { name: '确认启动自定义流程' }).click()
    await page.getByText(/自定义流程已启动.*local-instance-1/).waitFor()
    assert.equal(await page.evaluate(() => window.__test.submissions.length), 2)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close() }
})
