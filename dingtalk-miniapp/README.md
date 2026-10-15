# Momentum 钉钉小程序（原生源码）

本目录提供原生小程序源码：工作台、移动账号登录/账套选择、我的审批、审批详情、报表预览。审批和报表均通过 API 读取/写入当前工作区服务端数据，不再使用本地固定演示账号或浏览器 Cookie。

## 已实现

- 默认由 `dd.getAuthCode` 取得一次性授权码并调用 `/api/auth/dingtalk/mobile-login`；服务端向钉钉核验后签发 12 小时 Bearer token。
- 工作区个人密码登录作为显式备用方式；新成员通过本人专属的一次性激活链接自行设置密码。
- 令牌保存在 DingTalk Mini Program storage；后续请求自动带 `Authorization: Bearer …`。
- `/api/auth/me` 会话恢复、`/api/auth/switch-scope` 账套选择、服务端 logout。
- `/api/workflow/tasks` 当前登录人的待办，`/api/workflow/tasks/:id` 受权限校验的真实业务详情，`POST /api/workflow/tasks/:id/complete` 提交必填意见与同意/驳回。
- 审批 actor **不由客户端声明**；API 从已登录身份、账套角色和 Flowable user map 推导。
- `/api/reports/preview` 实时工作区统计及 Markdown。
- 401/会话失效会清除本地 token 并跳转登录；支持退出。

## 部署前配置

1. 编辑 `utils/api.js`，将 `API_BASE_URL` 替换为实际 API 的 HTTPS origin，例如 `https://plm.example.com`（不要添加 token；API path 已包含 `/api`）。
2. 在钉钉小程序管理后台登记该域名为 HTTPS 请求安全域名，并按本企业开发工具要求安装/运行原生小程序工程。
3. 在 API 服务端设置 `DINGTALK_SSO_CLIENT_ID`、`DINGTALK_SSO_CLIENT_SECRET`、`DINGTALK_SSO_CORP_ID`；Secret 只能放服务端受限环境文件。
4. 由平台管理员创建既有工作区成员、分配账套角色，并把经可信通讯录核验的 `userId/unionId` 绑定到该用户；钉钉登录不会自动创建用户或授予权限。
5. 页面使用 `utils/api.js` 的 API 路径；API 服务器需开启对应 HTTPS/CORS/代理访问。`/api/auth/status` 提供不含凭证的 SSO 配置状态。

> **身份边界：** SSO 代码路径已实现，但当前企业 Client ID/Secret/Corp ID 尚未提供，故尚未连接或验证任何真实钉钉租户。未配置时页面明确显示未配置状态。身份未绑定、成员停用或无有效成员关系都会拒绝访问；停用成员的会话会撤销。钉钉机器人 Webhook 不等同于小程序 SSO。不得把应用密钥、密码、机器人 Webhook 或 Flowable 凭证嵌入客户端源码。

## 页面结构

```text
app.js / app.json / app.acss
pages/login/                 企业账号登录、账套选择
pages/home/                  当前用户与账套、审批/报表快捷入口
pages/approvals/             当前 scope 待审批列表
pages/approval-detail/       真实业务预览与必填审批意见
pages/report-preview/        报告摘要和 Markdown
utils/api.js                 认证、Bearer 注入与统一 API client
```

本地语法检查：

```bash
node --check pages/login/index.js
node --check utils/api.js
node -e 'JSON.parse(require("node:fs").readFileSync("app.json", "utf8"))'
```

此目录准备了代码与 API 接口；真实钉钉企业凭证、安全域名、企业授权/审查及 miniapp 发布仍未提供或完成，因此不声称已接入实际组织或发布到钉钉。
