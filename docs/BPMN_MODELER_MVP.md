# PLM BPMN 可视流程：隔离 MVP

本实现只面向独立开发和自动化验收。没有部署生产，没有向现有 Flowable 实例提交模型，也没有修改当前共享工作树或 main。

## 安全边界

浏览器使用开源 bpmn-js 和自有最小 Flowable moddle 描述符，不依赖 Flowable Cloud Design 或商业 UI。描述符不是 Flowable 官方发布物；后端不信任浏览器导出的 XML，也不提供 XML 上传或源码编辑接口。后端只接收受限 JSON 流程图，校验后生成部署 XML，并在发布边界再次检查允许的 XML 词汇和结构。

支持开始事件、结束事件、用户任务、顺序流与排他网关。分支条件限于 `approvalDecision` 的 `approved` / `rejected` 或默认分支，不接收任意表达式。暂不支持循环、并行网关、子流程、调用活动、脚本任务、service task、任务/执行监听器、事件脚本或任意 URL。不能将本功能理解为“任意 BPMN XML 的安全导入器”。

用户任务从当前 tenant / organization / account 的有效 PLM 成员或角色选择。Flowable 身份由现有 scope-bound connector 的 `userMap[email]` 在服务端解析。角色转换为当前有效成员的 `candidateUsers` 快照，不把 `groupMap`（引擎用户 → 候选组）误作角色映射。冻结版本时存在未映射成员即失败；用户不需要输入原始引擎 ID。

## 保存与发布

草稿以修订号进行乐观并发控制；冻结后的图、XML 与 SHA-256 持久化为不可变版本。发布前必须预览差异，并提供短时、一次性、绑定作用域及版本的确认令牌。管理员权限、三维 scope 和审计由服务端强制执行，不仅是隐藏按钮。

发布复用现有加密连接器，Flowable `tenantId` 格式与现有审批集成一致：`tenant:T:organization:O:account:A`。重复或并发发布不能无意增加引擎定义版本；网络结果不明确时记录为 uncertain，禁止自动重试，须另行核对。

**真实引擎发布默认阻断。** 仅测试环境显式开启 mock 模式且 connector 指向 loopback 时，才能走发布闭环。该模式只是开发测试通道，不是生产发布开关。

## 为什么不能发布到现有 Flowable 8.0.0

