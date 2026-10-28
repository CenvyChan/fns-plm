import { flowableMissingFieldLabels, flowableRestContextHint } from './flowable-settings-diagnostics'
import { JsonField, SecretField, TextField } from './ConnectorFields'

type ProviderPanelProps = {
  draft: Record<string, string>
  secrets: Record<string, boolean>
  clearSecrets: string[]
  onValueChange: (key: string, value: string) => void
  onToggleClear: (key: string) => void
}

type FlowablePanelProps = ProviderPanelProps & {
  missingFields: string[]
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
  missingFields,
}: FlowablePanelProps) {
  const restContextHint = flowableRestContextHint(draft.baseUrl ?? '')
  return (
    <section className="connector-fields" aria-label="Flowable 审批引擎配置">
      <div className="connector-help">
        <b>审批引擎连接</b>
        <span>PLM 内部流程业务通过独立的 Flowable 引擎 REST API 执行。当前隔离标准 REST 容器使用 <code>/flowable-rest/service</code>；本项目内置 Spring Boot Flowable 服务使用 <code>/flowable-rest/process-api</code>。请按目标实例的部署方式填写完整 Base URL，主机和端口由部署方提供。每个账套首次发起真实流程时，服务端会按 tenantId 部署 PLM BPMN 定义。用户/候选组映射按业务身份隔离。</span>
      </div>
      <TextField label="REST API Base URL" value={draft.baseUrl ?? ''} onChange={value => onValueChange('baseUrl', value)} placeholder="https://<Flowable-host>/flowable-rest/service" />
      {restContextHint && <small role="status">{restContextHint}</small>}
      {missingFields.length > 0 && <div className="connector-error" role="status" aria-label="Flowable 缺失必填字段">
        <b>尚不能测试连接，缺少必填字段：</b> {flowableMissingFieldLabels(missingFields).join('、')}。请补齐并加密保存后再测试。
      </div>}
      {secrets.password && !clearSecrets.includes('password') && <small role="status">Basic Auth 密码已加密保存；出于安全原因不回显。输入新密码可替换。</small>}
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
