# 多租户与性能收尾验收

本分支基于 `0f4539a4972aed69d5725232f096a3fa5514b3fd`，仅修改服务端认证、通用列表响应、工作区审计与本地测试；未修改导航、样式、物料建档字段。分支：`fix/tenant-performance-20261021`。

## 本次已修复

1. **指定无权限账套登录会被静默替换成默认账套。** 原 `auth.ts` 的 `find(...) ?? scopes[0]` 使拒绝分支不可达。现在明确返回 403，不发 session，并记录拒绝事件。这不是已证实的跨账套数据泄漏，但会造成登录进入非预期工作区。
2. **停用一个账套成员会误撤销该用户其他账套会话。** 原逻辑只按 `user_id` 删除全部 session；现在增加服务端已验证的 `active_account_id` 条件。当前账套立即 401，其他账套仍可访问；全局用户停用仍由每请求验证直接拒绝。
3. **通用列表忽略分页与搜索参数。** 新增兼容式 `page/pageSize/q` 契约，搜索只针对已加载的当前 tenant/org/account 数据，在过滤之后分页，不读取其他工作区。
4. **普通工作区写入缺少统一安全审计。** 所有经 `index.ts` 的 `persist()` 保存的写入，增加 actor、tenant/org/account、方法、路由及适用的对象 ID 审计；业务保存与审计同事务，失败一起回滚。不记录请求正文、令牌或连接器密钥。
5. **关键权限/组织操作先提交业务、后独立写审计。** 成员创建、角色/状态/身份绑定更新、密码重置链接、密码激活、账套切换、租户/组织/账套创建的审计，移动到相应业务事务内。
6. **项目附件删除缺少审计，且先删字节再删元数据。** 现在元数据删除与审计先同事务提交，再清理文件；审计失败时元数据和原文件均保留。提交后文件清理失败仅记录错误，避免让调用方误以为数据库操作也失败；这种情况下可能留下待清理的孤立文件。

## 列表接口契约

不传 `page`、`pageSize`、`q` 时仍返回原数组，保证现有客户端兼容。任一参数出现时返回：

```json
{"items":[],"total":0,"page":1,"pageSize":50,"totalPages":0}
```

- `page` 为正的安全整数；`pageSize` 默认 50、范围 1–200；拒绝分页偏移溢出。
- `q` 为最多 200 字符的单一字符串，去首尾空白，不区分大小写，按固定业务文本字段作字面子串匹配，不执行正则或 SQL。
- 重复参数、嵌套对象、零/负数/小数/指数分页等返回 400。
- 保持现有集合顺序；超出末页返回空数组，`total` 为过滤后的总条数。
- 适用 15 个列表：tasks、projects、materials、boms、documents、reviews、kpi-rules、sales-bom-snapshots、project-phases、project-milestones、project-events、project-reports、project-templates、project-event-reviews、project-template-library。

示例：`GET /api/tasks?q=needle&page=2&pageSize=20`，仍须携带会话及三个与会话匹配的 scope headers。

## 验收结果

`npm run build` 通过。选定的 8 个测试文件合计 **44/44 通过，无跳过**；其中新增 `tenant-performance.test.mjs` 为 16 项测试。最终日志见 `qa-evidence/tenant-performance/final.txt`。

