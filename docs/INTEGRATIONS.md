# 企业连接器、加密存储与外部服务

## 通用安全模型

连接器配置按当前内部 `(tenantId, organizationId, accountId)` 三元组保存。管理员在「系统集成与连接器」页面提交 URL、服务账号、allowlist 和映射；后端使用 Node.js `crypto` 的 **AES-256-GCM** 加密整份配置（认证标签、随机 nonce 与密文一并保存），SQLite 只保存密文与配置 revision。AppId 与 AppSecret 均按只写凭证处理：设置摘要只返回是否已设置，不返回原值；输入框留空表示保留现有值，勾选“清除现有值”才会移除。

- 密钥必须为 32 字节：环境变量 `APP_ENCRYPTION_KEY` 需要恰好 64 个十六进制字符；否则使用 `APP_ENCRYPTION_KEY_FILE` 指定的本地密钥文件。生产 systemd 默认 `/var/lib/momentum/.app-encryption-key`，由 `momentum` 用户持有，权限应为 `0600`。Docker 部署时仅向后端容器注入稳定的解密主密钥或其密钥文件；应用在服务端进程内读取密钥，浏览器/API 摘要不会暴露密钥。
- **数据库与密钥必须一起备份。** 只恢复 SQLite 文件而丢失密钥，会使已保存的凭证无法解密；只备份密钥而丢失数据库也不能恢复集成设置。
- 更换密钥不等于轮换：当前没有自动重加密/轮换命令。换密钥前先保存各连接器凭据、停服务、按维护流程导出/重加密，或保留原密钥安全备份。不要在工单、日志、前端、版本库或聊天中记录凭证。
- K3Cloud 配置**只通过 PLM 页面**保存到加密账套记录；服务端不会从 Docker 环境变量读取 K3Cloud AppId/AppSecret，也不会用环境默认值回退。Docker 环境只需提供应用解密主密钥。Flowable/钉钉仍可使用环境默认值，但必须完整匹配 `CONNECTOR_DEFAULT_TENANT_ID`、`CONNECTOR_DEFAULT_ORGANIZATION_ID`、`CONNECTOR_DEFAULT_ACCOUNT_ID`；不能跨范围共享。环境变量本身也须由运维安全管理，不应提交 Git。
- 连接器测试会真实连到配置的第三方；**钉钉测试会发一条消息**。仅在受控群中主动触发测试。

## 1. Flowable BPMN

### 部署与密钥

内置项目包含独立 Java Flowable 8 REST 引擎源码（`flowable-service/`），不是 Node 进程内嵌模拟引擎。按 [Flowable 部署指南](../deploy/ubuntu/flowable-service-README.md) 单独编译/部署，确认本地 health endpoint 正常，并在 `/etc/momentum-flowable/momentum-flowable.env` 设置：

```dotenv
FLOWABLE_REST_USERNAME=momentum-api
FLOWABLE_REST_PASSWORD=<24+ 字符随机强密码>
FLOWABLE_HOST=127.0.0.1
FLOWABLE_PORT=8090
FLOWABLE_DATA_DIR=/var/lib/momentum-flowable
```

如果 Node API 与引擎同机，常见 Base URL 为 `http://127.0.0.1:8090/flowable-rest/process-api`；如果跨主机，使用受控 HTTPS 代理 URL。引擎不应暴露在公网。引擎 REST Basic Auth 和 BPMN tenant 过滤均由服务端负责；内部三层范围转换成确定性组合标识 `tenant:<tenantId>:organization:<organizationId>:account:<accountId>`，不能只用 accountId 作为外部隔离键。

可在独立测试引擎上复跑完整链路：先在 `server/` 中执行 `npm run build`，再设置 `FLOWABLE_BASE_URL`、`FLOWABLE_USERNAME`、`FLOWABLE_PASSWORD` 并执行 `npm run test:flowable:e2e`。脚本只接受 loopback Flowable URL，并在独立临时 SQLite 中启动 API；它会创建两个 tenant/org/account 范围，验证流程实例 tenant、assignee 与候选组映射、缺失/伪造任一范围头拒绝、跨范围查询/详情/完成拒绝，并核对完成历史。测试实例之外不会连接 K3Cloud 或钉钉，也不会连接远程或生产 Flowable。

