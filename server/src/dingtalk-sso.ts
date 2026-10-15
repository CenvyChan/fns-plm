type DingTalkConfig = { clientId: string; clientSecret: string; corpId: string }
export type DingTalkIdentity = { userId: string; unionId?: string; name?: string }
type CachedToken = { fingerprint: string; accessToken: string; expiresAt: number }
let cachedToken: CachedToken | undefined

function config(): DingTalkConfig | undefined {
  const clientId = process.env.DINGTALK_SSO_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.DINGTALK_SSO_CLIENT_SECRET?.trim() ?? ''
  const corpId = process.env.DINGTALK_SSO_CORP_ID?.trim() ?? ''
  return clientId && clientSecret && corpId ? { clientId, clientSecret, corpId } : undefined
}

export function dingtalkSsoStatus() {
  const missing: string[] = []
  if (!process.env.DINGTALK_SSO_CLIENT_ID?.trim()) missing.push('DINGTALK_SSO_CLIENT_ID')
  if (!process.env.DINGTALK_SSO_CLIENT_SECRET?.trim()) missing.push('DINGTALK_SSO_CLIENT_SECRET')
  if (!process.env.DINGTALK_SSO_CORP_ID?.trim()) missing.push('DINGTALK_SSO_CORP_ID')
  return { configured: missing.length === 0, missing }
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`DingTalk API HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Unexpected DingTalk API response')
  return payload as Record<string, unknown>
}

async function getAppAccessToken(settings: DingTalkConfig): Promise<string> {
  const fingerprint = `${settings.clientId}:${settings.corpId}`
  if (cachedToken?.fingerprint === fingerprint && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken
  const payload = await fetchJson(`https://api.dingtalk.com/v1.0/oauth2/${encodeURIComponent(settings.corpId)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: settings.clientId, client_secret: settings.clientSecret, grant_type: 'client_credentials' }),
  })
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  const expiresIn = Number(payload.expires_in)
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('DingTalk app token response is incomplete')
  cachedToken = { fingerprint, accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  return accessToken
}

export async function exchangeDingTalkAuthCode(authCode: string): Promise<DingTalkIdentity> {
  const settings = config()
  if (!settings) throw new Error('DingTalk SSO is not configured')
  if (!authCode || authCode.length > 1024) throw new Error('Invalid DingTalk authorization code')
  const accessToken = await getAppAccessToken(settings)
  const payload = await fetchJson(`https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ code: authCode }),
  })
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as Record<string, unknown>
    : payload
  if (typeof payload.errcode === 'number' && payload.errcode !== 0) throw new Error(`DingTalk identity API error ${payload.errcode}`)
  const userId = typeof result.userid === 'string' ? result.userid : typeof result.userId === 'string' ? result.userId : ''
  const unionId = typeof result.unionid === 'string' ? result.unionid : typeof result.unionId === 'string' ? result.unionId : typeof result.associated_unionid === 'string' ? result.associated_unionid : undefined
  const name = typeof result.name === 'string' ? result.name.slice(0, 80) : undefined
  if (!userId) throw new Error('DingTalk identity response did not include userId')
  return { userId, ...(unionId ? { unionId } : {}), ...(name ? { name } : {}) }
}
