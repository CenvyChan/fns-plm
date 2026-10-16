# REST API 参考

**Base path：** `/api`。除健康检查、身份初始化/登录及钉钉卡片回调以外，所有 API 都要求有效服务端会话。Web 使用 HttpOnly Cookie；移动客户端使用 `Authorization: Bearer <accessToken>`。完成身份认证后，所有受保护请求还必须携带 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID` 三个范围头；前端从服务端登录/会话响应自动填入。JSON 请求设置 `Content-Type: application/json`；文件上传使用 `multipart/form-data` 的 `file` 字段。

租户、组织和账套范围的授权仍从已验证的数据库会话及成员关系推导。三个 `X-*-ID` 请求头是必需的一致性声明，服务端逐项与当前会话绑定的成员关系核对：缺少任一头返回 `400 workspace_scope_required`，不匹配返回 `403 workspace_scope_mismatch`。这些头**不是授权凭证，也不能用来切换范围或越权访问**；切换账套必须使用 `/auth/switch-scope`，服务器重新验证成员关系后由客户端更新范围头。健康、首次初始化、登录、`/auth/me` 会话恢复和签名校验的钉钉回调是发现/建立会话的例外，不携带已认证范围。

## 1. 认证与账号范围

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/auth/status` | 公开 | 返回首次初始化状态及 `dingtalkSso.configured/missing`；不返回凭证。 |
| `POST` | `/api/auth/setup` | 公开，仅首次 | 只需管理员姓名、邮箱与密码；创建平台管理员和内部默认管理范围“平台管理 / 平台组织 / 系统管理账套”。登录后可配置真实租户/组织/账套；全局已有用户时返回 `409`。 |
| `POST` | `/api/auth/mobile/setup` | 公开，仅首次 | 同上，另返回短期 `accessToken`（12 小时）。 |
| `POST` | `/api/auth/activate` | 公开，单次令牌 | 接收 `{ "token": "…", "password": "…" }`，成员自行设置至少 12 位个人密码；令牌 48 小时有效、一次性使用。 |
| `POST` | `/api/auth/login` | 公开 | 邮箱/密码登录，写入 HttpOnly Cookie，返回当前用户及可访问账套列表。 |
| `POST` | `/api/auth/mobile/login` | 公开 | 移动 Bearer 登录；请求可带 `accountId`，但仅在该用户已加入该账套时接受。 |
| `POST` | `/api/auth/dingtalk/mobile-login` | 公开，钉钉小程序 | 接收小程序一次性 `authCode`；服务端向钉钉验证并换取 `userId/unionId`，只登录已绑定且启用的既有用户。未绑定或无有效成员关系均拒绝，不自动建用户/分配角色。 |
| `POST` | `/api/auth/logout` | 会话 | 撤销当前会话并清除 Cookie。 |
| `GET` | `/api/auth/me` | 会话 | 返回当前用户与其可访问账套。 |
| `GET` | `/api/auth/scopes` | 会话 | 返回 scope 列表及当前账套 ID。 |
| `POST` | `/api/auth/switch-scope` | 会话 | 请求 `{ "accountId": "..." }`，仅切换到用户有效成员关系对应的账套。 |
| `GET` | `/api/auth/users` | 当前账套 `admin` | 列出当前账套成员。 |
| `POST` | `/api/auth/users` | 当前账套 `admin` | 创建新用户或将已有用户加入本账套。新用户不由管理员设置密码，响应只返回一次性 `activationToken`（48 小时有效）；已存在用户沿用其个人凭证。 |
| `POST` | `/api/auth/users/:id/activation` | 平台管理员且当前账套 `admin` | 生成单次密码重设链接并立即撤销该全局用户的会话；旧密码停用直至本人激活。 |
| `PATCH` | `/api/auth/users/:id` | 当前账套 `admin`；钉钉绑定仅平台管理员 | 更新成员角色/启停/显示名；停用会撤销该用户全部会话。平台管理员可设置/清除 `dingtalkUserId/dingtalkUnionId`，绑定到现有用户；不能通过此接口直接设置密码。 |
| `POST` | `/api/auth/tenants` | 平台管理员 | 创建新租户、组织、账套并将平台管理员加入新账套。 |
| `POST` | `/api/auth/organizations` | 当前账套 `admin` | 在当前租户新增组织和首个账套，并将当前用户加为管理员。 |
| `POST` | `/api/auth/accounts` | 当前账套 `admin` | 在当前组织新增账套，并将当前用户加为账套管理员。 |

