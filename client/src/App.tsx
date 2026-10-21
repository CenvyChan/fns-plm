import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes, Building2, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, Circle, Clock3, Command, FileText, FolderKanban, GitBranch, LayoutDashboard,
  ListTodo, LogOut, Menu, Plus, Search, Settings, Sparkles, Target, Trash2, Users, X, Zap,
} from 'lucide-react'
import { createId, loadLocalWorkspace, requestWorkspace, saveLocalWorkspace, syncMutation } from './data'
import { apiJson, getApiBaseUrl, isNativeApp, jsonRequest, setApiScope, setApiToken, type AuthUser, type UserScope } from './api'
import Plm from './Plm'
import WorkflowWorkbench from './WorkflowWorkbench'
import BpmnModelerWorkbench from './BpmnModelerWorkbench'
import ReportsWorkbench from './ReportsWorkbench'
import ReportDefinitionsWorkbench from './ReportDefinitionsWorkbench'
import DailyReportingWorkbench from './DailyReportingWorkbench'
import DailyReportingManagement from './DailyReportingManagement'
import DailyReportImport from './DailyReportImport'
import { pages, pageById, resolvePage, pageFromLocation, canAccessPage, isDailyWorkbenchPage, isDailyManagementPage, isDailyImportPage, isReportPage, type DailyAccess } from './navigation'
import './navigation.css'
import WorkspaceTabs from './WorkspaceTabs'
import { scopeKey } from './workspace-tabs'
import { navigationAreas, navigationPath } from './navigation-areas'
import './design-system.css'
import LoginScreen from './LoginScreen'
import UserAdmin from './UserAdmin'
import TenantAdmin from './TenantAdmin'
import ConnectorWorkbench from './ConnectorWorkbench'
import ProjectWorkbench from './ProjectWorkbench'
import './integrations.css'
import './app-interactions.css'
import type { Priority, Project, Task, TaskStatus, WorkspaceData } from './types'

function WorkflowEntry({ currentUser }: { currentUser: AuthUser }) {
  const [mode, setMode] = useState<'tasks' | 'models'>('tasks')
  return <><div className="workflow-entry-tabs"><button className={mode === 'tasks' ? 'active' : ''} onClick={() => setMode('tasks')}>流程待办</button><button className={mode === 'models' ? 'active' : ''} onClick={() => setMode('models')}>BPMN 模型设计</button></div>{mode === 'tasks' ? <WorkflowWorkbench/> : <BpmnModelerWorkbench key={`${currentUser.tenantId}:${currentUser.organizationId}:${currentUser.accountId}`} currentUser={currentUser}/>}</>
}

