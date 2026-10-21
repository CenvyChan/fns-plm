export const MATERIAL_RULE_VERSION = 'confirmed-2026-10-21-v2'
export class MaterialRuleError extends Error {}
export type MaterialRule = { kind: string; prefix: string; width: number; version: string; basis: string }
const pending: Record<string, string> = {
  injection: '待确认：2.01.02.0317### 中分类段、材质/处理等参数段的映射未能从本地已确认目录唯一确定；不得把 0317 当作不透明固定段放行。注塑无毛坯。',
  'metal-blank': '待确认：2.02.03.05##### 的类别/各段映射尚未在本地目录形成唯一可验证绑定；五位示例不代表所有五金毛坯均可出码。',
  'metal-treated': '待确认：2.03.02.0117### 的 01/17 等各段映射不明；不得从示例猜成已确认规则。',
  finished: '待确认：产成品通常三位流水，但当前类别和完整固定前缀/各段映射未能从已确认规则及本地目录唯一确定。',
  mould: '待确认：模具类别.系列 + 五位流水；当前类别、系列及其目录绑定尚未唯一确认。',
}
export function resolveMaterialRule(kind: string, prefix: string, groupNumber: string): MaterialRule {
  if (pending[kind]) throw new MaterialRuleError(pending[kind])
  if (kind !== 'raw') throw new MaterialRuleError('未知或未录入类别，禁止生成编码；不得消耗流水。')
  if (!/^[123](?:\.\d+)+\.?$/.test(prefix) || prefix.length > 100) throw new MaterialRuleError('编码前缀必须以 1/2/3 加点号开头；分段或前缀未确认。')
  if (!/^3(?:\.\d+)+$/.test(groupNumber) || prefix !== `${groupNumber}.`) throw new MaterialRuleError('原材料须选择 K3Cloud 的 3 开头完整分组；最后一个点后为五位流水。')
  return { kind, prefix, width: 5, version: MATERIAL_RULE_VERSION, basis: '用户已确认：K3Cloud 3 开头完整分组 + 点号 + 最后五位流水；完整分组由当前来源记录唯一确定，不解释或猜测其他维度段。' }
}
export function nextMaterialCode(rule: MaterialRule, codes: string[]): { code: string; serial: number; maximum: number } {
  let maximum = 0, matched = false
  for (const code of codes) {
    if (!code.startsWith(rule.prefix)) continue
    const suffix = code.slice(rule.prefix.length)
    if (!/^\d+$/.test(suffix)) continue
    if (suffix.length !== rule.width) throw new MaterialRuleError('当前前缀存在不同流水位数的旧编码；分段冲突待确认，禁止沿用通用五位规则。')
    matched = true
    maximum = Math.max(maximum, Number(suffix))
  }
  if (!matched) throw new MaterialRuleError('当前前缀尚无可核验最大流水号；首号/起点待确认，禁止猜测。')
  if (maximum >= 10 ** rule.width - 1) throw new MaterialRuleError('当前流水池已耗尽，禁止溢出或自动扩位。')
  const serial = maximum + 1
  return { code: rule.prefix + String(serial).padStart(rule.width, '0'), serial, maximum }
}
