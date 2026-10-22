import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X, PanelsTopLeft } from 'lucide-react'
import { createPortal } from 'react-dom'
import { pageById } from './navigation'
import { restoreTabs, safeTabUrl, tabId, type WorkspaceTab, TAB_WARNING_THRESHOLD, planTabClose } from './workspace-tabs'
import './workspace-tabs.css'
import { WorkspacePortalContext } from './WorkspacePortal'
import { applyViewState, readViewState, saveViewState } from './workspace-view-state'
import WorkspaceFeedback from './WorkspaceFeedback'
import WorkspaceTabManager from './WorkspaceTabManager'

function Panel({ id, active, children, onDirty, onTitle, storageKey }: { id: string; active: boolean; children: ReactNode; storageKey: string; onDirty: (id: string, dirty: boolean) => void; onTitle: (id: string, title: string) => void }) {
  const reportTitle = useCallback((title: string) => onTitle(id, title), [id, onTitle])
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
  return <WorkspacePortalContext.Provider value={{ host, active, tabId: id, onTitle: reportTitle }}><div ref={root} id={`workspace-panel-${id}`} role="tabpanel" aria-labelledby={`workspace-tab-${id}`} hidden={!active} className="workspace-tab-panel" onChangeCapture={event => {
    const field = event.target as HTMLElement
    if (field.closest('form, [role="dialog"], .modal-card')) onDirty(id, true)
  }}>{children}</div><WorkspaceFeedback root={root} host={host} active={active}/></WorkspacePortalContext.Provider>
}

export default function WorkspaceTabs({ page, storageKey, allowed, onNavigate, children, externalDirty = {}, onTabsClosed, managerTarget }: { page: string; storageKey: string; allowed: (page: string) => boolean; onNavigate: (page: string, url?: string) => void; children: (page: string) => ReactNode; externalDirty?: Record<string, boolean>; onTabsClosed?: (ids: string[]) => void; managerTarget?: HTMLElement | null }) {
  // Access loading is handled by the parent before mounting this security-scoped tree.
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    let saved: string | null = null
    try { saved = sessionStorage.getItem(storageKey) } catch { /* storage is optional */ }
    const restored = restoreTabs(saved, allowed)
    const id = tabId(page)
    return [...restored.filter(tab => tab.id !== id), { id, page, url: safeTabUrl(location.href, page) }]
  })
  const [mounted, setMounted] = useState(() => new Set([tabId(page)]))
  const [localDirty, setDirty] = useState<Record<string, boolean>>({})
  const dirty = { ...localDirty, ...externalDirty }
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [managerOpen, setManagerOpen] = useState(false)
  const markTitle = useRef((id: string, title: string) => setTitles(old => old[id] === title ? old : { ...old, [id]: title })).current
  const label = (tab: WorkspaceTab) => titles[tab.id] || pageById[tab.id]?.label || tab.id
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
  const closeTabs = (ids: string[]): boolean => {
    const plan = planTabClose(tabsRef.current, ids, dirtyRef.current, tabId(page))
    if (!plan.closing.length) return false
    if (plan.unsaved.length && !window.confirm(`所选页签中有 ${plan.unsaved.length} 项未保存内容：\n${plan.unsaved.map(label).join('\n')}\n关闭将丢弃这些内容，确定关闭所选全部 ${plan.closing.length} 项？`)) return false
    // Confirm the entire batch before changing any tab; cancellation is atomic.
    if (plan.closing.some(tab => tab.id === tabId(page))) onNavigate(plan.target?.page ?? 'overview', plan.target?.url)
    const remaining = plan.remaining.length ? plan.remaining : [{ id: 'overview', page: 'overview', url: safeTabUrl('/', 'overview') }]
    setTabs(remaining)
    setMounted(old => new Set([...old].filter(id => !ids.includes(id)).concat(remaining.map(tab => tab.id === 'overview' ? tab.id : '').filter(Boolean))))
    setDirty(old => Object.fromEntries(Object.entries(old).filter(([id]) => !ids.includes(id))))
    onTabsClosed?.(plan.closing.map(tab => tab.id))
    setTitles(old => Object.fromEntries(Object.entries(old).filter(([id]) => !ids.includes(id))))
    return true
  }
  const close = (tab: WorkspaceTab) => { closeTabs([tab.id]) }
  const activeId = tabId(page)
  const rail = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = rail.current
    const selected = row?.querySelector<HTMLElement>('.workspace-tab.is-active')
    if (!row || !selected) return
    const reveal = () => {
      const left = selected.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft
      if (left < row.scrollLeft) row.scrollLeft = left
      else if (left + selected.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + selected.offsetWidth - row.clientWidth
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(row)
    return () => observer.disconnect()
  }, [activeId, tabs.length, titles[activeId]])
  return <div className="workspace-frame">{managerTarget && createPortal(<button type="button" className="workspace-manage-button" aria-label={`管理页签，已打开 ${tabs.length} 个页签`} aria-haspopup="dialog" aria-expanded={managerOpen} aria-controls={managerOpen ? 'workspace-manager' : undefined} title={tabs.length >= TAB_WARNING_THRESHOLD ? `已打开 ${tabs.length} 个页签，建议关闭暂不使用的页签` : '管理已打开页签'} onClick={() => setManagerOpen(true)}><PanelsTopLeft size={15}/><span>页签</span><b>{tabs.length}</b></button>, managerTarget)}{tabs.length >= TAB_WARNING_THRESHOLD && <div className="workspace-tabs-warning" role="status">页签较多：切换不会关闭后台页签；请使用“管理页签”多选整理。</div>}<div ref={rail} className="workspace-tabs" role="tablist" aria-label="已打开的工作页签">{tabs.map((tab, index) => <div className={`workspace-tab ${tab.id === activeId ? 'is-active' : ''}`} key={tab.id}><button id={`workspace-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === activeId} title={label(tab)} aria-controls={`workspace-panel-${tab.id}`} tabIndex={tab.id === activeId ? 0 : -1} onClick={() => activate(tab)} onKeyDown={event => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : offset ? tabs[(index + offset + tabs.length) % tabs.length] : undefined
    if (target) { event.preventDefault(); activate(target); document.getElementById(`workspace-tab-${target.id}`)?.focus() }
  }}>{label(tab)}{dirty[tab.id] && <span className="workspace-dirty" aria-label="未保存"> ·</span>}</button><button type="button" className="workspace-tab-close" aria-label={`关闭${label(tab)}页签`} onClick={() => close(tab)}><X size={13}/></button></div>)}</div>{Object.values(dirty).some(Boolean) && <div className="workspace-unsaved" role="status">有未保存内容；切页保留，关闭、刷新或切换账套前请保存。</div>}{tabs.filter(tab => mounted.has(tab.id) || tab.id === activeId).map(tab => <Panel storageKey={storageKey} key={tab.id} id={tab.id} active={tab.id === activeId} onDirty={markDirty} onTitle={markTitle}>{children(tab.id === activeId ? page : tab.page)}</Panel>)}{managerOpen && <WorkspaceTabManager tabs={tabs} activeId={activeId} dirty={dirty} label={label} onClose={() => setManagerOpen(false)} onCloseTabs={closeTabs}/>}</div>
}
