# 自定义流程启动：刷新请求代次回归

已修复同模型、同用户范围内的旧 `start-context` 响应覆盖较新发布版本的问题。初始/effect 读取和 `published_version_changed` 后读取共用单调递增的请求代次；应用成功结果或错误前，同时检查代次、模型、完整用户/租户/组织/账套 storage key 和 refreshKey。effect 清理使在途请求失效。晚到的旧 POST 409 也不能再触发过时刷新。提交和按钮同时要求上下文仍属于当前请求代次。

## 真实浏览器回归

`client/tests/custom-start-refresh-race.browser.mjs` 使用真实 React 组件、Vite 和 Chromium；API 完全由浏览器内存夹具替代，没有业务后端或真实引擎写入。

核心时序：初始 GET 返回流程 v7/表单 v2 → 提交 v7 得到 409 → 409 触发的第二个 GET 挂起（旧 v8/表单 v3）→ 改变 refreshKey → 第三个 GET 先返回 v9/表单 v4 → 释放旧 GET。断言界面仍为 v9/表单 v4、没有旧错误、确认框清空；绕过禁用按钮直接提交表单仍不会发请求；重新确认后仅提交 `immutable-v9`，不会提交 v8。

七个新增用例覆盖：旧成功响应；旧 HTTP 503、传输异常及 JSON 解析错误；切换账套；切换模型；晚到的旧 POST 409。每个用例输出对应 JSON 检查证据。`latest-version-start.png` 是内存夹具中 v9 模拟启动成功的最终页面，不代表业务系统操作。

## 验证结果

- 原提交 `8ae0ef4ade5d7625def4f0bb8b13898e9decdf6c` 的组件运行新增核心测试：预期失败，最新 v9 被旧结果覆盖；见 `baseline-red.log`。
- `cd client && npm test`：35/35 通过，见 `client-tests.log`。
- `cd client && npm run build`：通过，见 `client-build.log`。
- `cd client && npm run test:browser`：10/10 通过（7 个新增 + 3 个既有），见 `browser-tests.log`。
- `cd server && npm test`：160/160 通过；该命令包含服务端构建，见 `server-tests.log`。
- `cd server && npm run build`：再次独立构建通过，见 `server-build.log`。
- `git diff --check`：通过。

服务端验证实际通过以下隔离包装执行，网络命名空间只有回环设备，没有外部路由；测试使用临时数据库和本地/内存模拟服务：

```bash
sudo unshare --net bash -c '
  ip link set lo up
  cd /workspace/plm-custom-start-uat/server
  export NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null
  npm test
  npm run build
'
```

## 边界

只在隔离工作树和本地分支执行。没有调用生产、共享预发或真实 K3，没有创建真实业务记录、发送通知、合并、推送或部署。没有重新运行真实 Flowable 引擎端到端脚本；本次浏览器与服务端验证为本地夹具/模拟集成。前端构建有单个 bundle 超过 500 kB 的非阻断告警。既有测试自动改写的历史证据已恢复，避免混入无关变更。原始日志、场景 JSON、截图和文件哈希均保存在本目录。
