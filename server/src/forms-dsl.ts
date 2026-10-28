export type Scalar = string | number | boolean
export type Condition = { field: string; op: 'eq' | 'neq' | 'in'; value: Scalar | Scalar[] }
export type ScopeIds = { tenantId: string; organizationId: string; accountId: string }
export type FormField = {
  id: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'customer' | 'user'
  section?: string
  required?: boolean; min?: number; max?: number; pattern?: string; options?: Array<{ value: string; label: string }>
  requiredWhen?: Condition; visibleWhen?: Condition; enabledWhen?: Condition
}
export type FormDefinition = { dslVersion: 1; fields: FormField[]; sections?: Array<{ id: string; title: string; description?: string }>; events?: Array<{ on: 'change'; field: string; actions: Array<{ type: 'set' | 'clear'; target: string; value?: Scalar }> }> }
const own = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const only = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k))
const scalar = (x: unknown): x is Scalar => typeof x === 'string' || typeof x === 'number' && Number.isFinite(x) || typeof x === 'boolean'
function safePattern(input: string): boolean {
  if (!input || input.length > 128) return false
  let p = input
  if (p.startsWith('^')) p = p.slice(1)
  if (p.endsWith('$')) p = p.slice(0, -1)
  let variableQuantifiers = 0
  while (p.length) {
    if (p[0] === '[') {
      const end = p.indexOf(']')
      if (end < 0) return false
      const chars = p.slice(1, end)
      if (!chars || !/^[A-Za-z0-9_ .,@-]+$/.test(chars) || chars.startsWith('-') || /--/.test(chars)) return false
      p = p.slice(end + 1)
    } else {
      if (!/[A-Za-z0-9 _.,@-]/.test(p[0]!)) return false
      p = p.slice(1)
    }
    if (p[0] === '?') { variableQuantifiers++; p = p.slice(1) }
    else if (p[0] === '{') {
      const m = p.match(/^\{(\d{1,3})(?:,(\d{1,3}))?\}/)
      if (!m) return false
      const min = Number(m[1]), max = Number(m[2] ?? m[1])
      if (max < min || max > 256) return false
      if (max !== min) variableQuantifiers++
      p = p.slice(m[0].length)
    }
    if (p[0] === '*' || p[0] === '+') return false
  }
  return variableQuantifiers <= 1
}
function validateCondition(x: unknown, ids: Set<string>): Condition {
  if (!own(x) || !only(x, ['field', 'op', 'value']) || typeof x.field !== 'string' || !ids.has(x.field) || !['eq', 'neq', 'in'].includes(String(x.op))) throw Error('invalid condition')
  if (Array.isArray(x.value)) { if (!x.value.length || x.value.length > 30 || x.value.some(v => !scalar(v))) throw Error('invalid condition value') }
  else if (!scalar(x.value)) throw Error('invalid condition value')
  if (x.op === 'in' && !Array.isArray(x.value)) throw Error('in requires an array')
  return x as Condition
}
export function validateDefinition(input: unknown): FormDefinition {
  if (!own(input) || !only(input, ['dslVersion', 'fields', 'events', 'sections']) || input.dslVersion !== 1 || !Array.isArray(input.fields) || input.fields.length > 100) throw Error('invalid definition')
  const sectionIds = new Set<string>()
  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections) || input.sections.length > 50) throw Error('invalid sections')
    for (const raw of input.sections) {
      if (!own(raw) || !only(raw, ['id', 'title', 'description']) || typeof raw.id !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(raw.id) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw.id) || sectionIds.has(raw.id) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 120 || raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 500)) throw Error('invalid section')
      sectionIds.add(raw.id)
    }
  }
  const ids = new Set<string>()
  for (const raw of input.fields) {
    if (!own(raw) || !only(raw, ['id', 'label', 'type', 'section', 'required', 'min', 'max', 'pattern', 'options', 'requiredWhen', 'visibleWhen', 'enabledWhen'])) throw Error('unknown field property')
    const f = raw as unknown as FormField
    if (typeof f.id !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(f.id) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.id) || ids.has(f.id) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 120 || !['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'customer', 'user'].includes(f.type)) throw Error('invalid field')
    ids.add(f.id)
    if (f.section !== undefined && (typeof f.section !== 'string' || !sectionIds.has(f.section))) throw Error('unknown field section')
    if (f.required !== undefined && typeof f.required !== 'boolean') throw Error('invalid required')
    for (const k of ['min', 'max'] as const) if (f[k] !== undefined && (!Number.isFinite(f[k]) || Math.abs(f[k]!) > 1e12)) throw Error('invalid bounds')
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) throw Error('invalid bounds')
    if ((f.min !== undefined || f.max !== undefined) && !['number', 'text', 'textarea', 'multiselect'].includes(f.type)) throw Error('bounds unsupported for field type')
    if (f.type !== 'number' && [f.min, f.max].some(bound => bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0))) throw Error('length bounds must be nonnegative integers')
    if (f.pattern !== undefined) { if (typeof f.pattern !== 'string' || !safePattern(f.pattern)) throw Error('unsafe pattern'); try { new RegExp(`^(?:${f.pattern})$`) } catch { throw Error('invalid pattern') } }
    if (f.options !== undefined && (!Array.isArray(f.options) || f.options.length > 100 || f.options.some(o => !own(o) || !only(o, ['value', 'label']) || typeof o.value !== 'string' || typeof o.label !== 'string' || o.value.length > 200 || o.label.length > 200) || new Set(f.options.map(o => o.value)).size !== f.options.length)) throw Error('invalid options')
    if (['select', 'multiselect'].includes(f.type) !== Array.isArray(f.options)) throw Error('options required only for select fields')
  }
  for (const f of input.fields as FormField[]) for (const c of [f.requiredWhen, f.visibleWhen, f.enabledWhen]) if (c !== undefined) validateCondition(c, ids)
  if (input.events !== undefined) {
    if (!Array.isArray(input.events) || input.events.length > 100) throw Error('invalid events')
    for (const e of input.events) {
      if (!own(e) || !only(e, ['on', 'field', 'actions']) || e.on !== 'change' || typeof e.field !== 'string' || !ids.has(e.field) || !Array.isArray(e.actions) || e.actions.length > 50) throw Error('invalid event')
      for (const a of e.actions) if (!own(a) || !only(a, ['type', 'target', 'value']) || !['set', 'clear'].includes(String(a.type)) || typeof a.target !== 'string' || !ids.has(a.target) || a.type === 'set' && !scalar(a.value) || a.type === 'clear' && a.value !== undefined) throw Error('invalid action')
    }
    // A source may be evaluated once. Writes to another source must precede its
    // evaluation, making normalization idempotent and rejecting cycles/back-edges.
    const events = input.events as NonNullable<FormDefinition['events']>
    const sources = new Map<string, number>()
    events.forEach((event, index) => {
      if (sources.has(event.field)) throw Error('duplicate event source')
      sources.set(event.field, index)
    })
    events.forEach((event, index) => {
      for (const action of event.actions) {
        const targetIndex = sources.get(action.target)
        if (targetIndex !== undefined && targetIndex <= index) throw Error('events must follow forward dependency order; cycles are forbidden')
      }
    })
  }
  return input as unknown as FormDefinition
}
export function isEmptyValue(value: unknown): boolean { return value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0 }
export function normalizeEvents(definition: FormDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const result = { ...values }
  for (const event of definition.events ?? []) {
    const source = result[event.field]
    if (isEmptyValue(source)) continue
    for (const action of event.actions) {
      if (action.type === 'clear') delete result[action.target]
      else result[action.target] = action.value
    }
  }
  return result
}
export function matches(condition: Condition | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true
  const actual = values[condition.field], expected = condition.value
  return condition.op === 'eq' ? actual === expected : condition.op === 'neq' ? actual !== expected : Array.isArray(expected) && expected.includes(actual as Scalar)
}
export function validateValues(definition: FormDefinition, values: unknown, scope: ScopeIds, lookup: (type: 'user' | 'customer', id: string, scope: ScopeIds) => boolean): Record<string, unknown> {
  if (!own(values) || !only(values, definition.fields.map(field => field.id))) throw Error('unknown or malformed values')
  const result = normalizeEvents(definition, values)
  for (const field of definition.fields) {
    const visible = matches(field.visibleWhen, result), enabled = matches(field.enabledWhen, result)
    const required = !!field.required || !!field.requiredWhen && matches(field.requiredWhen, result)
    const value = result[field.id], empty = isEmptyValue(value)
    if (Array.isArray(value) && field.type !== 'multiselect') throw Error(`${field.id} invalid field type`)
    if (!visible || !enabled) {
      if (!empty) throw Error(`${field.id} is not editable`)
      continue
    }
    if (empty) { if (required) throw Error(`${field.id} is required`); continue }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) throw Error(`${field.id} invalid number`)
    } else if (field.type === 'multiselect') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !field.options?.some(option => option.value === item)) || new Set(value).size !== value.length || field.min !== undefined && value.length < field.min || field.max !== undefined && value.length > field.max) throw Error(`${field.id} invalid options`)
    } else if (field.type === 'select') {
      if (typeof value !== 'string' || !field.options?.some(option => option.value === value)) throw Error(`${field.id} invalid option`)
    } else if (field.type === 'user' || field.type === 'customer') {
      if (typeof value !== 'string' || !lookup(field.type, value, scope)) throw Error(`${field.id} invalid scoped selection`)
    } else if (typeof value !== 'string' || value.length > (field.type === 'textarea' ? 10000 : 2000) || field.min !== undefined && value.length < field.min || field.max !== undefined && value.length > field.max) throw Error(`${field.id} invalid text`)
    if (typeof value === 'string' && field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) throw Error(`${field.id} does not match pattern`)
    if (field.type === 'date' && typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw Error(`${field.id} invalid date`)
  }
  return result
}
