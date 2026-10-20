import { useId } from 'react'
import type { FormField } from './FormDesignerWorkbench'
import type { Condition, FormDefinition } from './formRules'

type Props = {
  definition: FormDefinition
  field: FormField
  onChange: (patch: Partial<FormField>) => void
  onEventsChange: (events: FormDefinition['events']) => void
}

type RuleKey = 'visibleWhen' | 'requiredWhen' | 'enabledWhen'
const rules: { key: RuleKey; title: string; description: string }[] = [
  { key: 'visibleWhen', title: '显示条件', description: '条件满足时显示此字段。' },
  { key: 'requiredWhen', title: '必填条件', description: '条件满足时此字段必填。' },
  { key: 'enabledWhen', title: '启用条件', description: '条件满足时此字段可编辑。' },
]
const scalar = (value: unknown) => value == null ? '' : String(value)

export default function FormRuleInspector({ definition, field, onChange, onEventsChange }: Props) {
  const id = useId()
  const sourceFields = (definition.fields as FormField[]).filter(item => item.id !== field.id)
  const typeOf = (fieldId: string) => (definition.fields as FormField[]).find(item => item.id === fieldId)?.type
  const updateRule = (key: RuleKey, next?: Condition) => onChange({ [key]: next } as Partial<FormField>)
  const parseScalar = (text: string, fieldId: string): string | number => typeOf(fieldId) === 'number' && text.trim() !== '' ? Number(text) : text
  const events = definition.events ?? []
  const ownEvent = events.find(event => event.on === 'change' && event.field === field.id)
  const otherEvents = events.filter(event => !(event.on === 'change' && event.field === field.id))
  const changeOwnEvent = (actions: NonNullable<FormDefinition['events']>[number]['actions']) => {
    onEventsChange(!actions.length ? otherEvents : ownEvent ? events.map(event => event === ownEvent ? { ...event, actions } : event) : [...events, { on: 'change' as const, field: field.id, actions }])
  }
  const actions = ownEvent?.actions ?? []
  const setAction = (index: number, patch: Partial<(typeof actions)[number]>) => changeOwnEvent(actions.map((action, i) => i === index ? { ...action, ...patch } : action))

  return <section className="fd-rule-inspector" aria-label="字段规则检查器">
    <header className="fd-rule-header"><h3>规则与联动</h3><p>比较采用严格类型匹配；源字段非空时按定义顺序归一化。后端会拒绝造成循环的联动。</p></header>
    <div className="fd-rule-groups">
      {rules.map(({ key, title, description }, index) => {
        const condition = field[key]
        const enabled = !!condition
        const prefix = `${title}${index + 1}`
        return <article className="fd-rule-card" key={key}>
          <div className="fd-rule-card-heading"><label className="fd-check"><input type="checkbox" aria-label={`启用${title}`} checked={enabled} onChange={event => updateRule(key, event.target.checked ? { field: sourceFields[0]?.id ?? '', op: 'eq', value: '' } : undefined)} />{title}</label><p>{description}</p></div>
          {enabled && <div className="fd-rule-controls">
            <label>来源字段<select aria-label={`${title}来源`} value={condition.field} onChange={event => updateRule(key, { ...condition, field: event.target.value, value: condition.op === 'in' ? [] : '' })}><option value="">请选择字段</option>{sourceFields.map(item => <option key={item.id} value={item.id}>{item.label}（{item.id}）</option>)}</select></label>
            <label>比较方式<select aria-label={`${title}比较`} value={condition.op} onChange={event => updateRule(key, { ...condition, op: event.target.value as Condition['op'], value: event.target.value === 'in' ? [] : '' })}><option value="eq">等于</option><option value="neq">不等于</option><option value="in">属于列表</option></select></label>
            <label>匹配值<input aria-label={`${title}值`} type="text" value={Array.isArray(condition.value) ? condition.value.map(scalar).join(', ') : scalar(condition.value)} placeholder={condition.op === 'in' ? '以逗号分隔' : '输入匹配值'} onChange={event => {
              const text = event.target.value
              const value = condition.op === 'in' ? text.split(',').map(item => parseScalar(item.trim(), condition.field)).filter(item => String(item) !== '') : parseScalar(text, condition.field)
              updateRule(key, { ...condition, value })
            }} /></label>
            <button type="button" className="fd-link danger" onClick={() => updateRule(key, undefined)}>删除条件</button>
          </div>}
        </article>
      })}
    </div>
    <section className="fd-rule-events" aria-labelledby={`${id}-events-title`}>
      <div className="fd-rule-section-heading"><div><h4 id={`${id}-events-title`}>字段变更联动</h4><p>当此字段非空时，按定义顺序执行；清空字段不会触发联动。</p></div><button type="button" onClick={() => changeOwnEvent([...actions, { type: 'set', target: sourceFields[0]?.id ?? '', value: '' }])}>添加动作</button></div>
      {actions.length === 0 ? <p className="fd-rule-empty">尚无联动动作。</p> : <div className="fd-rule-actions">{actions.map((action, index) => <article className="fd-rule-action" key={`${action.target}-${index}`}>
        <label>操作<select aria-label={`联动操作${index + 1}`} value={action.type} onChange={event => setAction(index, event.target.value === 'clear' ? { type: 'clear', value: undefined } : { type: 'set', value: '' })}><option value="set">设置常量</option><option value="clear">清空目标</option></select></label>
        <label>目标字段<select aria-label={`联动目标${index + 1}`} value={action.target} onChange={event => setAction(index, { target: event.target.value })}><option value="">请选择字段</option>{(definition.fields as FormField[]).filter(item => item.id !== field.id).map(item => <option key={item.id} value={item.id}>{item.label}（{item.id}）</option>)}</select></label>
        {action.type === 'set' && <label>设置值<input aria-label={`联动值${index + 1}`} type="text" value={scalar(action.value)} onChange={event => setAction(index, { value: parseScalar(event.target.value, action.target) })} /></label>}
        <button type="button" className="fd-link danger" aria-label={`删除联动动作${index + 1}`} onClick={() => changeOwnEvent(actions.filter((_, i) => i !== index))}>删除动作</button>
      </article>)}</div>}
    </section>
  </section>
}
