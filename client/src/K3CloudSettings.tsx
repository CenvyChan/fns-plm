import { JsonField, SecretField, TextField } from './ConnectorFields'

type K3CloudSyncStatus = {
  schedule?: {
    enabled: boolean
    intervalHours: number
    timezone: string
    ready: boolean
    readinessMessage: string
    schedulerState: string
  }
  lastRun?: {
    finishedAt?: string
    status?: string
    error?: string
    businessSyncMode?: 'full' | 'incremental' | 'mixed'
    businessChangedRowCounts?: Record<string, number>
  }
}

type K3CloudConnectionPanelProps = {
  draft: Record<string, string>
  secrets: Record<string, boolean>
  clearSecrets: string[]
  onValueChange: (key: string, value: string) => void
  onToggleClear: (key: string) => void
  allowlistText: string
  onAllowlistChange: (value: string) => void
  dailySourcesText: string
  onDailySourcesChange: (value: string) => void
}

const dailySourcesExample = `{
  "shipment": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<客户名称>", "materialName": "<物料>", "quantity": "<数量>", "unit": "<单位>", "unitPrice": "<单价>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>", "upstreamBillNo": "<来源销售订单号>" } },
  "purchase-receipt": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<供应商名称>", "materialName": "<物料>", "quantity": "<数量>", "unit": "<单位>", "unitPrice": "<单价>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>", "upstreamBillNo": "<来源采购订单号>" } },
  "sales-order": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<客户名称>", "materialName": "<物料>", "quantity": "<数量>", "unit": "<单位>", "unitPrice": "<单价>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>" } },
  "purchase-order": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<供应商名称>", "materialName": "<物料>", "quantity": "<数量>", "unit": "<单位>", "unitPrice": "<单价>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>" } },
  "sales-invoice": { "formId": "<销项发票 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<发票号码>", "date": "<开票日期>", "modifiedAt": "<修改时间>", "partyName": "<客户名称>", "materialName": "<物料>", "quantity": "<开票数量>", "unitPrice": "<单价>", "originalAmount": "<原币价税金额>", "amountCny": "<人民币价税金额>", "taxAmountCny": "<人民币税额>", "upstreamBillNo": "<来源出库/订单号>" } },
  "purchase-invoice": { "formId": "<采购发票/收票 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<发票号码>", "date": "<收票日期>", "modifiedAt": "<修改时间>", "partyName": "<供应商名称>", "materialName": "<物料>", "quantity": "<开票数量>", "unitPrice": "<单价>", "originalAmount": "<原币价税金额>", "amountCny": "<人民币价税金额>", "taxAmountCny": "<人民币税额>", "upstreamBillNo": "<来源入库/订单号>" } },
  "receivable": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<客户名称>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>", "settledAmountCny": "<已收人民币金额>", "upstreamBillNo": "<来源销售发票号>" } },
  "payable": { "formId": "<企业核实的 FormId>", "fields": { "id": "<唯一行ID>", "billNo": "<单号>", "date": "<日期>", "modifiedAt": "<修改时间>", "partyName": "<供应商名称>", "originalAmount": "<原币金额>", "amountCny": "<人民币金额>", "settledAmountCny": "<已付人民币金额>", "upstreamBillNo": "<来源采购发票号>" } }
}`

const masterSourcesExample = `{
  "customer": { "formId": "<客户 FormId>", "fields": { "id": "<稳定唯一键>", "number": "<客户编码>", "name": "<客户名称>", "status": "<状态>" } },
  "supplier": { "formId": "<供应商 FormId>", "fields": { "id": "<稳定唯一键>", "number": "<供应商编码>", "name": "<供应商名称>", "status": "<状态>" } },
  "salesperson": { "formId": "<业务员 FormId>", "fields": { "id": "<稳定唯一键>", "number": "<业务员编码>", "name": "<业务员名称>", "department": "<部门>" } },
  "user": { "formId": "<ERP 用户 FormId>", "fields": { "id": "<稳定唯一键>", "number": "<用户编码>", "name": "<用户名称>", "status": "<状态>" } }
}`

