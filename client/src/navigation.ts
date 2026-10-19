import type { AuthUser } from './api'

export type NavigationUser = Pick<AuthUser, 'role' | 'isPlatformAdmin'>
export type NavigationItem = { id: string; label: string; access?: 'admin' | 'platform' }
export type NavigationGroup = { id: string; label: string; description: string; items: NavigationItem[] }

// Page IDs are the existing application entry points, not new static pages.
export const navigationGroups: NavigationGroup[] = [
  { id: 'personal', label: '个人工作台', description: '任务、项目与时间安排', items: [
    { id: 'overview', label: '总览' }, { id: 'tasks', label: '我的待办' },
    { id: 'projects', label: '项目进度' }, { id: 'timeline', label: '时间线' },
  ] },
  { id: 'product', label: '产品数据', description: '研发资料与产品结构', items: [
    { id: 'materials', label: '物料主数据' }, { id: 'boms', label: '多视图 BOM' },
    { id: 'documents', label: '图文档中心' },
  ] },
  { id: 'operations', label: '业务运营', description: '经营日报、推送与绩效', items: [
    { id: 'reports', label: '经营日报与报表' }, { id: 'kpi', label: 'KPI 与绩效' },
  ] },
  { id: 'collaboration', label: '流程协同', description: '业务审批与流程跟踪', items: [
    { id: 'workflow', label: '流程审批' },
  ] },
  { id: 'administration', label: '系统管理', description: '授权、连接器与工作区', items: [
    { id: 'users', label: '成员与权限', access: 'admin' },
    { id: 'settings', label: '系统集成', access: 'admin' },
    { id: 'tenants', label: '租户与账套', access: 'platform' },
  ] },
]

export function canAccessNavigation(item: NavigationItem, user: NavigationUser): boolean {
  return item.access === 'admin' ? user.role === 'admin' : item.access === 'platform' ? user.isPlatformAdmin : true
}
export function visibleNavigation(user: NavigationUser): NavigationGroup[] {
  return navigationGroups.map(group => ({ ...group, items: group.items.filter(item => canAccessNavigation(item, user)) })).filter(group => group.items.length > 0)
}
export function navigationEntry(page: string) {
  const group = navigationGroups.find(group => group.items.some(item => item.id === page))
  const item = group?.items.find(item => item.id === page)
  return { group, item }
}
export function resolveNavigationPage(page: string | null, user?: NavigationUser | null): string {
  const item = navigationEntry(page ?? '').item
  return item && (!user || canAccessNavigation(item, user)) ? item.id : 'overview'
}
export function pageFromSearch(search: string, user?: NavigationUser | null): string {
  return resolveNavigationPage(new URLSearchParams(search).get('page'), user)
}
export function navigationUrl(href: string, page: string): string {
  const url = new URL(href)
  url.searchParams.set('page', resolveNavigationPage(page))
  return `${url.pathname}${url.search}${url.hash}`
}
