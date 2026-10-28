import { pageById } from './navigation'

// K3 reports are grouped by the business workflow, with every report route directly reachable.
export const navigationAreas = [
  { id: 'workspace', label: '工作台', sections: [
    { label: '个人工作', pages: ['overview', 'tasks', 'timeline'] },
  ] },
  { id: 'product', label: '产品与项目', sections: [
    { label: '产品资料', pages: ['materials', 'boms', 'documents'] },
    { label: '协作与执行', pages: ['projects', 'workflow'] },
    { label: '绩效分析', pages: ['kpi'] },
  ] },
  { id: 'k3-reports', label: 'K3 报表', sections: [
    { label: '总览与数据来源', pages: ['operational-reports', 'operational-preflight'] },
    { label: '库存', pages: ['operational-inventory', 'operational-movements', 'operational-aging'] },
    { label: '采购', pages: ['operational-purchase'] },
    { label: '销售', pages: ['operational-sales', 'operational-candidate-sales-collect'] },
    { label: '应收', pages: ['operational-candidate-ar-aging', 'operational-candidate-ar-detail', 'operational-candidate-ar-summary'] },
    { label: '应付', pages: ['operational-candidate-ap-aging', 'operational-candidate-ap-uninvoiced-detail', 'operational-candidate-ap-detail', 'operational-candidate-ap-summary'] },
    { label: '委外', pages: ['operational-candidate-subcontract-detail', 'operational-candidate-subcontract-summary'] },
    { label: '成本', pages: ['operational-candidate-cost-analysis'] },
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
  for (const owner of [page, record?.parent].filter((value): value is string => Boolean(value))) {
    for (const area of navigationAreas) for (const section of area.sections) {
      if (section.pages.includes(owner)) return [area.label, section.label, record?.label ?? owner]
    }
  }
  return ['工作台', record?.label ?? '总览']
}
