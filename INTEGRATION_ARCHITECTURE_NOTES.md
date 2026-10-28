# 企业集成参考资料

## 金蝶云星空 / K3Cloud WebAPI

- [金蝶云星空 WebAPI 接口说明书 V6.0](https://vip.kingdee.com/article/490771221039228672)：WebAPI 提供 `ValidateUser` 登录与会话 Cookie；官方示例说明登录后的会话默认约 20 分钟无请求失效，调用方应复用会话并在会话失效后重新登录。`ExecuteBillQuery` 通过 `DynamicFormService.ExecuteBillQuery.common.kdsvc` 查询，参数包含 `FormId`、`FieldKeys`、`FilterString`、`OrderString`、分页字段；`Limit` 最大 2000。`View`、`Save`、`Submit`、`Audit` 是不同操作，不应混成一个“同步”动作。
- [金蝶官方云星空 OpenAPI 门户](https://openapi.open.kingdee.com/)：介绍 API 网关及 .NET、Java、Python SDK。企业正式接入前，应依据目标账套/版本与授权资料确认适用的 OpenAPI/WebAPI 模式。
- [金蝶云星空系统集成（WebAPI）汇总](https://vip.kingdee.com/article/76278025062688512)：2025 年更新说明指出，公有云新租户可能要求第三方登录授权，传统账号密码登录不适用；生产集成需按实际租户授权方式确定认证流程。
- 当前公开资料/上方接口说明不是目标企业的账套契约。物料/BOM 的 FormId、字段 Key、自定义字段、组织、审批与状态规则必须从目标账套元数据及授权测试环境核验，不能由示例推断。

## Flowable BPMN 引擎

- [Flowable Spring Boot 集成文档](https://www.flowable.com/open-source/docs/bpmn/ch05a-Spring-Boot)：Spring Boot starter 会暴露 Process Engine 与服务 Bean；默认会从 `processes` 目录自动部署 BPMN 2.0 定义。默认 H2 可用于开发演示，持续运行应连接正式数据库。
- [Flowable REST API 文档](https://www.flowable.com/open-source/docs/bpmn/ch14-REST)：REST 可查询任务、完成任务并传递流程变量；任务评论有独立查询接口。审批意见可作为 task comment 留痕，再完成任务并写入同意/驳回变量。
- [Flowable Engine Releases](https://github.com/flowable/flowable-engine/releases)：官方发行页当前列出 Flowable 8.0.0；其发行说明包含 Spring Framework 7 / Spring Boot 4 等重大升级。版本需与目标 Java、Spring Boot 和数据库环境一起锁定，不能在未验证情况下套用旧版 7.x 配置。
- 已从 Maven Central 核验 `org.flowable:flowable-spring-boot-starter-process-rest:8.0.0` 工件存在；Flowable 8.0.0 平台管理 Spring Boot 4.0.2，Flowable 官方父 POM 的 JDK baseline 为 17。项目实际以 Java 21 编译通过。
- [Flowable REST API - Create a new deployment](https://www.flowable.com/open-source/docs/bpmn/ch14-REST)：支持 multipart 上传 BPMN 文件，并允许 `tenantId` 表单字段决定部署租户；运行时按 `tenantId` 过滤流程定义/实例/任务，因此应用可为每个账套分别部署定义并避免共享定义造成的跨账套查询失败。
- 本项目独立 Spring Boot starter 的真实 API 根路径已在运行服务上实测为 `/flowable-rest/process-api`（健康端点 `/flowable-rest/actuator/health`）；通用 Flowable REST 文档中的 `/service` 路径是传统 REST 应用示例，不能直接套用到此 starter。

## 钉钉移动端、工作通知与互动卡片

- [钉钉小程序介绍](https://open.dingtalk.com/document/app/introduction-to-dingtalk-mini-programs)：钉钉小程序与 H5 微应用是不同开发形态；小程序面向企业内部、第三方企业或个人应用，具有不同能力和授权范围。
- [钉钉应用类型介绍](https://open.dingtalk.com/document/orgapp/application-types)：企业内部应用可选择小程序或 H5 微应用；开放能力包含账号授权/免登。小程序需单独建立项目与发布，不等于响应式网页。
- [钉钉小程序目录结构](https://open.dingtalk.com/document/development/mini-app-directory-structure-of-mini-programs)：小程序根目录包括 `app.js`、`app.json`、`app.acss`；页面以 `.js`、`.axml`、`.acss`、`.json` 组成。
- [钉钉小程序网络请求](https://open.dingtalk.com/document/isvapp/send-network-requests)：小程序 `dd.httpRequest` 需将服务端域名配置为应用安全域名；请求通过 HTTPS 访问。
- [互动卡片审批接入流程](https://open.dingtalk.com/document/development/interactive-card-usage-example)：审批卡片可支持整卡跳转到详情页、同意/拒绝按钮和按状态更新；卡片使用 `outTrackId` 作为业务关联 ID。
- [互动卡片事件回调](https://open.dingtalk.com/document/development/event-callback-card)：回调可用 HTTP 或 Stream；HTTP 需要公网域名与回调路由注册及签名校验，Stream 使用 SDK 长连接；回调包含 `corpId`、`outTrackId`、`userId` 与按钮参数，业务服务需校验身份/签名并在 2 秒内响应。
- [发送互动动态卡片 API](https://open.dingtalk.com/document/development/send-interactive-dynamic-cards-1)：发送卡片需要应用 access token、已发布的卡片模板、接收人/会话、`outTrackId` 与回调配置；新接入优先评估新版卡片创建/投放接口。
- [钉钉消息卡片发送与更新](https://open.dingtalk.com/document/isvapp/message-card-sending-and-updating)：卡片可将业务单据摘要作为可点击详情入口，并在审批完成后更新按钮/状态。


## 进一步核实

- 钉钉新版 [创建并投放卡片](https://open.dingtalk.com/document/development/create-and-deliver-cards) 文档（更新于 2026-07-14）给出的 HTTP API 为 `POST https://api.dingtalk.com/v1.0/card/instances/createAndDeliver`；支持 `outTrackId`、模板变量、投放场域与 `callbackType`（HTTP/STREAM）。卡片交互后可关联业务单据并回显审批状态。
- [金蝶 LoginByAppSecret API 参考](https://mcp.qeasy.cloud/api-v2/Kingdee-Cloud/auth-login-by-appsecret) 是第三方整理的接口说明（页面标注来源为金蝶 OpenAPI 门户，不是金蝶官方网页本身）：列出的路由为 `AuthService.LoginByAppSecret.common.kdsvc`，参数为 `acctID`、`username`、`appid`、`appsecret`、`lcid`，成功后依赖会话 Cookie。上线时必须用目标租户授权资料/官方 SDK 验证接口版本及参数；项目默认不发起连接。
