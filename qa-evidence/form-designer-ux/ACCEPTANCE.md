# 可操作的 PLM 表单设计器

本分支提供真实 API / SQLite 支撑的功能性设计器，不是静态原型。现有 PLM 紫色视觉语言、认证、完整 tenant / organization / account scope、不可变历史版本与受控规则语义保留。

## 本次可自行完成的操作

- 组件面板添加八类字段；在画布选中字段，配置名称、稳定 ID、类型、必填、所属分区；复制、删除、上移、下移。字段重命名同步更新条件与事件引用；被引用字段不能直接删除。
- 分区可新增、改标题/说明、删除；删除分区后字段保留。画布及真实运行器展示分区；字段整体顺序由箭头控制，同一分区若被其他字段隔开会再次显示标题。
- 属性面板设置单/多选选项、数字范围、文本长度、多选数量、安全格式规则；条件面板设置显隐、条件必填、启用及 eq / neq / in 比较。数值条件保留 number 类型，不做隐式字符串比较。
- 受控事件仅 set 标量常量 / clear，按已定义顺序单遍归一化；编辑已有来源不改变其事件顺序。循环、反向依赖及非法定义由服务端拒绝，不执行任意 JS / eval / HTML / URL。
- 保存带 revision 的真实草稿，发布递增且不可变的版本；运行预览明确区分当前草稿与固定发布版本。版本差异摘要支持字段、字段顺序、分区和事件。
- 激活历史版本只切换 activeVersion 回滚指针，不覆盖 latestVersion、历史定义或既有节点固定版本。节点登记持久化 processKey / nodeKey / version / bindingKey，两个流程的同名节点互不覆盖。
- 桌面使用组件 / 画布 / 检查器三栏；窄屏改为组件 / 画布 / 属性与规则切换，避免硬塞三栏。未保存离开提醒、保存中、已保存、发布、冲突与权限错误均有明确状态。

## 实际浏览器闭环

使用本机隔离数据库 `/tmp/plm-form-designer-acceptance.sqlite` 与 `127.0.0.1:4180` 的完整应用，以临时验收身份操作。没有读取、使用或修改生产环境凭据。

1. 经 UI 创建 `ux_material_change` / 物料变更申请，创建「变更基本信息」分区。添加单选「变更类型」、多行文本「变更说明」、数字「变更数量」，配置所属分区和稳定 ID。
2. 可视化设置 mode 为 special 时说明显示且必填；数量范围 1–10。保存并发布 **v1**。
3. 可视化增加 mode=special 的数量启用条件、mode 非空时将 qty 设置为数字 3 的受控联动；将数字标签改为「变更数量（修订）」、最大值改为 5。保存并发布 **v2**。预览 special 后说明出现且必填，数量启用并自动为 3；源为空时数量禁用。
4. 整页刷新、重新选表单、选择固定 **v1**，仍是旧数字标签和 max=10；输入 11 得到原生 validity=false / Value must be less than or equal to 10。不是仅验证下拉文字。
5. UI 登记 `materialApproval / managerReview` → **v2**，再把激活指针回滚到 **v1**。SQLite 重读确认 latest=2、active=1、绑定仍是 v2；历史 v1 max=10、v2 max=5。
6. UI 上移/下移数字字段，确认画布顺序实际改变，再恢复原顺序并保存。
7. 浏览器真实登录会话发送缺 scope 请求返回 **400**；伪造 tenant、organization、account 分别 **403**。仅在隔离 fixture 中临时将该身份的成员关系降为 member，浏览器激活、绑定、发布均 **403**；点击激活按钮显示中文权限不足。随后恢复测试身份的 admin 成员关系，未改密码或其他凭据。
8. 390px 实际同源 iframe 浏览上下文内切换组件/画布/属性，选中字段并显示已保存的条件规则；固定 v1 运行页可操作，innerWidth=390，document scrollWidth=375，无横向溢出。截图只裁出真实 iframe 区域，未缩放桌面、合成或重绘内容；这不是手机硬件或触摸设备测试。
9. 固定 v1 填写有效数据及本地未绑定 task ID 后点击提交，服务端明确返回 **501 verified task adapter unavailable**，submission=0；当前 UI 将此类错误解释为「尚未接入可信流程任务适配器，已阻止提交」。没有假成功，也没有调用远程引擎。

数据库证据：[browser-persistence-final.json](browser-persistence-final.json)。浏览器权限摘要：[browser-checks.json](browser-checks.json)。