const todayISO = () => {
  const d = new Date()
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
const addDays = (n: number) => {
  const d = new Date(`${todayISO()}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const dateLabel = (value: string) => {
  if (value === todayISO()) return '今天'
  if (value === addDays(1)) return '明天'
  const date = new Date(`${value}T12:00:00`)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
const fullDateLabel = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
const weekDays = ['一', '二', '三', '四', '五', '六', '日']

function Logo() {
  return <div className="brand-lockup"><div className="brand-symbol"><i/><i/><i/></div><span>momentum<span className="brand-dot">.</span></span></div>
}

function Sidebar({ page, setPage, onAddTask, onCreateProject, onOpenProject, open, projects, pendingCount, user, isAdmin, scopes, onSwitchScope, weekCompleted, weekTotal, onViewWeek, onLogout, dailyAccess }: { dailyAccess: DailyAccess | null; page: string; setPage: (p: string) => void; onAddTask: () => void; onCreateProject: () => void; onOpenProject: (id: string) => void; open: boolean; projects: Project[]; pendingCount: number; user: AuthUser; isAdmin: boolean; scopes: UserScope[]; onSwitchScope: (id: string) => void; weekCompleted: number; weekTotal: number; onViewWeek: () => void; onLogout: () => void }) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const icons: Record<string, typeof Activity> = { dashboard: LayoutDashboard, tasks: ListTodo, projects: FolderKanban, calendar: CalendarDays, chart: BarChart3, boxes: Boxes, branch: GitBranch, file: FileText, check: CheckCircle2, activity: Activity, archive: FileText, users: Users, settings: Settings, building: Building2 }
  const activePage = pageById[page]?.parent ?? page
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
    <Logo />
    <div className="workspace-picker"><button className="workspace-switch" aria-expanded={scopeOpen} onClick={() => setScopeOpen(value => !value)} title="切换已授权的组织或账套"><span className="workspace-avatar">{user.tenantName.slice(0, 1)}</span><span className="workspace-label"><b>{user.accountName}</b><small>{user.tenantName} · {user.organizationName}</small></span><ChevronDown size={15}/></button>{scopeOpen && <div className="workspace-scope-menu" role="menu" aria-label="已授权工作区">{scopes.map(scope => <button type="button" role="menuitem" key={scope.membershipId} className={scope.accountId === user.accountId ? 'is-current' : ''} onClick={() => { setScopeOpen(false); if (scope.accountId !== user.accountId) onSwitchScope(scope.accountId) }}><span>{scope.tenantName} · {scope.organizationName}</span><b>{scope.accountName}</b><small>{scope.role === 'admin' ? '管理员' : scope.role === 'plm_manager' ? 'PLM 管理员' : scope.role === 'reviewer' ? '审批人' : '成员'}{scope.accountId === user.accountId ? ' · 当前' : ''}</small></button>)}{user.isPlatformAdmin && <button type="button" role="menuitem" className="scope-admin-link" onClick={() => { setScopeOpen(false); setPage('tenants') }}><Building2 size={14}/>管理租户与账套</button>}</div>}</div>
    <div className="navigation-groups" aria-label="主导航">
      {navigationAreas.map(area => {
        const sections = area.sections.map(section => ({ ...section, entries: section.pages.map(id => pageById[id]).filter(item => canAccessPage(item.id, user, dailyAccess)) })).filter(section => section.entries.length)
        if (!sections.length) return null
        return <details className="navigation-group" key={area.id} open={!area.collapsed || sections.some(section => section.entries.some(item => item.id === activePage))}><summary className="nav-caption nav-group-toggle">{area.label}</summary>{sections.map(section => <details className="nav-section" key={section.label} open={!('collapsed' in section && section.collapsed) || section.entries.some(item => item.id === activePage)}><summary>{section.label}</summary><nav className="side-nav" aria-label={section.label}>{section.entries.map(item => {
          const Icon = icons[item.icon] ?? FileText
          return <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} aria-current={activePage === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><Icon size={18}/><span>{item.menuLabel ?? item.label}</span>{item.id === 'tasks' && <span className="nav-count">{pendingCount}</span>}</button>
        })}</nav></details>)}</details>
      })}
    </div>
    <div className="sidebar-project-label"><span>置顶项目</span><button type="button" aria-label="新增项目" onClick={onCreateProject}><Plus size={15}/></button></div>
    {projects.slice(0, 5).map(project => <button key={project.id} className="mini-project" onClick={() => onOpenProject(project.id)}><i className="project-dot" style={{ background: project.color }}/>{project.name}</button>)}
    <div className="sidebar-bottom">
      <div className="focus-card"><div className="focus-card-top"><span className="focus-icon"><Zap size={15} fill="currentColor"/></span><span>保持节奏</span><button type="button" className="focus-more" onClick={onViewWeek} aria-label="查看本周任务"><ArrowRight size={15}/></button></div><p>每一小步，都是在<br/>向重要的事靠近。</p><div className="focus-progress"><span style={{ width: `${weekTotal ? Math.round(weekCompleted / weekTotal * 100) : 0}%` }}/></div><small>本周已完成 {weekCompleted} / {weekTotal} 项</small></div>
      <div className="profile-row"><div className="profile-avatar">{user.displayName.slice(0, 1)}</div><div><b>{user.displayName}</b><small>{user.email} · {user.role}</small></div><button type="button" className="profile-more" onClick={onLogout} aria-label="退出登录"><LogOut size={16}/></button></div>
    </div>
  </aside>
}

function Header({ page, query, setQuery, onAddTask, onMenu, user, scopes, onSwitchScope, onLogout, tasks, onOpenTasks }: { page: string; query: string; setQuery: (v: string) => void; onAddTask: () => void; onMenu: () => void; user: AuthUser; scopes: UserScope[]; onSwitchScope: (id: string) => void; onLogout: () => void; tasks: Task[]; onOpenTasks: () => void }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const reminders = useMemo(() => tasks.filter(task => task.status !== 'done' && task.dueDate <= addDays(2)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6), [tasks])
  const labels = Object.fromEntries(pages.map(item => [item.id, item.label]))
  const path = navigationPath(page)
  const plm = !['overview', 'tasks', 'projects', 'timeline'].includes(page)
  return <header className="topbar"><button className="mobile-menu icon-button" onClick={onMenu} aria-label="打开导航"><Menu size={19}/></button><div className="breadcrumbs"><span>{path.slice(0, -1).join(' / ')}</span><ChevronRight size={14}/><b>{labels[page] ?? '工作区'}</b></div><div className="topbar-actions">{['overview', 'tasks'].includes(page) && <label className="searchbox"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务或项目…"/><kbd><Command size={11}/> K</kbd></label>}<label className="account-scope-wrap" title="切换当前组织与账套"><span>{user.tenantName}</span><select aria-label="切换账套" value={user.accountId} disabled={scopes.length < 2} onChange={event => onSwitchScope(event.target.value)}>{scopes.map(scope => <option key={scope.accountId} value={scope.accountId}>{scope.tenantName} · {scope.organizationName} · {scope.accountName}</option>)}</select></label><div className="notification-wrap"><button className="icon-button notification-button" aria-label={`待办提醒，${reminders.length} 项即将到期`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(value => !value)}><Bell size={18}/>{reminders.length > 0 && <i/>}</button>{notificationsOpen && <section className="notification-popover" aria-label="待办提醒"><div className="notification-head"><b>待办提醒</b><span>{reminders.length} 项临期</span></div>{reminders.length ? reminders.map(task => <button type="button" key={task.id} className="notification-item" onClick={() => { setNotificationsOpen(false); onOpenTasks() }}><b>{task.title}</b><small>{task.dueDate < todayISO() ? '已逾期' : task.dueDate === todayISO() ? '今天截止' : `截止 ${dateLabel(task.dueDate)}`}</small></button>) : <div className="notification-empty">当前没有逾期或未来两天内到期的待办。</div>}<button type="button" className="notification-all" onClick={() => { setNotificationsOpen(false); onOpenTasks() }}>查看全部待办<ArrowRight size={14}/></button><small className="notification-footnote">按当前工作区截止日期生成；不是钉钉推送。</small></section>}</div><div className="top-avatar" title={user.email}>{user.displayName.slice(0, 1)}</div><button className="icon-button" aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={17}/></button>{!plm && <button className="top-add" onClick={onAddTask}><Plus size={16}/><span>新建任务</span></button>}</div></header>
}

function StatCard({ label, value, detail, icon: Icon, accent, trend }: { label: string; value: string | number; detail: string; icon: typeof Target; accent: string; trend?: string }) {
  return <motion.div className="stat-card" whileHover={{ y: -3 }} transition={{ duration: .2 }}><div className={`stat-icon ${accent}`}><Icon size={18}/></div><div className="stat-label">{label}</div><div className="stat-value-row"><strong>{value}</strong>{trend && <span className="stat-trend"><ArrowUpRight size={13}/>{trend}</span>}</div><div className="stat-detail">{detail}</div></motion.div>
}

function TaskRow({ task, project, onToggle, onDelete, onEdit, busy }: { task: Task; project?: Project; onToggle: () => void; onDelete: () => void; onEdit?: () => void; busy?: boolean }) {
  const isDone = task.status === 'done'
  return <motion.div className={`task-row ${isDone ? 'task-done' : ''}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 12 }}>
    <button className={`task-check ${isDone ? 'checked' : ''}`} onClick={onToggle} disabled={busy} aria-label={isDone ? '标记未完成' : '完成任务'}>{isDone ? <Check size={13}/> : <Circle size={18}/>}</button>
    <div className="task-main">{onEdit ? <button className="task-title-button" onClick={onEdit} disabled={busy} title="编辑待办">{task.title}</button> : <span className="task-title">{task.title}</span>}<div className="task-meta"><span className="task-project"><i style={{ background: project?.color ?? '#c8cbd3' }}/>{project?.name ?? '个人任务'}</span><span className="meta-divider"/><span className={`priority priority-${task.priority}`}>{task.priority === 'high' ? '高优先级' : task.priority === 'medium' ? '中优先级' : '低优先级'}</span></div></div>
    <span className={`task-due ${task.dueDate < todayISO() && !isDone ? 'overdue' : ''}`}><Clock3 size={13}/>{dateLabel(task.dueDate)}</span>
    <button className="task-delete" onClick={onDelete} disabled={busy} aria-label="删除任务"><Trash2 size={15}/></button>
  </motion.div>
}

