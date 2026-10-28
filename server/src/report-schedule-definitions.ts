import { randomUUID } from 'node:crypto'
import { db } from './database.js'
import { buildDefinitionPreview, getReportDefinitionVersion, type ReportDefinition } from './report-definitions.js'
import type { WorkspaceScope } from './scope.js'

export type DefinitionBinding = { definitionId?: string; definitionVersion?: number }
export class ReportBindingError extends Error {
  constructor(message: string, readonly status: 400 | 404 = 400) { super(message) }
}
export function hasDefinitionBinding(binding: DefinitionBinding): boolean {
  return binding.definitionId !== undefined || binding.definitionVersion !== undefined
}
export function pinnedDefinition(scope: WorkspaceScope, binding: DefinitionBinding): ReportDefinition {
  if (typeof binding.definitionId !== 'string' || !binding.definitionId || !Number.isSafeInteger(binding.definitionVersion) || binding.definitionVersion! < 1) {
    throw new ReportBindingError('报表定义版本关联无效；不会回退到其他报告。')
  }
  const definition = getReportDefinitionVersion(scope, binding.definitionId, binding.definitionVersion!)
  if (!definition) throw new ReportBindingError('指定报表定义版本不存在或不属于当前账套；不会改用最新版本。', 404)
  return definition
}
/** Omission preserves the old binding. Only an explicit null pair detaches it. */
export function bindingFromBody(scope: WorkspaceScope, body: Record<string, unknown>, previous: DefinitionBinding = {}): DefinitionBinding {
  const hasId = Object.hasOwn(body, 'definitionId'), hasVersion = Object.hasOwn(body, 'definitionVersion')
  if (!hasId && !hasVersion) return { ...(previous.definitionId !== undefined ? { definitionId: previous.definitionId } : {}), ...(previous.definitionVersion !== undefined ? { definitionVersion: previous.definitionVersion } : {}) }
  if (!hasId || !hasVersion) throw new ReportBindingError('definitionId 和 definitionVersion 必须一起提交。')
  if (body.definitionId === null && body.definitionVersion === null) return {}
  if (typeof body.definitionId !== 'string' || !body.definitionId.trim() || body.definitionId.length > 100 || !Number.isSafeInteger(body.definitionVersion) || Number(body.definitionVersion) < 1) throw new ReportBindingError('必须指定有效的报表定义 ID 和正整数版本，或同时设为 null 解除关联。')
  const binding = { definitionId: body.definitionId, definitionVersion: Number(body.definitionVersion) }
  pinnedDefinition(scope, binding)
  return binding
}
const escapeMarkdown = (value: unknown, max = 120) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max).replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&')
export function buildPinnedReport(scope: WorkspaceScope, binding: DefinitionBinding) {
  const preview = buildDefinitionPreview(scope, pinnedDefinition(scope, binding)), d = preview.definition
  const text = [
    `### ${escapeMarkdown(d.name)} · v${d.version}`,
    `生成时间：${preview.generatedAt}`,
    `模板：${d.template === 'daily-sales' ? '销售日报' : '采购日报'}；日期：${d.filters.from || '不限'} 至 ${d.filters.to || '不限'}；客商：${escapeMarkdown(d.filters.partyName || '不限', 200)}`,
    `记录数：${preview.summary.count}；数量：${preview.summary.quantity}；金额（CNY）：${preview.summary.amountCny.toFixed(2)}`,
    `口径：${preview.amountBasis}`,
    preview.source === 'local-mock' ? `演示数据提示：${preview.notice}` : '读取本次同步后已保存日报；定义按计划绑定版本固定。',
    '',
    ...preview.rows.slice(0, 8).map(row => `- ${row.date} · ${escapeMarkdown(row.documentNo)} · ${escapeMarkdown(row.partyName)} · 数量 ${row.quantity} · CNY ${row.amountCny.toFixed(2)}`),
    ...(preview.rows.length > 8 ? [`- 另有 ${preview.rows.length - 8} 条；完整明细已随本次报告归档。`] : []),
  ].join('\n')
  return { ...preview, title: d.name, text, definitionId: d.id, definitionVersion: d.version }
}
export type PinnedReport = ReturnType<typeof buildPinnedReport>
export type ScheduleReportSnapshot = { id: string; scheduleId: string; definitionId: string; definitionVersion: number; createdAt: string; report: PinnedReport }
// A separate immutable row per generation avoids array read/modify/write races and
// never overwrites dailyReport's existing date-based snapshots or revision audit.
db.exec(`CREATE TABLE IF NOT EXISTS report_schedule_snapshots (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL, schedule_id TEXT NOT NULL, created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_schedule_snapshots_scope ON report_schedule_snapshots(tenant_id,organization_id,account_id,schedule_id,created_at);`)
export function archiveScheduleReport(scope: WorkspaceScope, scheduleId: string, report: PinnedReport, text = report.text): ScheduleReportSnapshot {
  const snapshot: ScheduleReportSnapshot = { id: randomUUID(), scheduleId, definitionId: report.definitionId, definitionVersion: report.definitionVersion, createdAt: new Date().toISOString(), report: { ...report, text } }
  db.prepare('INSERT INTO report_schedule_snapshots(id,tenant_id,organization_id,account_id,schedule_id,created_at,payload) VALUES(?,?,?,?,?,?,?)').run(snapshot.id, scope.tenantId, scope.organizationId, scope.accountId, scheduleId, snapshot.createdAt, JSON.stringify(snapshot))
  return snapshot
}
export function scheduleReportSnapshots(scope: WorkspaceScope, scheduleId: string): ScheduleReportSnapshot[] {
  const rows = db.prepare('SELECT payload FROM report_schedule_snapshots WHERE tenant_id=? AND organization_id=? AND account_id=? AND schedule_id=? ORDER BY created_at DESC,id DESC').all(scope.tenantId, scope.organizationId, scope.accountId, scheduleId) as Array<{ payload: string }>
  return rows.map(row => JSON.parse(row.payload) as ScheduleReportSnapshot)
}
