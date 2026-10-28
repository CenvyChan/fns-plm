import { isIP } from 'node:net'

/** Permit plaintext K3Cloud only on literal private-network addresses in production.
 * Do not resolve arbitrary hostnames here: DNS changes must not bypass the policy.
 * Loopback, link-local/metadata, public and IPv4-mapped IPv6 addresses are excluded.
 */
export function isK3CloudUrlAllowed(url: URL): boolean {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return false
  if (url.protocol === 'https:' || process.env.NODE_ENV !== 'production') return true
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) === 4) {
    const [first, second] = host.split('.').map(Number)
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
  }
  return isIP(host) === 6 && /^(fc|fd)/i.test(host)
}