### 在 PLM 管理页配置

为相同内部三元组打开 **系统集成与连接器 → Flowable**，填入 Base URL、服务账号、密钥和请求超时。配置 Flowable 用户映射 JSON：

```json
{
  "alice@example.com": "flowable-user-alice",
  "bob@example.com": "flowable-user-bob"
}
```

键是已认证工作区用户的邮箱，值是 Flowable 中已存在且有相应任务权限的用户 ID；不得映射到共享管理员身份来绕开审批人权限。保存后再点“测试连接”。UI 不会把旧密码回显。

如使用 Flowable 候选组，可在同一范围的 Flowable 配置中增加 `groupMap`，键为 `userMap` 映射后的 Flowable 用户 ID，值为该用户可处理的候选组 ID 数组，例如 `{"flowable-user-alice":["material-reviewers"]}`。服务端只在当前三层 scope 下查询这些候选组，并再次核对任务 tenant；详情、完成和钉钉卡片回调也执行相同的用户/候选组校验。缺少组映射、租户不一致或任务已分配给其他用户时拒绝访问。流程发起的 assignee 还必须是当前范围 `userMap` 中的用户。

启动白名单内的 `materialApproval`、`bomReleaseApproval`、`documentReleaseApproval`、`performanceReviewApproval` 流程时，后端会在该三层范围对应的组合 tenant 中部署对应 BPMN XML 并验证定义。审批任务按当前范围的已验证用户映射查询；任务读取和完成还须同时匹配该组合 tenant 与会话用户映射。引擎一旦配置但不可用，API 返回错误而不是悄悄切回演示模式。真实任务需在 Flowable 中正确配置 tenant、assignee/候选人；本地演示任务不是 Flowable 记录。

## 2. 金蝶云星空 K3Cloud

在 **系统集成与连接器 → K3Cloud → 连接设置** 按内部三元组配置企业批准的 WebAPI Base URL、外部 ERP 账套 ID、服务用户名、外部组织标识、第三方应用 AppId/AppSecret、LCID。AppId 与 AppSecret 输入后只在 PLM 服务端内存中用于加密入库；查询设置不读回。不要把它们放入 Docker 的 K3Cloud 环境变量，Docker 只负责提供 AES 解密主密钥。外部 K3Cloud 的组织/账套参数不会取代内部范围校验；登录会话与查询缓存同样按内部三元组隔离。后端通过官方 LoginByAppSecret 获取短期 cookie，然后调用 ExecuteBillQuery；查询结果最多缓存 60 秒。

生产推荐 HTTPS。K3Cloud 的 HTTP 仅允许受信私有网络范围，连接设置与运行时使用同一校验；不会使用全局 HTTP 绕过。公网 HTTP、回环、链路本地/云元数据地址和 HTTP 域名均不放行；内网域名应改用经批准的私有地址或 HTTPS。URL 不能携带用户名密码、查询参数或片段，登录、查询和元数据请求均不跟随重定向。HTTP 会明文传输凭据及数据，只适用于已批准的可信网络。Flowable 的生产 HTTP 另需 `FLOWABLE_HTTP_ALLOWLIST` 精确 URL 条目；BPMN staging 发布还需单独匹配 `FLOWABLE_VERIFIED_STAGING_URL` 与验证开关。代码库不保存内部 endpoint。

