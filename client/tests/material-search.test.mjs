// TEST ONLY: all materials, documents, BOMs, snapshots, and identifiers below are synthetic fixtures.
// These tests import the pure local-search module directly; they do not access network, environment, or production data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bomSearchText,
  matchesBomMaterial,
  matchesDocumentMaterial,
  matchesMaterial,
  matchesSearchText,
  matchesSnapshotMaterial,
  materialOptionLabel,
  materialSearchText,
  normalizeMaterialQuery,
} from '../src/material-search.ts'

const materials = {
  motor: {
    id: 'fixture-motor', partNo: 'MTR-042', name: 'Drive Motor', category: 'Actuator',
    specification: 'Brushless motor', unit: 'ea', revision: 'A', lifecycle: 'draft', owner: 'Fixture',
    createdAt: '2000-01-01', updatedAt: '2000-01-01', proposedGroupNumber: 'PG-77',
    classificationPath: ['Electrical', 'Rotating Equipment'],
    specificationFields: { productModel: 'QX-900', voltage: '24 V', winding: 'Winding-Z' },
    dimensions: { diameter: 'Ø42 mm', shaftLength: '18 mm' },
  },
  sameNameA: {
    id: 'fixture-same-a', partNo: 'ALT-101', name: 'Shared Valve', category: 'Fluid',
    specification: 'Type Alpha', unit: 'ea', revision: 'A', lifecycle: 'draft', owner: 'Fixture',
    createdAt: '2000-01-01', updatedAt: '2000-01-01',
    specificationFields: { productModel: 'Model-A', pressure: '10 bar' },
  },
  sameNameB: {
    id: 'fixture-same-b', partNo: 'ALT-202', name: 'Shared Valve', category: 'Fluid',
    specification: 'Type Beta', unit: 'ea', revision: 'A', lifecycle: 'draft', owner: 'Fixture',
    createdAt: '2000-01-01', updatedAt: '2000-01-01',
    specificationFields: { productModel: 'Model-B', pressure: '20 bar' },
  },
}

test('normalizes case, surrounding whitespace, NFKC, and fullwidth text', () => {
  assert.equal(normalizeMaterialQuery('  ＱＸ－９００  '), 'qx-900')
  assert.equal(normalizeMaterialQuery('  MIXED Case  '), 'mixed case')
  assert.equal(matchesSearchText('ＡＢＣ-１２３', 'abc-123'), true)
  assert.equal(matchesSearchText('  brushless MOTOR ', '  BRUSHLESS motor  '), true)
})

test('searches permitted material identity, legacy classification, and proposed group fields', () => {
  for (const query of ['mtr-042', 'drive motor', 'Actuator', 'PG-77', 'Electrical', 'Rotating Equipment']) {
    assert.equal(matchesMaterial(materials.motor, query), true, `expected match: ${query}`)
  }
  assert.equal(materialSearchText(materials.motor).includes('24 V'), true)
  assert.equal(matchesMaterial(materials.motor, 'Winding-Z'), true)
})

test('searches productModel and arbitrary structured specification and dimension values', () => {
  for (const query of ['QX-900', '24 V', 'Winding-Z', 'Ø42 mm', '18 mm']) {
    assert.equal(matchesMaterial(materials.motor, query), true, `expected structured-value match: ${query}`)
  }
  assert.equal(matchesMaterial(materials.motor, 'voltage'), false, 'search text includes values, not object keys')
  assert.equal(matchesMaterial(materials.motor, 'shaftLength'), false, 'search text includes values, not object keys')
})

test('does not match omitted ref/code/name fields or missing material references as undefined', () => {
  const sparse = { id: 'fixture-sparse', partNo: 'SP-1', name: 'Sparse Item', category: 'General', specification: 'Plain', unit: 'ea', revision: 'A', lifecycle: 'draft', owner: 'Fixture', createdAt: '2000-01-01', updatedAt: '2000-01-01' }
  assert.equal(matchesMaterial(sparse, 'undefined'), false)
  assert.equal(matchesMaterial(sparse, 'null'), false)
  assert.equal(matchesMaterial(sparse, 'productModel'), false)
  assert.equal(matchesMaterial(sparse, 'classificationPath'), false)
  assert.equal(matchesMaterial(sparse, 'dimensions'), false)
  assert.equal(materialSearchText(undefined), '')
  assert.equal(matchesDocumentMaterial({ id: 'fixture-doc', docNo: 'DOC-1', title: 'Manual', type: 'PDF', materialId: 'missing-fixture', revision: 'A', lifecycle: 'draft', owner: 'Fixture', updatedAt: '2000-01-01' }, {}, 'undefined'), false)
})

