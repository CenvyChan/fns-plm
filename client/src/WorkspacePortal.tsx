import { createContext, useContext } from 'react'

export const WorkspacePortalContext = createContext<{ host: HTMLElement | null; active: boolean; tabId?: string; onTitle?: (title: string) => void }>({ host: null, active: true })
export function useWorkspacePortal() {
  const context = useContext(WorkspacePortalContext)
  return { portalHost: context.host ?? (typeof document === 'undefined' ? null : document.body), tabActive: context.active }
}
