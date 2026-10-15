# 迁移部署交接

## 技术迁移

```text
node scripts/material-code/validate-migration.mjs --script src/main/resources/db/V4.58__material_code_cascade.sql
node scripts/material-code/apply-migration-receipt.mjs --target test --host 127.0.0.1 --database mes_demo_materialtest --user materialtest --script src/main/resources/db/V4.58__material_code_cascade.sql --approved-by test-runner
node scripts/material-code/apply-migration-receipt.mjs --target test --host 127.0.0.1 --database mes_demo_materialtest --user materialtest --script src/main/resources/db/V4.59__material_code_permissions.sql --approved-by test-runner
node scripts/material-code/apply-migration-receipt.mjs --target test --host 127.0.0.1 --database mes_demo_materialtest --user materialtest --script src/main/resources/db/V4.60__material_code_allocation_lifecycle.sql --approved-by test-runner
```

本轮批准的 disposable clone 是 `mes_demo_materialtest`，数据库用户是 `materialtest`；`mes_demo` 本体和 UB 数据库仍然拒绝执行。密码只能通过私密子进程的 `MYSQL_PWD` 注入，不能放在命令行、父进程环境、文档或日志。
V4.58/V4.59 只能在批准窗口由授权人员执行。自动化 worker 只允许在上述 disposable 测试库验证，不允许执行本地 `mes_demo` 或 UB 数据库。

## Receipt 必填项

记录脚本名、SHA-256、目标主机/数据库、执行人、开始/结束时间、状态和 `schema_migration` 回执。外部本地/UB 回执未提供时保持 `PENDING_EXTERNAL`，不得改成 PASS。