**组织标识如何填写：**填写对应金蝶组织的稳定标识，不是 PLM 内部组织 ID、账套 ID 或组织名称。当前该字段必填，用于连接会话/缓存和物料数据来源身份识别，不传给 `LoginByAppSecret`。物料来源刷新会以 `materialSource.fields.organization` 映射的组织字段执行 `字段 = '组织标识'` 查询，并严格校验返回值，所以必须与该字段的真实值完全一致：映射组织编码字段时填编码，映射组织内部 ID 字段时填内部 ID。没有配置物料来源时，建议统一采用金蝶组织编码。物料过滤值支持 1–100 个英文字母、数字、下划线、点或连字符。更改该值会改变连接/物料来源身份，应保持稳定。

普通单据、主数据及元数据查询不会自动按此值过滤；ERP 可查询范围仍须通过接口用户的金蝶权限和经核实的查询条件控制。此字段不是普通查询的组织权限边界；PLM 内部的租户/组织/账套隔离仍独立生效。

**查询 allowlist 必须从企业已确认的 FormId 与字段中显式填写**，例如：

```json
{
  "BD_MATERIAL": ["FMATERIALID", "FNumber", "FName"],
  "ENG_BOM": ["FID", "FNumber", "FName"]
}
```

具体 FormId、字段名按公司 K3Cloud 版本与授权范围核实，示例不是一份通用授权清单。查询的 FormId 和 FieldKeys 都要在 allowlist 中。`filterString`、排序字段还需遵守服务端过滤与输入长度约束。这个客户端不提供 K3Cloud 写入/建单/正式物料编码生成能力，避免把演示主数据覆盖到 ERP。

新增的 **K3Cloud → 表单与字段** 工作区提供上传只读包中的 FormId/业务链缓存，并区分“源目录标记已核实”“示例引用”和“候选”。这些标签都不是当前 PLM 账套的验证结论：原包的 verified 标记仅属于其来源账套；目录不是完整 FormId 权威清单。字段发现调用 PLM 自有只读适配器的 `QueryBusinessInfo`（即参考包的 `query_metadata(FormId)`），读取当前内部账套已加密保存的凭据；必须先成功测试连接。发现不会读取业务行，也不会自动扩大 allowlist。

管理员从动态元数据中选择可见字段；自定义字段只按元数据明确返回的 Key 标记，不能靠 `F_` 前缀推造。带 `__` 的元数据标识不会作为字段返回；隐藏字段与弹性域父键不可勾选。规范字段映射也只能从本次发现的字段中逐项选取。点击“加入 allowlist / 应用映射草稿”只改页面未保存草稿，之后仍需点击“加密保存配置”才会按当前账套范围持久化。静态目录仅提供有限候选提示：可提示 `SAL_OUTSTOCK`（销售出库）、`STK_InStock`（采购/其他入库）、`SAL_SaleOrder`、`PUR_PurchaseOrder` 以及客户/供应商/员工候选；不会预设字段映射。上传目录没有足够证据确定销项发票、采购收票、应收、应付和 ERP 用户表单，相关 FormId 留给当前账套发现。尤其 `AR_receiveBill` 是收款单、`AP_PAYBILL` 是付款单，不能仅凭名称当作应收/应付余额表单。

销售/采购日报还需在同一加密账套配置中设置 `dailyReportSources`，按企业实际 FormId 将六类来源（销售出库、采购入库、销售订单、采购订单、应收、应付）映射至规范字段；映射字段必须全部在 `formAllowlist` 内。`id` 应是单据行级唯一键，`amountCny` 应是人民币金额，应收/应付需另映射 `settledAmountCny`。保存连接器配置不会自动访问 ERP；管理员主动手动同步或报告发送/计划运行时才读取。报告发送前同步失败会 fail-closed，不发送旧快照或演示金额。余额代表最近一次同步时点，不是按历史报表日回溯的余额。字段清单、金额口径及状态语义必须由企业管理员对照当前 K3Cloud 版本核验。

