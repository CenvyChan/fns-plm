# 并行参数物料预览交付记录

日期：2026-10-14。唯一修改范围：E:/DEV/mes/mes/mes-demo/.worktrees/material-code-cascade。
源计划：docs/superpowers/plans/2026-10-14-material-code-matrix-preview.md。
源设计：docs/materialCode/material-code-cascade-progression-calculation.md。

## 本批实现及操作方式

既有 /production/material-code-cascade 路由默认显示“并行参数与ERP预览”。输入分成主分类与组织、并行维度、身份规格、ERP主数据四区。右侧自动显示候选编码、段来源、K3Cloud物料卡以及BD_MATERIAL Save候选载荷，支持复制和下载草稿。旧“已发布规则 · 编码保留”标签保留，不将草稿直接接到既有reserve接口。

演示路径：成品 → 注塑件 → 冷插骨架 → 单槽型 → 注塑材质PET；创建/使用组织001；填写名称及规格、单位/分组引用编码。候选结果101010101####。另有半成品冷插骨架201010101####、五金成品机壳/SPCC/电泳102020101####、五金毛坯机壳/SPCC/固定00：202040100####。

####是未分配流水占位，不是已保留号码。预览不占号、不写分配数据库、不调用ERP。单位、分组和子实体结构仍为待目标账套元数据核验的映射候选，不能把导出的JSON直接执行Save。真正的ERP按钮禁用；没有Submit/Audit。

## 可维护来源

- 人工图片字典与节点：src/test/resources/material-code/matrix-fixtures.json；231节点，16待确认值保留审计，不转为READABLE。
- 分支及规格配置：scripts/material-code/preview-branch-rules.json；六主族、三共享维度域，120叶分支；98草稿可演算，22因命名空间/材料适配证据缺失阻断。
- 生成入口：node scripts/material-code/build-preview-matrix.mjs。
- 运行时产物：src/main/resources/material-code/preview-matrix.json；生成文件，不在Vue复制规则。
- 漂移检测：node scripts/material-code/build-preview-matrix.mjs --check。
- 节点检查：node scripts/material-code/validate-matrix-fixture.mjs src/test/resources/material-code/matrix-fixtures.json。
- 全组合检查：node scripts/material-code/validate-preview-matrix.mjs；6,901个可读字典组合前缀无碰撞。该演算不是工艺组合批准。
- 负向检查：validate-preview-matrix.mjs --mutate-top-class / --mutate-fixed，两者必须退出1。

维护配置→重新生成→静态检查→Java/Vue测试→浏览器场景。规则状态固定DRAFT；图片可读不等于业务批准。总类一位、流水四位/起点1/步长1和身份字段范围是明确草稿假设。尚无业务人员用的编辑/发布/停用管理页面；正式发布及持久化并行维度分配不是本批交付。

## 风险与安全边界

GitNexus新符号在当前索引未找到，风险UNKNOWN，不将0调用者解释为低风险。旧QA的exercisePage影响分析：一名直接调用者main，两个上游记录，LOW；仅适配默认标签，不修改原有分配业务函数。新API复用account/resolve授权，不能信任客户端组织字段。验收以调用链、真实针对性测试及diff check补足索引不足，未提交代码。

新预览服务不含repository/ERP client/sequence allocator；writeAllowed恒false。正式分配仍由既有ACTIVE规则引擎和现有账户级唯一性、幂等事务控制。本批没有宣称新矩阵已接通正式发布、真实Save或生产完整流程。

## 证据矩阵

| 面 | 验证 | 结果 |
| --- | --- | --- |
| Java/API契约 | MaterialCode*Test、MaterialSpecNormalization*Test、K3CloudMaterialMasterGatewayTest | 79 tests，0 failures/errors/skips，BUILD SUCCESS |
| Web纯逻辑 | Vitest 3 suites | 11 tests通过 |
| Web编译 | vue-tsc --noEmit --skipLibCheck；Vite生产构建 | 类型通过；built in 9.79s |
| 新Web浏览器 | 真实生产Vue及路由；模拟API，1440×900/390×844 | 四分支、结构化规格提交、账套切换清空、迟到响应丢弃、父级重置、业务错误清除旧码、禁用分支、无权限、下载、暗色、无横向溢出通过；ERP writes0；运行时errors0 |
| 原Web浏览器 | material-code-qa.mjs --mode fixture | 旧级联、结构规格、保留、409、UNKNOWN不重发、回读、模板白名单、仅查看权限及无权限、暗色通过 |
| 草稿规则 | 生成一致性、231节点检查、6,901组合碰撞检查 | 通过；错误命名空间/固定补位负向测试失败符合预期 |
| 数据库/缓存 | 新预览不读写分配库；未新增表或DDL | 无生产或disposable数据写入；现有分配回归通过，不等价真实DB集成验收 |
| K3只读 | 新独立stdio readonly进程，刷新后的User环境；BD_MATERIAL元数据及001组织1条查询 | 10工具、0写工具；传输可用，但ERP返回ErrorCode500/MsgCode1/IsSuccess=false（会话丢失）；PENDING_EXTERNAL |
| 本地真实联调 | 2026-10-14测试JVM PID48332监听8080；Swagger/OpenAPI200且包含两个新矩阵端点；匿名GET矩阵/POST预览/组织401；5778前端200 | HTTP_READY，新API已注册；登录后实际账套/组织/预览验收PENDING_EXTERNAL；当前启动日志未取得，不伪造Tomcat标记 |
| Mobile/H5/钉钉 | 非本批请求范围 | not applicable |
| UB/生产部署 | 未提交、推送、合并、部署 | not applicable |

