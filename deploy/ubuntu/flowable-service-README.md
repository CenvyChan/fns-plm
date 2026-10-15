# 独立 Flowable 8 REST 引擎部署

Node API 和 Flowable 是两个独立服务。Node 应用的 `deploy.sh` 不会假装 Flowable 已经运行；此目录提供独立的 Maven 构建与 SSH 原子发布脚本。

## 前置条件

- Ubuntu 目标机：Java 21+ 位于 `/usr/bin/java`、systemd、可用非交互 `sudo -n`、SSH key。
- 本地构建机：Java 21+、Maven 3.8+、SSH/scp。
- 先运行 `sudo bash deploy/ubuntu/bootstrap.sh`，该脚本会准备 `momentum-flowable` 系统用户、`/var/lib/momentum-flowable`、环境模板和 systemd 单元。
- 编辑 `/etc/momentum-flowable/momentum-flowable.env`，至少设置随机的 `FLOWABLE_REST_PASSWORD`（24 字符以上）；使用 H2 时数据保存在 `/var/lib/momentum-flowable/flowable.mv.db`。生产多副本建议使用受控 PostgreSQL，而不是共享 H2 文件。

## 构建与部署

```bash
# 仅本地构建并检查 JAR 发布包，不连接远端
./deploy/ubuntu/deploy-flowable.sh --dry-run

# 单独发布 Flowable 引擎；完成后健康检查失败时自动恢复上一 release
./deploy/ubuntu/deploy-flowable.sh deployer@your-ubuntu-host

# 检查状态与日志
sudo systemctl status momentum-flowable.service
sudo journalctl -u momentum-flowable.service -n 100 --no-pager
curl -fsS http://127.0.0.1:8090/flowable-rest/actuator/health
```

每次发布会构建 Maven 可执行 JAR、只传 JAR、原子切换 `/opt/momentum-flowable/current`，并通过本机 health endpoint 验证。环境配置、运行数据库和流程历史不进入发布包，也不会随热修 release 清理。

Node API 的账套连接器仍需在系统集成页分别配置 Flowable REST Base URL、REST 用户名及相同密码，并设置 `userMap`（工作区用户邮箱到 Flowable assignee 用户 ID 的映射）。Flowable REST servlet 由 `flowable.rest-api-enabled: true` 显式开启；常见同机 Base URL 为 `http://127.0.0.1:8090/flowable-rest/process-api`（必须包含默认 `/process-api` servlet 路径）。密钥保存为 AES-256-GCM 密文。只有流程模型本身正确包含 tenant、assignee 和 BPMN 部署时，任务列表/审批才会进入真实引擎。