| 验收面 | 具体结果 |
| --- | --- |
| 三层隔离 | 同 tenant/org 的不同账套、同 tenant 的不同 org、不同 tenant 搜索不返回原账套数据；跨范围写入 404，伪造 scope header 403；既有核心 API、文件和外键引用矩阵通过 |
| 分页搜索 | 10,000 条临时任务，分页条数、精确总数、过滤后分页、空结果、超末页、异常输入和 15 个列表的同构契约均通过；不传参数的原数组契约通过 |
| 权限即时失效 | 相同已登录 token 在角色降为 member 后，下一次物料写入 403、允许的读取仍 200；单账套成员停用后该账套 401、另一账套独立 token 仍 200；tenant/org/account 停用及全局 user/member 停用均在下一请求 401，无需重启 |
| 审计成功路径 | 工作区写入含正确 actor/三层 scope；失败或重复写入不新增成功审计；成员与创建租户审计含正确 actor/受影响范围 |
| 审计故障注入 | 在临时 SQLite 设置拒绝特定审计写入的 trigger：工作区写入、成员修改/新增、密码重置、密码激活、账套切换、建租户/组织/账套全部返回 500，业务表、session、激活令牌保持原状；激活令牌之后可正常使用 |
| 附件删除 | 审计失败时文件元数据及字节仍在且可下载；正常删除后元数据和字节清除、审计包含文件 ID |
| 邻近模块 | 表单隔离/授权/版本绑定、BPMN 安全、项目计划、报表定义、集成隔离既有回归通过；集成套件明确输出 `realEnterpriseServicesContacted:false` |

本地 10,000 行、10 次请求的取样：搜索返回 20 项，响应 JSON **2,737 bytes**；p50 **18.59 ms**，最大 **24.97 ms**。计时包含本地 HTTP/解析，受并行测试和机器负载影响，**不是生产 SLA 或容量承诺**。

初始缺陷复现采用最初 12 项新增测试，对未接入修复的基线实现得到 **2 通过、10 失败**，证明无权账套登录返回 200、其他账套 session 被误撤销、分页搜索参数被忽略、工作区写入没有要求的审计。原始输出在 `qa-evidence/tenant-performance/before.txt`；后续新增审计故障和附件测试不包含在这份初始输出内。隔离/分页联合测试当时因缺少分页契约失败，不应据此声称基线存在跨租户数据泄漏。

复现最终验收：

```bash
cd server
npm run build
node --test tests/tenant-performance.test.mjs tests/multitenant.test.mjs tests/forms-http.test.mjs tests/forms-binding.test.mjs tests/bpmn-modeler-security.test.mjs tests/integrations-scope.test.mjs tests/report-definitions.test.mjs tests/project-planning.test.mjs
```

新增测试使用 `mkdtemp`、临时 SQLite/附件目录、127.0.0.1 随机端口、清空的真实业务连接器配置，结束清理。集成回归使用本地 mock，不调用真实 K3/DingTalk/Flowable。构建依赖复用基线工作树现有 `server/node_modules`；依赖软链接不属于提交内容。

## 尚未覆盖，不能宣称全量性能或合规验收完成

- **数据库级分页/索引和高并发容量尚未实现。** `index.ts` 请求中间件仍先 `loadScopedWorkspace()`；`workspace-store.ts` 读取/解析整个 JSON 工作区，`list-query.ts` 在内存过滤切片。因此改善的是返回量和服务端搜索契约，不是消除整库 JSON 解析/线性扫描。`/api/workspace` 与无参数旧列表仍为全量响应；前端尚未迁移到新分页调用。
- **专项模块并非全部改成同一分页契约。** 日报、工作流、成员管理、报表等独立 router 的列表，以及附件列表，不在本次 15 个通用列表改造范围内；它们的完整性能验收需各模块继续完成。
- **即时失效验证的是权限变更完成后的下一请求。** 未验证已经进入异步处理中的在途写请求取消、WebSocket/离线客户端或分布式多节点失效传播。
- **审计尚非完整合规台账。** 未增加不可篡改/保留期/外部归档、独立审计查询权限与导出；现有表仍用 `subject` 表示目标，成员目标多为邮箱，没有独立稳定 target_user_id，也不记录字段级变更前后值；部分新建对象的通用审计只有集合路由。登录/登出/初始管理员建立等 session 生命周期仍沿用既有独立审计写入策略，未纳入本次原子性改造。其他 router 的所有业务操作未逐项证明覆盖。
- 未运行完整仓库测试、浏览器端到端、移动端、真实外部系统联调、生产数据库检查或生产压测。未推送、未合并、未部署。分支可供集成审核，但以上边界不应被计为已经关闭。
