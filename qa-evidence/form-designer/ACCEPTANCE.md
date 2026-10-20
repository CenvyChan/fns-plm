# PLM 表单设计器：隔离 MVP 验收

已完成有真实后端闭环的第一阶段，不是仅渲染控件的原型。草稿、不可变发布版本与 submission 均有 SQLite 持久化；生产 Flowable 任务提交适配尚未接通，默认明确拒绝，不冒充完整 Flowable 集成。

## 分支与隔离

- 基线：`0a2a63cd7c2a444c07309f255b5b47dd6fe1e741`。
- 独立分支：`feat/flowable-form-designer`。
- worktree：`/workspace/plm-flowable-form-designer`。
- 开始时共享仓库为干净的 `feat/dailyreport-function-parity`，HEAD `68bd0cf22b674d2b7d344b4c2bde9d0253c2d24f`；没有切换它或编辑其受控源码。
- `main` 基准引用：`644c4a295db06c271bd5502e335f803e9e5da800`。
- 未 push，未实际部署，未接触远端 Flowable 或生产数据库，未使用生产凭证。测试使用新建的临时 SQLite 与回环地址，既有部署回归仅在其隔离 fixture 内模拟。

**隔离偏差需要明确保留：** 初期为复用已有依赖，在独立 worktree 中软链接了共享仓库的 node_modules。Vite 本地预览/构建因此更新了共享忽略目录 `client/node_modules/.vite` 和 `.vite-temp` 缓存。发现后立即停止预览，改为 `/tmp/plm-forms-mvp-dependencies/` 私有依赖副本，最终回归使用私有副本。共享受控源码、分支和 HEAD 未改变，但不能声称整个共享目录完全零写入。没有为掩盖此事删除可能原本存在的共享缓存。

## 浏览器按钮 → 数据库证据

使用实际完整 PLM 应用、真实本地账号和 `/tmp/plm-forms-mvp-ui/forms.sqlite`，逐个点击：

1. 流程审批 → 表单设计 → 高级 JSON DSL，填写 `mvp_browser_form` 并保存；收到「草稿已保存」。
2. 点击发布，收到「已发布版本 1」。
3. 修改标题字段标签及数量最大值，保存并再次发布，收到「已发布版本 2」。
4. 整页刷新、重新进入设计器并加载表单；选择固定版本 1、点击读取发布版本，仍显示旧标签。
5. 使用必填文本及数字 0，填写本地未绑定任务 ID 后点击提交；服务端明确返回 `verified task adapter unavailable`，没有写入假成功 submission。
6. 切回固定版本 2并读取，显示新标签及固定版本 2；保存最终截图。

用另一只读 SQLite 连接核对结果：草稿 revision=2、latestVersion=2；v1 标签「申请标题」、数量 max=10；v2 标签「申请标题（修订）」、数量 max=5。两份历史定义仍各自存在。浏览器数据库 submission=0，符合未接引擎适配器应拒绝的预期。

数据库快照证据：[`browser-persistence.json`](browser-persistence.json)。最终界面：[`fixed-version-2-browser.png`](fixed-version-2-browser.png)。这些只含隔离 fixture 数据，不含会话 token、密码或生产凭证。

## 自动化真实后端闭环

`server/tests/forms-http.test.mjs` 建立实际 Express 监听器、实际 `createAuthRouter` 注册会话和成员关系，使用临时 SQLite；不是 mock authUser。其他身份通过数据库 fixture 创建真实 session/membership，再由真实认证解析器验证。

覆盖创建/重复 key、读取、编辑、revision 冲突、事务发布 v1/v2、旧版本不变、数据库 UPDATE/DELETE 不可变触发器；验证实际 401/400/403、角色设计权限、tenant/org/account 各层隔离、同 key 独立建表、真实本地客商/用户 lookup 与跨 scope 值拒绝。

运行测试通过明确注入**仅测试内**的本地可信 `FormTaskAdapter`，验证任务 actor/scope/form/version/task/process 逐项一致才允许成功提交；伪造、版本漂移、客户端 process ID/actor ID、未知任务和缺 adapter 均被拒绝。服务端再次检查字段类型、必填、数字范围、文本长度、日期、多选、正则、条件必填/可见/启用、联动规范化。成功提交后重新开只读数据库，核对实际 actor、完整 scope、固定版本、流程实例及值；再通过 HTTP 重读并检查访问控制。

`forms-renderer-contract.test.mjs` 编译实际前端纯规则模块，与服务端函数对比空值（含 0/[]）、条件及单遍联动结果。`forms-dsl.test.mjs` 验证事件幂等/循环及反向依赖拒绝、严格未知键和安全正则；`forms-binding.test.mjs` 验证稳定 form key/version 格式不接受 latest。

私有依赖副本上的最终完整回归：**后端 115/115、前端 19/19 均通过，前后端构建成功**。隔离状态及结果汇总见 [`verification-summary.json`](verification-summary.json)。本地验收服务已关闭。

最终命令和完整输出在同目录的 `server-regression.log`、`client-tests.log`、`client-build.log`；这些 `.log` 为本地验收产物、不纳入 Git。可从新 worktree 安装锁定依赖后重跑：

```sh
cd server && npm ci && npm test
cd ../client && npm ci && npm test && npm run build
```

测试运行环境为 Node 24.19.0。前端构建存在已有的 bundle 大于 500 kB 警告，不是构建失败。

## 下一阶段条件与未完成范围

[API 与适配边界说明](../../docs/form-design-api.md) 中定义稳定引擎键 `plm-form:<key>:v<version>`，以及 React renderer/API 与服务端 `FormTaskAdapter` 边界。

尚未调用远端 Flowable 查询/认领/完成任务，也未验证真实引擎上的 assignee/candidate、过程变量回写、任务完成幂等、事务 outbox 或失败重试。成功 submission 目前仅在隔离测试注入本地可信适配器后验证。正式服务没有公开测试上下文创建入口或 adapter 切换开关。

后续需先确认官方 `@flowable/forms` 的内部仓库访问许可、分发条款、准确版本及与当前 OSS 引擎兼容性；SDK 不是本阶段依赖。若继续真实任务对接，需另行授权的隔离 Flowable 环境和可信 PLM actor/tenant 映射。不得拿生产账号或生产流程作为默认测试条件。

当前正则为受限安全子集，不支持任意 JS 正则；字段联动仅 set/clear 标量常量；日期有真实日历校验但不支持日期范围；历史版本保存定义、不保存历史显示名称；客商状态码沿用现有本地快照，尚未标准化过滤。未更改流程画布。
