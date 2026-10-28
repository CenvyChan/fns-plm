import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'

// TEST ONLY: synthetic specs/models live exclusively in this test harness.
// No production app/config is loaded; all API requests are intercepted and external network blocked.
const date = '2000-01-01T00:00:00Z'
const material = (id, specification, extra = {}) => ({ id, partNo: `TEST-${id}`, name: 'Same fixture name', specification, category: '零件', unit: '件', revision: 'A', lifecycle: 'draft', owner: 'Test only', createdAt: date, updatedAt: date, ...extra })
const materials = [
  material('parent', 'Fixture finished spec', { category: '成品', specificationFields: { productModel: 'PX-ONLY-741' } }),
  material('component', 'SPEC-ONLY-852', { specificationFields: { productModel: 'CX-ONLY-963' } }),
  material('pack', 'PACK-ONLY-147', { category: '包装材料' }),
  material('draft', 'DRAFT-ONLY-258', { templateSourceId: 'test-source', erpGroupNumber: 'fixture-group' }),
]
const bom = (id, kind, extra = {}) => ({ id, bomNo: `TEST-BOM-${id}`, kind, parentMaterialId: 'parent', revision: 'A', lifecycle: 'released', effectiveDate: '2000-01-01', scope: 'TEST ONLY', updatedAt: date, lines: [], ...extra })
const workspace = {
  ...Object.fromEntries(['tasks', 'projects', 'kpiRules', 'reviews', 'projectPhases', 'projectMilestones', 'projectEvents', 'projectEventReviews', 'projectReports', 'projectTemplates'].map(key => [key, []])),
  materials,
  boms: [bom('design', 'design', { lines: [{ id: 'test-line', materialId: 'component', quantity: 1, findNumber: '10' }] }), bom('manufacturing', 'manufacturing'), bom('sales', 'sales', { sourceBomId: 'design', configGroups: [{ key: 'packaging', label: '包装', required: true }], configAttributes: [], salesRules: [{ id: 'test-rule', groupKey: 'packaging', conditions: [], materialId: 'pack', quantity: 1, priority: 1 }] })],
  documents: [{ id: 'test-doc', docNo: 'TEST-DOC', title: 'Test drawing', type: '工程图', materialId: 'component', revision: 'A', lifecycle: 'draft', owner: 'Test only', updatedAt: date }],
  salesBomSnapshots: [{ id: 'test-snapshot', orderNo: 'TEST-ORDER', parentMaterialId: 'parent', bomId: 'sales', bomNo: 'TEST-BOM-sales', bomRevision: 'A', quantity: 1, attributes: {}, createdAt: date, lines: [{ id: 'snapshot-line', materialId: 'component', quantity: 1, role: 'component', sourceBomId: 'design', sourceRevision: 'A', findNumber: '10' }] }],
}

async function harness(t, width = 1440) {
  const result = await build({
    absWorkingDir: resolve(import.meta.dirname, '..'),
    stdin: { resolveDir: resolve(import.meta.dirname, '..'), loader: 'tsx', contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MaterialWorkbench from './src/MaterialWorkbench';
import DocumentWorkbench from './src/DocumentWorkbench';
import BomWorkbench from './src/BomWorkbench';
import MaterialSelect from './src/MaterialSelect';
const fixture = ${JSON.stringify(workspace)};
function FixtureApp() {
 const [workspace, setWorkspace] = useState(fixture);
 const [restricted, setRestricted] = useState(false);
 const [submitted, setSubmitted] = useState('');
 const page = new URL(location.href).searchParams.get('page');
 if (page === 'selector') return <><form aria-label="test-only-form" onSubmit={event => {event.preventDefault();setSubmitted(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))))}}>
 <MaterialSelect label="测试物料" name="materialId" materials={workspace.materials.filter(item => !restricted || item.id === 'parent')} defaultValue="parent" required/>
 <button type="submit">提交测试表单</button></form><button onClick={() => setRestricted(!restricted)}>切换资格范围</button><output>{submitted}</output></>;
 const props = {workspace, onChange:setWorkspace, onToast:() => {}};
 return page === 'materials' ? <MaterialWorkbench {...props}/> : page === 'documents' ? <DocumentWorkbench {...props}/> : <BomWorkbench {...props}/>;
}
createRoot(document.getElementById('root')!).render(<FixtureApp/>);` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  })
  const script = result.outputFiles[0].text
  const server = createServer((req, res) => {
    if (req.url === '/test-only.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script) }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/test-only.js"></script>') }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
  const requests = [], unexpected = [], errors = []
  const origin = `http://127.0.0.1:${server.address().port}`
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) { unexpected.push(req.url()); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    requests.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() })
    if (req.method() === 'GET' && url.pathname === '/api/material-closure/source') return route.fulfill({ json: { snapshot: null, rows: [], notice: 'TEST ONLY: local snapshot fixture, no ERP connection' } })
    if (req.method() === 'GET' && /^\/api\/documents\/[^/]+\/files$/.test(url.pathname)) return route.fulfill({ json: { files: [] } })
    if (req.method() === 'POST' && /^\/api\/boms\/[^/]+\/lines$/.test(url.pathname)) return route.fulfill({ json: req.postDataJSON() })
    unexpected.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 400, json: { error: 'Unexpected API in isolated test' } })
  })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []) })
  return { page, requests, go: async pageName => { await page.goto(`${origin}/?page=${pageName}`); await page.locator('#root > *').first().waitFor() } }
}

