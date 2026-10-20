export type Condition = { field: string; op: 'eq' | 'neq' | 'in'; value: string | number | boolean | (string | number | boolean)[] }
export type FormDefinition = { dslVersion: 1; fields: { id: string; visibleWhen?: Condition; requiredWhen?: Condition; required?: boolean; enabledWhen?: Condition; [key: string]: unknown }[]; events?: { on: 'change'; field: string; actions: { type: 'set' | 'clear'; target: string; value?: string | number | boolean }[] }[] }

export function conditionMatches(condition: Condition | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true
  const actual = values[condition.field], expected = condition.value
  if (condition.op === 'eq') return actual === expected
  if (condition.op === 'neq') return actual !== expected
  return Array.isArray(expected) && expected.includes(actual as string | number | boolean)
}

export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

export function normalizeEvents(definition: FormDefinition, initialValues: Record<string, unknown>): Record<string, unknown> {
  const values = { ...initialValues }
  for (const event of definition.events ?? []) {
    if (event.on !== 'change' || isEmptyValue(values[event.field])) continue
    for (const action of event.actions) {
      if (action.type === 'clear') delete values[action.target]
      else if (action.type === 'set' && action.value !== undefined) values[action.target] = action.value
    }
  }
  return values
}

export function applyEvents(definition: FormDefinition, field: string, value: unknown, prior: Record<string, unknown>): Record<string, unknown> {
  return normalizeEvents(definition, { ...prior, [field]: value })
}
