import { createHmac, timingSafeEqual } from 'node:crypto'

export type DingTalkStatus = { configured: boolean; connected: boolean; message: string }
export type ApprovalAction = 'approve' | 'reject'
export type DingTalkConfig = { webhookUrl?: string; webhookSecret?: string; cardCallbackSecret?: string; appKey?: string; appSecret?: string; templateId?: string; corpId?: string; publicAppUrl?: string; userMapping?: Record<string, unknown> }

function configFromEnvironment(): DingTalkConfig {
  return { webhookUrl: process.env.DINGTALK_WEBHOOK_URL?.trim() || process.env.DINGTALK_ROBOT_WEBHOOK?.trim() || '', webhookSecret: process.env.DINGTALK_WEBHOOK_SECRET ?? process.env.DINGTALK_ROBOT_SECRET ?? '', cardCallbackSecret: process.env.DINGTALK_CARD_CALLBACK_SECRET ?? '', appKey: process.env.DINGTALK_APP_KEY?.trim() ?? '', appSecret: process.env.DINGTALK_APP_SECRET ?? '', templateId: process.env.DINGTALK_CARD_TEMPLATE_ID?.trim() ?? '', corpId: process.env.DINGTALK_CORP_ID?.trim() ?? '', publicAppUrl: process.env.PUBLIC_APP_URL?.trim() ?? '' }
}
function effectiveConfig(input?: Partial<DingTalkConfig>): DingTalkConfig { return input ?? configFromEnvironment() }

export function getDingTalkStatus(input?: Partial<DingTalkConfig>): DingTalkStatus {
  const webhook = effectiveConfig(input).webhookUrl?.trim()
  if (!webhook) return { configured: false, connected: false, message: '钉钉机器人 Webhook 尚未配置；没有发送任何消息。' }
  try { const url = new URL(webhook); if (url.protocol !== 'https:' || !['oapi.dingtalk.com', 'api.dingtalk.com'].includes(url.hostname)) return { configured: false, connected: false, message: '钉钉 Webhook 必须使用官方 HTTPS API 主机。' } }
  catch { return { configured: false, connected: false, message: '钉钉 Webhook URL 无效。' } }
  return { configured: true, connected: false, message: '钉钉机器人已配置；需显式发送测试消息以验证网络与权限。' }
}
export const dingtalkStatus = getDingTalkStatus

function signedWebhook(input?: Partial<DingTalkConfig>): URL | null {
  const config = effectiveConfig(input), raw = config.webhookUrl?.trim()
  if (!raw) return null
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('DingTalk webhook URL is invalid.') }
  if (url.protocol !== 'https:' || !['oapi.dingtalk.com', 'api.dingtalk.com'].includes(url.hostname)) throw new Error('DingTalk webhook must use an official HTTPS API host.')
  const secret = config.webhookSecret
  if (secret) {
    const timestamp = Date.now().toString(), sign = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
    url.searchParams.set('timestamp', timestamp); url.searchParams.set('sign', sign)
  }
  return url
}

/** Explicitly sends one Markdown message; callers must choose when to invoke it. */
export async function sendMarkdown(title: string, text: string, input?: Partial<DingTalkConfig>): Promise<{ ok: boolean; message: string }> {
  const url = signedWebhook(input)
  if (!url) return { ok: false, message: 'DingTalk robot webhook is not configured; no message was sent.' }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { title: title.slice(0, 100), text: text.slice(0, 20000) } }), signal: controller.signal })
    let payload: unknown
    try { payload = await response.json() } catch { return { ok: false, message: 'DingTalk returned invalid JSON.' } }
    const code = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).errcode : undefined
    if (!response.ok || (typeof code === 'number' && code !== 0)) return { ok: false, message: `DingTalk rejected the message (HTTP ${response.status}).` }
    return { ok: true, message: 'DingTalk message sent.' }
  } catch (error) { return { ok: false, message: error instanceof Error && error.name === 'AbortError' ? 'DingTalk request timed out.' : 'DingTalk request failed due to a network error.' }
  } finally { clearTimeout(timer) }
}
export const sendDingTalkMarkdown = sendMarkdown

/** Build an application detail link; remote origins must use HTTPS and stay on their configured origin. */
export function buildApprovalPreviewUrl(path: string, params: Record<string, string> = {}, configuredBase?: string): string | null {
  const base = (configuredBase ?? process.env.PUBLIC_APP_URL)?.trim()
  if (!base) return null
  try {
    const url = new URL(path, base), baseUrl = new URL(base), local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if (!['https:', ...(local ? ['http:'] : [])].includes(url.protocol) || !['https:', ...(['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname) ? ['http:'] : [])].includes(baseUrl.protocol)) return null
    if (url.origin !== baseUrl.origin || url.username || url.password) return null
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  } catch { return null }
}
export const buildApprovalUrl = buildApprovalPreviewUrl

/** Verify DingTalk card callback signature over timestamp + newline + app secret. */
export function verifyCardCallbackSignature(headers: Headers | Record<string, string | string[] | undefined>, secret = process.env.DINGTALK_CARD_CALLBACK_SECRET): boolean {
  if (!secret) return false
  const get = (key: string): string | undefined => {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(key) ?? undefined
    const record = headers as Record<string, string | string[] | undefined>, value = record[key] ?? record[Object.keys(record).find(k => k.toLowerCase() === key) ?? '']
    return Array.isArray(value) ? value[0] : value
  }
  const timestamp = get('x-ddpaas-signature-timestamp'), signature = get('x-ddpaas-signature')
  if (!timestamp || !signature || !/^\d{1,20}$/.test(timestamp)) return false
  const numericTimestamp = Number(timestamp), timestampMs = numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1_000 : numericTimestamp
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'), a = Buffer.from(expected), b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function parseCardApprovalAction(payload: unknown): ApprovalAction | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>, content = root.content && typeof root.content === 'object' ? root.content as Record<string, unknown> : root
  const privateData = content.cardPrivateData && typeof content.cardPrivateData === 'object' ? content.cardPrivateData as Record<string, unknown> : undefined
  const params = privateData?.params && typeof privateData.params === 'object' ? privateData.params as Record<string, unknown> : undefined
  for (const candidate of [params?.action, params?.actionIds]) for (const value of Array.isArray(candidate) ? candidate : [candidate]) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (['approve', 'approved', 'agree', 'accept', '同意'].includes(normalized)) return 'approve'
    if (['reject', 'rejected', 'deny', 'refuse', '驳回', '拒绝'].includes(normalized)) return 'reject'
  }
  return null
}
export const parseApprovalAction = parseCardApprovalAction