test('shared selector searches specs/models, preserves IDs and cannot bypass eligibility or required selection', async t => {
  const { page, go } = await harness(t)
  await go('selector')
  const search = page.getByRole('searchbox', { name: '测试物料搜索', exact: true })
  const select = page.getByRole('combobox', { name: '测试物料', exact: true })
  await search.fill('  cx-only-963  ')
  assert.equal(await select.inputValue(), 'parent', 'filter must not silently change selected ID')
  assert.match(await select.locator('option[value=component]').innerText(), /SPEC-ONLY-852.*CX-ONLY-963/)
  await select.selectOption('component'); await page.getByRole('button', { name: '提交测试表单' }).click()
  assert.deepEqual(JSON.parse(await page.locator('output').innerText()), { materialId: 'component' })
  await search.fill('NO-MATCH-TEST'); assert.equal(await select.inputValue(), 'component')
  assert.match(await page.locator('.material-search-select [role=status]').innerText(), /没有匹配项.*保留已选项/)
  await page.getByRole('button', { name: '切换资格范围' }).click()
  assert.equal(await select.inputValue(), '', 'an ineligible selection cannot be submitted')
  assert.equal(await select.locator('option[value=component]').count(), 0)
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), false)
  await search.fill('ＰＸ－ＯＮＬＹ－７４１'); assert.equal(await select.locator('option[value=parent]').count(), 1)
  await select.selectOption('parent'); await select.focus(); await page.keyboard.press('Home')
  assert.equal(await select.evaluate(element => element.tagName), 'SELECT', 'native keyboard semantics retained')
})

test('material master and source-copy draft picker include structured model and specification', async t => {
  const { page, go, requests } = await harness(t, 390)
  await go('materials')
  const search = page.locator('.material-workbench .module-search input')
  await search.fill('  px-only-741  ')
  assert.equal(await page.locator('.materials-table tbody tr').count(), 1)
  assert.match(await page.locator('.materials-table tbody tr').innerText(), /TEST-parent/)
  await search.fill('SPEC-ONLY-852'); assert.equal(await page.locator('.materials-table tbody tr').count(), 1)
  await search.fill('NO-MATCH-TEST'); await page.getByText('没有匹配的物料', { exact: true }).waitFor()
  await search.fill(''); assert.equal(await page.locator('.materials-table tbody tr').count(), 4)
  await page.getByRole('searchbox', { name: '来源复制草稿搜索', exact: true }).fill('draft-only-258')
  const draft = page.getByRole('combobox', { name: '来源复制草稿', exact: true })
  assert.equal(await draft.locator('option[value=draft]').count(), 1)
  await draft.selectOption('draft')
  assert.equal(await page.getByRole('textbox', { name: '规格', exact: true }).inputValue(), 'DRAFT-ONLY-258')
  assert.ok(requests.every(request => request.method === 'GET'), 'search performs no mutation or ERP refresh')
})