同一配置还可以设置 `masterDataSources`，分别配置 `customer`、`supplier`、`salesperson`、`user` 的 `formId` 和 `fields`。支持的规范字段仅有 `id`、`number`、`name`、`status`、`category`、`department`、`ownerNumber`、`ownerName`、`modifiedAt`；每类须映射稳定唯一 `id` 和 `name`，其余按需映射且必须在 `formAllowlist` 中。ERP `user` 仅作为账套级只读目录快照，不会创建 PLM 用户、分配角色/权限，也不会读取密码或联系方式。

管理员或 `plm_manager` 可调用 `POST /api/k3cloud/sync` 同步六类日报业务单据和四类基础资料；全部数据源均需配置。`GET /api/k3cloud/master-data` 可读取镜像。定时同步通过 `k3DataSyncSchedule: { "enabled": false, "intervalHours": 1 }` 配置，频率仅支持 1、6、12、24 小时；24 小时任务每天在 Asia/Shanghai 的 02:05 执行。启用前服务端要求全部十类映射及只读 allowlist 齐全；默认关闭。多实例使用按 tenant/organization/account 区分的任务锁，同一账套运行失败时保留主数据上一次完整快照。应用配置使用现有加密连接器存储；本仓库不附带企业凭据或通用 FormId 映射。

## 3. 钉钉机器人与互动审批卡片

在当前内部三元组配置钉钉官方 HTTPS 群机器人 Webhook 与签名密钥，按需配置 `PUBLIC_APP_URL`/应用 HTTPS 地址。后端只向 `oapi.dingtalk.com` 或 `api.dingtalk.com` 发送 Markdown；调用 `reports/send`、计划执行或连接器测试时才发消息。预览链接仅能在配置的同一 HTTPS origin 内生成。

互动卡片另需在各三元组配置中填写企业 CorpId、AppKey、AppSecret、模板 ID、卡片回调签名密钥，并配置 `userMapping`：键 `corpId:userId`，值为该范围 Flowable assignee 用户 ID。回调验证 `x-ddpaas-signature-timestamp` 与 `x-ddpaas-signature`，拒绝超过 5 分钟的签名，并在后端查询当前 tenant/organization/account 组合 tenant 中该用户可处理的任务后才完成审批；不得用只按 userId 的回退映射。

钉钉小程序 SSO 使用单独的服务端应用凭证，但必须通过 `DINGTALK_SSO_TENANT_ID`、`DINGTALK_SSO_ORGANIZATION_ID`、`DINGTALK_SSO_ACCOUNT_ID` 显式绑定到一个现存且启用的内部三元组。登录时可选的 `accountId` 只能与该绑定账套一致，且钉钉身份必须绑定到该范围的有效成员；未绑定完整范围、scope 不存在或成员关系不匹配时拒绝登录。SSO 凭证缺少任一内部 scope ID 时视为未配置。请在钉钉开放平台将回调 HTTPS 地址配置到 `/api/dingtalk/cards/callback`，按钉钉官方说明授权该事件及模板。

机器人 Webhook 和应用回调是不同权限：只接通机器人意味着**通知已可用，但不代表小程序 SSO、互动卡片审批或免登录身份映射已发布**。

## 4. DingTalk Mini-App

小程序源码位置：`dingtalk-miniapp/`。默认调用 `dd.getAuthCode` 取得一次性 authCode，提交到 `/api/auth/dingtalk/mobile-login`；Node 服务端使用应用访问凭证调用钉钉免登接口，验证并换取 `userId/unionId`，再匹配本地已绑定用户。成功后签发 12 小时 Bearer token；小程序将 token 存入 DingTalk storage，后续 API 自动携带。审批接口不允许客户端传递 actor。退出/过期后须重新认证。

发布前管理员必须：

1. 将 `dingtalk-miniapp/utils/api.js` 的 `API_BASE_URL` 替换成真实 HTTPS API 域名（不可包含 API token）；
2. 在钉钉小程序后台登记请求安全域名；
3. 由企业管理员提供应用 Client ID、Client Secret、Corp ID；服务端设置 `DINGTALK_SSO_CLIENT_ID`、`DINGTALK_SSO_CLIENT_SECRET`、`DINGTALK_SSO_CORP_ID`，仅服务端保管 Secret；
4. 先在工作区创建用户并分配其租户、组织、账套和角色；平台管理员再将经企业通讯录核验的钉钉 `userId/unionId` 绑定到该既有用户；
5. 完成钉钉开发者平台审核、授权与发布。

