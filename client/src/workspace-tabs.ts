import { pageById, resolvePage } from './navigation'

export type WorkspaceTab = { id: string; page: string; url: string }
export const tabId = (page: string): string => pageById[page]?.parent ?? resolvePage(page)
export const scopeKey = (user: { id: string; tenantId: string; organizationId: string; accountId: string; role: string }) =>
  ['plm-tabs-v1', user.id, user.tenantId, user.organizationId, user.accountId, user.role].map(encodeURIComponent).join(':')
export function safeTabUrl(raw: string, page: string) {
  const source = new URL(raw, 'https://workspace.invalid')
  const params = new URLSearchParams()
  // Persist navigation/filter metadata only, never credentials or business drafts.
  for (const key of ['date', 'definitionId', 'scheduleId']) {
    const value = source.searchParams.get(key)
    if (value && value.length <= 160) params.set(key, value)
  }
  params.set('page', resolvePage(page))
  return `${source.pathname.startsWith('/') ? source.pathname.replace(/^\/+/, '/') : '/'}?${params}`
}
export function restoreTabs(raw: string | null, allowed: (page: string) => boolean): WorkspaceTab[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(data)) return []
    const seen = new Set<string>()
    return data.slice(0, 20).flatMap(item => {
      if (!item || typeof item.page !== 'string' || !pageById[item.page] || !allowed(item.page)) return []
      const id = tabId(item.page)
      if (seen.has(id)) return []
      seen.add(id)
      // Editors require transient record context owned by their original workbench.
      const page = pageById[item.page].parent ? id : item.page
      return [{ id, page, url: safeTabUrl(typeof item.url === 'string' ? item.url : '/', page) }]
    })
  } catch { return [] }
}

// A soft warning, never an automatic eviction of a live panel or draft.
export const TAB_WARNING_THRESHOLD = 8
export function planTabClose(tabs: WorkspaceTab[], ids: string[], dirty: Record<string, boolean>, activeId: string) {
  const selected = new Set(ids)
  const closing = tabs.filter(tab => selected.has(tab.id))
  const remaining = tabs.filter(tab => !selected.has(tab.id))
  return { closing, remaining, unsaved: closing.filter(tab => dirty[tab.id]), target: remaining.find(tab => tab.id === activeId) ?? remaining.at(-1) }
}
