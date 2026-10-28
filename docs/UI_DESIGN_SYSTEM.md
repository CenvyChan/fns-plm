# 共享 UI 设计系统

适用范围：现有日报、物料、BOM 与文档预览界面。`client/src/design-system.css` 是已在主入口加载的低侵入共享层；不负责导航或业务状态，也不替代各模块组件样式。日报基线参照 [`research/dailyReport/DESIGN.md`](../../research/dailyReport/DESIGN.md)，并尊重现存 `.dr-*`、`.plm-page`、`.plm-table`、`.materials-table`、`.bom-*`、`.document-preview-*` 类名。

## 视觉原则

- 运营 ERP 内容紧凑、平静、优先便于扫描；延续现有浅色内容表面和紫/靛蓝主操作色。
- 优先使用清晰文本、边框和状态标签；不能只用颜色表达错误或分配异常。
- 保留业务组件自己的布局、图表及设计器画布。共享规则只作用于 `.dr-section`、`.plm-page` 和既有预览弹窗。

## Tokens

| 类别 | 共享变量 | 用法 |
|---|---|---|
| 字体 | `--ui-font` | DM Sans、Noto Sans SC、系统字体回退；数字优先使用现有等宽/制表数字设定 |
| 文本 | `--ui-ink`、`--ui-text`、`--ui-muted` | 标题/正文/辅助信息；关键数据应有足够对比度 |
| 表面与边线 | `--ui-surface`、`--ui-surface-soft`、`--ui-line` | 白色内容表面、柔和表头、分隔线 |
| 动作 | `--ui-accent`、`--ui-accent-hover` | 主操作及键盘焦点 |
| 语义 | `--ui-success`、`--ui-warning`、`--ui-danger` | 成功、警告、错误；同时提供文字/图标说明 |
| 间距 | `--ui-space-1/2/3/4/6` | 4/8/12/16/24px 基准网格；紧凑表单可用4px细分 |
| 圆角/焦点 | `--ui-radius`、`--ui-focus` | 小型控件圆角与可见焦点环 |

## 组件约定

- **表格**：日报 `.iw-table-wrap`/`.dr-k3-table` 与 PLM `.plm-table-wrap`/`.bom-line-wrap` 横向溢出时滚动，不截断、不隐藏列或数据。表格可保留适合内容的最小宽度。表头需可辨认，行分隔稳定，数值宜右对齐且使用等宽数字。
- **表单**：沿用 `.dr-form`、`.form-label` 和现有输入类；每个输入有可见标签，错误同时使用文字和 `aria-invalid`。`:focus-visible` 提供清晰焦点环；禁用态与只读态需区分。
- **弹窗/侧滑**：沿用 `.material-modal`、`.bom-modal`、`.plm-modal` 与 `.document-preview-modal`；限制在视口内，内部可滚动且避免滚动穿透。调用方应使用真实按钮、`role="dialog"`/`aria-modal="true"`，管理初始焦点、Escape 和关闭后的焦点归还。
- **加载/空/错误/成功**：使用现有 `.dr-loading`、`.iw-empty`、`.plm-empty`、`[role=status]` 等承载状态；加载需有可读提示，空态说明下一步，错误提供恢复动作，成功可用 `role="status"`。不可仅以颜色区分。
- **按钮**：沿用 `.primary-button`、`.secondary-button`、`.outline-button` 等现有语义类；所有可操作元素键盘可达，焦点不可被裁切。

## 响应式与无障碍

窄屏保持信息完整：表格采用触控横向滚动；表单字段按现存断点堆叠；弹窗宽高不越出视口。验证建议覆盖 375px、768px 与桌面宽度，含键盘遍历、明显焦点、缩放、读屏标签和减少动态效果。共享层不对 `.bpmn-*`、图表或设计器画布作通配样式。

## 实施边界

导入此 CSS 应置于基础与功能样式之后，以使有限的焦点和视口辅助规则生效；导入动作由集成方负责。本文件不增加业务菜单、不更改日报组件或分析逻辑；只对现有代表页映射共享 primitives，并在窄屏修正操作区换行。字号基准为正文13px、辅助/表格12px、页标题20px，行内边距12px。实际验收见 `NAVIGATION_TABS_VALIDATION.md`。
