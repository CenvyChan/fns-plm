# 物料模板优先与 WebAPI JSON：本批交付记录

日期：2026-10-15。唯一写入树：E:/DEV/mes/mes/mes-demo/.worktrees/material-code-cascade；分支 codex/material-code-cascade。保留此前未提交改动，本批不提交、不部署、不操作数据库、不写 ERP。

## 来源与本批验收标准

源计划：material-code-authoritative-groups-lifecycle.md、2026-10-14-authoritative-groups-execution.md；本批计划：docs/superpowers/plans/2026-10-15-material-template-webapi-json.md。

用户将交互收敛为“近似物料模板优先 → 新物料差异 → 最终确认 → 完整且确定的 WebAPI JSON”。页面不能把所有 ERP 字段平铺，不得把只包含名称/单位的镜像复制叫作完整模板。

## 已落地

- 主页面及旧矩阵参考页使用全宽表单，四列/两列/一列按实际容器宽度切换；预览不再对半挤压。
- 顶部近似物料按编码或中文名称搜索、查看镜像，再显式读取实时集团00业务模板；应用模板保留已手动编辑字段。若当前未选分组，用模板完整分组编码定位现有权威树；已有分组不被暗改。结构化规格须重新填写，不从原始规格字符串猜测。
- 单位族合并摘要，具体单位、业务控制、默认业务引用折叠到最终确认区。采购组织仅可选择已授权组织；供应商、仓库、车间使用中文/编码远程候选，不提供自由创建编码。采购组织变化清空旧供应商。引用功能失败显示错误，不伪造空成功。
- 新增 GET /api/material-code/preparation/options/{supplier|warehouse|workshop} 与 GET /api/material-code/preparation/template/{materialCode}；身份/权限/组织职责校验先于 ERP 请求。具体 tenant/account 只由服务端上下文决定。所有 ERP 请求固定只读 API，读取前精确账套新登录，读取后检查连接指纹未变。只接收集团00创建/使用、已审核且启用的模板。
- 实时 metadata Key/PropertyName 映射 View 到 Save 字段；处理多语言、枚举、编码引用与单据体形态；剔除源内码、人员、审核、日期、旧号/唯一条码和组织上下文。未知非空复杂字段、缺必填、非法枚举明确阻塞；不盲拷 View JSON。
- Web 生成 BD_MATERIAL 候选 payload，合并名称/分组/规格与选项编码，显示继承、覆盖、新增、剔除清单。固定00/00，不继承来源编码；不同单位不得假定1:1。可复制候选 JSON 或下载带阻塞清单的校验草稿。

## 真实证据与验证边界

独立只读 MCP 成功：10工具、0写工具；查询集团00纸箱样本 3.04.01.00001 的 View 与 BD_MATERIAL 元数据。将两者直接交给 Java 转换器进行只读演算：362项字段处置，266项继承、40项排除、51项未赋值省略、5项空复杂字段保留复核说明；该样本转换阶段阻塞为0。**这不等于最终新物料 JSON 已通过校验，也不证明 MCP 环境与 MES 当前 FNS 绑定一致。** 原始证据只在 ignored 的 .omo/evidence/material-code-cascade，不写入业务库或版本库。

| 表面 | 本批证据 | 状态 |
| --- | --- | --- |
| Web/Vben | card：1440/900/390；group：1440/900/390；matrix：1440/390；真实Vue+模拟API，0运行错误/0ERP写入 | 本地通过，不代替登录验收 |
| 后端/API | 物料相关 Maven 136项，0失败/0错误 | 通过，含精确绑定、拒绝跨组织、权限先行、模板投影 |
| 前端模型 | Vitest 21项 | 通过 |
| 类型/构建 | scripts\mes.cmd web ele-check / web ele-build | 通过 |
| 真实ERP读证据 | MCP metadata/View + Java真实样本投影 | 已取得，未与运行MES绑定对证 |
| 数据库/缓存 | 未迁移、未写数据 | 未做在线验收 |
| UB/后端运行实例 | 未重启、未部署 | 未更新运行实例 |
| Mobile/钉钉 | 本批不涉及 | 不适用 |

GitNexus 对本批新增/未索引符号返回 UNKNOWN，不能宣称 LOW；已用调用链阅读、实际定向回归及 git diff --check 补充，未提交。

## 尚未达到最终验收的事项

“导出可执行 JSON”仍禁用。候选编译器必定列出 SERVER_FINAL_VALIDATION_REQUIRED，不允许客户端自报 ready。以下条件尚未完成：

1. 安全重启本独立工作树后端，新登录后对当前 FNS 调用模板和选项 API，核对具体连接、职责、集团00与错误分支。
2. 原计划 V4.61 测试库迁移、独立同步权限、在线快照成功回读/失败不覆盖/跨账套隔离。
3. 权威 group ID+完整编码与末段规则正式发布、预留编码唯一性与幂等回执。没有已分配编码时不得用 #### 或来源编码生成正式产物。
4. 服务端重新读取模板、合并差异并对目标必填/引用可用性/单位换算/模板分组兼容性进行最终校验；返回验证回执后才能开放正式 JSON 导出。不能把本批前端组装当安全执行边界。
5. 完整 JSON 仍须人工审阅及受控测试账套验收；Save/View/Submit/View/Audit/View(C)及人工分配保持后续独立操作。

整体物料项目、正式JSON交付和集团生命周期**未完成**；本批是模板优先交互与受控候选生成的已验证本地增量。

## 知识与记忆决定

已检索 Blinko“物料 模板 WebAPI”，没有直接相关笔记。本批不新增长期规则或 Blinko Todo：当前MES在线验收未完成，业务偏好与本批结论待用户确认入库；不将单个纸箱样本推广到全部物料分组。
