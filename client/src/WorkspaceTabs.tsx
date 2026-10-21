import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { pageById } from './navigation'
import { restoreTabs, safeTabUrl, tabId, type WorkspaceTab } from './workspace-tabs'
import './workspace-tabs.css'
import { WorkspacePortalContext } from './WorkspacePortal'
import { applyViewState, readViewState, saveViewState } from './workspace-view-state'

function Panel({ id, active, children, onDirty, storageKey }: { id: string; active: boolean; children: ReactNode; storageKey: string; onDirty: (id: string, dirty: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const viewKey = `${storageKey}:view:${id}`
  const activeRef = useRef(active); activeRef.current = active
  useEffect(() => {
    const node = root.current
    if (!node) return
    const saved = readViewState(viewKey)
    let restoring = Boolean(saved)
    const timer = window.setTimeout(() => {
      if (saved) applyViewState(node, saved)
      restoring = false
    }, 400)
    const save = () => { if (!restoring && activeRef.current) saveViewState(node, viewKey) }
    node.addEventListener('input', save)
    node.addEventListener('change', save)
    node.addEventListener('scroll', save, true)
    window.addEventListener('scroll', save, { passive: true })
    return () => { clearTimeout(timer); node.removeEventListener('input', save); node.removeEventListener('change', save); node.removeEventListener('scroll', save, true); window.removeEventListener('scroll', save) }
  }, [viewKey])
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'))
  useLayoutEffect(() => {
    if (!host) return
    host.className = 'workspace-portal-host'
    document.body.appendChild(host)
    return () => { host.remove() }
  }, [host])
  useLayoutEffect(() => { if (host) { host.hidden = !active; host.inert = !active } }, [active, host])
  useEffect(() => {
    const node = root.current
    if (!node) return
    const observer = new MutationObserver(() => {
      if (!node.querySelector('form, [role="dialog"], .modal-card') && !host?.querySelector('form, [role="dialog"], .modal-card')) onDirty(id, false)
    })
    observer.observe(node, { childList: true, subtree: true })
    if (host) observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [id, onDirty, host])
  return <WorkspacePortalContext.Provider value={{ host, active }}><div ref={root} id={`workspace-panel-${id}`} role="tabpanel" aria-labelledby={`workspace-tab-${id}`} hidden={!active} className="workspace-tab-panel" onChangeCapture={event => {
    const field = event.target as HTMLElement
    if (field.closest('form, [role="dialog"], .modal-card')) onDirty(id, true)
  }}>{children}</div></WorkspacePortalContext.Provider>
}

export default function WorkspaceTabs({ page, storageKey, allowed, onNavigate, children }: { page: string; storageKey: string; allowed: (page: string) => boolean; onNavigate: (page: string, url?: string) => void; children: (page: string) => ReactNode }) {
  // Access loading is handled by the parent before mounting this security-scoped tree.
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    let saved: string | null = null
    try { saved = sessionStorage.getItem(storageKey) } catch { /* storage is optional */ }
    const restored = restoreTabs(saved, allowed)
    const id = tabId(page)
    return [...restored.filter(tab => tab.id !== id), { id, page, url: safeTabUrl(location.href, page) }]
  })
  const [mounted, setMounted] = useState(() => new Set([tabId(page)]))
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const scrollPositions = useRef<Record<string, number>>({})
  const activeTabId = tabId(page)
  useLayoutEffect(() => {
    const position = scrollPositions.current[activeTabId] ?? readViewState(`${storageKey}:view:${activeTabId}`)?.scrollY ?? 0
    const frame = requestAnimationFrame(() => window.scrollTo(0, position))
    return () => cancelAnimationFrame(frame)
  }, [activeTabId, storageKey])
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const currentRef = useRef(page); currentRef.current = page
  const markDirty = useRef((id: string, value: boolean) => setDirty(old => old[id] === value ? old : { ...old, [id]: value })).current
  useLayoutEffect(() => {
    setMounted(old => old.has(tabId(page)) ? old : new Set([...old, tabId(page)]))
    setTabs(old => {
      const id = tabId(page)
      const next = old.filter(tab => allowed(tab.page) || tab.id === id)
      const found = next.find(tab => tab.id === id)
      if (found?.page === page) return old.length === next.length ? old : next
      return found ? next.map(tab => tab.id === id ? { ...tab, page, url: safeTabUrl(location.href, page) } : tab) : [...next, { id, page, url: safeTabUrl(location.href, page) }]
    })
  }, [page, allowed])
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(tabs.map(tab => ({ ...tab, url: tab.id === tabId(page) ? safeTabUrl(location.href, page) : tab.url })))) } catch { /* no persistence in restricted browsers */ }
  }, [tabs, storageKey, page])
  useEffect(() => {
    const beforeNavigate = (event: Event) => {
      const current = currentRef.current
      scrollPositions.current[tabId(current)] = window.scrollY
      const panel = document.getElementById(`workspace-panel-${tabId(current)}`)
      if (panel) saveViewState(panel, `${storageKey}:view:${tabId(current)}`)
      const url = new URL(location.href)
      const date = document.querySelector<HTMLInputElement>('.workspace-tab-panel:not([hidden]) .dr-header-date input')?.value
      if (date) url.searchParams.set('date', date)
      setTabs(old => old.map(tab => tab.id === tabId(current) ? { ...tab, url: safeTabUrl(url.href, current) } : tab))
      const detail = (event as CustomEvent<{ page: string; url?: string; reuseOpen?: boolean }>).detail
      if (detail?.reuseOpen && !detail.url && !pageById[detail.page]?.parent) {
        const existing = tabsRef.current.find(tab => tab.id === tabId(detail.page))
        if (existing && dirtyRef.current[existing.id]) { detail.page = existing.page; detail.url = existing.url }
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.values(dirtyRef.current).some(Boolean)) { event.preventDefault(); event.returnValue = '' }
    }
    const beforeDiscard = (event: Event) => { if (Object.values(dirtyRef.current).some(Boolean) && !window.confirm('有未保存内容，离开当前工作区将丢弃。确定继续？')) event.preventDefault() }
    window.addEventListener('workspace:before-discard', beforeDiscard)
    window.addEventListener('workspace:before-navigate', beforeNavigate)
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('workspace:before-discard', beforeDiscard); window.removeEventListener('workspace:before-navigate', beforeNavigate); window.removeEventListener('beforeunload', beforeUnload) }
  }, [])
  const activate = (tab: WorkspaceTab) => {
    if (tab.id === tabId(page)) return
    onNavigate(tab.page, tab.url)
  }
  const close = (tab: WorkspaceTab) => {
    if (dirty[tab.id] && !window.confirm('此页签有未保存内容。关闭将丢弃，确定关闭？')) return
    const next = tabs.filter(item => item.id !== tab.id)
    if (tab.id === tabId(page)) { const target = next.at(-1); onNavigate(target?.page ?? 'overview', target?.url) }
    setTabs(next)
    markDirty(tab.id, false)
  }
  const activeId = tabId(page)
  return <><div className="workspace-tabs" role="tablist" aria-label="已打开的工作页签">{tabs.map((tab, index) => <div className={`workspace-tab ${tab.id === activeId ? 'is-active' : ''}`} key={tab.id}><button id={`workspace-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === activeId} aria-controls={`workspace-panel-${tab.id}`} tabIndex={tab.id === activeId ? 0 : -1} onClick={() => activate(tab)} onKeyDown={event => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : offset ? tabs[(index + offset + tabs.length) % tabs.length] : undefined
    if (target) { event.preventDefault(); activate(target); document.getElementById(`workspace-tab-${target.id}`)?.focus() }
  }}>{pageById[tab.id]?.label ?? tab.id}{dirty[tab.id] && <span className="workspace-dirty" aria-label="未保存"> ·</span>}</button><button type="button" className="workspace-tab-close" aria-label={`关闭${pageById[tab.id]?.label ?? tab.id}页签`} onClick={() => close(tab)}><X size={13}/></button></div>)}</div>{Object.values(dirty).some(Boolean) && <div className="workspace-unsaved" role="status">有未保存内容；切换页签会保留，关闭页签、刷新或切换账套前请先保存。</div>}{tabs.filter(tab => mounted.has(tab.id) || tab.id === activeId).map(tab => <Panel storageKey={storageKey} key={tab.id} id={tab.id} active={tab.id === activeId} onDirty={markDirty}>{children(tab.id === activeId ? page : tab.page)}</Panel>)}</>
}
