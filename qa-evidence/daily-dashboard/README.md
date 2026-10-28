# 日报界面对标验证

本分支基于 `4d23d723bb49870132d1304ff328d5a0ba39170c`，只修改 PLM 客户端展示及测试，不修改服务端业务模型、计算、权限或隔离规则。未推送、合并、部署，未访问生产数据库或真实 ERP。

## 已实现

- 销售/采购分析：日期与维度分区筛选；五张指标卡；日/月金额趋势、客户/供应商前十排名；每张图可展开完整数据表。图表使用现有接口的保存人民币金额，不推算汇率，不补造无记录期间。日期为分类点而非连续时间比例。
- 日报列表：汇总位于筛选前；数量及金额右对齐、独立币种标签；上下分页、10/20/50 条每页、首页/末页与页码跳转。汇总不随分页变化，筛选和导出仍以已应用条件为准。
- 新增/编辑页：左表单、右填报检查及关联说明，窄屏单列；必填字段可见标识。保留全部原字段、币种、汇率输入、保存校验与权限，不做可能与服务端不同的折算预估。
- 核对页：月/年累计分别列示系统金额、K3 金额和差额，明确截至所选日期；不完整数据继续显示待判定，不当作零。

## 对照与尚未覆盖

参考源码为 `/workspace/research/dailyReport`：`templates/reports/dashboard.html`、`reports/services.py`、`templates/sales/shipment_list.html`、`templates/sales/shipment_form.html`、`sales/models.py`、`purchase/models.py`、`templates/integrations/reconciliation.html` 和 `integrations/services/kingdee_compare.py`。

旧系统有 `SalesShipment.owner/sale_type`、`PurchaseReceipt.buyer/purchase_type` 业务字段；PLM 当前分析接口未提供对应字段。本分支不以录入人代替负责人、不以币种代替业务类型，因此未增加负责人排名/业务类型占比。

旧系统新增页可选单关联；PLM 仍是在日报保存后进入独立“关联分摊与三维对账”页面处理，未实现新增页内选单。

旧系统金蝶核对有业务+年月筛选、自然月每日双方笔数/数量/金额、差额及月底合计。PLM 当前返回的是截至指定日期的月/年累计及关联覆盖信息，不含完整逐日对账数据。本分支未新增该接口或逐日表，不能视为此页面完整对齐。亦未接入真实 ERP 验收。

## 本地回归

```bash
cd /workspace/fns-plm-report-ui/client
npm run build
npm test
node --experimental-strip-types --test tests/daily-dashboard.browser.mjs

cd /workspace/fns-plm-report-ui/server
npm run build
node --test tests/daily-analysis.test.mjs tests/daily-reporting.test.mjs
```

客户端：74 项单测；新增浏览器用例为一个综合流程，覆盖桌面/768/390/360 宽度、筛选验证、草稿筛选不影响导出、空数据、加载失败/重试、销售列表分页、销售新增保存返回（拦截 POST）、采购分析、只读操作隐藏、tenant/org/account 请求头以及完整/不完整累计对账。图表单测覆盖空数据、单点、零值、负数、较大金额和多个保留页签渐变 ID 唯一性。

服务端：3 项专项测试，临时 SQLite 数据库、loopback 端口且 ERP 配置清空，覆盖分析/导出一致性、跨作用域拒绝、日报/关联/快照/更正/导出和历史导入。不是生产/ERP 连接测试。

所有 PNG 为本地浏览器夹具界面，并非生产业务数据。`local-save-confirmation.png` 是仅本地拦截保存后的确认画面；`reconciliation-incomplete.png` 展示缺数据不判差额的状态。日志与截图同目录。构建只有既有较大 bundle 提示。
