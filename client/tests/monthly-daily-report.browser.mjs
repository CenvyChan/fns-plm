import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// Loopback only: all API data is synthetic and all non-GET requests are blocked.
test('monthly report shows a full month of purchases and sales without allocation or live ERP calls', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const evidence = new URL('../../qa-evidence/monthly-daily/', import.meta.url).pathname;
  mkdirSync(evidence, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1550, height: 1100 }, locale: 'zh-CN' });
    const user = { id: 'fixture-user', email: 'local@example.test', displayName: '本地预览员', role: 'admin', disabled: false, isPlatformAdmin: false, createdAt: '2026-10-21', tenantId: 'fixture-tenant', tenantName: '隔离界面预览', organizationId: 'fixture-org', organizationName: '预览组织', accountId: 'fixture-account', accountName: '预览账套', membershipId: 'fixture-member' };
    const workspace = Object.fromEntries(['tasks','projects','kpiRules','reviews','materials','boms','salesBomSnapshots','documents','projectPhases','projectMilestones','projectEvents','projectEventReviews','projectReports','projectTemplates'].map(key => [key, []]));
    const requests = [], writes = [], errors = [];
    let fail = false, available = true, purchaseAllowed = true;
    const zero = () => ({ count: 0, quantity: 0, amountCny: 0 });
    const payload = month => {
      const [year, number] = month.split('-').map(Number);
      const days = Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => {
        const day = index + 1, hasData = (day >= 5 && day <= 21 && day % 7 !== 4) || day === 31;
        const sales = hasData ? { count: day === 31 ? 1 : day % 5 + 4, quantity: day === 31 ? -0.125 : day * 128.75, amountCny: day === 31 ? -125.5 : day * 1873.45 } : zero();
        const purchase = hasData ? { count: day % 3 + 1, quantity: day * 32.123, amountCny: day * 876.23 } : zero();
        const business = metric => ({ system: metric, k3: available && metric.count ? { ...metric, amountCny: Number((metric.amountCny - 36.25).toFixed(2)) } : zero(), difference: available ? metric.count ? 36.25 : 0 : null });
        return { date: `${month}-${String(day).padStart(2, '0')}`, sales: business(sales), ...(purchaseAllowed ? { purchase: business(purchase) } : {}) };
      });
      const totals = {};
      for (const kind of purchaseAllowed ? ['sales', 'purchase'] : ['sales']) {
        const sum = key => days.reduce((a, day) => ({ count: a.count + day[kind][key].count, quantity: Number((a.quantity + day[kind][key].quantity).toFixed(6)), amountCny: Number((a.amountCny + day[kind][key].amountCny).toFixed(2)) }), zero());
        const system = sum('system'), k3 = sum('k3');
        totals[kind] = { system, k3, difference: available ? Number((system.amountCny - k3.amountCny).toFixed(2)) : null };
      }
      return { month, days, totals, access: { sales: true, purchase: purchaseAllowed }, mockEnabled: true, k3Available: available, k3AvailableByType: { sales: available, ...(purchaseAllowed ? { purchase: available } : {}) }, notice: '仅限本地隔离测试数据，不代表实际台账；不连接真实 ERP。', amountBasis: '金额按保存人民币金额逐日汇总，数量可能跨单位。' };
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push({ path: url.pathname, query: url.search, headers: request.headers() });
      if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 400, json: { message: '本地测试禁止写入' } }); }
      let data = {};
      if (url.pathname === '/api/auth/status') data = { setupRequired: false };
      else if (url.pathname === '/api/auth/me') data = { user, scopes: [user] };
      else if (url.pathname === '/api/workspace') data = workspace;
      else if (url.pathname === '/api/daily-reports/summary') data = { access: { sales: true, purchase: purchaseAllowed, canWrite: true, canManage: true } };
      else if (url.pathname.endsWith('/monthly/export.xlsx')) return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('fixture-download') });
      else if (url.pathname.endsWith('/monthly')) {
        if (fail) return route.fulfill({ status: 503, json: { message: '本地模拟月报加载失败' } });
        data = payload(url.searchParams.get('month'));
      }
      return route.fulfill({ json: data });
    });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const goto = () => page.goto(`${origin}/?page=daily-reconciliation&month=2026-10`);
    const table = page.locator('.mdr-table');
    const screenshot = async name => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: 'disabled' });
    };
    await goto();
    await page.getByRole('heading', { name: '月度采购与销售汇总', exact: true }).waitFor();
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), 31);
    assert.equal(await table.locator('tbody tr').last().locator('th').innerText(), '2026-10-31');
    assert.match(await table.locator('tbody tr').last().innerText(), /-125\.50/);
    assert.equal(await page.locator('.dr-recon-grid').count(), 0);
    assert.equal(await page.getByRole('button', { name: /保存分摊/ }).count(), 0);
    assert.equal(await page.locator('.mdr-card').count(), 3);
    await screenshot('monthly-purchase-sales-desktop');
    // Draft month does not change the export's applied query.
    await page.getByLabel('汇总月份', { exact: true }).fill('2024-02');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出月度 Excel', exact: true }).click();
    await download;
    assert.equal(new URLSearchParams(requests.findLast(r => r.path.endsWith('export.xlsx')).query).get('month'), '2026-10');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.mdr-table tbody tr').length === 29);
    assert.match(await table.locator('caption').innerText(), /2024 年 2 月/);
    await page.getByLabel('汇总月份', { exact: true }).fill('2026-10');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.mdr-table tbody tr').length === 31);
    await page.getByLabel('查看内容', { exact: true }).selectOption('sales');
    assert.equal(await page.locator('.workspace-unsaved').count(), 0);
    assert.equal(await table.locator('thead th').count(), 8);
    assert.match(await table.locator('thead').innerText(), /系统笔数.*系统数量.*系统金额/s);
    await screenshot('monthly-sales-comparison-desktop');
    await page.getByLabel('查看内容', { exact: true }).selectOption('purchase');
    assert.match(await page.locator('.mdr-header').innerText(), /采购入库核对/);
    await screenshot('monthly-purchase-comparison-desktop');
    available = false;
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.locator('.mdr-card').first().waitFor();
    assert.equal(await page.locator('.mdr-card strong').nth(1).innerText(), '—');
    assert.equal(await table.locator('tbody tr').nth(4).locator('td').nth(5).innerText(), '—');
    await screenshot('monthly-no-k3-snapshot');
    fail = true;
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '本地模拟月报加载失败' }).waitFor();
    assert.equal(await table.count(), 0);
    assert.equal(await page.getByRole('button', { name: '导出月度 Excel', exact: true }).isDisabled(), true);
    fail = false; available = true;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await table.waitFor();
    await page.getByLabel('查看内容', { exact: true }).selectOption('both');
    for (const width of [768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `page fits ${width}`);
      assert.equal(await table.locator('tbody tr').count(), 31);
      assert.equal(await page.locator('.mdr-table-scroll').evaluate(n => n.scrollWidth > n.clientWidth), true);
      if (width === 390) await screenshot('monthly-purchase-sales-mobile');
    }
    purchaseAllowed = false;
    await goto(); await table.waitFor();
    assert.equal(await page.getByLabel('查看内容').locator('option[value=purchase]').count(), 0);
    assert.equal(await table.locator('thead tr').last().locator('th').count(), 3);
    assert.match(await page.locator('.mdr-card').first().innerText(), /未授权采购数据/);
    const monthlyRequests = requests.filter(r => r.path.includes('/monthly'));
    assert.ok(monthlyRequests.every(r => r.headers['x-tenant-id'] === user.tenantId && r.headers['x-organization-id'] === user.organizationId && r.headers['x-account-id'] === user.accountId));
    assert.equal(requests.some(r => /sync|links|k3-lines|refresh-mock/.test(r.path)), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