function ProgressRing({ value }: { value: number }) {
  const radius = 39
  const circumference = 2 * Math.PI * radius
  return <svg className="progress-ring" viewBox="0 0 100 100" role="img" aria-label={`今日任务完成 ${value}%`}><circle className="ring-track" cx="50" cy="50" r={radius}/><circle className="ring-value" cx="50" cy="50" r={radius} strokeDasharray={`${circumference}`} strokeDashoffset={circumference * (1 - value / 100)}/><text x="50" y="49" textAnchor="middle" className="ring-number">{value}%</text><text x="50" y="64" textAnchor="middle" className="ring-caption">完成</text></svg>
}

function WeekChart({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const points = values.map((v, i) => `${12 + i * 46},${72 - v / max * 48}`).join(' ')
  const area = `12,76 ${points} 288,76`
  return <div className="week-chart"><svg viewBox="0 0 300 88" preserveAspectRatio="none" aria-label={`本周按截止日期分布的任务数量：${values.join('、')}`}><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8d7cf6" stopOpacity=".23"/><stop offset="100%" stopColor="#8d7cf6" stopOpacity="0"/></linearGradient></defs><polygon points={area} fill="url(#chartFill)"/><polyline points={points} fill="none" stroke="#8572ed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{values.map((v, i) => <circle key={i} cx={12 + i * 46} cy={72 - v / max * 48} r="3.2" fill="#fff" stroke="#8572ed" strokeWidth="2"/>)}</svg><div className="chart-days">{weekDays.map((d, i) => <span key={d} className={i === (new Date().getDay() + 6) % 7 ? 'today' : ''}>{d}</span>)}</div></div>
}

function ProjectCard({ project, tasks, onClick }: { project: Project; tasks: Task[]; onClick: () => void }) {
  const completed = tasks.filter(t => t.status === 'done').length
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0
  const doneCount = completed.toString().padStart(2, '0')
  return <motion.button className="project-card" onClick={onClick} whileHover={{ y: -4, transition: { duration: .18 } }}>
    <div className="project-cover" style={{ '--project-color': project.color } as React.CSSProperties}><div className="cover-orbit orbit-one"/><div className="cover-orbit orbit-two"/><div className="cover-stamp"><span>{project.name.slice(0, 1)}</span></div><span className="cover-arrow"><ArrowUpRight size={17}/></span></div>
    <div className="project-card-body"><div className="project-title-line"><h3>{project.name}</h3></div><p>{project.description || '为重要的目标持续推进。'}</p><div className="project-progress-line"><div className="project-progress-track"><span style={{ width: `${progress}%`, background: project.color }}/></div><b>{progress}%</b></div><div className="project-card-foot"><span><CheckCircle2 size={14}/>{doneCount} / {tasks.length.toString().padStart(2, '0')} 项已完成</span><span>截止 {dateLabel(project.dueDate)}</span></div></div>
  </motion.button>
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && onClose()}><motion.div className="modal-card" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: .2 }}><div className="modal-heading"><div><span className="modal-eyebrow">MOMENTUM WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18}/></button></div>{children}</motion.div></motion.div>
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData>(() => loadLocalWorkspace())
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [userScopes, setUserScopes] = useState<UserScope[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [authError, setAuthError] = useState('')
  const [page, setCurrentPage] = useState(pageFromLocation)
  const [dailyAccess, setDailyAccess] = useState<DailyAccess | null>(null)
  const [accessRevision, setAccessRevision] = useState(0)
  const [dailyAccessReady, setDailyAccessReady] = useState(false)
  const setPage = (value: string, targetUrl?: string, reuseOpen = false) => {
    const destination = { page: resolvePage(value), url: targetUrl, reuseOpen }
    window.dispatchEvent(new CustomEvent('workspace:before-navigate', { detail: destination }))
    const next = destination.page
    setCurrentPage(next)
    const url = new URL(destination.url ?? window.location.href, window.location.origin)
    const family = (p: string) => pageById[p]?.parent ?? p
    if (family(page) !== family(next)) for (const key of ['definitionId', 'scheduleId']) url.searchParams.delete(key)
    url.searchParams.set('page', next)
    if (url.href !== window.location.href) window.history.pushState({}, '', url)
    setMobileNav(false)
  }
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all')
  const [taskModal, setTaskModal] = useState(false)
  const [projectModal, setProjectModal] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [taskSaving, setTaskSaving] = useState(false)
  const [projectSaving, setProjectSaving] = useState(false)
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')

  const bootstrap = async () => {
    setAuthLoading(true); setAuthError('')
    if (new URLSearchParams(window.location.hash.slice(1)).has('activate')) {
      setSetupRequired(false); setAuthUser(null); setUserScopes([]); setAuthLoading(false); return
    }
    if (isNativeApp() && !getApiBaseUrl()) { setSetupRequired(false); setAuthLoading(false); return }
    try {
      const status = await apiJson<{ setupRequired: boolean }>('/api/auth/status')
      setSetupRequired(status.setupRequired)
      if (status.setupRequired) { setAuthUser(null); setUserScopes([]); return }
      const session = await apiJson<{ user: AuthUser; scopes: UserScope[] }>('/api/auth/me')
      setApiScope(session.user)
      const data = await requestWorkspace()
      setAuthUser(session.user); setUserScopes(session.scopes); setWorkspace(data); saveLocalWorkspace(data)
    } catch (value) {
      setApiToken(''); setApiScope(null); setAuthUser(null); setUserScopes([])
      const message = value instanceof Error ? value.message : '无法连接工作区服务。'
      setAuthError(message.includes('请登录') || message.includes('authentication_required') ? '' : message)
    } finally { setAuthLoading(false) }
  }
  useEffect(() => { void bootstrap() }, [])
  useEffect(() => {
    const onPopState = () => { setCurrentPage(pageFromLocation()); setMobileNav(false) }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    let cancelled = false
    setDailyAccess(null); setDailyAccessReady(false)
    if (authUser) void apiJson<{ access: DailyAccess }>(`/api/daily-reports/summary?date=${todayISO()}`).then(result => { if (!cancelled) setDailyAccess(result.access) }).catch(() => { /* Page workbenches show the actual API error; navigation fails closed. */ }).finally(() => { if (!cancelled) setDailyAccessReady(true) })
    return () => { cancelled = true }
  }, [authUser?.id, authUser?.tenantId, authUser?.organizationId, authUser?.accountId, authUser?.role, accessRevision])
  const deniedDailyLeaf = Boolean(authUser && dailyAccessReady && ['daily-sales', 'daily-sales-analysis', 'daily-purchase', 'daily-purchase-analysis'].includes(page) && !canAccessPage(page, authUser, dailyAccess))
  useEffect(() => {
    // Never mount or persist an unauthorized daily leaf during deep-link/scope restoration.
    if (deniedDailyLeaf) setPage('overview')
  }, [deniedDailyLeaf, page])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2400); return () => clearTimeout(timer) }, [toast])
  const commit = (next: WorkspaceData) => { setWorkspace(next); saveLocalWorkspace(next) }
  const handleAuthenticated = async (result: { user: AuthUser; scopes: UserScope[] }) => {
    setAuthLoading(true); setAuthError('')
    try {
      setApiScope(result.user)
      const data = await requestWorkspace()
      setWorkspace(data); setAuthUser(result.user); setUserScopes(result.scopes); setSetupRequired(false)
      const requested = new URLSearchParams(window.location.search).get('page')
      setPage(resolvePage(requested))
    } catch (value) { setAuthError(value instanceof Error ? value.message : '工作区加载失败。') }
    finally { setAuthLoading(false) }
  }
  const switchScope = async (accountId: string) => {
    if (!window.dispatchEvent(new Event('workspace:before-discard', { cancelable: true }))) return
    if ((taskModal || projectModal) && !window.confirm('当前有打开的编辑表单，切换账套将关闭它。继续？')) return
    if (taskSaving || projectSaving || pendingTaskId) { setToast('请等待当前保存完成后再切换账套。'); return }
    setAuthLoading(true); setDailyAccess(null); setDailyAccessReady(false)
    setTaskModal(false); setProjectModal(false); setEditingTask(null); setEditingProject(null)
    let switched = false
    try {
      const result = await apiJson<{ user: AuthUser; scopes: UserScope[] }>('/api/auth/switch-scope', jsonRequest('POST', { accountId }))
      switched = true
      setApiScope(result.user)
      const data = await requestWorkspace()
      setAuthUser(result.user); setUserScopes(result.scopes); setWorkspace(data); saveLocalWorkspace(data); setSelectedProject(null); setToast(`已切换至 ${result.user.accountName}`)
    } catch (value) {
      setToast(value instanceof Error ? value.message : '切换工作区失败。')
      if (switched) await bootstrap()
      else setAccessRevision(value => value + 1)
    } finally { setAuthLoading(false) }
  }
  const logout = async () => {
    if (!window.dispatchEvent(new Event('workspace:before-discard', { cancelable: true }))) return
    try { await apiJson('/api/auth/logout', jsonRequest('POST')) } catch { /* clear local credential even if the API is offline */ }
    setApiToken(''); setApiScope(null); setAuthUser(null); setDailyAccess(null); setUserScopes([]); setPage('overview'); setWorkspace(loadLocalWorkspace())
  }
  const openNewTask = () => { setEditingTask(null); setTaskModal(true) }
  const openEditTask = (task: Task) => { setEditingTask(task); setTaskModal(true) }
  const openNewProject = () => { setEditingProject(null); setProjectModal(true) }
  const openEditProject = () => { const project = selectedProject ? projectsById[selectedProject] : undefined; if (project) { setEditingProject(project); setProjectModal(true) } }
  const toggleTask = async (task: Task) => {
    const status: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    if (pendingTaskId) return; setPendingTaskId(task.id)
    try { await syncMutation(`/tasks/${task.id}`, 'PATCH', { status }); commit({ ...workspace, tasks: workspace.tasks.map(item => item.id === task.id ? { ...item, status } : item) }) }
    catch (value) { setToast(value instanceof Error ? value.message : '任务更新失败。') }
    finally { setPendingTaskId(null) }
  }
  const deleteTask = async (task: Task) => {
    if (pendingTaskId || !window.confirm(`确定删除任务“${task.title}”吗？此操作不可撤销。`)) return; setPendingTaskId(task.id)
    try { await syncMutation(`/tasks/${task.id}`, 'DELETE'); commit({ ...workspace, tasks: workspace.tasks.filter(item => item.id !== task.id) }); setToast('任务已删除') }
    catch (value) { setToast(value instanceof Error ? value.message : '任务删除失败。') }
    finally { setPendingTaskId(null) }
  }
  const saveTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (taskSaving) return; setTaskSaving(true)
    const form = new FormData(event.currentTarget)
    const fields = { title: String(form.get('title')).trim(), description: String(form.get('description') || '').trim(), dueDate: String(form.get('dueDate')), priority: String(form.get('priority')) as Priority, projectId: String(form.get('projectId') || '') || undefined }
    const task: Task = { ...(editingTask ?? { id: createId(), status: 'todo' as TaskStatus, createdAt: new Date().toISOString() }), ...fields }
    try {
      if (editingTask) { await syncMutation(`/tasks/${editingTask.id}`, 'PATCH', fields); commit({ ...workspace, tasks: workspace.tasks.map(item => item.id === task.id ? task : item) }); setToast('待办已更新') }
      else { await syncMutation('/tasks', 'POST', task); commit({ ...workspace, tasks: [task, ...workspace.tasks] }); setToast('已添加到待办') }
      setTaskModal(false); setEditingTask(null)
    } catch (value) { setToast(value instanceof Error ? value.message : '任务保存失败。') }
    finally { setTaskSaving(false) }
  }
  const saveProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (projectSaving) return; setProjectSaving(true)
    const form = new FormData(event.currentTarget)
    const project: Project = { ...(editingProject ?? { id: createId(), createdAt: new Date().toISOString() }), name: String(form.get('name')).trim(), description: String(form.get('description')).trim(), dueDate: String(form.get('dueDate')), color: String(form.get('color')) }
    try {
      if (editingProject) { await syncMutation(`/projects/${editingProject.id}`, 'PATCH', { name: project.name, description: project.description, dueDate: project.dueDate, color: project.color }); commit({ ...workspace, projects: workspace.projects.map(item => item.id === project.id ? project : item) }); setToast('项目资料已更新') }
      else { await syncMutation('/projects', 'POST', project); commit({ ...workspace, projects: [project, ...workspace.projects] }); setToast('新项目已创建') }
      setProjectModal(false); setEditingProject(null)
    } catch (value) { setToast(value instanceof Error ? value.message : '项目保存失败。') }
    finally { setProjectSaving(false) }
  }
  const projectsById = useMemo(() => Object.fromEntries(workspace.projects.map(p => [p.id, p])) as Record<string, Project>, [workspace.projects])
  const relevantTasks = useMemo(() => workspace.tasks.filter(task => {
    const matchesQuery = !query || `${task.title} ${projectsById[task.projectId ?? '']?.name ?? ''}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'done' ? task.status === 'done' : task.status !== 'done')
    const matchesProject = page !== 'projects' || !selectedProject || task.projectId === selectedProject
    return matchesQuery && matchesFilter && matchesProject
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [workspace.tasks, query, filter, projectsById, page, selectedProject])
  const todayTasks = workspace.tasks.filter(task => task.dueDate === todayISO())
  const queryTerm = query.trim().toLowerCase()
  const todaySearchTasks = todayTasks.filter(task => !queryTerm || `${task.title} ${projectsById[task.projectId ?? '']?.name ?? ''}`.toLowerCase().includes(queryTerm))
  const todayVisibleTasks = todaySearchTasks.filter(task => filter === 'all' || (filter === 'done' ? task.status === 'done' : task.status !== 'done'))
  const overviewProjects = workspace.projects.filter(project => !queryTerm || `${project.name} ${project.description ?? ''}`.toLowerCase().includes(queryTerm)).slice(0, 3)
  const completedToday = todayTasks.filter(task => task.status === 'done').length
  const completion = todayTasks.length ? Math.round(completedToday / todayTasks.length * 100) : 0
  const upcoming = workspace.tasks.filter(task => task.status !== 'done' && task.dueDate >= todayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4)
  const pendingCount = workspace.tasks.filter(task => task.status !== 'done').length
  const weekStart = new Date(`${todayISO()}T12:00:00`); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const weekDates = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(weekStart.getDate() + index); return date.toISOString().slice(0, 10) })
  const weekDateSet = new Set(weekDates)
  const weekTasks = workspace.tasks.filter(task => weekDateSet.has(task.dueDate))
  const weekCompleted = weekTasks.filter(task => task.status === 'done').length
  const weekTaskCounts = weekDates.map(date => workspace.tasks.filter(task => task.dueDate === date).length)

  if (authLoading || (authUser && !dailyAccessReady) || deniedDailyLeaf) return <main className="session-loading"><span className="status-dot"/> 正在验证安全会话…</main>
  if (!authUser) return <LoginScreen setupRequired={setupRequired} apiError={authError} onAuthenticated={handleAuthenticated} onRetry={() => { void bootstrap() }}/>

  return <div className="app-shell"><Sidebar page={page} setPage={p => { setPage(p); setSelectedProject(null); setMobileNav(false) }} onAddTask={openNewTask} onCreateProject={openNewProject} onOpenProject={id => { setPage('projects'); setSelectedProject(id); setMobileNav(false) }} open={mobileNav} projects={workspace.projects} pendingCount={pendingCount} user={authUser} isAdmin={authUser.role === 'admin'} dailyAccess={dailyAccess} scopes={userScopes} onSwitchScope={id => { void switchScope(id) }} weekCompleted={weekCompleted} weekTotal={weekTasks.length} onViewWeek={() => { setPage('timeline'); setMobileNav(false) }} onLogout={() => { void logout() }}/><div className="app-main"><Header page={page} query={query} setQuery={setQuery} onAddTask={openNewTask} onMenu={() => setMobileNav(!mobileNav)} user={authUser} scopes={userScopes} onSwitchScope={id => { void switchScope(id) }} onLogout={() => { void logout() }} tasks={workspace.tasks} onOpenTasks={() => setPage('tasks')}/><main className="content-area" key={`${authUser.id}:${authUser.tenantId}:${authUser.organizationId}:${authUser.accountId}:${authUser.role}`}>
    <WorkspaceTabs page={page} storageKey={scopeKey(authUser)} allowed={candidate => canAccessPage(candidate, authUser, dailyAccess)} onNavigate={setPage}>{page => {
      const isPersonalPage = ['overview', 'tasks', 'projects', 'timeline'].includes(page)
      const headerTitle = pageById[page]?.label ?? '总览'
      return <>
    {isPersonalPage && <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>{fullDateLabel}</div><h1>{page === 'overview' ? <>早上好，<em>{authUser.displayName}</em></> : headerTitle}</h1><p>{page === 'overview' ? '把注意力留给真正重要的事。今天也会是稳稳向前的一天。' : page === 'tasks' ? '把大事拆小，按自己的节奏一件件完成。' : page === 'projects' ? '看见每个目标的进展，也看见自己走过的路。' : '把接下来的安排放进视野，心里就有了余裕。'}</p></div><button className="primary-button heading-add" onClick={() => page === 'projects' ? openNewProject() : openNewTask()}><Plus size={16}/>{page === 'projects' ? '新建项目' : '新建任务'}</button></div>}

    {page === 'overview' && <>
      <section className="stats-grid"><StatCard label="待完成任务" value={pendingCount.toString().padStart(2, '0')} detail="保持轻盈，一次专注一件" icon={ListTodo} accent="lavender"/><StatCard label="项目总数" value={workspace.projects.length.toString().padStart(2, '0')} detail="当前账套中的项目记录" icon={FolderKanban} accent="mint"/><StatCard label="今日完成" value={`${completedToday.toString().padStart(2, '0')} / ${todayTasks.length.toString().padStart(2, '0')}`} detail="完成一项，就向前一步" icon={CheckCircle2} accent="peach"/><StatCard label="本周完成" value={weekCompleted.toString().padStart(2, '0')} detail="按本周截止日期统计" icon={Activity} accent="blue"/></section>
      <section className="dashboard-grid"><div className="panel tasks-panel"><div className="panel-heading"><div><div className="panel-kicker">STAY IN MOTION</div><h2>今天要做 <span className="heading-count">{todayTasks.length}</span></h2></div><button className="text-action" onClick={() => setPage('tasks')}>查看全部<ArrowRight size={15}/></button></div><div className="filter-tabs"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>全部 <span>{todaySearchTasks.length}</span></button><button className={filter === 'todo' ? 'selected' : ''} onClick={() => setFilter('todo')}>待完成 <span>{todaySearchTasks.filter(t => t.status !== 'done').length}</span></button><button className={filter === 'done' ? 'selected' : ''} onClick={() => setFilter('done')}>已完成 <span>{todaySearchTasks.filter(t => t.status === 'done').length}</span></button></div><div className="task-list">{todayVisibleTasks.length ? <AnimatePresence initial={false}>{todayVisibleTasks.map(task => <TaskRow key={task.id} task={task} project={projectsById[task.projectId ?? '']} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task)}/>)}</AnimatePresence> : <div className="empty-inline"><CheckCircle2 size={20}/>{queryTerm ? '没有符合搜索条件的任务。' : filter === 'all' ? '今天还没有安排，先享受一段留白吧。' : '当前筛选下没有任务。'}</div>}</div><button className="add-row" onClick={() => setTaskModal(true)}><span><Plus size={16}/></span>添加一项待办</button></div>
        <div className="right-column"><div className="panel rhythm-panel"><div className="panel-heading"><div><div className="panel-kicker">YOUR DAILY RHYTHM</div><h2>今日节奏</h2></div><button className="more-button" aria-label="查看今日待办" title="查看今日待办" onClick={() => setPage('tasks')}><ArrowRight size={18}/></button></div><div className="rhythm-content"><ProgressRing value={completion}/><div className="rhythm-copy"><b>{completion >= 100 ? '做得真棒！' : '进度正好'}</b><span>{completion >= 100 ? '今天的任务已经全部完成。' : '专注当下，按自己的节奏来。'}</span><div className="rhythm-meta"><span><i className="dot-lavender"/>今日完成</span><b>{completedToday}<small> / {todayTasks.length}</small></b></div></div></div><div className="rhythm-bottom"><span><Sparkles size={14}/>一点点积累，也很了不起。</span><span>今日目标</span></div></div>
        <div className="panel focus-panel"><div className="panel-heading"><div><div className="panel-kicker">WEEKLY TASKS</div><h2>本周任务分布</h2></div><span className="focus-total"><b>{weekTasks.length}</b> 项</span></div><WeekChart values={weekTaskCounts}/><div className="week-foot"><span>已完成 <b>{weekCompleted}</b> 项</span><span>未完成 <b>{weekTasks.length - weekCompleted}</b> 项</span></div></div></div></section>
      <section className="section-block"><div className="section-heading"><div><div className="panel-kicker">MAKE IT HAPPEN</div><h2>正在推进的项目</h2></div><button className="text-action" onClick={() => setPage('projects')}>全部项目<ArrowRight size={15}/></button></div><div className="projects-grid">{overviewProjects.length ? overviewProjects.map(project => <ProjectCard key={project.id} project={project} tasks={workspace.tasks.filter(t => t.projectId === project.id)} onClick={() => { setPage('projects'); setSelectedProject(project.id) }}/>) : queryTerm ? <div className="empty-inline">没有匹配的项目。</div> : null}<button className="create-project-card" onClick={() => setProjectModal(true)}><span className="create-plus"><Plus size={20}/></span><b>从一个新目标开始</b><small>创建项目，追踪每一步进展</small></button></div></section>
    </>}

    {page === 'tasks' && <section className="panel full-panel"><div className="panel-heading"><div><div className="panel-kicker">TASK MANAGER</div><h2>所有待办 <span className="heading-count">{relevantTasks.length}</span></h2></div><div className="compact-filters"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'todo' ? 'selected' : ''} onClick={() => setFilter('todo')}>待完成</button><button className={filter === 'done' ? 'selected' : ''} onClick={() => setFilter('done')}>已完成</button></div></div><div className="task-list all-task-list">{relevantTasks.length ? <AnimatePresence initial={false}>{relevantTasks.map(task => <TaskRow key={task.id} task={task} project={projectsById[task.projectId ?? '']} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task)} onEdit={() => openEditTask(task)} busy={pendingTaskId !== null}/>)}</AnimatePresence> : <div className="empty-state"><span className="empty-icon"><CheckCircle2 size={24}/></span><b>这里暂时很清爽</b><p>试试调整筛选条件，或创建一项新任务。</p><button className="primary-button" onClick={openNewTask}><Plus size={16}/>新建任务</button></div>}</div><button className="add-row" onClick={openNewTask}><span><Plus size={16}/></span>添加一项待办</button></section>}

    {page === 'projects' && <ProjectWorkbench workspace={workspace} currentUser={authUser} onChange={commit} onToast={setToast} selectedProjectId={selectedProject} onProjectSelected={setSelectedProject} onCreateProject={openNewProject} onEditProject={openEditProject}/>}

    {page === 'timeline' && <section className="timeline-layout"><div className="panel timeline-panel"><div className="panel-heading"><div><div className="panel-kicker">LOOK AHEAD</div><h2>接下来</h2></div><span className="timeline-month">{new Intl.DateTimeFormat('zh-CN', { month: 'long', year: 'numeric' }).format(new Date())}</span></div><div className="timeline-list">{upcoming.map((task, i) => <div className="timeline-item" key={task.id}><div className="timeline-date"><b>{new Date(`${task.dueDate}T12:00:00`).getDate().toString().padStart(2, '0')}</b><small>{new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${task.dueDate}T12:00:00`))}</small></div><div className="timeline-rail"><i style={{ background: projectsById[task.projectId ?? '']?.color ?? '#aaa' }}/>{i < upcoming.length - 1 && <span/>}</div><button className="timeline-task" onClick={() => toggleTask(task)}><div><b>{task.title}</b><span>{projectsById[task.projectId ?? '']?.name ?? '个人任务'} · {dateLabel(task.dueDate)}</span></div><span className={`priority priority-${task.priority}`}>{task.priority === 'high' ? '高优先级' : task.priority === 'medium' ? '中优先级' : '低优先级'}</span><ChevronRight size={16}/></button></div>)}</div>{!upcoming.length && <div className="empty-state"><span className="empty-icon"><CalendarDays size={22}/></span><b>接下来没有待办</b><p>为未来安排一项温柔的提醒。</p></div>}<button className="add-row" onClick={() => setTaskModal(true)}><span><Plus size={16}/></span>安排一项新任务</button></div><div className="timeline-aside"><div className="timeline-note"><div className="note-icon"><Sparkles size={17}/></div><div className="panel-kicker">A GENTLE REMINDER</div><h3>别忘了给<br/>自己留一点空间。</h3><p>安排得刚刚好，才能走得更长远。你的每一步都算数。</p><div className="note-decoration">✳</div></div><div className="panel upcoming-count"><span>未来 7 天</span><b>{upcoming.length}<small>项待办</small></b><div className="mini-week">{weekDays.map((d, i) => <span className={i === (new Date().getDay() + 6) % 7 ? 'active' : ''} key={d}><i/>{d}</span>)}</div></div></div></section>}
    {['kpi', 'materials', 'boms', 'documents'].includes(page) && <Plm page={page} workspace={workspace} onChange={commit} onToast={setToast} currentUser={authUser}/>}
    {page === 'workflow' && canAccessPage(page, authUser, dailyAccess) && <WorkflowEntry currentUser={authUser}/>}
    {isDailyWorkbenchPage(page) && <DailyReportingWorkbench page={page} onNavigate={setPage} filterScopeKey={scopeKey(authUser)}/>}
    {['report-definitions','report-definitions-new','report-definitions-edit'].includes(page) && canAccessPage(page, authUser, dailyAccess) && <ReportDefinitionsWorkbench key={`${authUser.tenantId}:${authUser.organizationId}:${authUser.accountId}`} page={page} onNavigate={setPage} canManage={authUser.role === 'admin'}/>}
    {(page === 'reports' || page.startsWith('report-schedules')) && isReportPage(page) && canAccessPage(page, authUser, dailyAccess) && <ReportsWorkbench page={page} onNavigate={setPage} canManage={authUser.role === 'admin'}/>}
    {isDailyImportPage(page) && canAccessPage(page, authUser, dailyAccess) && <DailyReportImport key={page} kind={page === 'daily-sales-import' ? 'sales' : 'purchase'} onNavigate={setPage}/>}
    {isDailyManagementPage(page) && canAccessPage(page, authUser, dailyAccess) && <DailyReportingManagement canManageUsers={authUser.role === 'admin'} page={page} onNavigate={setPage} onChanged={() => setAccessRevision(value => value + 1)}/>}
    {!isDailyWorkbenchPage(page) && !canAccessPage(page, authUser, dailyAccess) && <section className="iw-card"><h1>无权访问此页面</h1><p>当前账套角色未获授权，请从导航选择可用页面。</p><button className="iw-button iw-secondary" onClick={() => setPage('overview')}>返回总览</button></section>}
    {page === 'users' && authUser.role === 'admin' && <UserAdmin currentUser={authUser} onToast={setToast}/>}
    {page === 'settings' && authUser.role === 'admin' && <ConnectorWorkbench key={`${authUser.tenantId}:${authUser.organizationId}:${authUser.accountId}`}/>}
    {page === 'tenants' && authUser.isPlatformAdmin && <TenantAdmin currentUser={authUser} scopes={userScopes} onScopesChange={setUserScopes} onSwitchScope={id => { void switchScope(id) }} onToast={setToast}/>}
      </>
    }}</WorkspaceTabs>
    <footer className="page-footer"><span><i className="status-dot"/>当前工作区 · {authUser.tenantName} / {authUser.organizationName} / {authUser.accountName}</span><span>Momentum · enterprise workspace</span></footer>
  </main></div>{mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="关闭菜单"/>}
    <AnimatePresence>{taskModal && <Modal title={editingTask ? '编辑待办' : '新建一项待办'} onClose={() => { if (!taskSaving) { setTaskModal(false); setEditingTask(null) } }}><form className="form-stack" onSubmit={saveTask}><label className="form-label">任务内容<input name="title" placeholder="例如：整理产品首页的信息架构" required autoFocus maxLength={120} defaultValue={editingTask?.title}/></label><label className="form-label">任务说明（可选）<textarea name="description" rows={3} maxLength={2000} defaultValue={editingTask?.description ?? ''} placeholder="补充验收标准或背景信息"/></label><div className="form-row"><label className="form-label">截止日期<input type="date" name="dueDate" defaultValue={editingTask?.dueDate ?? todayISO()} required/></label><label className="form-label">优先级<select name="priority" defaultValue={editingTask?.priority ?? 'medium'}><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option></select></label></div><label className="form-label">关联项目<select name="projectId" defaultValue={editingTask?.projectId ?? (page === 'projects' ? selectedProject ?? '' : '')}><option value="">个人任务</option>{workspace.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="secondary-button" disabled={taskSaving} onClick={() => { setTaskModal(false); setEditingTask(null) }}>取消</button><button type="submit" className="primary-button" disabled={taskSaving}>{taskSaving ? '保存中…' : editingTask ? '保存修改' : <><Plus size={16}/>创建任务</>}</button></div></form></Modal>}</AnimatePresence>
  <AnimatePresence>{projectModal && <Modal title={editingProject ? '编辑项目' : '创建一个新项目'} onClose={() => { if (!projectSaving) { setProjectModal(false); setEditingProject(null) } }}><form className="form-stack" onSubmit={saveProject}><label className="form-label">项目名称<input name="name" placeholder="给这个目标一个名字" required autoFocus maxLength={60} defaultValue={editingProject?.name}/></label><label className="form-label">一句话描述<input name="description" placeholder="你希望完成什么？" maxLength={140} defaultValue={editingProject?.description}/></label><div className="form-row"><label className="form-label">目标日期<input type="date" name="dueDate" defaultValue={editingProject?.dueDate ?? addDays(14)} required/></label><label className="form-label">项目颜色<select name="color" defaultValue={editingProject?.color ?? '#8d7cf6'}><option value="#8d7cf6">薰衣草紫</option><option value="#56b89a">薄荷绿</option><option value="#efa869">暖阳橙</option><option value="#5e9de6">晴空蓝</option><option value="#df7e93">柔和粉</option></select></label></div><div className="modal-actions"><button type="button" className="secondary-button" disabled={projectSaving} onClick={() => { setProjectModal(false); setEditingProject(null) }}>取消</button><button type="submit" className="primary-button" disabled={projectSaving}>{projectSaving ? '保存中…' : editingProject ? '保存修改' : <><Plus size={16}/>创建项目</>}</button></div></form></Modal>}</AnimatePresence>
  <AnimatePresence>{toast && <motion.div className="toast-message" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><CheckCircle2 size={17}/>{toast}</motion.div>}</AnimatePresence>
  </div>
}

export default App
