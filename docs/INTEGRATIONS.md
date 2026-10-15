# 企业连接器、加密存储与外部服务

## 通用安全模型

连接器配置按当前账套保存。管理员在「系统集成与连接器」页面提交 URL、服务账号、 allowlist 和映射；后端配置层使用 Node.js `crypto` 的 **AES-256-GCM** 加密敏感字段（认证标签、随机 nonce 与密文一并保存），SQLite 只保存密文与配置 revision。查询设置只返回 Secret 是否已设置，不读回明文；输入框留空表示保持原密钥，勾选“清除现有值”才会移除。

- 密钥必须为 32 字节：环境变量 `APP_ENCRYPTION_KEY` 需要恰好 64 个十六进制字符；否则使用 `APP_ENCRYPTION_KEY_FILE` 指定的本地密钥文件。生产 systemd 默认 `/var/lib/momentum/.app-encryption-key`，由 `momentum` 用户持有，权限应为 `0600`。
- **数据库与密钥必须一起备份。** 只恢复 SQLite 文件而丢失密钥，会使已保存的凭证无法解密；只备份密钥而丢失数据库也不能恢复集成设置。
- 更换密钥不等于轮换：当前没有自动重加密/轮换命令。换密钥前先保存各连接器凭据、停服务、按维护流程导出/重加密，或保留原密钥安全备份。不要在工单、日志、前端、版本库或聊天中记录凭证。
- 每个账套的加密设置优先于 server environment defaults；环境变量适用于首启/默认配置。环境变量本身也须由运维作为密钥管理，不应提交 Git。
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

如果 Node API 与引擎同机，常见 Base URL 为 `http://127.0.0.1:8090/flowable-rest/process-api`；如果跨主机，使用受控 HTTPS 代理 URL。引擎不应暴露在公网。引擎 REST Basic Auth 和不同账套的 BPMN tenant 过滤均由服务端负责。

可在独立测试引擎上复跑完整链路：先在 `server/` 中执行 `npm run build`，再设置 `FLOWABLE_BASE_URL`、`FLOWABLE_USERNAME`、`FLOWABLE_PASSWORD` 并执行 `npm run test:flowable:e2e`。检查会为随机 tenant 部署四个审批定义，创建并完成一条物料审批，最后核对历史结束时间；默认仅允许 loopback 地址，明确授权的非生产测试环境才设置 `FLOWABLE_E2E_ALLOW_REMOTE=true`。不要对生产引擎运行该写入型测试。

### 在 PLM 管理页配置

为相同账套打开 **系统集成与连接器 → Flowable**，填入 Base URL、服务账号、密钥和请求超时。配置 Flowable 用户映射 JSON：

```json
{
  "alice@example.com": "flowable-user-alice",
  "bob@example.com": "flowable-user-bob"
}
```

键是已认证工作区用户的邮箱，值是 Flowable 中已存在且有相应任务权限的用户 ID；不得映射到共享管理员身份来绕开审批人权限。保存后再点“测试连接”。UI 不会把旧密码回显。

启动白名单内的 `materialApproval`、`bomReleaseApproval`、`documentReleaseApproval`、`performanceReviewApproval` 流程时，后端会在该租户部署对应 BPMN XML 并验证定义。审批任务按当前账号的已验证用户映射查询。引擎一旦配置但不可用，API 返回错误而不是悄悄切回演示模式。真实任务需在 Flowable 中正确配置 tenant、assignee/候选人；本地演示任务不是 Flowable 记录。

## 2. 金蝶云星空 K3Cloud

仅配置企业批准的 HTTPS WebAPI Base URL、账套 ID、服务用户名、组织标识、第三方应用 AppId/AppSecret、LCID。后端通过官方 LoginByAppSecret 获取短期 cookie，然后调用 ExecuteBillQuery；查询结果最多缓存 60 秒。生产地址应为 HTTPS；默认拒绝远端明文 HTTP。

**查询 allowlist 必须从企业已确认的 FormId 与字段中显式填写**，例如：

```json
{
  "BD_MATERIAL": ["FMATERIALID", "FNumber", "FName"],
  "ENG_BOM": ["FID", "FNumber", "FName"]
}
```

具体 FormId、字段名按公司 K3Cloud 版本与授权范围核实，示例不是一份通用授权清单。查询的 FormId 和 FieldKeys 都要在 allowlist 中。`filterString`、排序字段还需遵守服务端过滤与输入长度约束。这个客户端不提供 K3Cloud 写入/建单/正式物料编码生成能力，避免把演示主数据覆盖到 ERP。

## 3. 钉钉机器人与互动审批卡片

