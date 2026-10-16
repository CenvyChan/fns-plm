# 销售 / 采购日报与 K3Cloud 对账

本功能嵌入现有 React/Express 工作台 **报告** 页面，不运行 Django 服务。日报与快照按服务端认证的 tenant / organization / account 三层 scope 保存到项目 SQLite。现有角色为唯一授权来源：`admin`、`plm_manager`、`member` 可录入/更正/关联/归档；`reviewer` 等只读角色可查询但不能写入。每个受保护 API 仍须携带三个由已验证会话绑定的 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID` 头。

## 当前功能

- **销售/采购手工日报与历史**：日期、客商、单据号、数量、币种、原币金额、兑 CNY 汇率、折算人民币金额、备注、创建/更新操作者。支持历史查询、修改与软删除；手工输入不依赖 K3Cloud。
- **本地 K3 快照行关联**：销售日报仅允许关联销售出库，采购日报仅允许关联采购入库；行 ID 由当前账套数据查验。支持跨日报多对多、部分金额/数量分摊，超额和跨日关联保留并显式警告。日报侧覆盖额封顶，避免超额分摊虚增覆盖率；同一 K3 行原始金额只计一次。
- **三个独立对账视角**：①日报侧关联覆盖率；②同期间金额差异（系统日报 − K3，月累计及年累计）；③K3 明细原金额、累计分摊、剩余、超额和跨日状态。K3 数据缺失时标记不完整/待判定，不把缺失 ERP 数字作为零额结论。
- **不可变报告快照与更正**：归档生成递增版本，保存当时日报、K3 行、关联、三维对账、订单、应收/应付与警告副本；后续更正不会改写旧快照，而会作为更正记录带入相应后续日期的快照。
- **导出**：快照 HTML（对客商、备注等用户文本做 HTML 转义）和 Excel 工作簿：摘要、日报明细、K3 快照、关联与分摊、销售对账、采购对账、应收明细、应付明细。
- **模拟投递**：归档快照可记录 email / DingTalk 两个渠道的本地模拟结果；接口不连接 SMTP、钉钉，也没有外部收件人/群。本轮没有真实发送。
- **既有报告计划**：既有日报/周报计划与钉钉推送代码保留；统一报告 Markdown 预览增加销售/采购日报、订单、应收/应付摘要。若未来管理员配置并主动运行现有机器人计划，它仍可能向配置的真实机器人发消息，因此本轮没有执行任何计划/推送操作。系统没有 SMTP 邮件连接器，邮件渠道目前仅为模拟记录。

## 演示数据与连接器边界

非生产环境默认提供 account-scoped 的本地隔离演示日报与 K3 业务快照行，包含销售出库、采购入库、销售/采购订单、应收/应付余额，并刻意含部分分摊、超额和跨日样例，用于验证闭环。条目均标记为本地演示，**不是用户业务数据或 K3Cloud 实际数据**。只有 `admin` / `plm_manager` 可调用本地 mock 刷新；生产环境该路由返回 404。没有配置/调用真实 K3Cloud 连接器，不从真实 ERP 读取数据，也不向真实 ERP 写入。

当前不含付款审批或付款指标；也未实现真实 SMTP 收发或新增 DingTalk 收件人授权流程。现有只读 K3Cloud 查询连接器与现有报告/调度接口继续各自工作，后续若需要真实收发，应先配置明确的收件目标并另行授权。

## API

所有日报端点位于 `/api` 下，在现有 `sessionGate` 和三层 scope 授权后运行。

| 方法 / 路径 | 权限 | 说明 |
|---|---|---|
| `GET /daily-reports?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sales\|purchase` | 已登录 | 读当前账套日报历史；日期和类型均为可选过滤。 |
| `POST /daily-reports` | `admin`、`plm_manager`、`member` | 手工录入；必需 `type,date,partyName,quantity,currency,originalAmount,exchangeRate`。服务端计算 `amountCny`，并记录登录操作者。 |
| `PATCH /daily-reports/:id` | 同上 | 修改当前账套日报；如果日期/类型已有快照，创建更正；旧快照保留。 |
| `DELETE /daily-reports/:id` | 同上 | 软删除当前账套记录；若已归档则形成更正记录。 |
| `GET /daily-reports/k3-lines?type=sales\|purchase&q=...` | 已登录 | 读同账套销售出库/采购入库快照行及当前累计分摊。 |
| `PUT /daily-reports/:id/links` | 同上 | 请求 `{ "links": [{ "k3RowId": "...", "allocatedAmount": 100, "allocatedQuantity": 2 }] }`；整组替换关联。销售/采购种类必须吻合；超额/跨日返回 `warnings` 但允许保存。 |
| `GET /daily-reports/summary?date=YYYY-MM-DD&scope=both` | 已登录 | 指定日期及销售/采购/两者的三维对账、订单、应收/应付和数据完整性警告。 |
| `GET /daily-reports/snapshots` | 已登录 | 列出当前账套快照、渠道记录及未纳入后续快照的更正。 |
| `POST /daily-reports/snapshots` | `admin`、`plm_manager`、`member` | `{ "reportDate": "YYYY-MM-DD", "scope": "both" }`；归档新版本。 |
| `GET /daily-reports/snapshots/:id` | 已登录 | 读取归档时完整数据副本；跨账套 ID 返回 404。 |
| `GET /daily-reports/snapshots/:id/export.html` | 已登录 | 下载已归档 HTML 报表。 |
| `GET /daily-reports/snapshots/:id/export.xlsx` | 已登录 | 下载多工作表 Excel。 |
| `POST /daily-reports/snapshots/:id/deliveries` | `admin`、`plm_manager`、`member` | `{ "channel": "email"\|"dingtalk" }`；仅写入隔离模拟记录。 |
| `POST /daily-reports/mock-refresh` | `admin`、`plm_manager`，仅非生产 | 刷新本地示例 K3 行；不访问外部 ERP。 |

## 开发验证

```bash
npm run build --prefix client
npm test --prefix server
```

`server/tests/daily-reporting.test.mjs` 使用临时 SQLite 和虚构账号，覆盖认证/scope/RBAC、超额与错类型关联、三维对账、快照不可变性、次日更正、HTML 注入转义、Excel 工作表、邮件/钉钉模拟、租户隔离及服务重启后的持久化。测试不使用真实企业凭证、不连接真实 K3Cloud/SMTP/钉钉，也不向真实接收方发消息。
