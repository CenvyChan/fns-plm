const nativeFetch = globalThis.fetch.bind(globalThis)
const allowedHosts = new Set(['oapi.dingtalk.com', 'api.dingtalk.com'])

globalThis.fetch = async (input, init) => {
  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const requested = new URL(rawUrl)
  if (!allowedHosts.has(requested.hostname)) return nativeFetch(input, init)

  // Tests must never send to the official DingTalk host, even if the local mock is absent.
  const mockUrl = process.env.DINGTALK_TEST_MOCK_URL
  if (!mockUrl) return new Response(JSON.stringify({ errcode: 310000, errmsg: 'isolated mock is not configured' }), { status: 502, headers: { 'content-type': 'application/json' } })

  const request = input instanceof Request ? input : undefined
  const method = init?.method ?? request?.method ?? 'GET'
  const headers = init?.headers ?? request?.headers
  const body = init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? await request.clone().text() : undefined)
  return nativeFetch(mockUrl, { method, headers, body, signal: init?.signal ?? request?.signal })
}
