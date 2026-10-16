import { JsonField, SecretField, TextField } from './ConnectorFields'

type ProviderPanelProps = {
  draft: Record<string, string>
  secrets: Record<string, boolean>
  clearSecrets: string[]
  onValueChange: (key: string, value: string) => void
  onToggleClear: (key: string) => void
}

type FlowablePanelProps = ProviderPanelProps & {
  userMapText: string
  onUserMapChange: (value: string) => void
  groupMapText: string
  onGroupMapChange: (value: string) => void
}

export function FlowableSettingsPanel({
  draft,
  secrets,
  clearSecrets,
  onValueChange,
  onToggleClear,
  userMapText,
  onUserMapChange,
  groupMapText,
  onGroupMapChange,
}: FlowablePanelProps) {
  return (
    <section className="connector-fields" aria-label="Flowable 审批引擎配置">
      <div className="connector-help">
        <b>审批引擎连接</b>
        <span>使用 Flowable REST API；每个账套首次发起真实流程时，服务端会按 tenantId 部署 PLM BPMN 定义。用户映射用于登录身份绑定；候选组映射按当前组织与账套隔离。</span>
      </div>
      <TextField label="REST API Base URL" value={draft.baseUrl ?? ''} onChange={value => onValueChange('baseUrl', value)} placeholder="http://127.0.0.1:8090/flowable-rest/process-api" />
      <TextField label="服务账号" value={draft.username ?? ''} onChange={value => onValueChange('username', value)} placeholder="flowable-admin" />
      <SecretField
        label="Basic Auth 密码"
        value={draft.password ?? ''}
        onChange={value => onValueChange('password', value)}
        configured={Boolean(secrets.password)}
        clear={clearSecrets.includes('password')}
        onToggleClear={() => onToggleClear('password')}
      />
      <TextField label="请求超时（毫秒）" value={draft.timeoutMs ?? ''} onChange={value => onValueChange('timeoutMs', value)} placeholder="10000" />
      <JsonField label="Flowable 用户映射（JSON）" description="键为 Momentum 登录邮箱，值为 Flowable 用户 ID。" value={userMapText} onChange={onUserMapChange} rows={5} placeholder={'{\n  "engineer@company.com": "flowable-user-id"\n}'} />
      <JsonField label="Flowable 候选组映射（JSON）" description="键为 Flowable 用户 ID，值为该用户可处理的候选组 ID 数组。" value={groupMapText} onChange={onGroupMapChange} rows={5} placeholder={'{\n  "flowable-user-id": ["material-reviewers"]\n}'} />
    </section>
  )
}

type DingTalkPanelProps = ProviderPanelProps & {
  userMappingText: string
  onUserMappingChange: (value: string) => void
}

export function DingTalkSettingsPanel({
  draft,
  secrets,
  clearSecrets,
  onValueChange,
  onToggleClear,
  userMappingText,
  onUserMappingChange,
}: DingTalkPanelProps) {
  return (
    <section className="connector-fields" aria-label="钉钉机器人与通知配置">
      <div className="connector-help">
        <b>钉钉机器人通知</b>
        <span>测试按钮会向当前账套配置的群机器人发送明确标注的测试消息。卡片回调还需在钉钉开放平台配置回调地址与身份映射。</span>
      </div>
      <TextField label="自定义机器人 Webhook" value={draft.webhookUrl ?? ''} onChange={value => onValueChange('webhookUrl', value)} placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" />
      <SecretField label="机器人签名密钥" value={draft.webhookSecret ?? ''} onChange={value => onValueChange('webhookSecret', value)} configured={Boolean(secrets.webhookSecret)} clear={clearSecrets.includes('webhookSecret')} onToggleClear={() => onToggleClear('webhookSecret')} />
      <TextField label="应用 HTTPS 公网地址（用于通知链接）" value={draft.publicAppUrl ?? ''} onChange={value => onValueChange('publicAppUrl', value)} placeholder="https://plm.company.com" />
      <TextField label="企业 CorpId" value={draft.corpId ?? ''} onChange={value => onValueChange('corpId', value)} />
      <TextField label="钉钉应用 AppKey" value={draft.appKey ?? ''} onChange={value => onValueChange('appKey', value)} />
      <SecretField label="钉钉应用 AppSecret" value={draft.appSecret ?? ''} onChange={value => onValueChange('appSecret', value)} configured={Boolean(secrets.appSecret)} clear={clearSecrets.includes('appSecret')} onToggleClear={() => onToggleClear('appSecret')} />
      <TextField label="互动卡片模板 ID" value={draft.templateId ?? ''} onChange={value => onValueChange('templateId', value)} />
      <SecretField label="互动卡片回调签名密钥" value={draft.cardCallbackSecret ?? ''} onChange={value => onValueChange('cardCallbackSecret', value)} configured={Boolean(secrets.cardCallbackSecret)} clear={clearSecrets.includes('cardCallbackSecret')} onToggleClear={() => onToggleClear('cardCallbackSecret')} />
      <JsonField label="钉钉身份映射（JSON）" description="键 corpId:userId，值为 Flowable assignee 用户 ID。" value={userMappingText} onChange={onUserMappingChange} rows={5} placeholder={'{\n  "ding-corp:ding-user-id": "flowable-user-id"\n}'} />
    </section>
  )
}
