# 销售 / 采购日报与 K3Cloud 对账

本功能嵌入 React/Express 工作台 **报告** 页面，不运行 Django 服务。日报、K3Cloud 快照与不可变归档均按服务端认证的 tenant / organization / account 三层 scope 保存到 SQLite。所有受保护 API 仍须携带由已验证会话绑定的 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID` 头。

## 功能

- **销售/采购手工日报与历史**：录入、查询、修改、软删除；服务端计算 CNY 金额并记录操作者。手工日报不依赖 K3Cloud。
- **K3Cloud 只读同步**：管理员或 `plm_manager` 可手动触发同步。按当前账套配置的映射读取六类单据：销售出库、采购入库、销售订单、采购订单、应收单、应付单。读取走既有 K3Cloud LoginByAppSecret / ExecuteBillQuery 客户端；每个 FormId 和字段仍须先加入当前账套的服务端只读 allowlist。每类最多同步 5,000 行；超限、查询失败、记录缺关键字段或重复行级 ID 时整批拒绝，保留上一次已提交快照。
- **字段映射**：在 **系统集成 → K3Cloud** 配置 `dailyReportSources`。每类映射包含 `formId` 与从规范字段名到 K3 字段名的 `fields`。六类都须配置；最少映射 `id`、`billNo`、`date`、`partyName`、`originalAmount`、`amountCny`。应收/应付另须映射 `settledAmountCny`。可以按需增加 `partyNumber`、`materialName`、`quantity`、`unit`、`currency`、`status`。`id` 必须是行级唯一键；订单金额必须映射行级金额，避免同一张订单头金额随明细重复累计。字段名称和 FormId 会因企业 K3Cloud 版本/授权而异，需企业管理员先核实；本文不把示例当成通用字段清单。
- **快照替换与来源隔离**：同步完成后以真实 K3Cloud 快照整体替换当前演示快照，移除本地演示日报与其关联，保留已有真实日报、历史归档及可匹配的关联。真实快照存在时拒绝再刷新本地演示数据，防止真实与假数据混算。连接器、缓存、数据均按完整内部三层 scope 隔离；不写入 K3Cloud。
- **三个对账视角**：①日报关联覆盖率；②系统日报 − K3 的月/年累计差异；③K3 行原额、累计分摊、剩余、超额和跨日状态。没有对应快照时标记待判定，不将缺失 ERP 数字当作 0。
- **订单与应收应付明细**：页面显示销售/采购订单和应收/应付单明细及汇总；订单按所选报表日期统计。应收、应付余额取最后一次同步时点的单据金额/已收付/未收付数，不是按报表日回溯重算的历史余额。日报消息包含汇总及每类最多 8 条明细，平台页面每类最多显示 12 条，完整统计仍按全部记录计算。
- **不可变快照与导出**：归档生成递增版本，保存当时日报、K3 行、关联、对账、订单、应收/应付明细及警告副本。后续更正不改写旧版；HTML 会转义用户文本，Excel 含摘要、日报、K3、关联、销售/采购对账、应收和应付工作表。
- **日报推送**：手动 `/api/reports/send` 与计划执行均在发送前刷新 K3Cloud 六类数据，再生成报告；连接器/字段映射缺失或同步失败时本次不发送，防止把过期或演示金额发成真实财务信息。预览只读当前已保存快照，不触发 ERP 查询。Markdown 包含单据汇总、每类前 8 条单据明细、同步时点和余额口径。该功能不会自动新建/变更钉钉接收目标。
- **模拟渠道**：归档快照上的 email / DingTalk 模拟接口仅记本地模拟结果，不连接 SMTP 或真实收件人。

## 当前连接状态

非生产环境新账套默认拥有按账套隔离的本地演示数据，**不是用户业务数据或真实 K3Cloud 数据**。本代码仓库当前没有真实 K3Cloud 凭证、企业 FormId/字段映射或钉钉真实收件人配置；因此当前工作区不会被标记为已连接，也没有读取真实 ERP 或发送真实消息。配置并通过企业授权后，管理员可在日报页面点 **同步真实 K3Cloud**。同步后不再允许刷新演示快照。当前不含付款审批或付款指标。

## API

所有日报端点均位于 `/api` 下，受现有认证和三层 scope 授权保护。

| 方法 / 路径 | 权限 | 说明 |
|---|---|---|
| `GET /daily-reports?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sales\|purchase` | 已登录 | 读当前账套日报历史。 |
| `POST /daily-reports` | `admin`、`plm_manager`、`member` | 手工录入；服务端计算 CNY 金额。 |
| `PATCH /daily-reports/:id` / `DELETE /daily-reports/:id` | 同上 | 更正或软删除；已归档记录形成更正，不改写旧快照。 |
| `GET /daily-reports/k3-lines?type=sales\|purchase&q=...` | 已登录 | 读当前账套销售出库/采购入库快照行。 |
| `POST /daily-reports/k3-sync` | `admin`、`plm_manager` | 按已保存映射同步六类只读单据；映射必须完整且字段均在当前账套 allowlist 内。 |
| `PUT /daily-reports/:id/links` | `admin`、`plm_manager`、`member` | 多对多部分分摊；类型/账套校验，超额/跨日返回警告。 |
| `GET /daily-reports/summary?date=YYYY-MM-DD&scope=both` | 已登录 | 指定日期对账、订单、应收/应付汇总与明细、数据来源/时间及警告。 |
| `GET /daily-reports/snapshots` | 已登录 | 列出快照、渠道记录及未纳入后续快照的更正。 |
| `POST /daily-reports/snapshots` | `admin`、`plm_manager`、`member` | `{ "reportDate": "YYYY-MM-DD", "scope": "both" }`；归档新版本。 |
| `GET /daily-reports/snapshots/:id` | 已登录 | 读取归档时完整副本；跨账套 ID 返回 404。 |
| `GET /daily-reports/snapshots/:id/export.html` / `.xlsx` | 已登录 | 下载已归档 HTML / 多工作表 Excel。 |
| `POST /daily-reports/snapshots/:id/deliveries` | `admin`、`plm_manager`、`member` | 仅记录隔离模拟投递，不发送外部消息。 |
| `POST /daily-reports/mock-refresh` | `admin`、`plm_manager`；仅非生产 | 刷新本地演示数据；存在真实 ERP 快照时返回 409。 |

## 验证

```bash
npm run build --prefix client
npm test --prefix server
```

日报端到端测试使用临时 SQLite 和本地 K3Cloud WebAPI 替身，覆盖认证/scope/RBAC、六类数据同步、allowlist 拒绝、失败时旧快照保留、摘要/推送明细、对账、不可变快照、HTML 转义、Excel 导出、隔离模拟渠道、租户隔离及重启后的持久化。测试不使用真实企业凭证，不连接真实 K3Cloud/SMTP/钉钉，也不向真实接收方发消息。
