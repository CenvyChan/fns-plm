# 顶栏页签管理入口回归

已移除内容区“已打开 N 个页签 / 管理页签”整条横幅。顶栏铃铛左侧显示轻量“页签 N”按钮；窄屏仅显示图标与数量，仍提供完整可访问名称。点击打开原有管理弹窗。

`WorkspaceTabs` 仍是 tabs、dirty、managerOpen、关闭计划与草稿确认的唯一所有者；Header 只提供 portal 挂载点。未选页签及后台草稿保留，批量关闭未保存项时先整批确认，取消不改变选择或页签；全部关闭回退总览。保留原有 8 页签软提醒。基线没有独立的固定/取消固定状态，本次未额外新增。

另外修复窄屏铃铛通知弹层越界；保留原有铃铛功能。

## 实际执行

以下命令均在 `/workspace/fns-plm-monthly-daily` 内执行，不访问生产、不推送、不合并、不部署。

| 目录 | 命令 | 结果 |
| --- | --- | --- |
| server | `npm ci` | 按 package-lock.json 安装成功；npm 报 2 项 moderate 依赖漏洞，未自动升级依赖 |
| server | `node -e "const DB=require('better-sqlite3');const db=new DB(':memory:');console.log(db.prepare('select 1 as ready').get());db.close()"` | 原生 SQLite 模块加载和查询成功，之前缺依赖问题排除 |
| server | `npm test` | 构建成功，195/195 通过，无跳过 |
| client | `npm test` | 78/78 通过，无跳过 |
| client | `npm run build` | TypeScript 与 Vite 构建成功；仍有大于 500kB 的 chunk 警告 |
| client | `npm run test:browser`（首轮） | 13/18 通过：3 项原有页面等待超时，2 项新增夹具/定位问题；原始日志保留在 browser-initial-failure.txt |
| client | `node --experimental-strip-types --test --test-concurrency=1 tests/daily-dashboard.browser.mjs tests/monthly-daily-report.browser.mjs tests/overview-metrics.browser.mjs` | 原有 3 项串行复跑全部通过 |
| client | `node --experimental-strip-types --test --test-concurrency=1 tests/*.browser.mjs`（最终全量） | 18/18 通过，无跳过；完整日志 browser-full-final.txt |

新增用例调试时修正了实际导航文案、React 夹具 HTML 加载与原生 dialog 焦点巡回的断言，也发现并修复了 360px 通知弹层越界。最终代码通过了上述全量串行浏览器测试；未将首轮并发失败隐去，也未宣称默认并发命令已重新通过。并发超时根因尚未单独证明，测试脚本默认并发配置未改。

## 覆盖与截图

新增页签浏览器用例测量 1440、1024、768、390、360px 的顶栏按钮/铃铛间距、页面横向溢出、通知弹层和 dialog 边界，并检查原生弹窗键盘巡回、Escape、焦点恢复、计数同步、多选关闭、未保存确认取消/接受、保留未选草稿、关闭全部回退、Home/End 切换和 8 页签软提醒。几何结果见 layout-samples.json。

- topbar-1440.png / topbar-390.png：桌面及 390px 顶栏入口。
- manager-1440.png / manager-390.png：桌面及 390px 管理弹窗。
- manager-many-390.png：390px 下 8 个页签的管理列表。
- combined/monthly-desktop.png / combined/monthly-390.png：月度采购销售组合回归。
- combined/daily-filters-390.png：日报筛选窄屏组合回归。
- combined/task-create-desktop.png：任务创建组合回归。

浏览器测试均使用本地隔离夹具；新用例阻断外域网络和非 GET API 请求并断言无 API 写入。未验证生产业务数据、真实 ERP/Flowable/钉钉连接、真实移动设备、非 Chromium 浏览器或原本不存在的固定页签功能。
