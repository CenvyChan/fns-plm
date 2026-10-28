# Flowable 流程部署说明

本目录提供可部署的 PLM 审批 BPMN 定义。该应用的 Flowable REST 适配器由 Express 服务端代理，不在浏览器中暴露 Flowable 凭证。

## 已提供流程

`processes/plm-approvals.bpmn20.xml` 包含以下 executable process definition：

- `materialApproval`：物料主数据评审
- `bomReleaseApproval`：BOM 修订发布评审
- `documentReleaseApproval`：图文档修订发布评审
- `performanceReviewApproval`：绩效复核

四种流程均包含单个审批任务、审批结果网关及同意/驳回结束分支。审批人从 `assignee` 流程变量读取。

## 部署与环境配置

1. 将 BPMN 文件部署到 Flowable 的 Repository Service。示例使用 Flowable REST deployment endpoint；实际 REST base path 以目标 Flowable 版本及部署配置为准：

   ```bash
   curl -u "$FLOWABLE_USERNAME:$FLOWABLE_PASSWORD" \
     -F "file=@server/workflow/processes/plm-approvals.bpmn20.xml" \
     "$FLOWABLE_BASE_URL/repository/deployments"
   ```

2. 在 `server/.env` 中配置 `FLOWABLE_BASE_URL`、`FLOWABLE_USERNAME`、`FLOWABLE_PASSWORD`。按目标 Flowable 的真实 deployment 回复核验流程 definition key，再启用应用的 live 流程入口。
3. 配置登录网关/身份代理：设置 `TRUST_PROXY_ACTOR=true` 和 `TRUSTED_ACTOR_HEADER=x-authenticated-user`。代理必须先验证企业用户，再移除外部传入的同名 header，并写入自己的用户 ID；绝不能直接信任浏览器提交的 `actor`。
4. 将网关的 SSO/DingTalk 身份映射至 Flowable `assignee` 用户 ID。真实流程发起时必须提交业务类型、业务编号、标题与审批人。

## 服务端 API

- `GET /api/workflow/status`：引擎、模式和身份代理状态
- `GET /api/workflow/tasks`：按可信当前用户查询活动审批任务
- `GET /api/workflow/tasks/:id`：查询任务与任务评论
- `GET /api/workflow/audit`：读取当前用户自己的审批操作记录
- `POST /api/workflow/instances`：发起 allowlist 内的流程定义
- `POST /api/workflow/tasks/:id/complete`：必填意见、添加 Flowable comment 并完成任务
- `POST /api/workflow/demo-tasks`：仅当 Flowable 未配置时可用的本地演示流程

审批意见由服务端在完成任务前调用 Flowable Comment API 写入任务审计；服务端会先校验任务确属当前可信用户，再允许读取或完成。另保存当前用户的本地审计索引供工作台展示。钉钉机器人已配置时，流程发起会发送 Markdown 待办链接，H5 页面通过 `?page=workflow&approval=<processInstanceId>` 定位相应业务待办。

## 边界

- 当前项目未安装或启动 Flowable 服务，也未连接企业身份提供方；BPMN 文件是可部署的流程源定义。
- 未配置 Flowable 时，工作台使用明确标注的本地演示数据。演示审批意见保存到 `server/data/workflow-demo.json`，不代表正式电子签核。
- 多级会签、加签、代理审批、组织架构/角色解析、超时升级及流程版本迁移需依目标企业审批矩阵进一步建模。
