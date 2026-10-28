# 自定义流程启动入口：UAT 修复验收

生产基线：`0f4539a4972aed69d5725232f096a3fa5514b3fd`。隔离分支：`fix/custom-process-start-uat-20261021`。本次只处理额外发现的自定义流程 UI 阻断，不代表其余七项已完成。

## 已修复

BPMN 设计器新增独立的“启动已发布自定义流程”面板，不复用四个内置业务流程入口。管理员和 PLM 管理员可启动；模型编辑和发布仍只允许管理员。只读成员可查看固定版本，但启动被禁用，服务端继续执行角色及 tenant / organization / account 隔离检查。

面板展示最新成功发布的流程版本和该不可变图绑定的表单版本。启动需填写标题并勾选确认，再调用已有的 `POST /api/bpmn-models/:id/start`。新增只读 `start-context` 接口不连接引擎，也不返回连接器地址或凭据。启动请求带 `expectedVersionId`；确认后发布版本发生变化会返回 409，而不是默默启动未确认的新版本。

每次明确的新启动生成独立幂等键。请求发送前保留标识；成功后展示实例 ID。若网络、引擎或回执结果不明确，锁定再次提交，切换模型仍保留待核对状态。不会自动重试 POST。

发布预览、列表、审计和表单运行提示不再断言“只能 mock”“尚无适配器”或对 501 作全局推断。模式由服务端配置与既有安全门禁判定：`mock-test` 是隔离测试门禁，可以连接模拟或真实的本地测试引擎；`flowable` 仅对应现有精确 allowlist 和补丁确认标记；未配置或被安全门禁阻断时单独显示。模式不等于实时健康检查，实际启动仍检查引擎连接。

## 测试结果

- 前端构建成功，34 项测试通过；仍有原有大 bundle 提示，不阻断构建。
- 服务端构建成功，141 项测试通过。
- 真实浏览器通过完整应用登录、设计器和启动表单操作，不以截图或静态源代码代替执行。管理员启动成功；PLM 管理员可启动但不可保存模型；member 启动被禁用；未发布模型不可启动；未勾选确认时提交禁用；成功回执和不明确结果锁定均跨模型切换保留。
- 浏览器夹具先发布表单 v1，再发布表单 v2；启动面板仍展示 `uatPinnedForm v1`。本地模拟引擎记录了三次明确操作：管理员成功一次、故意制造不明确结果一次、PLM 管理员成功一次；没有自动重复启动。两条成功记录与一条 uncertain 记录已在 SQLite 核对。
- 真实 Flowable 8.0.0 采用本地已有补丁构件、全新临时 H2 数据库、仅 `127.0.0.1` 监听。API 实际完成：发布表单与 BPMN → 返回启动上下文 → 表单 v2 发布但流程仍固定 v1 → 拒绝旧版本确认 → 启动真实实例 → 同幂等键重放返回同一实例 → 不同请求内容返回 409 → 读取真实任务且原始 `formKey` 为 v1 → 未提交表单不能审批完成 → 校验必填项 → 提交表单与幂等重放 → 完成任务 → 引擎历史存在结束时间。
- 新浏览器夹具和真实引擎脚本使用 scope-bound 环境配置，临时数据库 `connector_configs` 行数为 0。未改任何现有连接器、生产数据库或记录，未调用生产 API 或共享 staging API，未发送外部通知，未合并、推送或部署。

## 证据

- `browser-start-success.png`：管理员启动成功与固定表单版本。
- `browser-manager-success.png`：PLM 管理员启动成功，但设计控件禁用。
- `browser-member-denied.png`：只读成员权限限制。
- `browser-uncertain-locked.png`：不明确结果与请求核对标识。
- `browser-engine-evidence.json`：仅 loopback 模拟引擎收到的请求与实例记录，不含凭据。
- `client-tests.log`、`server-tests.log`、`client-build.log`、`server-build.log`：构建及回归日志。
- `real-engine-e2e.log`：真实补丁引擎端到端 API 日志。
- `patched-parser.sha256`：本次真实引擎使用的 BPMN converter 构件哈希。

## 复现

在此工作树执行：

