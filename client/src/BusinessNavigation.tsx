import { useEffect, useState } from 'react'
import { Activity, BarChart3, Boxes, Building2, CalendarDays, CheckCircle2, ChevronDown, FileText, FolderKanban, GitBranch, LayoutDashboard, ListTodo, Settings, Users } from 'lucide-react'
import { navigationEntry, navigationGroups, navigationUrl, visibleNavigation, type NavigationUser } from './navigation'

const icons = { overview: LayoutDashboard, tasks: ListTodo, projects: FolderKanban, timeline: CalendarDays, materials: Boxes, boms: GitBranch, documents: FileText, reports: Activity, kpi: BarChart3, workflow: CheckCircle2, users: Users, settings: Settings, tenants: Building2 }
const STORAGE_KEY = 'momentum.navigation-collapsed.v1'
function readCollapsed(activeGroup?: string): string[] {
  const defaults = navigationGroups.filter(group => group.id !== activeGroup).map(group => group.id)
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return defaults
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : defaults
  } catch { return defaults }
}

export default function BusinessNavigation({ page, user, pendingCount, onNavigate }: { page: string; user: NavigationUser; pendingCount: number; onNavigate: (page: string) => void }) {
  const activeGroup = navigationEntry(page).group?.id
  const [collapsed, setCollapsed] = useState(() => readCollapsed(activeGroup))
  // A deep link, Back/Forward or a scope change must reveal its active leaf.
  useEffect(() => { setCollapsed(current => current.filter(id => id !== activeGroup)) }, [activeGroup, page])
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)) } catch { /* storage is optional */ } }, [collapsed])
  return <nav className="business-navigation" aria-label="业务导航">
    {visibleNavigation(user).map(group => {
      const expanded = !collapsed.includes(group.id)
      const active = group.id === activeGroup
      return <section className={`navigation-group ${active ? 'has-active-page' : ''}`} key={group.id}>
        <button type="button" className="navigation-group-toggle" aria-expanded={expanded} aria-controls={`navigation-${group.id}`} title={group.description} onClick={() => setCollapsed(current => expanded ? [...current, group.id] : current.filter(id => id !== group.id))}>
          <span>{group.label}</span><ChevronDown size={14} className={expanded ? '' : 'is-collapsed'}/>
        </button>
        <div className="navigation-group-items" id={`navigation-${group.id}`} hidden={!expanded}>
          {group.items.map(item => {
            const Icon = icons[item.id as keyof typeof icons]
            return <a key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} href={navigationUrl(window.location.href, item.id)} aria-current={page === item.id ? 'page' : undefined} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault(); onNavigate(item.id)
            }}><Icon size={17}/><span>{item.label}</span>{item.id === 'tasks' && <span className="nav-count">{pendingCount}</span>}</a>
          })}
        </div>
      </section>
    })}
  </nav>
}
