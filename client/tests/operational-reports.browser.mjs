import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, preview } from 'vite'
import { chromium } from 'playwright'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildEvidence, sha256 } from './helpers/operational-build-evidence.mjs'
const evidence = buildEvidence()
const evidenceOutputRoot = process.env.OP_EVIDENCE_ROOT ? resolve(process.env.OP_EVIDENCE_ROOT) : new URL('../../qa-evidence/all-reports-20261026/demo-metrics-20261028/', import.meta.url).pathname
const root = new URL('..', import.meta.url).pathname
const acceptanceOutDir = process.env.OP_ACCEPTANCE_OUT_DIR ? resolve(process.env.OP_ACCEPTANCE_OUT_DIR) : resolve(root, 'dist')
const reportSource = readFileSync(new URL('../../server/src/operational-reports.ts', import.meta.url), 'utf8')
const candidateBuild = await build({ entryPoints: [new URL('../../server/src/report-candidate-contract.ts', import.meta.url).pathname], write: false, bundle: true, platform: 'node', format: 'esm' })
const { REPORT_CANDIDATES, AR_SUMMARY_PLACEHOLDER } = await import(`data:text/javascript;base64,${Buffer.from(candidateBuild.outputFiles[0].text).toString('base64')}`)
const observationsBuild = await build({ entryPoints: [new URL('../../server/src/target-account-readonly-observations.ts', import.meta.url).pathname], write: false, bundle: true, platform: 'node', format: 'esm' })
const { TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS, GET_INVENTORY_DATA_READ_ONLY_OBSERVATION } = await import(`data:text/javascript;base64,${Buffer.from(observationsBuild.outputFiles[0].text).toString('base64')}`)
const secondPhaseBuild = await build({ entryPoints: [new URL('../../server/src/second-phase-report-contract.ts', import.meta.url).pathname], write: false, bundle: true, platform: 'node', format: 'esm' })
const { buildSecondPhaseReportDemo, PURCHASE_ARRAY_RESPONSE_FIELD_KEYS } = await import(`data:text/javascript;base64,${Buffer.from(secondPhaseBuild.outputFiles[0].text).toString('base64')}`)
const sourceLiteral = reportSource.slice(reportSource.indexOf('type CandidateField'), reportSource.indexOf('export type OperationalReportId'))
const literal = `const REPORT_CANDIDATES = ${JSON.stringify(REPORT_CANDIDATES)};\nconst AR_SUMMARY_PLACEHOLDER = ${JSON.stringify(AR_SUMMARY_PLACEHOLDER)};\nconst TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS = ${JSON.stringify(TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS)};\nconst GET_INVENTORY_DATA_READ_ONLY_OBSERVATION = ${JSON.stringify(GET_INVENTORY_DATA_READ_ONLY_OBSERVATION)};\n${sourceLiteral}`
const operationalBuild = await build({ stdin: { contents: literal, loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'esm' })
const { OPERATIONAL_REPORTS, OPERATIONAL_REPORT_METADATA_PREFLIGHT } = await import(`data:text/javascript;base64,${Buffer.from(operationalBuild.outputFiles[0].text).toString('base64')}`)
const candidates = REPORT_CANDIDATES.map(candidate => ({ ...candidate, targetAccountReadOnlyObservation: TARGET_ACCOUNT_READ_ONLY_REPORT_OBSERVATIONS[candidate.formId] || null }))
const user = { id: 'fixture-user', email: 'local@example.test', displayName: '本地预览员', role: 'admin', disabled: false, isPlatformAdmin: false, createdAt: '2026-10-23', tenantId: 'fixture-tenant', tenantName: 'LOCAL_FIXTURE', organizationId: 'fixture-org', organizationName: '本地样例组织', accountId: 'fixture-account', accountName: '本地样例账套', membershipId: 'fixture-member' }
const workspace = Object.fromEntries(['tasks','projects','kpiRules','reviews','materials','boms','salesBomSnapshots','documents','projectPhases','projectMilestones','projectEvents','projectEventReviews','projectReports','projectTemplates'].map(key => [key, []]))
const inventoryRows = [
  { id: 'fixture-stock-001', warehouse: '演示仓A', materialNumber: 'FIX-MAT-001', materialName: '演示控制模块', unit: '件', quantity: 24 },
  { id: 'fixture-stock-002', warehouse: '演示仓B', materialNumber: 'FIX-MAT-002', materialName: '演示传感组件', unit: '套', quantity: 8 },
  { id: 'fixture-stock-003', warehouse: '演示仓B', materialNumber: 'FIX-MAT-001', materialName: '演示控制模块', unit: '箱', quantity: 2 },
]
const reports = OPERATIONAL_REPORTS.map(report => ({ ...report, status: report.id === 'instant-inventory' ? 'fixture' : report.status, snapshotAt: report.id === 'instant-inventory' ? '2026-10-23T00:00:00Z' : null, sourceLabel: report.id === 'instant-inventory' ? '演示数据' : '来源待接入' }))
const routePages = [
  'operational-inventory','operational-movements','operational-purchase','operational-sales','operational-aging',
  'operational-candidate-sales-collect','operational-candidate-subcontract-detail','operational-candidate-subcontract-summary',
  'operational-candidate-ar-aging','operational-candidate-ar-detail','operational-candidate-ap-aging',
  'operational-candidate-ap-uninvoiced-detail','operational-candidate-ap-detail','operational-candidate-ap-summary',
  'operational-candidate-cost-analysis','operational-candidate-ar-summary',
]

async function runViewport(viewport) {
  const server = process.env.OP_ACCEPTANCE_BUILD === '1'
    ? await preview({ root, build: { outDir: acceptanceOutDir }, preview: { host: '127.0.0.1', port: 0, open: false, strictPort: false } })
    : await createServer({ root, server: { host: '127.0.0.1', port: 0 } })
  if (server.listen) await server.listen()
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const output = `${evidenceOutputRoot}/${viewport.width}/`
  mkdirSync(output, { recursive: true })
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width === 390, hasTouch: true })
  const errors = [], external = [], mutations = [], apiRequests = [], apiQueries = [], screenshots = [], assets = [], measures = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    const path = new URL(response.url()).pathname
    if (evidence.assets.length && path.startsWith('/assets/')) assets.push((async () => {
      const asset = evidence.assets.find(item => item.path.endsWith(path))
      assert.ok(asset, `served asset belongs to fingerprinted build: ${path}`)
      const digest = sha256(await response.body())
      assert.equal(digest, asset.sha256, `served build asset fingerprint: ${path}`)
      return { path, sha256: digest }
    })())
  })
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue()
    if (url.hostname !== '127.0.0.1') { external.push(url.origin); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    apiRequests.push(url.pathname)
    apiQueries.push({ path: url.pathname, keys: [...url.searchParams.keys()], values: Object.fromEntries(url.searchParams.entries()) })
    if (request.method() !== 'GET') { mutations.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 405, json: { error: 'readonly_fixture' } }) }
    let data = {}
    if (url.pathname === '/api/auth/status') data = { setupRequired: false }
    else if (url.pathname === '/api/auth/me') data = { user, scopes: [user] }
    else if (url.pathname === '/api/workspace') data = workspace
    else if (url.pathname === '/api/operational-reports') data = { reports, metadataPreflight: { ...OPERATIONAL_REPORT_METADATA_PREFLIGHT, reportCandidates: candidates, arSummaryPlaceholder: AR_SUMMARY_PLACEHOLDER, inventoryGetInventoryDataReadOnlyObservation: GET_INVENTORY_DATA_READ_ONLY_OBSERVATION } }
    else if (url.pathname === '/api/operational-reports/purchase-execution/demo' || url.pathname === '/api/operational-reports/sales-execution/demo') {
      assert.deepEqual([...url.searchParams.keys()].sort(), ['page', 'pageSize'], 'demo filters stay browser-local; only bounded paging reaches the local fixture endpoint')
      const kind = url.pathname.includes('purchase-execution') ? 'purchase' : 'sales'
      const query = { page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) }
      data = buildSecondPhaseReportDemo(kind, query)
      if (kind === 'purchase') {
        assert.deepEqual(data.FieldKeys, [...PURCHASE_ARRAY_RESPONSE_FIELD_KEYS])
        assert.equal(data.source, 'local_demo_fixture_not_k3_tested')
        assert.equal(data.liveCallsAllowed, false)
      }
    } else if (url.pathname === '/api/operational-reports/instant-inventory') {
      assert.ok([...url.searchParams.keys()].every(key => ['q', 'warehouse', 'unit'].includes(key)), 'inventory sends only local fixture filters')
      const warehouse = url.searchParams.get('warehouse') || '', unit = url.searchParams.get('unit') || ''
      const rows = inventoryRows.filter(row => (!warehouse || row.warehouse === warehouse) && (!unit || row.unit === unit))
      data = { report: reports.find(item => item.id === 'instant-inventory'), rows, total: rows.length, metadataPreflight: OPERATIONAL_REPORT_METADATA_PREFLIGHT }
    } else if (url.pathname.startsWith('/api/operational-reports/instant-inventory/rows/')) {
      const rowId = decodeURIComponent(url.pathname.split('/').at(-1))
      data = { row: inventoryRows.find(row => row.id === rowId), source: 'fixture' }
    } else if (url.pathname.startsWith('/api/operational-reports/')) {
      return route.fulfill({ status: 404, json: { error: 'unknown_local_report' } })
    }
    return route.fulfill({ json: data })
  })
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const capture = async (name, options = {}) => {
    const image = await page.screenshot({ path: `${output}${name}.png`, animations: 'disabled', fullPage: options.fullPage === true })
    screenshots.push({ file: `${name}.png`, sha256: sha256(image), sourceCommit: evidence.sourceCommit, worktreeFingerprint: evidence.worktreeFingerprint, buildFingerprint: evidence.buildFingerprint, viewport, deviceScaleFactor: 1, route: new URL(page.url()).search, state: name, dimensions: { width: image.readUInt32BE(16), height: image.readUInt32BE(20) } })
  }
  const captureResults = async name => {
    await page.locator('.op-business-results').scrollIntoViewIfNeeded()
    await capture(name)
  }
  const visit = async pageId => {
    await page.goto(`${origin}/?page=${pageId}`)
    await page.locator('.op-business-header h1').waitFor()
    await page.getByText('报表目录', { exact: true }).waitFor()
    const titles = {
      'operational-reports': '报表总览', 'operational-preflight': '数据来源说明',
      'operational-inventory': '即时库存', 'operational-movements': '收发存', 'operational-purchase': '采购订单执行明细', 'operational-sales': '销售执行明细', 'operational-aging': '库存账龄',
      'operational-candidate-sales-collect': '销售执行汇总', 'operational-candidate-subcontract-detail': '委外订单执行明细', 'operational-candidate-subcontract-summary': '委外订单执行汇总',
      'operational-candidate-ar-aging': '应收账龄', 'operational-candidate-ar-detail': '应收明细', 'operational-candidate-ar-summary': 'AR汇总待定义',
      'operational-candidate-ap-aging': '应付账龄', 'operational-candidate-ap-uninvoiced-detail': '应付未开票明细', 'operational-candidate-ap-detail': '应付明细', 'operational-candidate-ap-summary': '应付汇总',
      'operational-candidate-cost-analysis': '成本分析',
    }
    assert.equal(await page.locator('.op-business-header h1').innerText(), titles[pageId], `${pageId} route title`)
    if (!['operational-reports', 'operational-preflight', 'operational-candidate-ar-summary'].includes(pageId)) await page.getByRole('button', { name: '查询', exact: true }).waitFor()
  }
  const measure = async label => {
    const dimensions = await page.evaluate(() => ({ viewport: visualViewport?.width || innerWidth, documentWidth: document.documentElement.scrollWidth, escaped: [...document.querySelectorAll('.op-business-report *')].filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && (rect.right > (visualViewport?.width || innerWidth) + 1 || rect.left < -1) && !el.closest('.op-business-table-wrap,.op-table-wrap,.op-business-tech-body') }).slice(0, 12).map(el => ({ tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', text: el.textContent.slice(0, 60) })) }))
    measures.push({ label, ...dimensions })
    assert.equal(dimensions.viewport, viewport.width, `${label}: viewport`)
    assert.ok(dimensions.documentWidth <= viewport.width, `${label}: document overflow ${JSON.stringify(dimensions.escaped)}`)
    assert.deepEqual(dimensions.escaped, [], `${label}: report controls stay in viewport`)
    if (viewport.width === 390) {
      const small = await page.locator('.op-business-report button,.op-business-report input,.op-business-report select,.op-business-report summary').evaluateAll(elements => elements.filter(el => { const target = el.matches('input[type="checkbox"]') ? el.closest('label') || el : el; const rect = target.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) }).map(el => ({ label: el.getAttribute('aria-label'), text: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })))
      assert.deepEqual(small, [], `${label}: mobile controls retain 44px touch targets`)
    }
  }
  try {
    await page.goto(`${origin}/?page=operational-reports`)
    await page.locator('.op-business-header h1').getByText('报表总览').waitFor()
    const groups = page.locator('.op-business-group')
    assert.equal(await groups.count(), 7)
    assert.deepEqual(await groups.locator('h2').allTextContents(), ['库存','采购','销售','应收','应付','委外','成本'])
    const cards = page.locator('.op-business-card')
    assert.equal(await cards.count(), 16, '12 report cards, the AR placeholder, and three separate inventory pages')
    const directoryText = await page.locator('.op-business-report').innerText()
    for (const technical of ['PUR_PurchaseOrderDetailRpt', 'SAL_DetailReport', 'FormId', 'FieldKeys', 'SchemeId', 'GetSysReportData', 'RowCount']) assert.equal(directoryText.includes(technical), false, `directory hides ${technical}`)
    assert.equal(await page.locator('.op-business-tech[open]').count(), 0, 'technical details default to collapsed')
    await measure('directory')
    await capture('directory')
    if (viewport.width === 390) await page.getByRole('button', { name: /采购订单执行明细/ }).scrollIntoViewIfNeeded()

    const beforeClick = apiRequests.length
    await page.getByRole('button', { name: /采购订单执行明细/ }).click()
    await page.getByRole('heading', { name: '采购订单执行明细', level: 1 }).waitFor()
    assert.equal(apiRequests.filter(path => path.endsWith('/purchase-execution/demo')).length, 0, 'purchase page does not query on load')
    assert.equal(await page.getByLabel('供应商（演示）').inputValue(), '')
    assert.equal(await page.locator('.op-business-results').count(), 0, 'purchase results wait for Query')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 2 条演示记录', { exact: false }).waitFor()
    assert.match(await page.locator('.op-business-demo-metrics').innerText(), /演示记录\s+2[\s\S]*缺少币别\/单位/)
    assert.equal(await page.locator('.op-business-demo-metrics > div').count(), 1, 'purchase only shows row count when currency and unit are absent from fixture columns')
    assert.equal(await page.locator('.op-business-table-wrap tbody tr').count(), 1, 'first page has one demo row')
    assert.match(await page.locator('.op-business-results').innerText(), /第 1 \/ 2 页/)
    const purchaseRequests = apiQueries.filter(item => item.path.endsWith('/purchase-execution/demo'))
    assert.equal(purchaseRequests.length, 1)
    assert.deepEqual(purchaseRequests[0].keys.sort(), ['page','pageSize'])
    await measure('purchase-query-results')
    await captureResults('purchase-results')
    await page.getByRole('button', { name: '下一页' }).click()
    await page.getByText('第 2 / 2 页').waitFor()
    await page.locator('.op-business-table-wrap tbody button', { hasText: '查看明细' }).click()
    await page.getByRole('heading', { name: '演示明细' }).waitFor()
    await measure('purchase-detail')
    await capture('purchase-detail')
    await visit('operational-purchase')
    await page.getByLabel('供应商（演示）').selectOption({ label: '演示供应商-A' })
    const dateInputs = page.locator('.op-business-query-grid input[type="date"]')
    const dateCount = await dateInputs.count()
    assert.equal(dateCount, 2, 'purchase page shows both date condition controls')
    await page.locator('input[type="date"]').first().fill('2026-10-21')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 1 条演示记录', { exact: false }).waitFor()
    assert.equal(apiQueries.filter(item => item.path.endsWith('/purchase-execution/demo')).length, 2)
    assert.ok(!apiQueries.some(item => JSON.stringify(item.values).includes('演示供应商-A') || JSON.stringify(item.values).includes('2026-10-21')), 'supplier/date values remain local to the synthetic demo')

    await visit('operational-sales')
    assert.equal(await page.getByLabel('客户（演示）').inputValue(), '')
    assert.equal(apiRequests.filter(path => path.endsWith('/sales-execution/demo')).length, 0, 'sales page does not query on load')
    await page.getByLabel('客户（演示）').selectOption({ label: '演示客户-A' })
    assert.equal(await page.locator('.op-business-query-grid input[type="date"]').count(), 2)
    await page.locator('input[type="date"]').nth(1).fill('2026-10-21')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 1 条演示记录', { exact: false }).waitFor()
    assert.equal(await page.locator('.op-business-demo-metrics > div').count(), 1, 'sales detail only shows row count without currency and unit')
    assert.match(await page.locator('.op-business-demo-metrics').innerText(), /缺少币别\/单位/)
    assert.ok(!apiQueries.some(item => JSON.stringify(item.values).includes('演示客户-A')), 'synthetic customer is not sent to any endpoint')
    await measure('sales-query-results')
    if (viewport.width === 390) await captureResults('sales-results')

    for (const pageId of ['operational-candidate-sales-collect','operational-candidate-ar-detail','operational-candidate-ap-uninvoiced-detail','operational-candidate-ap-detail','operational-candidate-ap-summary']) {
      await visit(pageId)
      const filter = page.locator('.op-business-query-grid select').first()
      assert.equal(await filter.count(), 1, `${pageId} exposes one scoped synthetic party selector`)
      assert.equal(await page.locator('.op-business-results').count(), 0, `${pageId} waits for explicit Query`)
      const requestCount = apiRequests.length
      if (pageId === 'operational-candidate-sales-collect') {
        await page.getByRole('button', { name: '查询', exact: true }).click()
        const allCurrencyMetrics = page.locator('.op-business-demo-metrics')
        await allCurrencyMetrics.waitFor()
        assert.equal(await allCurrencyMetrics.locator(':scope > div').count(), 3, 'sales summary shows count and one order total per demo currency')
        assert.equal(await allCurrencyMetrics.locator(':scope > div').filter({ hasText: '样例币别-A' }).locator('b').innerText(), '2,045.75')
        assert.equal(await allCurrencyMetrics.locator(':scope > div').filter({ hasText: '样例币别-B' }).locator('b').innerText(), '2,560')
        assert.match(await allCurrencyMetrics.innerText(), /数量缺少计量单位/)
        await captureResults('sales-summary-all-currencies')
      }
      await filter.selectOption({ index: 1 })
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await page.getByRole('region', { name: '演示查询结果' }).waitFor()
      const metrics = page.locator('.op-business-demo-metrics')
      assert.equal(await metrics.locator(':scope > div').first().locator('b').innerText(), '1', `${pageId} party filter selects a synthetic row`)
      if (pageId === 'operational-candidate-sales-collect') assert.equal(await metrics.locator(':scope > div').filter({ hasText: '样例币别-A' }).locator('b').innerText(), '1,200.5')
      const amountExpected = {
        'operational-candidate-ar-detail': ['本期应收', '1,800'],
        'operational-candidate-ap-uninvoiced-detail': ['本期应付', '720'],
        'operational-candidate-ap-detail': ['本期应付', '2,100'],
      }[pageId]
      if (amountExpected) assert.equal(await metrics.locator(':scope > div').filter({ hasText: amountExpected[0] }).locator('b').innerText(), amountExpected[1], `${pageId} amount is grouped with the fixture currency`)
      if (pageId === 'operational-candidate-ap-summary') {
        assert.equal(await metrics.locator(':scope > div').count(), 1, 'AP summary with unverified period grain remains count-only')
        assert.match(await metrics.innerText(), /按期间口径尚未核验/)
      }
      await captureResults(`${pageId}-metric-results`)
      await page.locator('.op-business-results button', { hasText: '查看明细' }).click()
      await page.locator('.op-business-detail').waitFor()
      assert.equal(apiRequests.length, requestCount, `${pageId} filters, pagination, and row details remain browser-local`)
      const visible = await page.locator('.op-business-report').innerText()
      assert.doesNotMatch(visible, /FModel|FLOT/, `${pageId} never shows excluded runtime columns`)
      await measure(`${pageId}-query-and-detail`)
      if (pageId === 'operational-candidate-ar-detail' && viewport.width === 1440) await capture('ar-detail-results')
      if (pageId === 'operational-candidate-ap-detail' && viewport.width === 390) await captureResults('ap-detail-results')
    }

    for (const pageId of ['operational-candidate-ar-aging','operational-candidate-ap-aging']) {
      await visit(pageId)
      assert.equal(await page.locator('.op-business-aging-hint').innerText(), '账龄参数尚待配置')
      assert.equal(await page.getByRole('button', { name: '查询', exact: true }).isDisabled(), true)
      assert.equal(await page.locator('.op-business-results').count(), 0)
      assert.equal(await page.locator('.op-business-table-wrap').count(), 0)
      assert.equal(await page.locator('.op-business-demo-metrics').count(), 0, 'aging remains row-free and KPI-free')
      assert.doesNotMatch(await page.locator('.op-business-report').innerText(), /RowCount|FEntAgingGrpSetting/, 'raw preflight values stay out of visible text')
      assert.equal(await page.locator('.op-business-tech[open]').count(), 0, 'technical details remain collapsed')
      await measure(`${pageId}-configured-pending`)
      if (pageId === 'operational-candidate-ar-aging' && viewport.width === 1440) await capture('ar-aging-pending')
      if (pageId === 'operational-candidate-ap-aging' && viewport.width === 390) await capture('ap-aging-pending')
    }

    await visit('operational-candidate-ar-summary')
    assert.match(await page.locator('.op-business-report').innerText(), /待定义 · 无 FormId/)
    assert.equal(await page.locator('.op-business-table-wrap').count(), 0)
    assert.equal(await page.locator('.op-business-demo-metrics').count(), 0)

    await visit('operational-inventory')
    assert.equal(await page.getByLabel('仓库').isDisabled(), false)
    assert.equal(await page.locator('.op-business-results').count(), 0, 'inventory results wait for Query')
    assert.equal(apiRequests.filter(path => path === '/api/operational-reports/instant-inventory').length, 0, 'inventory does not query on page load')
    await page.getByLabel('仓库').selectOption('演示仓B')
    await page.getByLabel('库存单位').selectOption('箱')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 1 条演示库存记录', { exact: false }).waitFor()
    assert.equal(await page.locator('.op-business-table-wrap tbody tr').count(), 1)
    await page.getByRole('button', { name: '清除条件' }).click()
    assert.equal(await page.locator('.op-business-results').count(), 0)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 3 条演示库存记录', { exact: false }).waitFor()
    const inventoryMetrics = page.locator('.op-business-demo-metrics')
    assert.equal(await inventoryMetrics.locator(':scope > div').first().locator('b').innerText(), '3')
    assert.equal(await inventoryMetrics.locator(':scope > div').filter({ hasText: '单位：件' }).locator('b').innerText(), '24')
    assert.equal(await inventoryMetrics.locator(':scope > div').filter({ hasText: '单位：套' }).locator('b').innerText(), '8')
    assert.equal(await inventoryMetrics.locator(':scope > div').filter({ hasText: '单位：箱' }).locator('b').innerText(), '2')
    await measure('inventory-query-results')
    await captureResults('inventory-results')
    await page.getByRole('button', { name: '查看明细' }).first().click()
    await page.getByRole('dialog', { name: '库存演示明细' }).waitFor()
    await measure('inventory-row-detail')
    if (viewport.width === 1440) await capture('inventory-detail')

    for (const pageId of ['operational-movements','operational-aging','operational-candidate-subcontract-detail','operational-candidate-subcontract-summary','operational-candidate-cost-analysis']) {
      await visit(pageId)
      assert.equal(await page.locator('.op-business-results').count(), 0, `${pageId} has no fabricated business rows`)
      assert.equal(await page.getByRole('button', { name: '查询', exact: true }).isDisabled(), true, `${pageId} is locked without verified data`)
      await measure(`${pageId}-locked`)
    }

    const apCandidate = candidates.find(candidate => candidate.formId === 'AP_PAYDETAILREPORT')
    assert.ok(apCandidate)
    await visit('operational-candidate-ap-detail')
    const tableSettings = page.locator('[data-report-column-config="AP_PAYDETAILREPORT"]')
    assert.equal(await tableSettings.evaluate(element => element.open), false, 'column settings are collapsed by default')
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 4 条演示记录', { exact: false }).waitFor()
    assert.equal(await tableSettings.evaluate(element => element.open), false, 'ordinary query results do not require opening column settings')
    assert.equal(await page.locator('.op-business-table-wrap').count(), 1, 'the default report table is available before any configuration')
    await tableSettings.locator('summary').click()
    const picker = tableSettings.locator('.op-business-column-picker')
    assert.equal(await picker.locator('input[type="checkbox"]').count(), apCandidate.fieldCandidates.length, 'settings expose the complete attachment FieldKeys directory')
    const compactLayout = await page.evaluate(() => {
      const settings = document.querySelector('[data-report-column-config="AP_PAYDETAILREPORT"]')
      const body = settings.querySelector('.op-business-table-settings-body')
      const picker = settings.querySelector('.op-business-column-picker')
      const results = document.querySelector('.op-business-results')
      const settingsRect = settings.getBoundingClientRect(), resultsRect = results.getBoundingClientRect()
      return { settingsPosition: getComputedStyle(settings).position, bodyPosition: getComputedStyle(body).position, bodyOverflowY: getComputedStyle(body).overflowY, bodyScrollHeight: body.scrollHeight, bodyClientHeight: body.clientHeight, pickerOverflowY: getComputedStyle(picker).overflowY, pickerScrollHeight: picker.scrollHeight, pickerClientHeight: picker.clientHeight, settingsBottom: settingsRect.bottom, resultsTop: resultsRect.top }
    })
    assert.equal(compactLayout.settingsPosition, 'static', 'settings stay in document flow rather than overlaying report content')
    assert.equal(compactLayout.bodyPosition, 'static')
    assert.equal(compactLayout.bodyOverflowY, 'auto', 'expanded settings use a bounded internal scroll area')
    assert.ok(compactLayout.bodyScrollHeight > compactLayout.bodyClientHeight, 'long settings content scrolls internally instead of growing without limit')
    assert.equal(compactLayout.pickerOverflowY, 'auto', 'field catalog has its own internal scroll')
    assert.ok(compactLayout.pickerScrollHeight > compactLayout.pickerClientHeight, 'the full field catalog remains available inside the fixed-height list')
    assert.ok(compactLayout.pickerClientHeight >= 180 && compactLayout.pickerClientHeight <= 220, `field catalog keeps a readable internal viewport: ${compactLayout.pickerClientHeight}px`)
    assert.ok(compactLayout.settingsBottom <= compactLayout.resultsTop, 'expanded settings push no content over or behind report results')
    const firstFieldTarget = await picker.locator('label').first().evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, checkboxWidth: element.querySelector('input').getBoundingClientRect().width, checkboxHeight: element.querySelector('input').getBoundingClientRect().height }))
    assert.ok(firstFieldTarget.height >= (viewport.width === 390 ? 44 : 34), 'field rows retain readable desktop height and mobile tap target')
    assert.ok(firstFieldTarget.checkboxWidth <= 24 && firstFieldTarget.checkboxHeight <= 24, 'checkbox glyph remains compact while the enclosing label is the touch target')
    if (viewport.width === 390) assert.ok(firstFieldTarget.width >= 44 && firstFieldTarget.height >= 44, 'compact mobile checkbox rows retain a 44px touch target')
    await tableSettings.getByLabel('搜索字段目录').fill('FBUSINESSORGNAME')
    assert.equal(await picker.locator('input[type="checkbox"]').count(), 1, 'field search narrows the compact catalog')
    await tableSettings.getByLabel('搜索字段目录').fill('')
    assert.equal(await picker.locator('input[type="checkbox"]').count(), apCandidate.fieldCandidates.length, 'clearing search restores the full catalog')
    const visibleCount = async () => Number((await tableSettings.locator('summary').innerText()).match(/显示 (\d+)\//)?.[1])
    const initialVisibleCount = await visibleCount()
    const organizationColumn = page.getByLabel(/显示列 .* FBUSINESSORGNAME/)
    assert.equal(await organizationColumn.isChecked(), true)
    await organizationColumn.uncheck()
    assert.equal(await visibleCount(), initialVisibleCount - 1, 'unchecking a field removes that display column')
    await organizationColumn.check()
    assert.equal(await visibleCount(), initialVisibleCount, 'checking a field restores that display column')
    for (const excluded of apCandidate.targetAccountReadOnlyObservation?.excludedRuntimeFieldKeys || []) {
      assert.equal(await page.getByLabel(new RegExp(`显示列 .* ${excluded}`)).isDisabled(), true, `${excluded} remains locked as an excluded target-runtime field`)
    }
    await tableSettings.getByRole('button', { name: '下移 FCONTACTUNITNUMBER' }).click()
    await tableSettings.getByLabel('冻结前几列').selectOption('2')
    await tableSettings.getByLabel('允许排序字段').selectOption('FDATE')
    await tableSettings.getByLabel('排序方向').selectOption('desc')
    const storedPreferences = await page.evaluate(() => JSON.parse(localStorage.getItem('plm-report-table-preferences:v1:AP_PAYDETAILREPORT') || 'null'))
    assert.equal(storedPreferences.frozenCount, 2, 'freeze preference is stored per FormId locally')
    assert.equal(storedPreferences.sortKey, 'FDATE')
    assert.equal(storedPreferences.sortDirection, 'desc')
    assert.ok(storedPreferences.order.indexOf('FCONTACTUNITNUMBER') > storedPreferences.order.indexOf('FCONTACTUNITNAME'), 'column order can be changed')
    await tableSettings.scrollIntoViewIfNeeded()
    await capture('ap-detail-column-settings', { fullPage: true })
    await tableSettings.locator('summary').click()
    const requestsBeforeLocalQuery = apiRequests.length
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page.getByText('共 4 条演示记录', { exact: false }).waitFor()
    const configuredTable = page.locator('table[data-form-id="AP_PAYDETAILREPORT"]')
    assert.equal(await configuredTable.locator('tbody tr').first().locator('[data-field-key="FDATE"]').innerText(), '2026-09-08', 'descending sort applies to local synthetic rows before pagination')
    const frozenOffsets = await configuredTable.locator('thead th.op-business-frozen-column').evaluateAll(nodes => nodes.map(node => ({ position: getComputedStyle(node).position, left: getComputedStyle(node).left })))
    assert.deepEqual(frozenOffsets.slice(0, 2), [{ position: 'sticky', left: '0px' }, { position: 'sticky', left: '160px' }], 'the chosen first two columns stay frozen during horizontal scrolling')
    assert.ok(await page.locator('.op-business-table-wrap').evaluate(element => element.scrollWidth > element.clientWidth), 'wide report provides horizontal scrolling')
    assert.equal(apiRequests.length, requestsBeforeLocalQuery, 'column configuration and fixture sorting send no additional API request')
    await measure('customizable-wide-report-table')
    await captureResults('ap-detail-custom-columns')

    for (const pageId of routePages) {
      await visit(pageId)
      assert.equal(await page.locator('.op-business-header h1').count(), 1, `${pageId} direct route renders`)
    }
    assert.ok(external.every(origin => origin === 'https://fonts.googleapis.com'), `only the static Google Fonts stylesheet is attempted; all non-loopback requests are intercepted and blocked: ${external.join(',')}`)
    assert.deepEqual(mutations, [], 'no write requests')
    assert.equal(apiRequests.some(path => path.includes('/api/k3cloud/')), false, 'zero K3/live endpoint requests')
    await Promise.all(assets)
    assert.deepEqual(errors, [], `browser console errors: ${errors.join('\n')}`)
    assert.ok(apiRequests.length > 1, 'local auth and report fixture API exercised')
    writeFileSync(`${output}evidence.json`, JSON.stringify({ sourceCommit: evidence.sourceCommit, sourceTree: evidence.sourceTree, branch: evidence.branch, worktreeFingerprint: evidence.worktreeFingerprint, buildFingerprint: evidence.buildFingerprint, assets: evidence.assets, runtime: evidence.runtime, network: 'isolated network namespace; loopback only', blockedExternalRequests: external, mutations, k3Requests: apiRequests.filter(path => path.includes('/api/k3cloud/')), apiRequests, apiQueries, measures, screenshots }, null, 2) + '\n')
  } finally {
    await browser.close()
    await server.close()
  }
}

test('business-first K3 reports are usable, synthetic-only and live-locked at desktop and mobile widths', async () => {
  assert.equal(evidence.branch, 'feat/k3-all-operational-reports-20261026')
  assert.equal(evidence.sourceCommit, 'b352a25c0d5a8e213806404dfc8c4fb57647c989')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) await runViewport(viewport)
})
