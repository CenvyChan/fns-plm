import { useEffect, useContext, useRef } from 'react'
import { WorkspacePortalContext } from './WorkspacePortal'
export { businessTabTitle, dailyReportTabTitle, taskTabTitle } from './workspace-tab-title'

type ExtendedPortalContext = { tabId?: string; onTitle?: (title: string) => void }

/** Empty title delegates to the tab manager's navigation-label fallback. */
export function useWorkspaceTabIdentity(title: string): void {
  const context = useContext(WorkspacePortalContext) as unknown as ExtendedPortalContext
  const onTitle = context.onTitle
  const tabId = context.tabId
  const latest = useRef({ onTitle, tabId })
  latest.current = { onTitle, tabId }
  useEffect(() => {
    if (!tabId || !onTitle) return
    onTitle(title || '')
  }, [tabId, onTitle, title])
  useEffect(() => () => {
    const current = latest.current
    if (current.tabId && current.onTitle) current.onTitle('')
  }, [])
}

export function WorkspaceTabIdentity({ title }: { title: string }) {
  useWorkspaceTabIdentity(title)
  return null
}