export function K3CloudConnectionPanel({
  draft,
  secrets,
  clearSecrets,
  onValueChange,
  onToggleClear,
  allowlistText,
  onAllowlistChange,
  dailySourcesText,
  onDailySourcesChange,
}: K3CloudConnectionPanelProps) {
  return (
    <section className="connector-fields" aria-label="K3Cloud 连接与查询权限">
      <div className="connector-help">
        <b>金蝶云星空 WebAPI（只读）</b>
        <span>查询接口受 FormId / FieldKeys 服务端 allowlist 控制；此配置不会提供写单据能力。</span>
      </div>
      <TextField label="WebAPI Base URL" value={draft.baseUrl ?? ''} onChange={value => onValueChange('baseUrl', value)} placeholder="http://192.168.1.10/k3cloud" description="支持 HTTPS；内网 HTTP 请使用私有 IP（10.x、172.16–31.x、192.168.x 或 IPv6 ULA）。HTTP 不加密，仅用于可信内网。" />
      <TextField label="账套 ID" value={draft.accountId ?? ''} onChange={value => onValueChange('accountId', value)} />
      <TextField label="接口用户名" value={draft.username ?? ''} onChange={value => onValueChange('username', value)} />
      <TextField label="组织标识" value={draft.organization ?? ''} onChange={value => onValueChange('organization', value)} description="填写与物料映射组织字段的值完全一致的金蝶组织编码或内部 ID，不是 PLM 组织 ID。用于连接/来源识别及物料刷新组织过滤；不传入登录接口，普通单据/主数据查询不会自动按此值过滤。" />
      <SecretField
        label="第三方应用 AppId"
        value={draft.appId ?? ''}
        onChange={value => onValueChange('appId', value)}
        configured={Boolean(secrets.appId)}
        clear={clearSecrets.includes('appId')}
        onToggleClear={() => onToggleClear('appId')}
      />
      <SecretField
        label="AppSecret"
        value={draft.appSecret ?? ''}
        onChange={value => onValueChange('appSecret', value)}
        configured={Boolean(secrets.appSecret)}
        clear={clearSecrets.includes('appSecret')}
        onToggleClear={() => onToggleClear('appSecret')}
      />
      <TextField label="语言 ID（LCID）" value={draft.lcid ?? ''} onChange={value => onValueChange('lcid', value)} placeholder="2052" />
      <JsonField
        label="只读查询 allowlist（JSON）"
        description="键为 FormId，值为允许查询的字段数组。仅开放完成当前业务所需的字段。"
        value={allowlistText}
        onChange={onAllowlistChange}
        rows={7}
        placeholder={'{\n  "BD_MATERIAL": ["FMATERIALID", "FNumber", "FName"]\n}'}
      />
      <JsonField
        label="日报 K3 单据字段映射（JSON）"
        description="按企业 K3Cloud 版本核对 FormId 与字段；所有映射字段都必须加入上方 allowlist。首轮完整读取；映射 modifiedAt 后后续按修改时间增量读取（回看 5 分钟），未配置则该类每次完整读取。单据行需唯一 ID；按 upstreamBillNo/upstreamId 映射上下游关联。"
        value={dailySourcesText}
        onChange={onDailySourcesChange}
        rows={20}
        placeholder={dailySourcesExample}
      />
    </section>
  )
}

type K3CloudMappingPanelProps = {
  masterSourcesText: string
  onMasterSourcesChange: (value: string) => void
  syncEnabled: boolean
  onSyncEnabledChange: (value: boolean) => void
  syncIntervalHours: string
  onSyncIntervalChange: (value: string) => void
  syncStatus: K3CloudSyncStatus | null
  configured: boolean
  syncing: boolean
  onSync: () => void
}

function getScheduleLabel(state?: string) {
  if (state === 'scheduled') return '已启用'
  if (state === 'blocked-incomplete-config') return '等待完整配置'
  return '未启用'
}

export function K3CloudMappingPanel({
  masterSourcesText,
  onMasterSourcesChange,
  syncEnabled,
  onSyncEnabledChange,
  syncIntervalHours,
  onSyncIntervalChange,
  syncStatus,
  configured,
  syncing,
  onSync,
}: K3CloudMappingPanelProps) {
  const schedule = syncStatus?.schedule
  const lastRun = syncStatus?.lastRun

  return (
    <section className="connector-fields k3-mapping-panel" aria-label="K3Cloud 主数据与定时采集">
      <div className="connector-help">
        <b>主数据只读镜像与定时采集</b>
        <span>客户、供应商、业务员和 ERP 用户按当前账套独立保存快照，不创建或修改 PLM 登录账号、角色或权限。只采集非敏感规范字段，不采集密码或联系方式。</span>
      </div>
      <JsonField
        label="K3Cloud 主数据映射（JSON）"
        description="每类单独配置企业核实的 FormId；仅映射编号、名称、状态、类别、部门、负责人和修改时间，且字段必须加入上方 allowlist。"
        value={masterSourcesText}
        onChange={onMasterSourcesChange}
        rows={9}
        placeholder={masterSourcesExample}
      />
      <div className="k3-sync-settings">
        <label className="connector-field k3-sync-toggle">
          <span><input type="checkbox" checked={syncEnabled} onChange={event => onSyncEnabledChange(event.target.checked)} /> 启用 K3Cloud 周期同步</span>
          <small>同步八类业务单据（含销项发票与采购收票）及四类基础资料；默认关闭，使用 Asia/Shanghai 时区。</small>
        </label>
        <label className="connector-field">
          <span>同步频率</span>
          <select value={syncIntervalHours} onChange={event => onSyncIntervalChange(event.target.value)}>
            <option value="1">每小时</option>
            <option value="6">每 6 小时</option>
            <option value="12">每 12 小时</option>
            <option value="24">每天 02:05</option>
          </select>
        </label>
      </div>
      <div className="connector-help k3-schedule-status" role="status">
        <b>计划状态：{getScheduleLabel(schedule?.schedulerState)}</b>
        <span>
          {schedule?.ready ? '映射及连接就绪。' : schedule?.readinessMessage || '保存完整映射和连接配置后，可启用周期任务。'}{' '}
          {lastRun?.finishedAt
            ? `最近运行：${new Date(lastRun.finishedAt).toLocaleString()}（${lastRun.status === 'success' ? '成功' : '失败'}${lastRun.businessSyncMode ? ` · ${lastRun.businessSyncMode === 'incremental' ? '增量' : lastRun.businessSyncMode === 'mixed' ? '混合' : '全量'}` : ''}${lastRun.businessChangedRowCounts ? ` · 本次 ${Object.values(lastRun.businessChangedRowCounts).reduce((sum, count) => sum + count, 0)} 行` : ''}）`
            : '尚无同步记录。'}
          {lastRun?.error ? ` ${lastRun.error}` : ''}
        </span>
      </div>
      <div className="k3-sync-action-row">
        <span>手动同步会更新当前账套的业务单据与基础资料快照。</span>
        <button type="button" className="secondary-button" onClick={onSync} disabled={syncing || !configured}>
          {syncing ? '同步中…' : '立即同步'}
        </button>
      </div>
    </section>
  )
}
