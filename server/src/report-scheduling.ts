import { randomUUID } from 'node:crypto'

export type ReportScopeIdentity = { tenantId: string; organizationId: string; accountId: string }

export type ReportLockStore = {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>
}

export type ReportRunLockResult<T> =
  | { status: 'executed'; value: T }
  | { status: 'busy' | 'duplicate' }

const IN_FLIGHT_TTL_SECONDS = 60
const SCHEDULED_RUN_TTL_SECONDS = 600

function encoded(value: string): string { return encodeURIComponent(value) }

export function reportScheduleBucket(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year ?? ''}${values.month ?? ''}${values.day ?? ''}${values.hour ?? ''}${values.minute ?? ''}`
}

/**
 * Prevent overlapping sends for one scoped plan and deduplicate the same scheduled
 * minute across processes. A failed scheduled delivery releases its minute lock so
 * an operator or a later retry can try again; successful deliveries keep it briefly.
 */
export async function runWithReportLocks<T>(input: {
  scope: ReportScopeIdentity
  scheduleId: string
  scheduledBucket?: string
  lockStore: ReportLockStore
  run: () => Promise<T>
  isSuccessful: (value: T) => boolean
  token?: string
  inFlightTtlSeconds?: number
}): Promise<ReportRunLockResult<T>> {
  const scopeKey = [input.scope.tenantId, input.scope.organizationId, input.scope.accountId].map(encoded).join(':')
  const planKey = `${scopeKey}:${encoded(input.scheduleId)}`
  const token = input.token ?? randomUUID()
  const inFlightKey = `reports:${planKey}:inflight`
  const inFlightTtl = Number.isInteger(input.inFlightTtlSeconds) ? Math.min(21_600, Math.max(IN_FLIGHT_TTL_SECONDS, input.inFlightTtlSeconds!)) : IN_FLIGHT_TTL_SECONDS
  if (!await input.lockStore.setIfAbsent(inFlightKey, token, inFlightTtl)) return { status: 'busy' }

  let scheduledRunKey: string | undefined
  let scheduledRunClaimed = false
  const release = async (key: string) => {
    try { await input.lockStore.deleteIfValue(key, token) } catch { /* Expiring locks remain fail-safe if the cache is unavailable. */ }
  }

  try {
    if (input.scheduledBucket) {
      scheduledRunKey = `reports:${planKey}:minute:${encoded(input.scheduledBucket)}`
      scheduledRunClaimed = await input.lockStore.setIfAbsent(scheduledRunKey, token, SCHEDULED_RUN_TTL_SECONDS)
      if (!scheduledRunClaimed) return { status: 'duplicate' }
    }

    const value = await input.run()
    if (scheduledRunClaimed && !input.isSuccessful(value)) await release(scheduledRunKey!)
    return { status: 'executed', value }
  } catch (error) {
    if (scheduledRunClaimed) await release(scheduledRunKey!)
    throw error
  } finally {
    await release(inFlightKey)
  }
}
