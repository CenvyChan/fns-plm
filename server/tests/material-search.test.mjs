import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { listResponse } from '../dist/list-query.js'
import { resolveWorkspaceSearch } from '../dist/material-search.js'

// TEST ONLY: synthetic local account fixtures. No auth, production state, ERP adapters or K3 calls.
const materials = [
  { id: 'test-m1', partNo: 'TEST-MAT-101', name: 'Same test name', specification: 'SPEC-ONLY-111', category: 'TEST-CATEGORY', classificationPath: ['TEST-PATH'], proposedGroupNumber: 'TEST-GROUP', specificationFields: { productModel: 'MODEL-ONLY-222' }, dimensions: { width: 'DIM-ONLY-333' } },
  { id: 'test-m2', partNo: 'TEST-MAT-102', name: 'Same test name', specification: 'SECOND-SPEC-444', specificationFields: { freeFormGrade: 'GRADE-ONLY-555' } },
]
const workspace = {
  materials,
  boms: [
    { id: 'test-parent-bom', bomNo: 'BOM-LEGACY-1', parentMaterialId: 'test-m1', lines: [] },
    { id: 'test-line-bom', parentMaterialId: 'test-m2', lines: [{ materialId: 'test-m1' }] },
    { id: 'test-rule-bom', parentMaterialId: 'test-m2', lines: [], salesRules: [{ materialId: 'test-m1' }] },
    { id: 'test-missing-bom', parentMaterialId: 'missing-test-material', lines: [{ materialId: 'foreign-material' }] },
  ],
  documents: [
    { id: 'test-doc', docNo: 'DOC-LEGACY-1', title: 'Fixture drawing', materialId: 'test-m1' },
    { id: 'test-missing-doc', materialId: 'missing-test-material' },
    { id: 'test-foreign-doc', materialId: 'foreign-material' },
  ],
  salesBomSnapshots: [
    { id: 'test-parent-snapshot', orderNo: 'ORDER-LEGACY-1', parentMaterialId: 'test-m1', lines: [] },
    { id: 'test-line-snapshot', parentMaterialId: 'test-m2', lines: [{ materialId: 'test-m1' }] },
    { id: 'test-missing-snapshot', parentMaterialId: 'foreign-material', lines: [{ materialId: 'missing-test-material' }] },
  ],
}
const foreignWorkspace = { materials: [{ id: 'foreign-material', name: 'Other account', specification: 'FOREIGN-SECRET-666' }], boms: [], documents: [{ id: 'other-doc', materialId: 'foreign-material' }], salesBomSnapshots: [] }
const req = query => ({ query })
function response() { return { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this }, json(value) { this.payload = value; return this } } }
function query(collection, q, extra = {}, scope = workspace) {
  const res = response(); listResponse(req({ q, ...extra }), res, scope[collection], resolveWorkspaceSearch(scope, collection)); return res
}

test('legacy arrays and opt-in paged envelope remain compatible', () => {
  const bare = response(); listResponse(req({}), bare, materials); assert.strictEqual(bare.payload, materials)
  for (const params of [{ q: '' }, { page: '1' }, { pageSize: '1' }, { q: '   ' }]) {
    const res = response(); listResponse(req(params), res, materials)
    assert.equal(res.statusCode, 200); assert.equal(res.payload.total, 2); assert.equal(res.payload.page, 1)
    assert.deepEqual(Object.keys(res.payload).sort(), ['items', 'page', 'pageSize', 'total', 'totalPages'].sort())
  }
})

test('query validation retains positive safe integers, page-size and single-string limits', () => {
  for (const params of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '1e2' }, { page: ['1'] }, { page: '9007199254740992' }, { page: '9007199254740991', pageSize: '200' }, { pageSize: '0' }, { pageSize: '201' }, { pageSize: ['1'] }, { q: ['model', 'spec'] }, { q: { value: 'x' } }, { q: 'x'.repeat(201) }]) {
    const res = response(); listResponse(req(params), res, materials)
    assert.equal(res.statusCode, 400, JSON.stringify(params)); assert.equal(res.payload.error, 'invalid_list_query')
  }
  for (const params of [{ pageSize: '200' }, { q: 'x'.repeat(200) }]) {
    const res = response(); listResponse(req(params), res, materials); assert.equal(res.statusCode, 200)
  }
})

test('material search supports free text and structured model/grade/dimension without inventing model schema', () => {
  for (const term of [' SPEC-only-111 ', ' MODEL-ONLY-222 ', 'ｍｏｄｅｌ－ｏｎｌｙ－２２２', 'DIM-only-333', 'TEST-MAT-101', 'test-category', 'test-path', 'test-group']) {
    assert.deepEqual(query('materials', term).payload.items.map(row => row.id), ['test-m1'], term)
  }
  assert.deepEqual(query('materials', 'grade-only-555').payload.items.map(row => row.id), ['test-m2'])
  assert.equal(query('materials', 'same TEST name').payload.total, 2)
  assert.equal(query('materials', 'productModel').payload.total, 0, 'field names are not spec values')
  assert.equal(query('materials', 'undefined').payload.total, 0)
})

