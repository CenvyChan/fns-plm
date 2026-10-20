# 功能性表单设计器验收入口

完整操作记录、截图、真实 API / SQLite 证据、复跑方法与 OA/BPM 差距优先级见 [ACCEPTANCE.md](ACCEPTANCE.md)。

此目录仅包含隔离测试数据，不包含密码、会话 token 或生产凭据。最初 UX 任务随后扩展为功能性设计器，因此本分支同时包含安全 DSL 与真实版本/节点登记 API 的增量实现。

最终验收使用 `/tmp/plm-form-designer-acceptance.sqlite`，回环 API `127.0.0.1:4179`、完整应用 `127.0.0.1:4180`。临时服务不是生产部署；无可信引擎适配器时提交明确失败。
