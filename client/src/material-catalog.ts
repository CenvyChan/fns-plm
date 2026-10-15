import rawCatalog from './material-catalog.json'
import type { MaterialCatalogNode, Material } from './types'

export const materialCatalog = rawCatalog as MaterialCatalogNode[]
export const primaryFamilies = ['原材料', '辅助材料', '成品', '模具', '变压器', '半成品', '注塑产品配件']
export const sharedDimensionFamilies = ['注塑材质', '五金材质', '表面处理']
export const getNode = (id?: string) => materialCatalog.find(node => node.id === id)
export const displayNode = (node: MaterialCatalogNode) => `${node.path.join(' / ')} · ${node.code}${node.confirmed ? '' : '（待确认）'}`
export const isCatalogLeaf = (node: MaterialCatalogNode) => !materialCatalog.some(candidate => candidate.id !== node.id && candidate.id.startsWith(`${node.id}.`))
export const familyNodes = (family: string) => materialCatalog.filter(node => node.family === family)
export const dimensionNodes = (family: string) => materialCatalog.filter(node => node.family === family)

export interface DimensionRequirement { family: string; required: boolean; reason: string }
export function dimensionRequirements(node?: MaterialCatalogNode): DimensionRequirement[] {
  if (!node) return []
  const p = node.path
  if (node.family === '成品') {
    if (p[0] === '注塑件' && p[1] === '内配五金件') return [{ family: '五金材质', required: true, reason: '该分支属于内配五金件，不能误选注塑材质。' }]
    if (p[0] === '注塑件') return [{ family: '注塑材质', required: true, reason: '注塑产品需引用注塑材质维度。' }]
    if (p[0] === '五金件') return [{ family: '五金材质', required: true, reason: '五金产品需引用五金材质；表面处理按工艺选择。' }, { family: '表面处理', required: false, reason: '仅当该产品确有表面处理工艺时选择。' }]
  }
  if (node.family === '半成品') {
    if (p[0] === '注塑半成品') {
      const workedShell = p[1] === '壳体半成品（外加工后）'
      return [{ family: '注塑材质', required: true, reason: '注塑半成品与成品共用注塑材质字典。' }, ...(workedShell ? [{ family: '表面处理', required: true, reason: '外加工后壳体需要显式选择处理方案。' }] : [])]
    }
    if (p[0] === '五金毛坯') return [{ family: '五金材质', required: true, reason: '五金毛坯需要材质；固定 00 补位由规则端管理。' }]
    if (p[0] === '五金半成品') return [{ family: '五金材质', required: true, reason: '五金半成品需要五金材质。' }, { family: '表面处理', required: true, reason: '五金半成品规则要求材质 + 处理。' }]
  }
  if (node.family === '原材料') {
    if (node.id === 'raw.01.01') return [{ family: '注塑材质', required: true, reason: '塑料粒子引用注塑材质维度；批量属性不解释为流水步长。' }]
    if (['raw.02.01', 'raw.02.02', 'raw.02.03'].includes(node.id)) return [{ family: '五金材质', required: true, reason: '板材、卷材或铝型材使用五金材质域。' }]
    if (node.id === 'raw.02.04') return []
  }
  return []
}

export function materialDraftBlockers(material: Partial<Material>) {
  const reasons = ['当前项目尚未绑定并验证 ERP 权威分组快照。', '总类前缀、正式流水位数/起点/步长及号码命名空间尚未完成业务批准。', '当前记录没有目标 ERP 账套的服务端最终校验回执。']
  if (material.groupNodeId && !getNode(material.groupNodeId)?.confirmed) reasons.unshift('所选分类节点在设计矩阵中标注为待确认，不能发布。')
  if (material.proposedGroupNumber) reasons.push(`候选分组 ${material.proposedGroupNumber} 不是已核验的 ERP group ID；需与权威分组节点绑定。`)
  if (Object.values(material.dimensions ?? {}).some(id => { const node = getNode(id); return node && !node.confirmed })) reasons.push('存在未确认的共享维度值。')
  return reasons
}