日志：.omo/evidence/material-code-cascade/matrix-backend-regression.log、matrix-typecheck.log、matrix-vite-build.log、matrix-browser-qa.log、matrix-legacy-browser-regression.log、matrix-k3-readonly-probe.jsonl。
浏览器截图为fixture依赖，不是真实ERP结果。截图副本见.omo/evidence/material-code-cascade/matrix-browser/。

## 外部验收与回滚

本地测试前端：http://172.16.78.177:5778/production/material-code-cascade。
唯一测试库mes_demo_materialtest；启动助手先检查DATABASE()/CURRENT_USER()，再启动8080；ERP禁用，schema/SQL初始化禁用，密码仅进程内；独立JWT可能要求重新登录。助手无Stop-Process，不停止其他服务。凭据不输出或保存。

运行态仍待用户隐藏输入后确认启动、401授权边界及登录页面实际请求。真实ERP字段核验和正式规则批准未完成；不要误将构建通过等同端到端完成。
回滚只撤销本批新工作台入口及对应文件，保留用户和前序所有未提交改动；没有DB迁移/ERP写入需要回滚。

## 知识与记忆决策

任务开始已检索Blinko“物料编码 并行维度 规则预览”，无直接相关记录。notify=false，MCP configured=true，API200，daemon200。当前尚无真实运行态/ERP字段验收，暂不把草稿假设写为项目知识或长期规则。可复用候选：并行共享域不复制到分类树、预览不占号、未核验载荷只读。待用户确认后再入长期记忆。
待办候选：完成真实测试后端联调；通过readonly MCP核验BD_MATERIAL；确认正式段序/命名空间/流水/身份字段并交付发布与分配切片。未收到“确认入库”，不创建Blinko Todo。

完成级别：实现/本地静态和fixture验证已完成；真实测试后端联调PENDING_EXTERNAL；非端到端完成。

## 2026-10-14密码输入后运行态更新
旧临时argfile已清理，Maven离线重建217项classpath依赖到本worktree .tmp；先验证Windows转义守卫和Java离线参数解析再启动。用户隐藏输入后DATABASE()/CURRENT_USER()守卫通过；新PID48332确定拥有8080，并加载本worktree argfile/main。HTTP_READY不等同登录后端到端完成。用户手工调整sys_config后报告FNS/HH启用、FNSDEV/HHDEV停用，真实授权选项尚待用户登录验证；MES sys_config与readonly MCP User环境独立。新JVM保持ERP禁用，无真实写入。浏览器连接仍Codex auth token is unavailable，不提取cookie/进程凭据绕过。无需再次输入DB密码；保持助手窗口打开并在5778重新登录。证据：.omo/evidence/material-code-cascade/matrix-live-runtime-20261014.json。

## 2026-10-14 FNS职责最小补齐及真实API验收
用户报告切换FNS后ACCOUNT_SCOPE_DENIED；真实GET matrix/rules403、organizations200空列表复现。已核对FNS组织001/internal100071存在，admin没有FNS组织职责。仅通过本地8080现有职责管理API在mes_demo_materialtest创建MATERIAL_CODE_OPERATOR目录id22和tenant1/admin1/FNS100071 ORGANIZATION范围分配id46；未修改授权代码，没有新增002/HH范围，没有覆盖FNSDEV旧分配。真实后端及5778前端代理回验：organizations返回001·FNS，matrix200六物料族，matrix-preview200返回102020101####及BD_MATERIAL候选报文，writeAllowed=false。FNS002及HH001请求仍403，所有旧分配不变。旧ACTIVE rules在FNS返回空数组，不把FNSDEV已发布规则自动迁移；不影响新矩阵工作台。证据matrix-fns-scope-fix-20261014.json不含token/密码。回滚按id46停用本次新增分配，保留旧职责。页面待用户点击刷新规则确认真实UI。Blinko检索本次阻断无直接相关笔记；暂不写长期规则或Todo，确认后再入库。

## 2026-10-14 用户确认账套家族与配置复制
用户确认FNS/FNSDEV同账套家族并批准将源规则复制至FNS。canonical mes-erp-workflow references/account-family-customizations.md和formid-catalog.md已有家族规范：同族已验证事实默认继承，目标证据确认差异时拆分；禁止跨族继承。当前操作不是自动运行态fallback，不扩大授权。通过隐藏输入密码助手先核对DATABASE()/CURRENT_USER()和实际information_schema，取得源/目标快照后，只事务复制material_code_rule、material_code_rule_node、material_spec_definition；目标已有同族版本则失败，不覆盖。源id1→目标id2，QA_MCC_20261013 / QA_ONLY_V1，ACTIVE但qaOnly=true，3nodes+2fields；不是231节点生产规则。源JSON与测试标签完整保留。事务前后FNS counters0/allocations0、FNSDEV counters1/allocations1；本批不写上述运行态表。真实5778代理读FNS规则200，预览QA20261013.A-0001，allocationId=null/PREVIEW；没有reserve、Save、Submit、Audit。源API内容不变，目标除DB id外契约完全一致。原并行矩阵仍DRAFT，顶部####提示继续保留。旧标签页面刷新后应出现QA测试专用规则。证据matrix-family-rule-copy-20261014.json/sql。定向回滚先检查目标id2的后续分配引用，没有引用才考虑删除对应目标配置；有引用保留历史并停用规则，不动源规则、不回滚流水。
知识检索“FNS FNSDEV 账套家族”无直接Blinko项目笔记；仓库已有canonical规范，不重复创建长期规则。记忆候选：规则定义/已验证映射可同族继承，权限/流水/分配/ERP身份按具体账套隔离；正式数据发布仍需保留证据等级。待确认入长期规则；Todo未创建。
