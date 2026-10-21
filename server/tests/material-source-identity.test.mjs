import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MATERIAL_SOURCE_FIELDS, materialSourceFingerprint } from '../dist/material-source-identity.js'

const fields = Object.fromEntries(MATERIAL_SOURCE_FIELDS.map(key => [key, `F_${key}`]))
const config = { baseUrl: 'https://k3.example.test:9443/K3Cloud/', accountId: 'account-a', organization: 'org-a', materialSource: { formId: 'BD_MATERIAL', fields } }

test('material source digest binds every non-secret external identity component', () => {
  const original = materialSourceFingerprint(config)
  assert.match(original, /^sha256:[a-f0-9]{64}$/)
  for (const change of [
    { baseUrl: 'https://other.example.test:9443/K3Cloud/' },
    { baseUrl: 'http://k3.example.test:9443/K3Cloud/' },
    { baseUrl: 'https://k3.example.test:9444/K3Cloud/' },
    { baseUrl: 'https://k3.example.test:9443/OtherNamespace/' },
    { accountId: 'account-b' }, { organization: 'org-b' },
    { materialSource: { ...config.materialSource, formId: 'BD_OTHER' } },
    ...MATERIAL_SOURCE_FIELDS.map(key => ({ materialSource: { formId: 'BD_MATERIAL', fields: { ...fields, [key]: `F_other_${key}` } } })),
  ]) assert.notEqual(materialSourceFingerprint({ ...config, ...change }), original)
})

test('material source digest is stable across mapping order, URL normalization and credential rotation', () => {
  const original = materialSourceFingerprint(config)
  const reordered = { ...config, baseUrl: 'https://K3.EXAMPLE.TEST:9443/K3Cloud', accountId: ' account-a ', materialSource: { fields: Object.fromEntries(Object.entries(fields).reverse()), formId: 'BD_MATERIAL' } }
  assert.equal(materialSourceFingerprint(reordered), original)
  const withSecrets = { ...config, username: 'different-user', appId: 'new-app', appSecret: 'rotated', password: 'rotated', token: 'rotated', session: 'rotated', lcid: '2052', timeoutMs: 9999, formAllowlist: {} }
  assert.equal(materialSourceFingerprint(withSecrets), original)
  // Accessors prove the identity function never even reads these credential fields.
  for (const key of ['username', 'appId', 'appSecret', 'password', 'clientSecret', 'token', 'session']) Object.defineProperty(withSecrets, key, { get() { throw new Error('credential accessed') } })
  assert.equal(materialSourceFingerprint(withSecrets), original)
})

test('invalid/credential-bearing namespaces and incomplete identities fail without reflecting values', () => {
  for (const baseUrl of ['not-a-url', 'ftp://k3.example.test', 'https://sensitive-user:sensitive-pass@k3.example.test', 'https://k3.example.test?secret=sensitive', 'https://k3.example.test#sensitive']) {
    assert.throws(() => materialSourceFingerprint({ ...config, baseUrl }), error => !error.message.includes('sensitive'))
  }
  for (const change of [{ accountId: '' }, { organization: '' }, { materialSource: {} }, { materialSource: { formId: 'BD_MATERIAL', fields: {} } }]) assert.throws(() => materialSourceFingerprint({ ...config, ...change }))
})
