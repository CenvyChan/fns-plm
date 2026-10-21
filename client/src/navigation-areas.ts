import { pageById } from './navigation'

// Only existing routes: creation/editing stays inside its owning records page.
export const navigationAreas = [
  { id: 'workspace', label: '工作台', sections: [
    { label: '个人工作', pages: ['overview', 'tasks', 'timeline'] },
  ] },
  { id: 'product', label: '产品与项目', sections: [
    { label: '产品资料', pages: ['materials', 'boms', 'documents'] },
    { label: '协作与执行', pages: ['projects', 'workflow'] },
    { label: '绩效分析', pages: ['kpi'] },
  ] },
  { id: 'daily', label: '经营日报', sections: [
    { label: '销售', pages: ['daily-sales', 'daily-sales-analysis'] },
    { label: '采购', pages: ['daily-purchase', 'daily-purchase-analysis'] },
    { label: '核对与业务分析', pages: ['daily-reconciliation', 'daily-documents', 'reports'] },
    { label: '归档与报送', pages: ['daily-archives', 'report-definitions', 'report-schedules'], collapsed: true },
    { label: '基础资料维护', pages: ['daily-parties', 'daily-rates', 'daily-assignments', 'daily-mappings', 'daily-imports'], collapsed: true },
  ] },
  { id: 'system', label: '系统管理', collapsed: true, sections: [
    { label: '权限与集成', pages: ['users', 'settings', 'tenants'] },
  ] },
]
export function navigationPath(page: string) {
  const record = pageById[page]
  const owner = record?.parent ?? page
  for (const area of navigationAreas) for (const section of area.sections) {
    if (section.pages.includes(owner)) return [area.label, section.label, record?.label ?? owner]
  }
  return ['工作台', record?.label ?? '总览']
}
