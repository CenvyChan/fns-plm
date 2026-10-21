// Explicit allowlist: never serialise editor fields, record payloads or credentials.
export const filterSelector = '.module-search input, .status-filter select, .doc-toolbar input, .doc-toolbar select, .dr-list-filters input, .dr-list-filters select, .dr-header-date input'
type ViewState = { filters: Record<string, string>; scrollY: number; horizontal: number[] }
const fields = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(filterSelector)).filter(field => !field.closest('form, [role="dialog"], .modal-card'))
export function readViewState(key: string): ViewState | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (!data || !data.filters || typeof data.filters !== 'object' || Array.isArray(data.filters) || !Number.isFinite(data.scrollY) || data.scrollY < 0) return null
    return data
  } catch { return null }
}
export function saveViewState(root: HTMLElement, key: string) {
  const filters: Record<string, string> = {}
  for (const [index, field] of fields(root).entries()) filters[`${index}:${field.tagName}:${field.getAttribute('placeholder') ?? field.getAttribute('aria-label') ?? ''}`] = field.value.slice(0, 200)
  const state: ViewState = { filters: { ...readViewState(key)?.filters, ...filters }, scrollY: window.scrollY, horizontal: Array.from(root.querySelectorAll<HTMLElement>('.plm-table-wrap, .dr-table-wrap, .iw-table-wrap')).map(node => node.scrollLeft) }
  try { sessionStorage.setItem(key, JSON.stringify(state)) } catch { /* optional */ }
}
export function applyViewState(root: HTMLElement, state: ViewState) {
  for (const [index, field] of fields(root).entries()) {
    const key = `${index}:${field.tagName}:${field.getAttribute('placeholder') ?? field.getAttribute('aria-label') ?? ''}`
    const value = state.filters[key]
    if (typeof value !== 'string' || field.value === value || field.disabled) continue
    const proto = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value)
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  root.querySelectorAll<HTMLElement>('.plm-table-wrap, .dr-table-wrap, .iw-table-wrap').forEach((node, i) => { node.scrollLeft = state.horizontal?.[i] ?? 0 })
}
