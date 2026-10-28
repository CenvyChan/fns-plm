import type { ChangeEvent } from 'react'

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  description?: string
}) {
  return (
    <label className="connector-field">
      <span>{label}{description && <small>{description}</small>}</span>
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

export function SecretField({
  label,
  value,
  onChange,
  configured,
  clear,
  onToggleClear,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  configured: boolean
  clear: boolean
  onToggleClear: () => void
}) {
  return (
    <label className="connector-field">
      <span>{label}<small>{configured ? '已设置；当前不会回显' : '尚未设置'}</small></span>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={configured ? '留空保持现有密钥' : '输入密钥'}
      />
      {configured && (
        <button type="button" className={`secret-clear ${clear ? 'checked' : ''}`} onClick={onToggleClear}>
          {clear ? '将清除' : '清除现有值'}
        </button>
      )}
    </label>
  )
}

export function JsonField({
  label,
  description,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  rows: number
  placeholder: string
}) {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)

  return (
    <label className="connector-field connector-json-field">
      <span>{label}{description && <small>{description}</small>}</span>
      <textarea rows={rows} spellCheck={false} value={value} onChange={handleChange} placeholder={placeholder} />
    </label>
  )
}
