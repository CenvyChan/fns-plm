# 在线分组同步与账套快照交付记录

日期：2026-10-15。工作树：E:/DEV/mes/mes/mes-demo/.worktrees/material-code-cascade

## 来源与范围

源计划：[权威分组与集团生命周期](./material-code-authoritative-groups-lifecycle.md) 第一阶段。
实施计划：[账套绑定分组同步及快照](../superpowers/plans/2026-10-15-material-group-snapshot.md)。
本轮只落实在线分组同步和成功快照的代码与本地验证；未提交、未部署、未重启后端、未执行数据库迁移、未写ERP。

## 已实现

- 当前租户与精确启用账套配置，新登录后以同会话执行BD_MATERIAL / FMaterialGroup的QueryGroupInfo。不走公共静态会话缓存，不回退到默认账套或家族别名。
- CONFIGURED_ACCOUNT_LOGIN只证明按当前配置完成登录与同会话查询，不独立证明ERP公司的环境身份，更不批准物料写入。
- 成功结果在MES追加不可变快照，包含租户/账套/操作者、请求时间/完成时间、配置指纹、内容hash及真实节点。按请求时间取最新，失败不覆盖成功历史；配置改变后历史保留但绑定失效。
- GET /api/material-code/groups/snapshot 使用查看权限；POST /api/material-code/groups/sync 使用独立 production:material-code:groups-sync 权限；两者先检查组织职责。请求体不接受客户端指定租户/账套。
- 现有物料编码页新增懒加载“在线分组同步”页签；显示来源、绑定状态和分组树，失败保留现有展示。切换账套清除旧数据并丢弃旧请求响应。
- 此页签不静默替换现有规格草稿树；权威快照与规格/末段规则的正式接入仍需要下一阶段稳定ID映射。
- V4.61迁移与初始化schema增加material_group_snapshot表，节点为LONGTEXT；注册独立权限但不自动赋给角色。

## 验证矩阵

| 表面 | 证据 | 结论与边界 |
| --- | --- | --- |
| Java模块 | .omo/evidence/material-code-cascade/group-snapshot-regression.log | 117项，0失败/错误，BUILD SUCCESS；非真实ERP |
| HTTP传输契约 | K3CloudBoundMaterialGroupGatewayTest | 6项；精确登录参数、同session、QueryGroupInfo字段、登录失败、非法树、配置并发变化；MockRest，不是实际ERP |
| 租户/账套隔离 | MaterialGroupSnapshotServiceTest / ControllerTest / StoreTest | 跨租户、跨账套拒绝，独立权限、SQL作用域/请求排序、大JSON；存储为mock，未做真实MySQL |
| Web模型 | material-group-snapshot/spec/matrix-model.spec.ts | 12项通过 |
| Web类型/构建 | vue-tsc / group-snapshot-build.log | 类型通过；built in 11.01s，插件耗时警告不影响构建 |
| 页面交互 | group-snapshot-browser.log / output/playwright/material-group-snapshot/ | 真实Vue+mock API；宽屏和窄屏深色的空快照、成功同步、失败保留、配置变化、账套切换竞态、权限分离通过 |
| Git | git diff --check | 通过；已有行尾转换警告。新增符号GitNexus未索引，影响UNKNOWN |
| 登录后真实API | 未执行 | 待schema/迁移/权限/后端重启及新登录 |
| 真实ERP绑定 | 未执行 | 不把旧独立MCP证据或本地mock当成FNS绑定证明 |
| UB / 移动端 | 不适用 | 本轮不部署、不涉及移动端 |

## 下一步实际验收顺序

1. 经已有安全密码入口连接唯一允许测试库mes_demo_materialtest，先检查CURRENT_USER()、实际表结构与权限结构，不打印凭据。
2. 检查V4.61是否已存在；按实库结构应用迁移，明确分配独立同步权限，不自动扩大所有用户权限。
3. 使用独立工作树安全启动入口重启后端，重新登录。旧会话token不复用、不写日志。
4. 顶部选FNS，以当前MES配置调用新同步接口，核验登录/会话/账套/树节点；只向MES测试库写快照，不向ERP写入。
5. GET确认当前租户/账套成功快照；用受控失败验证旧快照不被覆盖，用另一账套验证隔离。真实数据库并发顺序另行验证。
6. 通过后再推进group ID+完整编码至末段规则映射、共享字典菜单、最大号只读、集团00生命周期；未配置规则不得发正式号。

## 知识与待办决策

本轮开始Blinko检索“物料分组 账套绑定 快照 同步”未找到相关笔记。由于尚未完成真实环境验收，本轮不写外部项目知识、长期规则或全局记忆。
Todo候选：测试库迁移/权限、FNS真实只读绑定与失败保留验收、权威group映射；尚未得到“确认入库”，不创建外部Todo。
记忆更新候选：账套家族可继承规则证据，但运行连接/组织职责/成功快照必须精确租户与具体账套隔离；等待用户确认，未写长期规则。
