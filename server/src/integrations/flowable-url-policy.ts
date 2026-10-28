function normalizedHttpBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) return undefined
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${path}`
  } catch {
    return undefined
  }
}

/** Exact, environment-managed HTTP base URLs; no host, CIDR, or path wildcards. */
export function isFlowableHttpEndpointAllowed(value: string): boolean {
  const candidate = normalizedHttpBaseUrl(value)
  if (!candidate) return false
  return (process.env.FLOWABLE_HTTP_ALLOWLIST ?? '')
    .split(',')
    .map(item => normalizedHttpBaseUrl(item))
    .some(item => Boolean(item && item === candidate))
}

/** Staging release requires both a separately verified URL and exact HTTP allowlisting. */
export function isVerifiedFlowableStagingEndpoint(value: string): boolean {
  if (process.env.FLOWABLE_VERIFIED_STAGING_RELEASE !== 'true') return false
  const candidate = normalizedHttpBaseUrl(value)
  const verified = normalizedHttpBaseUrl(process.env.FLOWABLE_VERIFIED_STAGING_URL ?? '')
  return Boolean(candidate && verified && candidate === verified && isFlowableHttpEndpointAllowed(value))
}