## 截图

- [桌面三栏设计与条件检查器](desktop-designer.png)
- [桌面节点固定 v2 与回滚指针](desktop-binding-v2-rollback-v1.png)
- [真实角色拒绝提示](browser-role-denied.png)
- [390px 条件编辑](mobile-390-rules.png)
- [390px 固定 v1 运行](mobile-390-runtime-v1.png)

## 回归及隔离

客户端构建成功，测试 **22/22**；服务端完整测试 **116/116**。新增真实 SSR 测试覆盖分区、旧 DSL 兼容、React 文本转义、规则编辑器与版本治理；真实 HTTP / SQLite 测试覆盖 sections 白名单、激活、绑定、同名节点跨流程隔离、member/reviewer 拒绝、跨 scope 拒绝、历史不可变与旧主键安全迁移。构建仍有既有的 bundle >500kB 提示，安装依赖曾提示 2 个 moderate 漏洞；没有擅自执行破坏性依赖升级。

本地日志：`client-build.log`、`client-tests.log`、`server-full-regression.log`（忽略文件，可本机复查）。依赖仅安装/复制到此 worktree 私有位置，不复用原目录写入缓存。未更改原分支或 main，未 push，未部署。`server/scripts/serve-form-designer-ux.mjs` 仅是回环验收反向代理，不能用于生产信任边界；后端真实路由的 scope / role 验证仍独立执行。

复跑：先分别在 client / server 安装锁定依赖。`server/scripts/start-form-designer-fixture.sh` 使用临时数据库和随机本地加密 key；再运行 `node server/scripts/serve-form-designer-ux.mjs`，默认 API_PORT=4179 / UI_PORT=4180。首次用应用初始化隔离管理员。不要指向生产数据库。

## 距离主流 OA / BPM 的剩余差距

| 优先级 | 差距与影响 | 依赖 / 下一步条件 |
|---|---|---|
| **P0** | 真实 Flowable 任务查询、assignee/candidate 授权、实际引擎节点绑定和 complete / 变量回写尚未实现。当前节点绑定只是 PLM 配置登记；activeVersion 不会改写任务固定版本。 | 需要另行授权的隔离引擎、可信 actor/tenant 映射、服务端 task adapter；不允许拿生产凭据试跑。 |
| **P0** | 引擎任务状态并发、提交幂等、失败重试 / outbox 及跨系统事务尚未完成。 | 要先接可信引擎，再设计任务完成与表单记录一致性；目前正式提交默认 fail closed。 |
| **P1** | 缺少节点级字段读写/隐藏权限、流程候选人图形配置、细粒度读权限与发布审批/审计面板。当前继承既有 admin/plm_manager 写、同 scope 成员读策略。 | 需要明确产品授权矩阵与审计留存策略，不应仅靠前端隐藏按钮。 |
| **P1** | 无复杂 AND/OR 条件树、字段间比较、计算/聚合、可重复子表、附件、签章、异步受控数据源。 | 分步扩展白名单 DSL、服务端类型检查、资源授权与相应迁移；仍禁止任意脚本、HTML 或 URL。 |
| **P1** | 当前分区为线性章节、字段为箭头排序，不是拖拽栅格/多列布局；无撤销重做、键盘快捷重排、批量编辑。 | 可在现有持久化结构上迭代，但不宣称已对齐完整 OA 布局体验。 |
| **P1** | 节点登记没有引擎模型读取/校验或可视化节点选择；版本差异为结构摘要，不是逐控件并排可视差异；回滚指针无完整变更历史 UI。 | 引擎模型 API 与审计机制；目前输入标识符仅做安全格式/固定版本存在性校验。 |
| **P2** | 日期无范围配置；联动仅标量常量与清空；部分高级校验以内置/服务端错误呈现，尚无完整可访问错误汇总与客户端多选数量即时提示。 | 保持前后端校验契约一致再扩展；需额外无障碍与多浏览器/真实手机验证。 |
| **外部许可** | 未安装/分发官方 `@flowable/forms`，没有声称官方 SDK 集成。 | 需确认包访问授权、分发许可、确切版本与现有 OSS 引擎兼容性；自有 DSL / React 设计器不以此包为前提。 |

结论：交付的是可操作、可持久化、可治理版本的 PLM 表单设计器闭环；不是已具备完整引擎能力或已完全等同主流 OA/BPM 的成品。
