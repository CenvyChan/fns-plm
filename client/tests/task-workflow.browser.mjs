import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// Fixtures only: no real accounts, services or production records are accessed.
test('task creation, copy cleanup, shared placeholders and collaboration actions', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] })
  const evidence = new URL('../../qa-evidence/task-workflow/', import.meta.url).pathname
  mkdirSync(evidence, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const user = { id: 'member', displayName: '任务负责人', email: 'member@example.test', role: 'member', tenantId: 'test', tenantName: '测试租户', organizationId: 'org', organizationName: '测试组织', accountId: 'account', accountName: '测试账套', membershipId: 'membership', isPlatformAdmin: false }
    let activeUser = user
    const manager = { id: 'manager', displayName: '汇报接收人', role: 'admin' }
    const workspace = Object.fromEntries(['tasks', 'projects', 'kpiRules', 'reviews', 'materials', 'boms', 'salesBomSnapshots', 'documents', 'projectPhases', 'projectMilestones', 'projectEvents', 'projectEventReviews', 'projectReports', 'projectTemplates'].map(key => [key, []]))
    const mutations = []
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.hostname !== '127.0.0.1') return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      let data = {}
      if (url.pathname === '/api/auth/status') data = { setupRequired: false }
      else if (url.pathname === '/api/auth/me') data = { user: activeUser, scopes: [activeUser] }
      else if (url.pathname === '/api/task-members') data = { members: [user, manager] }
      else if (url.pathname === '/api/workspace') data = workspace
      else if (url.pathname === '/api/daily-reports/summary') data = { access: {} }
      else if (url.pathname === '/api/tasks' && request.method() === 'POST') {
        const body = request.postDataJSON(); mutations.push(body)
        data = { ...body, creatorId: user.id, ...(body.collaborationMode ? { acceptanceStatus: body.collaborationMode === 'report' ? 'accepted' : 'pending', committedDueDate: body.collaborationMode === 'report' ? body.dueDate : undefined, reportStatus: 'none', reports: [], acceptBy: new Date(Date.now() + 7200000).toISOString() } : {}) }
        workspace.tasks.unshift(data)
      } else if (url.pathname.endsWith('/accept')) {
        const body = request.postDataJSON(); mutations.push({ action: 'accept', ...body })
        data = Object.assign(workspace.tasks.find(t => url.pathname.includes(t.id)), { acceptanceStatus: 'accepted', committedDueDate: body.committedDueDate, acceptedAt: new Date().toISOString() })
      } else if (url.pathname.endsWith('/review')) {
        const body = request.postDataJSON(); mutations.push({ action: 'review', ...body })
        data = Object.assign(workspace.tasks.find(t => url.pathname.includes(t.id)), { reportStatus: body.decision === 'approve' ? 'approved' : 'returned', status: body.decision === 'approve' ? 'done' : 'in-progress', reviewComment: body.comment })
      } else if (url.pathname.endsWith('/reports') && request.method() === 'POST') {
        const body = request.postData(); assert.ok(body.includes('本期目标已完成')); assert.ok(body.includes('evidence.txt'))
        data = Object.assign(workspace.tasks.find(t => url.pathname.includes(t.id)), { reportStatus: 'submitted', reports: [{ id: 'report-1', content: '本期目标已完成', progress: 100, createdAt: new Date().toISOString(), authorId: user.id, attachments: [{ id: 'attachment-1', name: 'evidence.txt', size: 7 }] }] })
        mutations.push({ action: 'report' })
      }
      return route.fulfill({ json: data })
    })
    const base = `http://127.0.0.1:${server.httpServer.address().port}`
    await page.goto(`${base}/?page=tasks`)
    await page.getByRole('heading', { name: /所有待办/ }).waitFor()
    for (const phrase of ['把大事拆小，按自己的节奏一件件完成。', '试试调整筛选条件，或创建一项新任务。']) assert.equal(await page.getByText(phrase, { exact: true }).count(), 0)
    await page.locator('.heading-add').click()
    const modal = page.locator('.modal-card')
    await modal.getByText('协作设置', { exact: true }).waitFor()
    assert.ok(!(await modal.innerText()).includes('MOMENTUM WORKSPACE'))
    const styles = await modal.locator('[name="title"], [name="description"]').evaluateAll(nodes => nodes.map(node => { const p = getComputedStyle(node, '::placeholder'); return { color: p.color, font: p.fontFamily, size: p.fontSize, weight: p.fontWeight, opacity: p.opacity, radius: getComputedStyle(node).borderRadius } }))
    assert.deepEqual(styles[0], styles[1])
    await modal.locator('[name="title"]').fill('自主发起周报')
    await modal.locator('select[name="collaborationMode-display"]').selectOption('report')
    await modal.locator('select[name="receiverId-display"]').selectOption('manager')
    await modal.locator('select[name="recurrence-display"]').selectOption('weekly')
    await modal.screenshot({ path: `${evidence}/create-report-desktop.png` })
    await modal.getByRole('button', { name: '创建任务', exact: true }).click()
    await modal.waitFor({ state: 'hidden' })
    assert.equal(mutations[0].collaborationMode, 'report')
    assert.equal(mutations[0].assigneeId, user.id)
    assert.equal(mutations[0].receiverId, manager.id)
    assert.equal(mutations[0].recurrence, 'weekly')
    await page.getByRole('button', { name: '自主发起周报', exact: true }).click()
    await modal.getByLabel('完成情况', { exact: true }).fill('本期目标已完成')
    await modal.getByLabel('进度（%）', { exact: true }).fill('100')
    await modal.locator('input[type="file"]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') })
    await modal.getByRole('button', { name: '提交汇报', exact: true }).click()
    await modal.getByText('历史汇报', { exact: true }).waitFor()
    await modal.getByRole('button', { name: 'evidence.txt', exact: true }).waitFor()
    assert.ok(mutations.some(m => m.action === 'report'))
    await modal.screenshot({ path: `${evidence}/submitted-report-desktop.png` })
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    activeUser = { ...user, ...manager }
    await page.reload()
    await page.getByRole('button', { name: '自主发起周报', exact: true }).click()
    assert.equal(await modal.getByLabel('完成情况', { exact: true }).count(), 0)
    await modal.getByLabel('评语（可选）', { exact: true }).fill('请补充验收依据')
    await modal.getByRole('button', { name: '退回修改', exact: true }).click()
    await modal.getByText('已退回', { exact: true }).waitFor()
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    activeUser = user
    await page.reload()
    await page.getByRole('button', { name: '自主发起周报', exact: true }).click()
    await modal.getByText('请补充验收依据', { exact: true }).waitFor()
    await modal.getByLabel('完成情况', { exact: true }).fill('本期目标已完成，并已补充验收依据')
    await modal.getByLabel('进度（%）', { exact: true }).fill('100')
    await modal.locator('input[type="file"]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') })
    await modal.getByRole('button', { name: '提交汇报', exact: true }).click()
    await modal.getByText('待审核', { exact: true }).waitFor()
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    activeUser = { ...user, ...manager }
    await page.reload()
    await page.getByRole('button', { name: '自主发起周报', exact: true }).click()
    await modal.getByRole('button', { name: '批准', exact: true }).click()
    await modal.getByText('已批准', { exact: true }).waitFor()
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    assert.deepEqual(mutations.filter(m => m.action === 'review').map(m => m.decision), ['return', 'approve'])
    activeUser = user
    // An assignment must be accepted by its assignee, not its receiver.
    workspace.tasks.unshift({ id: 'assignment-1', title: '接手指派任务', description: '', dueDate: '2026-10-24', priority: 'medium', status: 'todo', createdAt: new Date().toISOString(), creatorId: manager.id, assigneeId: user.id, receiverId: manager.id, collaborationMode: 'assignment', acceptanceStatus: 'pending', acceptBy: new Date(Date.now() + 7200000).toISOString(), recurrence: 'none', reportStatus: 'none', reports: [] })
    await page.reload()
    await page.getByRole('button', { name: '接手指派任务', exact: true }).click()
    await modal.getByRole('button', { name: '确认接手', exact: true }).click()
    await modal.getByText('提交完成情况 / 进度', { exact: true }).waitFor()
    assert.ok(mutations.some(m => m.action === 'accept' && m.committedDueDate))
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))
    assert.equal(await modal.evaluate(node => node.scrollWidth <= node.clientWidth), true)
    await modal.screenshot({ path: `${evidence}/accepted-assignment-mobile.png` })
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    await page.goto(`${base}/?page=timeline`)
    await page.locator('.timeline-layout').waitFor()
    assert.equal(await page.getByText('把接下来的安排放进视野，心里就有了余裕。', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await server.close() }
})
