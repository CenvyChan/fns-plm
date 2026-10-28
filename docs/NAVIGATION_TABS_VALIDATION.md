# 导航、内部页签与共享样式验收

## 交付边界

基线：`0f4539a4972aed69d5725232f096a3fa5514b3fd`。独立 worktree：`/workspace/plm-navigation-tabs-20261021`；分支：`cue/navigation-tabs-tokens-20261021`。未操作共享主工作树的文件，未 push、合并或部署。

依据 `/workspace/research/dailyReport/DESIGN.md` 及现有日报流程重组已有入口；没有增加业务菜单或虚构接口。日报分析逻辑、`DailyReportingWorkbench.tsx`、`DailyReportingManagement.tsx` 与服务端业务代码均不修改。菜单为大功能区 → 小功能区 → 已有页面，新增/编辑保留在记录页，分析与核对放回对应业务区，低频资料折叠。

## 实际实现

- 内部页签按现有业务 family 保活：销售与采购分开；同一业务的列表/新增/编辑保留同一个工作台实例。页签支持关闭、方向键与 Home/End；菜单重开未保存 family 时回到原编辑子页，而保存/取消仍执行原业务返回行为。
- 切换前保存当前 URL 白名单、筛选元数据与滚动位置；筛选和页签清单保存于 sessionStorage，不保存业务草稿或凭据。账号、tenant、organization、account、role 五维隔离；权限加载结束后才挂载工作区，恢复时重新过滤权限。
- 表单/对话框变更显示未保存标记；普通页签切换保留草稿而不阻断；关闭、刷新、登出及切换账套有离开提示。账套切换的事件可取消；取消后保留草稿。
- 弹窗/侧滑拥有独立页签 portal host；隐藏页的弹窗不可见/不可交互，详情与确认框只在 active 页锁定滚动/焦点。跨 scope 时整树及 portal host 卸载。
- 共享 token 与既有类映射覆盖颜色、字号、间距、表格、表单、按钮、反馈和弹窗视口；不是静态样板。390px 实测溢出的日报操作区通过共享 CSS 修复，完整字段表格保留独立横向滚动。

## 测试

- `npm --prefix client run build`：通过。Vite 仍有基线级大 chunk 警告。
- `npm --prefix client test`：41/41 通过，含新增层级完整性、页面 family、五维 scope key、恢复权限过滤、URL 白名单、视图元数据、安全离开/portal 集成及设计系统契约测试。
- `npm --prefix server run build`：通过。
- `node --test tests/multitenant.test.mjs tests/daily-reporting-admin.test.mjs tests/daily-reporting-empty-master-permissions.test.mjs tests/daily-reporting-empty-state-isolation.test.mjs`（server 目录）：8/8 通过。覆盖 tenant/org/account、角色、字段/接口越权、文件私有访问、日报客商分配和空主数据边界。
- `git diff --check`：通过。

测试只使用独立本地 API（4531）、前端（4530）与临时 SQLite；没有访问或修改生产数据库。通过现有真实 API 建立 26 条销售日报、1 条采购日报、3 条物料及独立租户/组织/账套 B。

## 浏览器验收

桌面约 1280px；窄屏是同源真实浏览器 iframe，CSS viewport 为 390×844（不是设备截图模拟或静态 mock；带经典滚动条时可用内容宽约375px）。未声称做过真实手机、768px 或全浏览器兼容测试。

- 物料搜索“页签验收” → BOM → 文档 → 物料：筛选保留；刷新后筛选与页签恢复，真实物料行可见。
- 销售26条：第2/3页 → 物料 → 返回销售，仍第2/3页；搜索 `NAV-SALES-026` 后仅1条且重置到第1页。刷新后日期和关键词恢复。
- 编辑既有销售记录，修改备注 → 物料 → 返回销售：仍为原记录、原草稿；真实保存经现有 API 成功，列表与详情显示新备注、成功反馈和创建人信息。
- 未保存内容离开：触发真实浏览器 confirm，选择取消后草稿仍在。菜单重开编辑 family 也保留草稿。
- 账套 A 保留关键词 → 切到账套 B，只有B页签、空关键词和0条记录 → 切回A，恢复A原页签与关键词。恢复元数据有400ms适配窗口，验证已等待其完成。
- 滚动250px → 物料 → 销售，布局稳定后恢复250px。采用已观察 DOM 的真实 click 验证，避免浏览器自动化 click 自动滚动目标对读数的干扰。
- 窄屏实开日报、物料、BOM、文档：未发生页面级横向溢出；日报表格 clientWidth315 / scrollWidth699，可独立横向滚动；导航抽屉和三级入口可操作。

## 已知限制与交给 Niko 的交叉项

1. **基线审计缺口**：客商维护与账套切换可查 scoped `security_events`；此次日报更新只有记录的 `updatedBy/updatedAt`，未生成独立安全审计事件。详情只显示创建人/创建时间，没有完整变更历史 UI。本分支不改日报组件/API、不增审计菜单，应由业务审计工作项补齐。
2. 草稿只在内存保活，不跨刷新、关页或重新登录保存；刷新有浏览器离开提示。刷新恢复编辑路由时缺少瞬时 record context 会显示“返回列表选择记录”，不会伪造编辑记录。刷新后列表页码按原组件默认值重置；切换页签则保留页码。
3. dirty 标记是通用表单/对话框变更探测，不是逐字段 diff。保存后表单消失即可清除；保持表单原位的专用编辑器仍需后续显式保存/dirty事件适配。没有改动日报组件以加入此协议。
4. 筛选恢复仅适配明确白名单，不保证设计器画布、复杂自定义控件与所有业务页的状态。保活页的既有异步请求逻辑未重写，服务端仍是最终权限边界。
5. Niko 与日报分析分支整合时，优先保留共享 `design-system.css`、导航注册/页签布局，检查对方新增实际筛选控件是否需要加入 `workspace-view-state.ts` 白名单；不要直接覆盖日报页面实现。

## 本地证据位置

目录：`/workspace/plm-navigation-tabs-evidence-20261021`（不提交本地数据库、密钥、夹具或依赖链接）。

- `client-build.log`、`client-tests.log`、`server-build.log`、`server-regression.log`
- `desktop-daily-save.png`、`desktop-daily-detail.png`、`desktop-unsaved-draft.png`
- `narrow-navigation.png`、`narrow-daily.png`、`narrow-materials.png`、`narrow-bom.png`、`narrow-documents.png`
- `scope-b-isolated.png`、`scope-a-restored.png`
- `audit-evidence.json`、`daily-updated-record.json`（仅本地验收身份/数据）