首次初始化要求管理员姓名、有效邮箱和至少 12 位密码，不要求预先知道企业组织资料。平台管理员进入 **租户与账套** 管理页，可创建真实租户及首个组织/账套；随后还能在当前租户新增组织和账套。新成员通过个人一次性激活链接自行设置密码；Web 会话默认 7 天，移动 Bearer 会话默认 12 小时。钉钉小程序 SSO 需在服务端配置 `DINGTALK_SSO_CLIENT_ID`、`DINGTALK_SSO_CLIENT_SECRET`、`DINGTALK_SSO_CORP_ID`，并由平台管理员将已核验的钉钉 `userId/unionId` 绑定至既有用户；未配置时 API/UI 明确标记为未配置。登录错误会限流。所有业务请求必须携带服务端确认的三项 scope 头；普通成员只可访问已加入的账套。服务器端口、Cookie、CORS 与代理设置见 [Ubuntu 部署说明](../deploy/ubuntu/README.md)。

**已有账号迁移说明：** 为避免没有收到个人重置链接的员工突然无法登录，数据库升级不会自动停用既有账号密码。若需淘汰旧密码，平台管理员应逐人生成一次性重置链接；生成时该用户旧密码立即失效且所有会话撤销，成员完成链接激活后再恢复密码登录。

## 2. 工作区、待办与项目

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/health` | 公开 | API 与 SQLite 健康状态，包括 WAL 和租户表是否可用。 |
| `GET` | `/api/workspace` | 已登录 | 返回当前账套工作区快照：`tasks`、`projects`、`kpiRules`、`reviews`、`materials`、`boms`、`documents`、`salesBomSnapshots`。 |
| `GET` | `/api/tasks` | 已登录 | 当前账套任务。 |
| `POST` | `/api/tasks` | 已登录 | 新建任务；必需非空 `title`，可带 `description`、`dueDate`、`priority` (`low/medium/high`)、`status` (`todo/in-progress/done`)、`projectId`。 |
| `PATCH` | `/api/tasks/:id` | 已登录 | 更新任务可编辑字段；当前账套外的 ID 不可读写。 |
| `DELETE` | `/api/tasks/:id` | 已登录 | 删除当前账套任务。 |
| `GET` | `/api/projects` | 已登录 | 当前账套项目。 |
| `POST` | `/api/projects` | 已登录 | 新建项目；必需 `name`，可带 `description`、`color` (`#RRGGBB`) 与 `dueDate`。 |
| `PATCH` | `/api/projects/:id` | 已登录 | 更新项目名称、描述、颜色、截止日。 |
| `DELETE` | `/api/projects/:id` | 已登录 | 删除项目；关联任务解除项目引用。 |
| `POST` | `/api/projects/:id/import-plan` | `admin`, `plm_manager` | 通过 `multipart/form-data` 的 `file` 导入 CSV/XLSX；最大 10 MB。解析后校验阶段/里程碑引用、重复 WBS 和日期，再原子写入当前项目。 |
| `GET` | `/api/projects/:id/export.csv` | 已登录 | 导出当前项目任务计划 CSV；记录不存在于当前 scope 时返回 `404`。 |
| `GET` | `/api/projects/:id/export.xlsx` | 已登录 | 导出当前项目 Excel 工作簿（项目、阶段、里程碑、任务、事件/评审、报告和附件清单）。 |
| `GET` | `/api/projects/:id/archive.zip` | 已登录 | 下载当前项目 JSON manifest、Excel 工作簿与该项目附件；响应 `private, no-store`，不打包数据库、密钥、环境变量或其他项目/账套数据。 |

## 3. PLM 集合

这些集合共享 CRUD 模式：`GET` 读取当前账套集合；`POST` 创建；`PATCH /:id` 更新。不存在于当前账套的 ID 返回 `404`。服务器对未知字段做白名单过滤，并作字段验证。写角色如下：

| 集合路径 | 集合键 | 写权限 | 约束 |
|---|---|---|---|
| `/api/kpi-rules` | `kpiRules` | `admin`, `plm_manager` | `code/name/formula/target/weight/direction/status` 必需；目标与权重必须为正。 |
| `/api/reviews` | `reviews` | `admin`, `plm_manager`, `reviewer` | 被考核人、部门、周期、评审人、状态必需。 |
| `/api/materials` | `materials` | `admin`, `plm_manager` | `partNo/name/unit/lifecycle` 必需；不允许将未核验物料冒充 ERP 已同步。 |
| `/api/boms` | `boms` | `admin`, `plm_manager` | 视图类型限 `design/manufacturing/sales`；发布前验证来源 BOM/修订与 SBOM 配置规则。 |
| `/api/documents` | `documents` | `admin`, `plm_manager` | 文档号、标题、类型、修订、状态必需。 |
| `/api/sales-bom-snapshots` | `salesBomSnapshots` | `admin`, `plm_manager` 创建 | 销售订单配置结果；不可修改，作为不可变历史快照保存。 |

