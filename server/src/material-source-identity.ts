import { createHash } from 'node:crypto'

export const MATERIAL_SOURCE_FIELDS = ['id', 'number', 'name', 'specification', 'unit', 'groupNumber', 'groupId', 'organization'] as const
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A versioned identity digest, not a connector/session cache key. Never hash credentials. */
export function materialSourceFingerprint(config: Record<string, unknown>): string {
  let endpoint: URL
  try { endpoint = new URL(String(config.baseUrl ?? '').trim()) }
  catch { throw new Error('外部物料来源端点无效，请检查配置后重新刷新。') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('外部物料来源端点必须不含凭据、查询或片段。')
  // Match the K3 transport's namespace normalization, preserving path case and port.
  const namespace = endpoint.origin + endpoint.pathname.replace(/\/$/, '')
  const mapping = record(config.materialSource), fields = record(mapping.fields)
  const accountId = String(config.accountId ?? '').trim(), organization = String(config.organization ?? '').trim()
  if (!accountId || !organization || typeof mapping.formId !== 'string' || !mapping.formId || MATERIAL_SOURCE_FIELDS.some(key => typeof fields[key] !== 'string' || !fields[key])) throw new Error('外部物料来源身份不完整，请配置后重新刷新。')
  const identity = ['k3-material-source:v1', namespace, accountId, organization, mapping.formId, MATERIAL_SOURCE_FIELDS.map(key => [key, fields[key]])]
  return 'sha256:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}
