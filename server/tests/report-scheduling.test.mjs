import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportScheduleBucket, runWithReportLocks } from '../dist/report-scheduling.js'

function mockLocks() {
  const entries = new Map()
  return {
    entries,
    async setIfAbsent(key, value) {
      if (entries.has(key)) return false
      entries.set(key, value)
      return true
    },
    async deleteIfValue(key, expected) {
      if (entries.get(key) !== expected) return false
      entries.delete(key)
      return true
    },
  }
}

const scopeA = { tenantId: 'tenant-a', organizationId: 'org-a', accountId: 'account-a' }
const scopeB = { tenantId: 'tenant-b', organizationId: 'org-b', accountId: 'account-b' }
const base = { scheduleId: 'same-plan-id', scheduledBucket: '202610160915', isSuccessful: value => value.ok }

test('scheduled runs deduplicate the same plan/minute while isolating every scope layer', async () => {
  const locks = mockLocks()
  let sends = 0
  const run = async scope => runWithReportLocks({ ...base, scope, lockStore: locks, run: async () => ({ ok: (++sends, true) }) })

  assert.equal((await run(scopeA)).status, 'executed')
  assert.equal((await run(scopeA)).status, 'duplicate')
  assert.equal((await run(scopeB)).status, 'executed')
  assert.equal(sends, 2, 'a different tenant/org/account tuple must have its own dedupe lock')
  assert.equal(locks.entries.size, 2, 'successful scheduled minute locks remain briefly to deduplicate retries')
})

test('failed scheduled delivery releases the minute lock so an immediate retry can succeed', async () => {
  const locks = mockLocks()
  let attempts = 0
  const invoke = () => runWithReportLocks({
    ...base,
    scope: scopeA,
    lockStore: locks,
    run: async () => ({ ok: ++attempts > 1 }),
  })

  assert.deepEqual(await invoke(), { status: 'executed', value: { ok: false } })
  assert.equal(locks.entries.size, 0, 'failed execution must release both minute and in-flight locks')
  assert.deepEqual(await invoke(), { status: 'executed', value: { ok: true } })
  assert.equal(locks.entries.size, 1, 'successful retry keeps only the scheduled-minute lock')
})

test('in-flight lock rejects overlapping execution and is released after completion', async () => {
  const locks = mockLocks()
  let finish
  let sends = 0
  const first = runWithReportLocks({
    ...base,
    scope: scopeA,
    lockStore: locks,
    run: () => new Promise(resolve => { sends += 1; finish = () => resolve({ ok: true }) }),
  })
  await new Promise(resolve => setImmediate(resolve))
  const second = await runWithReportLocks({ ...base, scope: scopeA, lockStore: locks, run: async () => ({ ok: true }) })
  assert.deepEqual(second, { status: 'busy' })
  assert.equal(sends, 1)
  finish()
  assert.equal((await first).status, 'executed')
  assert.equal(locks.entries.size, 1, 'the success dedupe lock remains; the in-flight lock is removed')
})

test('schedule bucket uses the schedule timezone and preserves minute precision', () => {
  const instant = new Date('2026-10-16T00:15:47.000Z')
  assert.equal(reportScheduleBucket('UTC', instant), '202610160015')
  assert.equal(reportScheduleBucket('Asia/Tokyo', instant), '202610160915')
})
