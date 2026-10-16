import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'

const sso = await import('../dist/dingtalk-sso.js')

test('DingTalk authCode is exchanged server-side for a verified identity using only mocked official endpoints', { concurrency: false }, async () => {
  const keys = [
    'DINGTALK_SSO_CLIENT_ID', 'DINGTALK_SSO_CLIENT_SECRET', 'DINGTALK_SSO_CORP_ID',
    'DINGTALK_SSO_TENANT_ID', 'DINGTALK_SSO_ORGANIZATION_ID', 'DINGTALK_SSO_ACCOUNT_ID',
  ]
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const realFetch = globalThis.fetch
  const nonce = randomUUID()
  const clientId = `mock-client-${nonce}`
  const clientSecret = randomBytes(32).toString('hex')
  const corpId = `mock-corp-${nonce}`
  const authCode = `one-time-auth-code-${nonce}`
  const mockAppToken = `mock-app-token-${nonce}`
  const calls = []

  try {
    Object.assign(process.env, {
      DINGTALK_SSO_CLIENT_ID: clientId,
      DINGTALK_SSO_CLIENT_SECRET: clientSecret,
      DINGTALK_SSO_CORP_ID: corpId,
      DINGTALK_SSO_TENANT_ID: `tenant-${nonce}`,
      DINGTALK_SSO_ORGANIZATION_ID: `organization-${nonce}`,
      DINGTALK_SSO_ACCOUNT_ID: `account-${nonce}`,
    })
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url)
      calls.push({ url: url.href, method: init.method, body: JSON.parse(init.body ?? '{}') })
      if (url.hostname === 'api.dingtalk.com' && url.pathname === `/v1.0/oauth2/${encodeURIComponent(corpId)}/token`) {
        assert.equal(init.method, 'POST')
        assert.deepEqual(JSON.parse(init.body), { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
        return Response.json({ access_token: mockAppToken, expires_in: 3600 })
      }
      if (url.hostname === 'oapi.dingtalk.com' && url.pathname === '/topapi/v2/user/getuserinfo') {
        assert.equal(url.searchParams.get('access_token'), mockAppToken)
        assert.equal(init.method, 'POST')
        assert.deepEqual(JSON.parse(init.body), { code: authCode })
        return Response.json({ errcode: 0, result: { userid: 'mock-bound-user-id', unionid: 'mock-bound-union-id', name: 'Mock Employee' } })
      }
      throw new Error(`Unexpected external request in mock test: ${url.origin}${url.pathname}`)
    }

    assert.equal(sso.dingtalkSsoStatus().configured, true)
    assert.deepEqual(sso.dingtalkSsoScope(), {
      tenantId: `tenant-${nonce}`,
      organizationId: `organization-${nonce}`,
      accountId: `account-${nonce}`,
    })
    const identity = await sso.exchangeDingTalkAuthCode(authCode)
    assert.deepEqual(identity, { userId: 'mock-bound-user-id', unionId: 'mock-bound-union-id', name: 'Mock Employee' })
    assert.equal(calls.length, 2, 'one app-token request and one authCode identity verification are expected')
    await assert.rejects(sso.exchangeDingTalkAuthCode(''), /Invalid DingTalk authorization code/)
    assert.equal(calls.length, 2, 'invalid or missing authCode must be rejected before any external request')
  } finally {
    globalThis.fetch = realFetch
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})