**KPI 规则维护：** `PATCH /api/kpi-rules/:id` 更新规则并递增修订号；直接修改 `status` 会被拒绝。使用 `POST /api/kpi-rules/activate-set`，请求 `{ "ids": ["…"] }`，原子切换目标规则集；所选规则权重必须合计 **100%**，未选中规则转为草稿。`DELETE /api/kpi-rules/:id` 仅允许删除未生效且未被绩效记录/评审快照引用的规则；被保护规则返回 `409`。

**BOM 发布约束：** EBOM/MBOM 行项目、下游 BOM 已发布且匹配的源 BOM 与修订；销售 BOM 需有订单属性、配置组和规则，并验证允许组合覆盖与无歧义。EBOM 是下游 MBOM/SBOM 的允许基线类型之一。某些字段是否受特定业务校验，以服务端当前的规则校验器为准。

**项目归档附件命名：** ZIP 内附件位于 `{项目编号}/attachments/`，文件名为 `{项目编号}_NA_NA_{创建人}_{UTC时间戳}_{附件ID}_{原文件名}`。当前项目附件模型仅直接关联项目，因此事件号和任务号使用 `NA`；manifest 同时保留 `originalName`、`archiveName`、`linkedRecord`、`creator`、`createdAt` 与 `sha256`，并对缺失的附件二进制标记 `archived: false`。

### 图文档附件

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/documents/:id/files` | 已登录 | 列出当前账套文档附件元数据，不含跨账套内容。 |
| `POST` | `/api/documents/:id/files` | `admin`, `plm_manager` | `multipart/form-data`，字段 `file`。最大 25 MB；检查允许的扩展名和文件内容签名。保存摘要、修订、上传用户及文件元数据。 |
| `GET` | `/api/documents/:id/files/:fileId/content` | 已登录 | 返回受保护的附件下载流（私有、`no-store`）；必须属于当前 scope。前端在拿到认证文件流后可本地预览 PDF/图片、DOCX/XLSX 和 CSV/TXT，不调用第三方预览服务；DWG/DXF/STEP/STL/IGES 等按原格式下载。 |

允许 PDF、PNG/JPEG、DOCX/XLSX、CSV/TXT 及 CAD 交换格式（DWG/DXF/STEP/STL/IGES 等）；登记、修订和上传仅限 `admin`、`plm_manager`，附件元数据/下载须具备当前账套有效认证，跨 scope 的记录与文件统一返回 404。浏览器本地预览不把附件发送到第三方；DOCX 以正文文本预览、XLSX 以首个工作表预览，复杂排版/宏/外部链接不执行，PDF 由浏览器内置查看器显示。**这不是 DMS/病毒扫描服务**，生产环境仍应配置备份、访问审计、恶意软件扫描和留存策略。Nginx 示例已设置 26 MB 上限以略高于 API 的 25 MB 限制。

### BOM 行项目

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/api/boms/:id/lines` | `admin`, `plm_manager` | 为当前 scope BOM 增加行；要求 `materialId` 和正数量。不可为销售 BOM 添加静态行。 |
| `DELETE` | `/api/boms/:id/lines/:lineId` | `admin`, `plm_manager` | 删除指定行。 |

