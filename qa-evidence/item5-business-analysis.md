# 第5项：业务内日报分析验证

## 已实现

销售日报、采购日报保留原业务入口，在业务页内切换“日报明细 / 统计分析”，没有新增分析菜单或独立静态图表。未修改导航配置，避免与并行导航改造发生冲突。

两种视图与 Excel 共用 `GET /api/daily-reports/analysis` 及 `GET /api/daily-reports/analysis/export.xlsx` 的同一服务端筛选函数。支持起止日期、客商名称包含、录入人、币种、来源及原有客商/单号/备注关键词查询。本周、本月、本年截至今天，并覆盖旧日期。导出采用“已应用”的条件，不会意外使用尚未提交的输入。

返回记录数、数量（保留至6位小数）、CNY/USD 分币种原币、已保存人民币合计；按日与按月趋势、客商前10排名均由同批未删除记录生成。人民币按保存金额合计后显示两位小数，不重新计算历史汇率。数量明确提示可能混合单位。当前账套、业务线权限及既有逐行编辑权限继续由服务端检查。Excel 保留摘要、全部筛选条件、演示标记、金额口径和明细，文本公式前缀作转义。

## 真实基准

只读参考本机旧项目 `/workspace/research/dailyReport/reports/services.py` 与 `reports/views.py`：统一过滤查询集用于汇总、趋势和导出，原币分币种，人民币沿用保存值；销售采购分业务线授权。没有运行旧项目，也没有接触其数据库。

当前 PLM 日报没有完整的原项目负责人/采购员及业务类型字段，因此只实现可验证的“录入人”筛选，不把录入人伪称业务负责人；未虚构业务分类、人员绩效或同比数据。

## 自动测试

- `npm run build --prefix client`：通过；现有大包体积警告仍在。
- `npm test --prefix client`：34/34 通过，包括新增3项 helper、SSR、内嵌和导出口径回归。
- `npm run build --prefix server`：通过。
- 服务端相关集成测试：5/5 通过。
- 在 server 目录运行 `node --test tests/daily-analysis.test.mjs tests/daily-reporting.test.mjs tests/daily-reporting-admin.test.mjs tests/report-definitions.test.mjs`。
- HTTP 测试全部使用各自临时 SQLite、随机本地端口和本地模拟上游，不访问真实 ERP。新增覆盖日期和查询校验、空态、历史人民币保存值、1.125/0.001 数量、日月趋势、排名、删除排除、Excel 摘要/明细一致及公式文本转义。
- 对销售专属成员验证销售分析/导出200、采购分析/导出403、未分配客商行只读；验证伪造账套403，以及成功切换到已授权第二租户/组织/账套后分析和导出不包含第一账套记录。

## 浏览器验证

本地 UI `127.0.0.1:5515` 与本地 API `127.0.0.1:4515` 使用专用 `/workspace/plm-item5-evidence/browser.sqlite`；没有读取或配置生产连接。样本均明确标识为隔离演示数据。

验证了销售本月范围、USD 筛选、明细与详情回看、按日/月及客商排名。USD 样本数量1.125、原币100、保存人民币680.67，汇总与趋势一致。把币种输入改成 CNY 但不应用，再点击导出，实际下载文件仍为已应用的 USD 一行，解析 Excel 确认数量1.125、人民币680.67及币种USD。采购独立显示1条、数量150、人民币6500；关键词无匹配时汇总归零，趋势和排名显示空态。最终干净页面浏览器错误日志为空。

外部证据（不进入提交）：

- `/workspace/plm-item5-evidence/sales-analysis-browser.png`
- `/workspace/plm-item5-evidence/purchase-analysis-browser.png`
- `/workspace/plm-item5-evidence/sales-analysis-browser-export.xlsx`
- `/workspace/plm-item5-evidence/client-build.log`
- `/workspace/plm-item5-evidence/client-tests.log`
- `/workspace/plm-item5-evidence/server-build.log`
- `/workspace/plm-item5-evidence/server-tests.log`

## 剩余边界

未修改导航/报告展示/报表定义/发送计划，不与并行导航任务重复改菜单；本项不新增重复入口。没有补造当前数据模型缺失的负责人、业务分类或人员排行。尚未进行大数据量性能、完整服务端全量测试、生产数据验收或真实 ERP 对接验证。分析与导出读取当时已保存数据，非不可变历史快照；需要固定历史版本时仍用既有“日报快照与更正”。

本项只准备独立分支供集成：没有推送、合并、部署或访问生产系统。
