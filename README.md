# Momentum｜个人待办与企业 PLM 工作台

前后端分离的中文企业工作台，覆盖个人任务/项目协作、KPI 绩效、物料/BOM/图文档、审批与报告。系统采用真实 REST API 和服务端身份验证；本地可运行并持久化到 SQLite。外部企业服务仍需管理员提供其真实服务地址与凭证，**本项目不会把未配置的 Flowable、K3Cloud、钉钉机器人或钉钉小程序宣称为已连接/已发布**。

## 功能范围

- **个人工作台**：待办新增、完成、撤销、删除、优先级、到期日、项目关联；项目进展、阶段/任务/里程碑/事件周视图甘特图、搜索、响应式动效 UI。
- **KPI 与绩效**：KPI 核定规则及权重、目标、周期、公式，绩效表单、实际值评分、自评/主管评审/归档。
- **物料主数据**：结构化分类、共享维度、产品规格、生命周期与 ERP 权威分组边界；未经规则核验不发放正式 K3Cloud 物料编码。
- **多视图 BOM**：EBOM/MBOM/SBOM 分开版本化；受控来源、配置条件与订单级销售 BOM 快照。
- **图文档**：文档号、修订、生命周期、物料关联；真实附件可上传到服务端受控文件目录，验证文件类型/内容、大小上限 25 MB、SHA-256 校验和，并通过认证 API 下载。
- **流程工作台**：本地流程演练支持意见留痕；配置 Flowable 后使用真实引擎 API 查询、发起、完成任务。
- **报告与钉钉**：账套报告预览、日报/周报计划、手动/计划推送钉钉 Markdown；支持销售/采购日报、按账套配置的 K3Cloud 六类单据只读同步（出库、入库、订单、应收/应付）、单据明细、三维对账、不可变快照及 HTML/多工作表 Excel 导出。真实同步需企业配置凭证、FormId 和 allowlist 字段；未配置时仅明确标注本地演示数据。应收/应付按最近同步时点显示余额。
- **开发期上下文工具**：`dev-tools/openviking.mjs` 为开发者提供本机 OpenViking health/搜索和资料导入命令；默认连接 `http://127.0.0.1:1933`、拒绝远程地址，与生产客户端/服务分离，导入默认只预览。
- **原生钉钉小程序源码**：`dingtalk-miniapp/` 包含一次性 authCode 免登实现、显式密码备用入口、账套选择、待审批列表/详情、审批操作与报告预览；真实应用凭证、身份绑定、安全域名/授权和发布仍待企业管理员完成。
- **账号与多租户权限**：企业（tenant）/组织/account/账套成员关系、单次成员激活链接、平台管理员核验钉钉身份绑定、租户/组织/账套管理页、scope 切换、基于角色的服务端授权、审计事件、连接器按完整 tenant/organization/account 三元组加密保存。

## 技术栈与数据

- 前端：React、TypeScript、Vite、Framer Motion、Lucide。
- API：Node.js 20+、Express、TypeScript、SQLite（`better-sqlite3`，WAL、外键、跨请求版本冲突检测）。
- 持久化：账户工作区、认证会话、账套/组织、成员、审计、加密连接器与受控文件索引写入 SQLite；文档二进制文件独立保存在受限文件目录；报告 cron 和工作流演示记录也通过 SQLite 状态表持久化。
- 凭证：账号密码使用 scrypt 哈希；新成员通过每人唯一、48 小时且仅一次的激活链接自行设置密码；Web 会话通过 HttpOnly/SameSite Cookie（最长 7 天）；移动会话使用服务端校验的 Bearer token（最长 12 小时）。钉钉 SSO 必须在服务端配置企业应用凭证并绑定已存在用户；未配置时不声称已接入。K3Cloud、Flowable、钉钉连接器密文使用 AES-256-GCM，密钥文件默认仅限服务账户访问。

## 本地启动

需要 Node.js 20+。在项目目录打开两个终端：

```bash
npm ci --prefix server
npm ci --prefix client

# 终端 1：API，默认 http://127.0.0.1:4000
npm run dev --prefix server

# 终端 2：前端，默认 http://localhost:5173
npm run dev --prefix client
```