在当前账套配置钉钉官方 HTTPS 群机器人 Webhook 与签名密钥，按需配置 `PUBLIC_APP_URL`/应用 HTTPS 地址。后端只向 `oapi.dingtalk.com` 或 `api.dingtalk.com` 发送 Markdown；调用 `reports/send`、计划执行或连接器测试时才发消息。预览链接仅能在配置的同一 HTTPS origin 内生成。

互动卡片另需填写企业 CorpId、AppKey、AppSecret、模板 ID、卡片回调签名密钥，并配置 `userMapping`：键 `corpId:userId`，值为 Flowable assignee 用户 ID。回调验证 `x-ddpaas-signature-timestamp` 与 `x-ddpaas-signature`，拒绝超过 5 分钟的签名，并在后端查询当前租户/用户可处理的任务后才完成审批。请在钉钉开放平台将回调 HTTPS 地址配置到 `/api/dingtalk/cards/callback`，按钉钉官方说明授权该事件及模板。

机器人 Webhook 和应用回调是不同权限：只接通机器人意味着**通知已可用，但不代表小程序 SSO、互动卡片审批或免登录身份映射已发布**。

## 4. DingTalk Mini-App

小程序源码位置：`dingtalk-miniapp/`。默认调用 `dd.getAuthCode` 取得一次性 authCode，提交到 `/api/auth/dingtalk/mobile-login`；Node 服务端使用应用访问凭证调用钉钉免登接口，验证并换取 `userId/unionId`，再匹配本地已绑定用户。成功后签发 12 小时 Bearer token；小程序将 token 存入 DingTalk storage，后续 API 自动携带。审批接口不允许客户端传递 actor。退出/过期后须重新认证。

发布前管理员必须：

1. 将 `dingtalk-miniapp/utils/api.js` 的 `API_BASE_URL` 替换成真实 HTTPS API 域名（不可包含 API token）；
2. 在钉钉小程序后台登记请求安全域名；
3. 由企业管理员提供应用 Client ID、Client Secret、Corp ID；服务端设置 `DINGTALK_SSO_CLIENT_ID`、`DINGTALK_SSO_CLIENT_SECRET`、`DINGTALK_SSO_CORP_ID`，仅服务端保管 Secret；
4. 先在工作区创建用户并分配其租户、组织、账套和角色；平台管理员再将经企业通讯录核验的钉钉 `userId/unionId` 绑定到该既有用户；
5. 完成钉钉开发者平台审核、授权与发布。

代码已实现上述免登路径，但由于当前未提供企业凭证，**尚未连接或验证真实钉钉租户**。`/api/auth/status` 返回非敏感配置状态；缺少任一必填配置时小程序会显示“未配置”。未绑定身份、停用用户/成员、无启用租户/组织/账套关系均拒绝登录；登录不自动创建用户或授予角色。个人密码登录仅为备用，并通过每人单次激活链接设置；管理员不分发共享默认密码。真实审批按钮调用同一 `/api/workflow/tasks`、`/tasks/:id`、`/tasks/:id/complete` 服务端路由，并需 `reviewer` 或管理角色。

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

Redis 可选，用于跨副本报告锁和 K3Cloud 查询缓存；未配置或不可用时切换到本进程缓存，单副本仍可用，但多副本跨进程去重不保证。通过 `REDIS_URL` 在服务端配置，并启用 Redis ACL、密码和网络访问控制。

环境变量模板见 `server/.env.example` 与 `deploy/ubuntu/momentum.env.example`。典型问题排查：

- API 中「未配置」：检查当前用户是否切换到了另一个账套（配置是账套隔离的）。
- Flowable 已配置但连接失败：检查 API 主机到 Flowable 的 DNS、网络 ACL、Basic Auth、REST base path 与 Java 服务状态。
- Flowable 可连接但无待办：核对邮箱→Flowable userMap、Flowable task assignee、BPMN 部署 tenant 与待办是否已完成。
- K3Cloud 查询拒绝：检查公司账号授权、LCID/组织、allowlist 的 FormId/列名及该 ERP 版本。
- 钉钉机器人拒绝：核对 Webhook、签名时间、群机器人关键词/安全设置及出口 HTTPS。`send` 接口只返回经过删减的安全错误，不记录凭证。
- 无法解密账套配置：检查服务使用的密钥文件与备份所带密钥一致；不要生成新密钥覆盖旧密钥。

外部系统的网络、真实数据许可、API 额度、数据保留、合规和厂商租户设置由客户组织管理员负责。没有真实凭证/授权时，只能进行本地配置校验和模拟/回归测试，不能称为真实集成。
