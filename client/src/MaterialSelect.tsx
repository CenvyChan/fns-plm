import { useId, useState } from 'react'
import type { Material } from './types'
import { materialOptionLabel, materialSearchText, matchesSearchText } from './material-search'

type SearchOption = { value: string; label: string; searchText: string }
type SearchableSelectProps = {
  name?: string; label: string; options: SearchOption[]; defaultValue?: string; value?: string;
  onChange?: (value: string) => void; required?: boolean; disabled?: boolean; placeholder?: string
}

/** Filtering never silently selects another material. Native select keeps form/keyboard semantics. */
export function SearchableSelect({ name, label, options, defaultValue = '', value, onChange, required, disabled, placeholder = '请选择' }: SearchableSelectProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [localValue, setLocalValue] = useState(defaultValue)
  const candidate = value ?? localValue
  // Eligibility rules are applied by the caller before searching. Never retain an ineligible ID.
  const selectedValue = options.some(option => option.value === candidate) ? candidate : ''
  const matching = options.filter(option => matchesSearchText(option.searchText, query))
  const selected = options.find(option => option.value === selectedValue)
  const retained = selected && !matching.some(option => option.value === selectedValue) ? selected : undefined
  return <div className="material-search-select" style={{ display: 'grid', gap: 6, minWidth: 0 }}>
    <input type="search" aria-label={`${label}搜索`} aria-describedby={`${id}-status`} value={query} disabled={disabled}
      placeholder="搜索编码、名称、规格/型号…" onChange={event => setQuery(event.target.value)}/>
    <select name={name} aria-label={label} aria-describedby={`${id}-status`} value={selectedValue} required={required} disabled={disabled}
      onChange={event => { setLocalValue(event.target.value); onChange?.(event.target.value) }}>
      <option value="">{placeholder}</option>
      {retained && <option value={retained.value}>{retained.label}（已选）</option>}
      {matching.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <small id={`${id}-status`} role="status">{matching.length ? `${matching.length} 项匹配` : '没有匹配项'}{retained ? '；保留已选项，搜索不会更改选择' : ''}</small>
  </div>
}

type MaterialSelectProps = Omit<SearchableSelectProps, 'options'> & { materials: Material[] }
export default function MaterialSelect({ materials, ...props }: MaterialSelectProps) {
  return <SearchableSelect {...props} options={materials.map(material => ({ value: material.id, label: materialOptionLabel(material), searchText: materialSearchText(material) }))}/>
}