打开 `http://localhost:5173/`。首次只需创建平台管理员（姓名、邮箱、至少 12 位密码），无需预先准备企业、组织或账套资料；系统建立仅用于登录和配置的“平台管理 / 平台组织 / 系统管理账套”。登录后可在 **租户与账套** 页配置真实企业范围并邀请成员。新建业务租户/账套从空白业务集合开始，不复制其它租户或静态预览样例。**没有预置默认密码**。前端 Vite 代理 `/api` 到本机 API。

每个已认证的业务 API 请求会自动携带 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID`。后端逐项与数据库中实际租户、组织、账套归属及服务端会话成员关系比对；缺少或不匹配会拒绝请求。ID 头是范围一致性声明，不是授权凭证，客户端不能通过改头切换到成员关系之外的数据。首次初始化、登录、健康检查与 `/auth/me` 会话恢复是建立/恢复身份的例外。

API 默认数据库路径为 `server/data/momentum.sqlite`，通过 `DATABASE_FILE` 可改变；连接器密钥默认保存在同目录 `.app-encryption-key`，可用 `APP_ENCRYPTION_KEY_FILE` 指定路径。直接配置 `APP_ENCRYPTION_KEY` 时须为恰好 64 位十六进制（32 字节）。文档附件默认存放在 `server/data/documents`，可通过 `DOCUMENT_STORAGE_DIR` 修改。旧工作区 JSON 只在首次管理员初始化时迁移一次到初始账套；后来建立的企业/账套不会继承其他账套私有数据。

新开发环境可复制 `server/.env.example` 为 `server/.env`，只在本地配置所需变量；不要提交密钥或数据库文件。集成设置也可在已登录管理员的 **系统集成** 页面按完整三层范围维护，API 会将敏感字段加密保存并对前端脱敏。共享环境变量默认不会跨范围复用，必须显式绑定完整三元组。

## 验证

```bash
npm run build --prefix client
npm test --prefix server
```

后端端到端回归测试会启动**独立临时 SQLite 数据库**，覆盖初始旧 JSON 迁移、租户/组织/账套头正反向核验、跨账套同 ID 数据隔离、跨范围关联拒绝、成员/评审人 RBAC、连接器配置三元组隔离与环境默认值 fail-closed；报告测试另覆盖计划创建/编辑/启停/删除、预览隔离、无凭据拒绝、在途锁、失败重试与调度分钟去重。Ubuntu 运维回归也会随 `npm test --prefix server` 运行，只在私有 `/tmp` 目录和替身服务命令中模拟发布、回滚、SHA-256 门禁、路径安全及 SQLite 备份恢复，不触碰真实服务或生产数据。钉钉测试凭据为虚构值，官方域名请求被测试预加载器拦截并转到本地 mock；测试不访问真实企业系统。OpenViking 开发工具测试仅验证预览/安全门禁，不访问 OpenViking 网络。测试清理临时数据，不触碰本地持久数据库或真实集成。

## 生产部署准备

部署脚本位于 `deploy/ubuntu/`。Node 服务用 systemd 运行，SQLite、AES 密钥、附件目录均固定在 `/var/lib/momentum/`，不会放入原子 release；备份工具通过 SQLite 在线备份 API 一致性备份数据库，并将加密密钥和图文档附件一并打包。Flowable 8 是独立 Java 服务，另有 systemd 模板与独立 Maven/SSH 原子发布脚本。详见：

- [Ubuntu 主服务部署、SQLite 备份与回滚](deploy/ubuntu/README.md)
- [独立 Flowable 引擎部署](deploy/ubuntu/flowable-service-README.md)
- [完整 REST API 文档](docs/API.md)
- [中文用户操作指南](docs/USER_GUIDE.md)
- [销售/采购日报与 K3Cloud 对账说明](docs/DAILY_REPORTING.md)
- [连接器加密、配置与边界说明](docs/INTEGRATIONS.md)
- [开发期 OpenViking 工具说明](docs/INTEGRATIONS.md#5-openviking-开发期上下文工具)
- [Android APK 构建与配置说明](android-app/README.md)
- [钉钉小程序联调说明](dingtalk-miniapp/README.md)

**当前没有连接或部署到外部 Ubuntu 主机**；SSH 主机、管理员授权、域名/TLS、真实 Flowable/K3Cloud/钉钉凭证均需用户/企业提供。应用不会为发布/部署擅自接受第三方条款，也不会向未经确认的远端主机写入。
