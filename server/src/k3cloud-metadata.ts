export type K3MetadataField = {
  key: string
  caption: string
  entity: string
  mustInput: boolean
  visible: boolean
  isCustom: boolean
  isFlexParent: boolean
  elementType: string | number | null
  fieldName: string
}

const ENTRY_CONTAINERS = new Set(['Entrys', 'Entitys', 'Entities', 'ChildEntries', 'EntryList', 'SubHeadEntity'])
const FLEX_ELEMENT_TYPE = '60523'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseK3MetadataPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return { raw: value } }
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(text)) return true
  if (['false', '0', 'no', 'n'].includes(text)) return false
  return undefined
}

/**
 * Flatten only real, query-shaped field Keys from the actual account metadata.
 * In particular, metadata-only Keys containing `__`, hidden fields and flex
 * parents remain identifiable but cannot be treated as queryable mapping keys.
 */
export function extractK3MetadataFields(raw: unknown): K3MetadataField[] {
  const parsed = parseK3MetadataPayload(raw)
  const fields: K3MetadataField[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, entity: string): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, entity)
      return
    }
    if (!node || typeof node !== 'object') return
    const object = asRecord(node)
    const label = object.Key ?? object.Id ?? object.TableName ?? object.Name
    const rawKey = object.Key ?? object.key ?? object.Id
    const isField = typeof rawKey === 'string' && rawKey.startsWith('F') && !rawKey.includes('__') && rawKey.length <= 256
    const currentEntity = isField ? entity : typeof label === 'string' && label ? label : entity
    if (isField) {
      const signature = `${currentEntity}\0${rawKey}`
      if (!seen.has(signature)) {
        seen.add(signature)
        const visibility = booleanValue(object.IsViewVisible ?? object.Visible)
        const elementType = object.ElementType ?? object.FieldType ?? null
        const name = object.Name ?? object.Caption ?? object.PropertyName ?? object.FieldName ?? ''
        const mustInput = object.MustInput ?? object.Mustinput
        fields.push({
          key: rawKey,
          caption: typeof name === 'string' ? name : String(name ?? ''),
          entity: currentEntity,
          mustInput: mustInput === 1 || mustInput === '1' || mustInput === true || mustInput === 'true' || mustInput === 'True',
          visible: visibility !== false,
          isCustom: rawKey.startsWith('F_'),
          isFlexParent: String(elementType) === FLEX_ELEMENT_TYPE,
          elementType: typeof elementType === 'string' || typeof elementType === 'number' ? elementType : null,
          fieldName: String(object.FieldName ?? object.PropertyName ?? ''),
        })
      }
    }
    for (const [childKey, child] of Object.entries(object)) {
      walk(child, ENTRY_CONTAINERS.has(childKey) ? childKey : currentEntity)
    }
  }

  walk(parsed, 'head')
  return fields
}

export function summarizeK3Metadata(formId: string, raw: unknown, discoveredAt = new Date().toISOString()) {
  const fields = extractK3MetadataFields(raw)
  if (!fields.length) throw new Error('K3Cloud 元数据响应中没有可用字段；请确认当前账套 FormId、组织权限及 WebAPI 授权。')
  const custom = fields.filter(field => field.isCustom)
  return {
    formId,
    source: 'query_metadata' as const,
    discoveredAt,
    fieldCount: fields.length,
    customFieldCount: custom.length,
    fields,
    requiredKeys: fields.filter(field => field.mustInput && field.visible).map(field => field.key),
    usableCustomKeys: custom.filter(field => field.visible && !field.isFlexParent).map(field => field.key),
    hiddenCustomKeys: custom.filter(field => !field.visible).map(field => field.key),
    flexParentKeys: fields.filter(field => field.isFlexParent).map(field => field.key),
    note: '字段来自本次账套 QueryBusinessInfo 元数据响应；F_ 仅用于标注元数据 Key 已声明的自定义字段，不用于猜测或生成字段名。隐藏字段、带 __ 的元数据标识和弹性域父键不得直接加入查询 allowlist。',
  }
}