test('document lookup and optional material picker search linked spec/model and preserve raw ID contract', async t => {
  const { page, go } = await harness(t)
  await go('documents')
  const search = page.locator('.doc-toolbar .module-search input')
  await search.fill('cx-only-963'); assert.equal(await page.locator('.docs-table tbody tr').count(), 1)
  await search.fill('NO-MATCH-TEST'); assert.equal(await page.locator('.docs-table tbody tr').count(), 0)
  await search.fill('TEST-component'); assert.equal(await page.locator('.docs-table tbody tr').count(), 1)
  await page.getByRole('button', { name: '登记图文档', exact: true }).click()
  const select = page.getByRole('combobox', { name: '关联物料', exact: true })
  assert.equal(await select.inputValue(), ''); assert.equal(await select.evaluate(element => element.required), false)
  await page.getByRole('searchbox', { name: '关联物料搜索', exact: true }).fill('SPEC-ONLY-852')
  await select.selectOption('component')
  assert.equal(await select.evaluate(element => new FormData(element.form).get('materialId')), 'component')
  await select.selectOption(''); assert.equal(await select.inputValue(), '', 'document may remain unlinked')
})

test('BOM parent/component/source and sales mappings support spec/model while enforcing existing restrictions', async t => {
  const { page, go, requests } = await harness(t)
  await go('boms')
  const bomSearch = page.getByRole('searchbox', { name: 'BOM 搜索', exact: true })
  await bomSearch.fill('pack-only-147'); assert.equal(await page.locator('.bom-list-item').count(), 1)
  await bomSearch.fill('NO-MATCH-TEST'); assert.equal(await page.locator('.bom-list-item').count(), 0)
  await bomSearch.fill('')
  await page.getByRole('searchbox', { name: '订单快照搜索', exact: true }).fill('spec-only-852')
  assert.equal(await page.locator('.snapshot-history-row').count(), 1)
  await page.getByRole('searchbox', { name: '订单快照搜索', exact: true }).fill('NO-MATCH-TEST')
  assert.equal(await page.locator('.snapshot-history-row').count(), 0)
  await page.getByRole('button', { name: '添加映射', exact: true }).click()
  await page.getByRole('searchbox', { name: '映射组件搜索', exact: true }).fill('pack-only-147')
  const mapping = page.getByRole('combobox', { name: '映射组件', exact: true })
  await mapping.selectOption('pack'); assert.equal(await mapping.inputValue(), 'pack')
  await page.getByLabel(/^映射物料类型/).selectOption('标签')
  assert.equal(await mapping.locator('option[value=pack]').count(), 0)
  assert.equal(await mapping.inputValue(), '')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: /设计 BOM.*EBOM/ }).click()
  await bomSearch.fill('cx-only-963'); assert.equal(await page.locator('.bom-list-item').count(), 1)
  await page.getByRole('button', { name: '添加物料', exact: true }).click()
  const component = page.getByRole('combobox', { name: '组件物料', exact: true })
  await page.getByRole('searchbox', { name: '组件物料搜索', exact: true }).fill('px-only-741')
  assert.equal(await component.locator('option[value=parent]').count(), 0, 'parent self-reference remains excluded')
  await page.getByRole('searchbox', { name: '组件物料搜索', exact: true }).fill('cx-only-963')
  await component.selectOption('component'); await page.getByRole('button', { name: '添加组件', exact: true }).click()
  assert.equal(requests.find(request => request.method === 'POST')?.body.materialId, 'component')
  await bomSearch.fill(''); await page.getByRole('button', { name: '新建 BOM', exact: true }).click()
  await page.getByRole('searchbox', { name: '父项产品搜索', exact: true }).fill('px-only-741')
  await page.getByRole('combobox', { name: '父项产品', exact: true }).selectOption('parent')
  await page.getByLabel(/^BOM 类型/).selectOption('manufacturing')
  await page.getByRole('searchbox', { name: '来源 BOM搜索', exact: true }).fill('spec-only-852')
  const source = page.getByRole('combobox', { name: '来源 BOM', exact: true })
  assert.equal(await source.locator('option[value=design]').count(), 1)
  assert.equal(await source.locator('option[value=manufacturing]').count(), 0, 'only released design sources remain eligible')
  await source.selectOption('design')
  const fields = await source.evaluate(element => Object.fromEntries(new FormData(element.form)))
  assert.equal(fields.parentMaterialId, 'parent'); assert.equal(fields.sourceBomId, 'design')
})