## 4. 系统集成与 K3Cloud

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/integrations/status` | 已登录 | 当前账套 Flowable、K3Cloud、钉钉和缓存状态。 |
| `GET` | `/api/integrations/settings` | `admin` | 返回当前账套连接器配置摘要；秘密值只返回是否已设置，不返回明文。 |
| `PUT` | `/api/integrations/settings/:provider` | `admin` | 保存 `flowable`、`k3cloud` 或 `dingtalk` 配置。秘密字段保留策略/清除机制见 [连接器说明](INTEGRATIONS.md)。 |
| `POST` | `/api/integrations/settings/:provider/test` | `admin` | 手动测试 Flowable、K3Cloud 登录或钉钉机器人；会实际请求配置的第三方服务，钉钉测试会向配置目标发送一条测试消息。 |
| `GET` | `/api/k3cloud/status` | 已登录 | 当前账套 K3Cloud 配置/连接状态。 |
| `POST` | `/api/k3cloud/query` | `admin`, `plm_manager` | 只读查询；`formId` 与每个 `FieldKeys` 必须在当前账套服务端 allowlist 中；最大页大小 200。 |

K3Cloud API 是**只读**。过滤字段、排序字段和列必须被 allowlist 接受；不提供创建/更新 ERP 主数据的 REST API。正式编码须由 K3Cloud/企业批准的编码规则授予。

## 5. 流程与审批

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/workflow/status` | 已登录 | Flowable 状态与当前 scope 演示任务数量。 |
| `GET` | `/api/workflow/tasks` | 已登录 | Flowable 连通时按当前用户映射、账号租户过滤；仅未配置引擎时返回账套演示任务。引擎已配置但不可用时返回 `502`，不回退成演示数据。 |
| `GET` | `/api/workflow/tasks/:id` | 已登录 | 返回演示任务，或验证 Flowable 租户/经映射的办理人后返回真实任务。 |
| `GET` | `/api/workflow/audit` | 已登录 | 返回当前账套本地演示审计，或当前映射审批人的 Flowable 操作记录。 |
| `POST` | `/api/workflow/demo-tasks` | `admin`, `plm_manager` | Flowable 未配置时创建本地演示待办；Flowable 已配置时拒绝新演示任务。 |
| `POST` | `/api/workflow/instances` | `admin`, `plm_manager` | 通过 allowlist 流程定义 key 发起 Flowable 实例；仅接受经校验的变量并由服务端加入 initiator/tenant。 |
| `POST` | `/api/workflow/tasks/:id/complete` | `admin`, `plm_manager`, `reviewer` | 决策 `approve/approved` 或 `reject/rejected`，必需审批意见。**不得由客户端指定操作者**；身份从登录会话与当前账套映射推导。 |
| `POST` | `/api/dingtalk/cards/callback` | 公开路由、签名验证 | 钉钉互动卡片回调；必须通过签名/身份映射校验，且仍需必填审批意见。 |

## 6. 报告、计划与钉钉推送

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/api/reports/preview` | 已登录 | 当前账套统计 summary 与 Markdown。 |
| `GET` | `/api/reports/schedules` | 已登录 | 当前账套日报/周报计划。 |
| `POST` | `/api/reports/schedules` | `admin` | 创建计划；可设置 `daily/weekly`、时间、星期、时区和启停；无渠道配置时不可启用。 |
| `PATCH` | `/api/reports/schedules/:id` | `admin` | 更新计划属性。 |
| `DELETE` | `/api/reports/schedules/:id` | `admin` | 删除计划。 |
| `POST` | `/api/reports/schedules/:id/run` | `admin` | 手动执行指定计划，可能发送钉钉消息。 |
| `POST` | `/api/reports/send` | `admin` | 手动推送当前账套报告，可能向当前账套配置的机器人发消息。 |

Redis `SET NX` 锁在连接成功时用于多副本的同分钟去重；没有 Redis 时程序使用进程内备用锁/缓存，不具备跨副本全局去重保证。

## 7. 共同响应与错误

- `400`：请求字段、格式、流程/业务规则无效。
- `401`：会话不存在、过期或已撤销。
- `403`：当前角色无权、范围头与会话成员关系不一致或任务不属于当前映射用户。
- `404`：当前账套下找不到记录/附件。
- `409`：唯一冲突、状态冲突、重复创建或 BOM 发布规则冲突；workspace 并发冲突返回 `workspace_conflict`，客户端应刷新重试。
- `413`：文件超过 25 MB 或 JSON body 超限。
- `415`：附件类型不支持或字节签名不匹配。
- `502/503`：外部 Flowable/K3Cloud/钉钉不可用或未配置。

缺少 `X-Tenant-ID`、`X-Organization-ID` 或 `X-Account-ID` 任一范围头时返回 `400 workspace_scope_required`。这些头都存在但与会话绑定范围不一致时返回 `403 workspace_scope_mismatch`。客户端不得自行从 URL 参数或请求体选择数据范围。

接口返回 JSON 对象/数组；应用清单接口当前未提供游标分页。时间戳为 ISO 8601 UTC 文本；日期字段按 `YYYY-MM-DD` 传递。列表、状态和权限以服务端结果为准，客户端展示/缓存不是授权边界。