```sh
npm run build --prefix client
npm run build --prefix server
npm test --prefix client
npm test --prefix server
cd server
node scripts/custom-start-ui-preview.mjs
# 仅隔离浏览器夹具：默认 http://127.0.0.1:4560/?page=workflow
# 测试账号和密码由脚本在终端输出，全部为新建临时测试账号。

# 另行启动采用补丁构件、全新数据库且仅 loopback 监听的 Flowable 后：
FLOWABLE_TEST_ENV=/absolute/path/to/isolated-test-service.env \
  node scripts/custom-start-real-e2e.mjs
```

真实引擎脚本会拒绝非 loopback URL。新测试环境文件必须提供 `FLOWABLE_BASE_URL`、`FLOWABLE_USERNAME` 和 `FLOWABLE_PASSWORD`；不要传入生产或共享业务环境。服务端全量测试会重写旧的 `qa-evidence/bpmn-modeler/http-persistence-evidence.json` 生成夹具；该生成改动不属于本次提交。

## 剩余 UAT 边界

本补丁尚未合并、推送或部署，因此生产页面不会因本轮隔离提交而改变。按授权发布后仍需在批准的共享 patched staging 上完成最终浏览器冒烟；本轮没有访问该连接，不能把本地通过写成共享 staging 或生产已验收。

不明确启动结果仍需管理员按请求标识人工核对引擎和启动记录，现有系统没有自助对账／解锁入口。本修复选择安全锁定而非盲目重试；若 UAT 要求业务人员自助恢复，该能力仍是待办。不支持未发布模型启动、不允许表单自动升级，均为刻意保留的安全限制，不是本次缺陷。

## 安全复审增补：确认版本、重试与保留键

在 `a5d05a115f80218e8bed9222841d3a8459bfcfa7` 之上进一步修复三项 UAT 阻断；不代表其余七项项目全部交付。

- 幂等摘要包含 `expectedVersionId` 的 presence/value：缺省表示没有显式版本确认，与任何显式版本均不同。同键改变确认版本、增加或移除确认版本返回 409；同一缺省请求仍只重放原实例，不会因后来发布而新起实例。旧格式摘要不迁移、不猜测兼容，返回 409，须管理员核对旧记录。
- 启动 UI 采用精确 HTTP 状态码＋错误码白名单。明确未发出引擎启动调用的 unavailable 或安全前置拒绝清除尝试锁并撤销勾选，必须重新显式确认；未知 4xx、一般 5xx、幂等冲突、已记录/进行中、网络或解析异常均锁定，不自动重试。
- 四个内置键 `materialApproval`、`bomReleaseApproval`、`documentReleaseApproval`、`performanceReviewApproval` 在创建、修改、冻结、预览、发布以及自定义部署 adapter 被拒绝。旧库冻结快照也受预览和发布二次防护。UI 显示中文冲突原因，内置流程自身的部署路径不受影响。

本轮证据位于 `../custom-process-start-security/`：最终客户端构建及 35 项全量测试、服务端构建及 143 项全量测试通过；新增 `bpmn-reserved-deploy.test.mjs` 包含四键 adapter 零 HTTP 调用和旧库快照 preview/publish 零部署回归，专门回归 2/2 通过。早期并行编辑中的一次客户端构建曾报 TS2322，修正后最终构建通过；仍保留既有大 bundle 提示。

真实浏览器通过完整登录与启动操作验证：unavailable 时引擎启动数为 0、勾选撤销且提交禁用；恢复后重新确认仅启动 1 次；另一次故意产生引擎结果不明确，跨模型切换后仍无提交按钮，没有自动重试。四键之一在 UI 保存时显示明确错误且数据库未保存该保留键。SQLite 核对恰为一条 started、一条 uncertain，连接器存储行数为 0。截图和脱敏本地引擎/数据库证据在上述新目录。

隔离 patched Flowable 8.0.0 采用全新临时 H2、随机测试凭据和 `127.0.0.1` 监听，完成真实发布→启动→同键重放→不同/移除确认版本冲突→固定表单 v1 提交→审批完成→历史结束时间验证。Converter SHA-256 为 `b3af6e161f2ed5153acf5cff3d2e29c2741dd1edc1baed21a72aa2408a8d6826`。测试引擎已停止。没有访问生产或共享预发、修改现有连接器、发送外部通知、合并、推送或部署；测试夹具内发布流程仅发往回环模拟/补丁引擎，不是业务环境部署。共享预发/生产最终验收仍未执行，不确定结果仍需人工核对。