[GitHub 公告 GHSA-8x6x-vw5h-q563](https://github.com/advisories/GHSA-8x6x-vw5h-q563) 标为 **Unreviewed**，描述 Flowable through 8.0.0 的 `ProcessDiagramLayoutFactory.parseXml()` XXE；公告的受影响版本和修复版本字段均为 Unknown。不能声称厂商已确认某版本修复。

[上游问题 #4216](https://github.com/flowable/flowable-engine/issues/4216) 指出仅启用主 BPMN 转换器的 safe-XML 标志不能覆盖图布局解析路径。[关联修复 PR #4254](https://github.com/flowable/flowable-engine/pull/4254) 提出了禁用 DTD、外部实体、XInclude 等措施，但本次读取 [GitHub API 状态](https://api.github.com/repos/flowable/flowable-engine/pulls/4254) 为 `open`、`merged:false`、`merged_at:null`。尚无据此可以确认的已发布修复版本。

PLM 允许列表和规范 XML 是纵深防御，**不证明引擎漏洞已修复**。生产发布仍需独立验证厂商修复或经审查的引擎补丁/缓解措施，同时限制部署权限、隔离引擎文件与网络出口，并对主引擎和 Flowable 5 兼容路径做恶意 XML 回归。本次不改远端配置。

## 本地验收

在此独立 worktree 中执行：

```sh
cd server
npm ci
npm run build
node --test tests/bpmn-modeler.test.mjs tests/bpmn-modeler-security.test.mjs
cd ../client
npm ci
npm run build
npm test
cd ../server
node scripts/bpmn-modeler-preview.mjs
```

预览启动器只创建临时 SQLite，启动 loopback 模拟 Flowable 并配置测试连接器，静态 UI 默认在 4510、API 在 4511、mock 在 4512。启动器输出临时数据路径和仅供该隔离实例使用的测试登录信息。不要将它当成生产启动脚本；退出后不应依赖该临时数据库长期保留。

HTTP 验收覆盖草稿保存、进程重启后恢复、不可变版本、显式确认发布、scope 越权拒绝、非管理员写入拒绝、恶意模型拒绝和本地 mock tenantId。证据写入 `qa-evidence/bpmn-modeler/http-persistence-evidence.json`，不包含生产凭据或真实业务数据。

## 仍需真实引擎联调

在漏洞修复/缓解通过独立验收之后，才可在额外隔离的真实 Flowable 环境验证：Flowable 8 对生成 XML 的导入与 ProcessValidator 校验、部署 tenantId 与定义版本、用户任务候选人/认领语义、排他条件运行、历史实例与已有表单/业务审批的绑定、服务端 DI/图布局行为，以及超时/重启后的部署对账。当前 mock 只能证明 PLM UI → API → SQLite → 连接器请求的闭环，不能证明这些引擎运行语义。

本 MVP 不自动替换现有四类业务审批定义，不会将新模型直接接入生产业务发起路径；现有 startProcess 的批准流程白名单保留。

## 本次实际验收结果

前端生产构建和服务端 TypeScript 构建均成功。服务端运行新增 BPMN 测试及四组既有鉴权、scope、连接器、报表回归，共 19 项通过；客户端共 17 项通过（含 moddle 真实 XML roundtrip、React SSR smoke 和既有页面测试）。客户端仍有构建体积提示，当前未做额外代码拆包。SSR/源码规则断言不冒充浏览器运行时测试。

另在最终代码的 loopback 预览中通过真实浏览器按钮完成：进入「流程审批 → BPMN 模型设计」、新建、修改名称、分配方式切换为 PLM 工作区角色并选管理员、保存草稿、校验、冻结 v1、预览差异、勾选确认、明确确认发布。页面返回「发布请求已完成」，仅本地 mock 收到请求。随后从临时 SQLite 独立查询到 revision=2、冻结 v1、`published` 记录、mock 部署/定义 ID，以及 create/update/version_created/preview/publish_started/published 审计链。库原生 bpmn.io 回链水印已恢复且可见，许可证原文已保存。

证据位于 `qa-evidence/bpmn-modeler/`：`browser-persistence-evidence.json` 是浏览器操作后的数据库查询结果；`http-persistence-evidence.json` 是自动 HTTP 回归后的版本、部署与审计记录；两张 PNG 分别展示发布成功状态和原生水印；`server-tests.log`、`client-tests.log` 和两端构建日志保存执行结果。全部使用合成测试账号、临时数据库及 loopback mock，无生产业务数据或凭据。

新增测试实际覆盖：外部 XML/DTD/XXE/命名空间及危险词汇拒绝、无效/脱离节点/环路/非法字段拒绝、scope 与管理员写入隔离、revision 冲突、进程重启后持久化、冻结版本及审计表 UPDATE/DELETE 触发器阻断、角色展开、排他条件与默认分支、节点/分配/布局/连线增改删差异、连接器/身份映射变化、发布基线变化、令牌重放、重复与并发发布仅发送一次。模拟网络失败后记录 uncertain，重试、改用新版本和重启进程均不能绕过阻断。

发布认领使用 SQLite immediate 事务和模型级 partial unique index；版本、审计及发布状态变更对应审计写入保持事务一致性。确认令牌还绑定操作者、连接器配置指纹、冻结 XML hash 和上次发布基线。超时或服务重启留下的 deploying/uncertain 采用保守阻断；本 MVP 不提供手动「清空后重试」按钮或自动对账/恢复接口，须后续在隔离真实引擎制定幂等部署核对流程。

第三方版本固定为 bpmn-js 18.31.0、bpmn-moddle 10.3.1；Flowable descriptor 是项目自有最小适配，非官方完整 schema。服务端 saxes 6.0.0 只作无外部资源加载的语法检查，另加规范 XML 标签/属性/表达式允许列表；图结构及成员映射仍由服务端校验。引擎 ProcessValidator、真实任务运行、表单及既有 PLM 业务审批绑定仍在前述真实引擎联调范围内。