test('handles nonmatches and empty queries with ordinary substring semantics', () => {
  assert.equal(matchesMaterial(materials.motor, 'unrelated-needle'), false)
  assert.equal(matchesMaterial(materials.motor, 'mtr-999'), false)
  assert.equal(matchesSearchText('anything', ''), true)
  assert.equal(matchesMaterial(materials.motor, ''), true)
})

test('option labels retain same-name materials while distinguishing specification and model', () => {
  const a = materialOptionLabel(materials.sameNameA)
  const b = materialOptionLabel(materials.sameNameB)
  assert.notEqual(a, b)
  assert.match(a, /ALT-101/)
  assert.match(a, /Shared Valve/)
  assert.match(a, /Type Alpha/)
  assert.match(a, /Model-A/)
  assert.match(b, /ALT-202/)
  assert.match(b, /Type Beta/)
  assert.match(b, /Model-B/)
})

test('document search includes document metadata and referenced material fields only', () => {
  const doc = { id: 'fixture-doc', docNo: 'DOC-PLN-8', title: 'Cooling Assembly Drawing', type: 'Engineering Drawing', materialId: 'motor', revision: 'A', lifecycle: 'draft', owner: 'Fixture', updatedAt: '2000-01-01' }
  for (const query of ['DOC-PLN-8', 'Cooling Assembly', 'Engineering Drawing', 'QX-900', 'Ø42 mm']) {
    assert.equal(matchesDocumentMaterial(doc, materials, query), true, `expected document match: ${query}`)
  }
  assert.equal(matchesDocumentMaterial(doc, materials, 'missing-only-value'), false)
})

const fixtureBom = {
  id: 'fixture-bom', bomNo: 'BOM-FX-12', parentMaterialId: 'motor', kind: 'sales', revision: 'R3',
  lifecycle: 'draft', effectiveDate: '2000-01-01', updatedAt: '2000-01-01', scope: 'North Assembly',
  lines: [{ id: 'fixture-line', materialId: 'sameNameA', quantity: 1, findNumber: '10' }, { id: 'fixture-missing-line', materialId: 'missing-fixture', quantity: 1, findNumber: '20' }],
  salesRules: [{ id: 'fixture-rule', groupKey: 'upgrade', conditions: [], materialId: 'sameNameB', quantity: 1, priority: 1 }],
}

test('BOM text and matching cover parent, component lines, and sales-rule materials', () => {
  const text = bomSearchText(fixtureBom, materials)
  for (const query of ['BOM-FX-12', 'R3', 'North Assembly', 'QX-900', 'ALT-101', 'Model-A', 'ALT-202', 'Model-B']) {
    assert.equal(matchesBomMaterial(fixtureBom, materials, query), true, `expected BOM match: ${query}`)
    assert.ok(text.toLowerCase().includes(query.toLowerCase()), `expected text to contain ${query}`)
  }
  assert.equal(matchesBomMaterial(fixtureBom, materials, 'undefined'), false)
  assert.equal(matchesBomMaterial(fixtureBom, materials, 'no-such-material'), false)
})

test('sales BOM snapshot matching covers order number, parent, and line material', () => {
  const snapshot = {
    id: 'fixture-snapshot', orderNo: 'SO-FX-44', parentMaterialId: 'motor', bomId: 'fixture-bom',
    bomNo: 'BOM-FX-12', bomRevision: 'R3', quantity: 1, attributes: {}, createdAt: '2000-01-01',
    lines: [{ id: 'fixture-snapshot-line', materialId: 'sameNameA', quantity: 1, role: 'component', sourceBomId: 'fixture-bom', sourceRevision: 'R3', findNumber: '10' }],
  }
  for (const query of ['SO-FX-44', 'BOM-FX-12', 'QX-900', 'ALT-101', 'Model-A']) {
    assert.equal(matchesSnapshotMaterial(snapshot, materials, query), true, `expected snapshot match: ${query}`)
  }
  assert.equal(matchesSnapshotMaterial(snapshot, materials, 'undefined'), false)
  assert.equal(matchesSnapshotMaterial(snapshot, materials, 'absent-fixture-value'), false)
})
