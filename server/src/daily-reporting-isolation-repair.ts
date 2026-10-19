import { createHash, randomBytes } from 'node:crypto'
import { Router, type Request } from 'express'
import { requireAuthenticated, requirePlatformAdmin, requireRole } from './auth.js'
import { db, getAppStateVersioned, recordSecurityEvent, setAppStateIfRevision } from './database.js'
import { REPAIR_POLICY } from './daily-reporting-isolation-repair-policy.js'
import type { DailyReportingAdminState } from './daily-reporting-admin.js'
import type { DailyReportState } from './daily-reporting.js'

type Scope = { tenantId: string; organizationId: string; accountId: string }
type Policy = { target: Scope; source: Scope; count: number; idsSha256: string; rowsSha256: string; ids: readonly string[] }
type Options = { policy?: Policy; now?: () => number }
type Binding = { actor: string; session: string; scope: string }
type Pending = Binding & { expires: number; adminRev: number; businessRev: number; sourceRev: number; adminDigest: string; businessDigest: string; sourceDigest: string }
type Journal = Pending & { tokenHash: string; pre: DailyReportingAdminState; postDigest: string; postRev: number; status: 'pending' | 'consumed'; consumedAt?: number }
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
const fingerprint = (value: unknown) => digest(canonical(value))
const scopeString = (s: Scope) => `${s.tenantId}:${s.organizationId}:${s.accountId}`
const key = (prefix: string, s: Scope) => `${prefix}:${scopeString(s)}`
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function references(value: unknown, ids: Set<string>): number {
  if (typeof value === 'string') return ids.has(value) ? 1 : 0
  if (Array.isArray(value)) return value.reduce((n, v) => n + references(v, ids), 0)
  if (record(value)) return Object.values(value).reduce<number>((n, v) => n + references(v, ids), 0)
  return 0
}
function emptyBusiness(value: DailyReportState): boolean {
  return ['reports', 'k3Rows', 'k3HistoricalHeaders', 'links', 'snapshots', 'corrections', 'deliveries'].every(k => {
    const v = (value as unknown as Record<string, unknown>)[k]
    return Array.isArray(v) && v.length === 0
  }) && value.k3MigrationStage == null
}
const rowsSorted = (rows: DailyReportingAdminState['parties']) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Production always calls this factory without options. Policy/clock injection is
// for isolated HTTP fixtures only; neither request bodies nor env can change it.
export function createDailyReportingIsolationRepairRouter(options: Options = {}): Router {
  const policy = options.policy ?? REPAIR_POLICY, now = options.now ?? Date.now
  const router = Router(), previews = new Map<string, Pending>()
  const guarded = [requireAuthenticated, requireRole('admin'), requirePlatformAdmin]
  const ids = [...policy.ids].sort(), candidateIds = new Set(ids)
  if (ids.length !== policy.count || candidateIds.size !== policy.count || fingerprint(ids) !== policy.idsSha256 || scopeString(policy.target) === scopeString(policy.source)) throw new Error('invalid_fixed_repair_policy')
  const adminKey = key('daily-reporting-admin', policy.target)
  const businessKey = key('daily-reporting', policy.target)
  const sourceKey = key('daily-reporting-admin', policy.source)
  const journalPrefix = key('daily-reporting-isolation-repair-journal', policy.target)
  function binding(req: Request): Binding {
    const u = req.authUser!
    if (scopeString(u) !== scopeString(policy.target)) throw new Error('fixed_target_scope_required')
    if (!req.sessionTokenHash) throw new Error('verified_session_required')
    return { actor: u.id, session: req.sessionTokenHash, scope: scopeString(u) }
  }
  function checkPayload(body: any): void {
    if (!body || body.scope !== 'NBHH' || body.count !== policy.count || body.idsHash !== policy.idsSha256 || body.rowsHash !== policy.rowsSha256 || !Array.isArray(body.ids) || body.ids.length !== policy.count || !body.ids.every((id: unknown) => typeof id === 'string') || canonical([...body.ids].sort()) !== canonical(ids)) throw new Error('policy_payload_mismatch')
    if (!Number.isSafeInteger(body.expectedAdminRevision) || !Number.isSafeInteger(body.expectedBusinessRevision)) throw new Error('expected_revisions_required')
  }
  function snapshots() {
    const admin = getAppStateVersioned<DailyReportingAdminState | null>(adminKey, null)
    const business = getAppStateVersioned<DailyReportState | null>(businessKey, null)
    const source = getAppStateVersioned<DailyReportingAdminState | null>(sourceKey, null)
    if (!record(admin.value) || !record(business.value) || !record(source.value)) throw new Error('persisted_scope_state_required')
    for (const name of ['parties', 'exchangeRates', 'assignments', 'partyMappings', 'legacyMemberships', 'importBatches'] as const) {
      if (!Array.isArray(admin.value[name]) || !Array.isArray(source.value[name])) throw new Error('invalid_master_state')
    }
    return { admin: { ...admin, value: admin.value }, business: { ...business, value: business.value }, source: { ...source, value: source.value } }
  }
  function checkSource(source: DailyReportingAdminState): void {
    const rows = source.parties
    if (rows.length !== policy.count || canonical(rows.map(p => p.id).sort()) !== canonical(ids) || rows.some(p => p.legacyCompanyCode !== 'FNS' || p.source !== 'legacy-import') || fingerprint(rowsSorted(rows)) !== policy.rowsSha256) throw new Error('source_integrity_mismatch')
  }
  function checkZeroReferences(admin: DailyReportingAdminState, business: DailyReportState): void {
    const { parties: _parties, ...otherAdmin } = admin
    if (admin.assignments.length || admin.partyMappings.length || !emptyBusiness(business) || references(otherAdmin, candidateIds) || references(business, candidateIds)) throw new Error('target_references_present')
  }
  function verify(req: Request, body: any, allowClean: boolean) {
    const actor = binding(req)
    checkPayload(body)
    const x = snapshots()
    if (body.expectedAdminRevision !== x.admin.revision || body.expectedBusinessRevision !== x.business.revision) throw new Error('revision_mismatch')
    checkSource(x.source.value)
    checkZeroReferences(x.admin.value, x.business.value)
    if (allowClean && x.admin.value.parties.length === 0 && x.admin.value.masterDataConfigured === false) return { ...x, actor, alreadyRepaired: true }
    // Never drop extra NBHH rows, including any row outside the approved IDs.
    if (x.admin.value.parties.length !== policy.count || canonical(x.admin.value.parties.map(p => p.id).sort()) !== canonical(ids)) throw new Error('candidate_set_mismatch')
    if (fingerprint(rowsSorted(x.admin.value.parties)) !== policy.rowsSha256 || canonical(rowsSorted(x.admin.value.parties)) !== canonical(rowsSorted(x.source.value.parties))) throw new Error('row_integrity_mismatch')
    return { ...x, actor, alreadyRepaired: false }
  }
  function audit(req: Request, action: string): void {
    const u = req.authUser!
    recordSecurityEvent({ userId: u.id, tenantId: u.tenantId, organizationId: u.organizationId, accountId: u.accountId, event: action, subject: `count=${policy.count};ids=${policy.idsSha256};rows=${policy.rowsSha256}`, ip: req.ip, userAgent: req.get('user-agent') })
  }
  router.post('/daily-reporting/isolation-repair/preview', ...guarded, (req, res) => {
    try {
      const x = verify(req, req.body, true)
      if (x.alreadyRepaired) return res.json({ candidateCount: 0, alreadyRepaired: true, candidateReferences: 0, masterDataConfigured: false, adminRevision: x.admin.revision, businessRevision: x.business.revision, sourceRevision: x.source.revision })
      for (const [h, p] of previews) if (p.expires <= now()) previews.delete(h)
      if (previews.size >= 100) throw new Error('too_many_pending_previews')
      const raw = randomBytes(32).toString('base64url')
      previews.set(digest(raw), { ...x.actor, expires: now() + 300_000, adminRev: x.admin.revision, businessRev: x.business.revision, sourceRev: x.source.revision, adminDigest: fingerprint(x.admin.value), businessDigest: fingerprint(x.business.value), sourceDigest: fingerprint(x.source.value) })
      return res.json({ candidateCount: policy.count, candidateReferences: 0, idsHash: policy.idsSha256, rowsHash: policy.rowsSha256, target: policy.target, source: policy.source, adminRevision: x.admin.revision, businessRevision: x.business.revision, sourceRevision: x.source.revision, previewToken: raw, expiresInSeconds: 300 })
    } catch (e) { return res.status(409).json({ error: (e as Error).message }) }
  })
  router.post('/daily-reporting/isolation-repair/commit', ...guarded, (req, res) => {
    try {
      const actor = binding(req), raw = req.body?.previewToken
      if (typeof raw !== 'string') throw new Error('invalid_expired_or_consumed_preview')
      const h = digest(raw), p = previews.get(h)
      previews.delete(h) // Even a rejected attempt cannot be replayed.
      if (!p || p.expires <= now() || p.actor !== actor.actor || p.session !== actor.session || p.scope !== actor.scope) throw new Error('invalid_expired_or_consumed_preview')
      const result = db.transaction(() => {
        const x = verify(req, req.body, false)
        if (x.admin.revision !== p.adminRev || x.business.revision !== p.businessRev || x.source.revision !== p.sourceRev || fingerprint(x.admin.value) !== p.adminDigest || fingerprint(x.business.value) !== p.businessDigest || fingerprint(x.source.value) !== p.sourceDigest) throw new Error('preview_state_changed')
        const before = structuredClone(x.admin.value), after = structuredClone(before)
        after.parties = []; after.masterDataConfigured = false
        const revision = setAppStateIfRevision(adminKey, after, x.admin.revision)
        const rollbackToken = randomBytes(32).toString('base64url'), tokenHash = digest(rollbackToken)
        const journal: Journal = { ...p, tokenHash, expires: now() + 1_800_000, pre: before, postDigest: fingerprint(after), postRev: revision, status: 'pending' }
        setAppStateIfRevision(`${journalPrefix}:${tokenHash}`, journal, 0)
        audit(req, 'daily_reporting_isolation_repair_commit')
        return { revision, rollbackToken, sourceRevision: x.source.revision, businessRevision: x.business.revision }
      })()
      return res.json({ removedCount: policy.count, candidateReferences: 0, masterDataConfigured: false, idsHash: policy.idsSha256, rowsHash: policy.rowsSha256, adminRevision: result.revision, sourceRevision: result.sourceRevision, businessRevision: result.businessRevision, rollbackToken: result.rollbackToken, rollbackExpiresInSeconds: 1800 })
    } catch (e) { return res.status(409).json({ error: (e as Error).message }) }
  })
  router.post('/daily-reporting/isolation-repair/rollback', ...guarded, (req, res) => {
    try {
      const actor = binding(req), raw = req.body?.rollbackToken
      if (typeof raw !== 'string') throw new Error('invalid_expired_or_consumed_rollback')
      const tokenHash = digest(raw), journalKey = `${journalPrefix}:${tokenHash}`
      const revision = db.transaction(() => {
        const journal = getAppStateVersioned<Journal | null>(journalKey, null), p = journal.value
        if (!p || p.status !== 'pending' || p.expires <= now() || p.tokenHash !== tokenHash || p.actor !== actor.actor || p.session !== actor.session || p.scope !== actor.scope) throw new Error('invalid_expired_or_consumed_rollback')
        const x = snapshots()
        checkSource(x.source.value); checkZeroReferences(x.admin.value, x.business.value)
        if (x.admin.revision !== p.postRev || fingerprint(x.admin.value) !== p.postDigest || x.business.revision !== p.businessRev || fingerprint(x.business.value) !== p.businessDigest || x.source.revision !== p.sourceRev || fingerprint(x.source.value) !== p.sourceDigest) throw new Error('rollback_state_changed')
        if (p.pre.parties.length !== policy.count || canonical(p.pre.parties.map(row => row.id).sort()) !== canonical(ids) || fingerprint(rowsSorted(p.pre.parties)) !== policy.rowsSha256 || fingerprint(p.pre) !== p.adminDigest) throw new Error('rollback_preimage_invalid')
        const next = setAppStateIfRevision(adminKey, p.pre, x.admin.revision)
        setAppStateIfRevision(journalKey, { ...p, status: 'consumed', consumedAt: now() }, journal.revision)
        audit(req, 'daily_reporting_isolation_repair_rollback')
        return next
      })()
      return res.json({ restoredCount: policy.count, adminRevision: revision })
    } catch (e) { return res.status(409).json({ error: (e as Error).message }) }
  })
  return router
}