代码已实现上述免登路径，但由于当前未提供企业凭证，**尚未连接或验证真实钉钉租户**。`/api/auth/status` 返回非敏感配置状态；缺少凭证或三层范围绑定时小程序会显示“未配置”。未绑定身份、停用用户/成员、无对应租户/组织/账套成员关系均拒绝登录；登录不自动创建用户或授予角色。个人密码登录仅为备用，并通过每人单次激活链接设置；管理员不分发共享默认密码。真实审批按钮调用同一 `/api/workflow/tasks`、`/tasks/:id`、`/tasks/:id/complete` 服务端路由，并需 `reviewer` 或管理角色。

钉钉官方参考：[企业内部小程序免登](https://open.dingtalk.com/document/development/small-program-application-free-of-registration)、[获取应用 Access Token](https://open.dingtalk.com/document/development/api-gettoken)、[通过免登码获取用户信息](https://open.dingtalk.com/document/development/obtain-the-userid-of-a-user-by-using-the-log-free)。此实现采用官方文档中的“服务端应用级 Access Token + 一次性免登 code 换 userId/unionId”流程；凭证/授权与真实账号映射仍需企业侧完成。

## 5. OpenViking 开发期上下文工具

OpenViking 仅作为**开发期上下文数据库**使用，不是个人待办/PLM 终端用户功能，不会加入生产客户端、Momentum Node API、系统集成配置、启动依赖或生产环境变量。仓库根目录的 `dev-tools/openviking.mjs` 是独立开发者 CLI，与生产客户端和 Node 服务目录分离，不会随应用启动或服务端构建。它只在开发者主动运行 `search` 或通过显式 `--confirm-import` 提交导入时才会向指定 OpenViking 服务发请求；不会自动连接、同步工作区、上传附件或导入项目资料。

CLI 默认指向 `http://127.0.0.1:1933`；它仅允许 loopback 服务地址，不允许远程主机。官方本机 Dev 模式无需 API Key，health 检查不需要模型凭证。搜索/导入目标 URI 必须位于 `viking://resources/projects/personal-todo-project/` 下。脚本在 `NODE_ENV=production` 时拒绝运行。

当前本机开发实例采用官方默认本地中文 Embedding `bge-small-zh-v1.5-f16`、本地文件/向量存储及 `auth_mode: dev`，服务仅绑定 `127.0.0.1`；不配置 VLM 或 API Key，workspace 是独立的 `~/.openviking/data`，不是项目目录。当前机器的 systemd unit 源文件为 `dev-tools/openviking.service`，安装与开机启用方式：

```bash
uv tool install 'openviking[local-embed]' --upgrade --force
export PATH="$HOME/.local/bin:$PATH"
sudo install -o root -g root -m 0644 dev-tools/openviking.service /etc/systemd/system/openviking.service
sudo systemctl daemon-reload
sudo systemctl enable --now openviking.service
```

该 unit 以 `ubuntu` 用户运行，在 `multi-user.target` 启动，异常退出后由 systemd 每 5 秒重启；配置和数据路径不因托管切换而改变。管理服务和查看日志可用：

```bash
sudo systemctl status openviking.service
sudo systemctl restart openviking.service
sudo systemctl stop openviking.service
sudo journalctl -u openviking.service -f
```

另一个终端可执行 `node dev-tools/openviking.mjs health`。首次启用本地 Embedding 可能下载 OpenViking 官方默认 GGUF 权重；这不调用模型 API。本次未启用 Ollama/VLM，也未索引项目文件。

本机当前未配置 VLM，因此 `openviking-server doctor` 会因 `No VLM provider configured` 返回非零；这是有意保留的可选能力缺项，不影响已验证的 loopback 服务启动。`GET /health` 与 `/ready` 均返回 HTTP 200。若之后需要依赖 VLM 的语义摘要/多模态处理，再由开发者明确选择本地 VLM 模型并配置；本次未连接远程推理服务。

示例（本机默认服务启动后，以下 health 命令只访问 loopback；搜索是单独显式命令，导入首次仅预览）：

```bash
# 默认等价于：export OPENVIKING_BASE_URL="http://127.0.0.1:1933"
node dev-tools/openviking.mjs health

# 语义搜索是显式命令，必须明确目标目录与查询文本
node dev-tools/openviking.mjs search \
  --target-uri viking://resources/projects/personal-todo-project/docs \
  --query "项目中某个开发约定是什么？"

# 第一次只显示来源、服务、目标的导入预览，不会发请求。只有确认该资料、目标和服务均获准后，再显式加 --confirm-import。
node dev-tools/openviking.mjs import-url \
  --target-uri viking://resources/projects/personal-todo-project/docs \
  --source-url https://<开发者明确选定并获准的文档地址>
```

脚本基于 OpenViking 官方 HTTP API，使用 `GET /health`、`POST /api/v1/search/find` 与 `POST /api/v1/resources`；原始参考：[本机快速开始](https://docs.openviking.ai/zh/getting-started/02-quickstart)、[服务端部署](https://docs.openviking.ai/zh/guides/03-deployment)、[模型配置](https://docs.openviking.ai/zh/guides/01-configuration)、[认证指南](https://docs.openviking.ai/zh/guides/04-authentication)。OpenViking 的知识导入/索引仍需要本地模型或开发者另行配置模型服务；未获准前不会导入或索引项目资料。

## 6. Redis、环境变量与诊断

Redis 可选，用于跨副本报告锁和 K3Cloud 查询缓存；未配置或不可用时切换到本进程缓存，单副本仍可用，但多副本跨进程去重不保证。报告锁按完整 tenant/organization/account、计划和本地调度分钟隔离；成功发送的调度分钟短期去重，发送失败会释放该分钟锁以允许立即重试，在途发送锁按值比较后释放。通过 `REDIS_URL` 在服务端配置，并启用 Redis ACL、密码和网络访问控制。

环境变量模板见 `server/.env.example` 与 `deploy/ubuntu/momentum.env.example`。K3Cloud 配置仅保存在 PLM 加密账套设置；Docker 环境提供稳定的 `APP_ENCRYPTION_KEY`（64 位十六进制）或持久化密钥文件，不要配置 `K3CLOUD_APP_ID` / `K3CLOUD_APP_SECRET`。典型问题排查：

- API 中「未配置」：检查当前用户是否切换到了另一个 scope（配置按 tenant/organization/account 三元组隔离），以及环境默认值是否完整绑定。
- Flowable 已配置但连接失败：检查 API 主机到 Flowable 的 DNS、网络 ACL、Basic Auth、REST base path 与 Java 服务状态。
- Flowable 可连接但无待办：核对邮箱→Flowable userMap、Flowable task assignee、BPMN 部署 tenant 与待办是否已完成。
- K3Cloud 查询拒绝：检查公司账号授权、LCID/组织、allowlist 的 FormId/列名及该 ERP 版本。
- 钉钉机器人拒绝：核对 Webhook、签名时间、群机器人关键词/安全设置及出口 HTTPS。`send` 接口只返回经过删减的安全错误，不记录凭证。
- 无法解密账套配置：检查服务使用的密钥文件与备份所带密钥一致；不要生成新密钥覆盖旧密钥。

外部系统的网络、真实数据许可、API 额度、数据保留、合规和厂商租户设置由客户组织管理员负责。没有真实凭证/授权时，只能进行本地配置校验和模拟/回归测试，不能称为真实集成。