test('filtering precedes pagination and does not mutate rows', () => {
  const before = JSON.stringify(workspace)
  const page1 = query('materials', 'same test', { page: '1', pageSize: '1' }).payload
  const page2 = query('materials', 'same test', { page: '2', pageSize: '1' }).payload
  assert.equal(page1.total, 2); assert.equal(page1.totalPages, 2); assert.equal(page2.items[0].id, 'test-m2')
  const onlySecond = query('materials', 'second-spec', { page: '1', pageSize: '1' }).payload
  assert.equal(onlySecond.total, 1); assert.equal(onlySecond.items[0].id, 'test-m2')
  assert.equal(query('materials', 'same test', { page: '3', pageSize: '1' }).payload.items.length, 0)
  assert.equal(query('materials', 'NO-MATCH').payload.totalPages, 0)
  assert.equal(JSON.stringify(workspace), before)
})

test('BOM parent, component and sales-rule references match spec/model', () => {
  for (const term of ['spec-only-111', 'model-only-222', 'TEST-MAT-101', 'Same test name']) {
    assert.deepEqual(query('boms', term).payload.items.map(row => row.id), ['test-parent-bom', 'test-line-bom', 'test-rule-bom'], term)
  }
  assert.equal(query('boms', 'BOM-LEGACY-1').payload.total, 1)
})

test('document and immutable snapshot parent/line search resolves linked material data', () => {
  assert.deepEqual(query('documents', 'model-only-222').payload.items.map(row => row.id), ['test-doc'])
  assert.equal(query('documents', 'DOC-LEGACY-1').payload.total, 1)
  assert.equal(query('documents', 'Fixture drawing').payload.total, 1)
  assert.deepEqual(query('salesBomSnapshots', 'spec-only-111').payload.items.map(row => row.id), ['test-parent-snapshot', 'test-line-snapshot'])
  assert.equal(query('salesBomSnapshots', 'ORDER-LEGACY-1').payload.total, 1)
})

test('unresolved and other-account references never join outside supplied scoped workspace', () => {
  for (const collection of ['materials', 'boms', 'documents', 'salesBomSnapshots']) {
    assert.equal(query(collection, 'FOREIGN-SECRET-666').payload.total, 0, collection)
    assert.equal(query(collection, 'undefined').payload.total, 0, collection)
  }
  assert.deepEqual(query('documents', 'FOREIGN-SECRET-666', {}, foreignWorkspace).payload.items.map(row => row.id), ['other-doc'])
  const empty = { ...workspace, materials: [] }
  assert.equal(query('documents', 'MODEL-ONLY-222', {}, empty).payload.total, 0)
  // A previously built resolver must not capture a different request's workspace.
  assert.equal(query('documents', 'FOREIGN-SECRET-666').payload.total, 0)
})

test('unrelated generic collections do not recursively search arbitrary properties', () => {
  const rows = [{ id: 'test-task', title: 'Legacy task', specificationFields: { productModel: 'SHOULD-NOT-MATCH' } }]
  const res = response(); listResponse(req({ q: 'SHOULD-NOT-MATCH' }), res, rows); assert.equal(res.payload.total, 0)
  const legacy = response(); listResponse(req({ q: 'legacy TASK' }), legacy, rows); assert.equal(legacy.payload.total, 1)
})

test('HTTP query contracts use shared implementation for all four scoped collection types', async t => {
  const app = express()
  const collections = { materials: 'materials', boms: 'boms', documents: 'documents', 'sales-bom-snapshots': 'salesBomSnapshots' }
  for (const [path, collection] of Object.entries(collections)) {
    app.get(`/api/${path}`, (req, res) => {
      // TEST ONLY scope fixture selection; production auth middleware is not exercised here.
      const scope = req.get('x-test-scope') === 'other' ? foreignWorkspace : workspace
      return listResponse(req, res, scope[collection], resolveWorkspaceSearch(scope, collection))
    })
  }
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const [path, expected] of [['materials', 1], ['boms', 3], ['documents', 1], ['sales-bom-snapshots', 2]]) {
    const bare = await fetch(`${origin}/api/${path}`); assert.ok(Array.isArray(await bare.json()))
    const res = await fetch(`${origin}/api/${path}?q=%20MODEL-ONLY-222%20&pageSize=1`)
    assert.equal(res.status, 200); const body = await res.json(); assert.equal(body.total, expected); assert.equal(body.items.length, 1)
  }
  for (const suffix of ['?q=a&q=b', '?page=0', '?pageSize=201', `?q=${'x'.repeat(201)}`]) {
    const invalid = await fetch(`${origin}/api/materials${suffix}`); assert.equal(invalid.status, 400)
  }
  const local = await fetch(`${origin}/api/documents?q=FOREIGN-SECRET-666`); assert.equal((await local.json()).total, 0)
  const other = await fetch(`${origin}/api/documents?q=FOREIGN-SECRET-666`, { headers: { 'x-test-scope': 'other' } }); assert.equal((await other.json()).total, 1)
})

test('production route wiring passes current scoped data, source snapshot already searches specification', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(index, /resolveWorkspaceSearch\(data, searchCollection\)/)
  assert.match(index, /listResponse\(req, res, list\(\), resolver\)/)
  for (const [path, key] of [['materials', 'materials'], ['boms', 'boms'], ['documents', 'documents'], ['sales-bom-snapshots', 'salesBomSnapshots']]) {
    assert.ok(index.includes(`registerCollection('${path}', '${key}'`), path)
  }
  const closure = readFileSync(new URL('../src/material-closure.ts', import.meta.url), 'utf8')
  assert.ok(closure.includes('${row.number} ${row.name} ${row.specification}'), 'existing snapshot source query includes specification; no ERP query needed')
})
