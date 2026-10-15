# Ubuntu 部署与运维

此目录提供可执行的 **Node API + SQLite** 主服务部署套件，以及一个**独立 Flowable 8 Java REST 引擎**的构建/发布套件。当前尚未 SSH 到任何真实服务器或部署：这里是部署准备，不是远端部署结果。

## 目标环境

- Ubuntu 22.04/24.04 LTS、systemd、`sudo -n`、SSH key。
- API 目标机：system-wide Node.js 20+（建议 Node 22 LTS）与 npm，路径为 `/usr/bin/node` 和 `/usr/bin/npm`。依赖 `better-sqlite3` 是原生 Node addon；若当前 Node/Ubuntu 平台没有可用预编译包，目标机需具备 `python3`, `make`, `g++` 以从源码构建。
- 如需部署内置 Flowable：目标机和构建机都需 Java 21+；构建机另需 Maven 3.8+。
- Nginx、Redis 是可选组件。脚本不会自动安装/升级 Node、Java、Maven、Nginx 或 Redis，不会修改防火墙、申请 TLS 证书、添加 SSH key 或配置企业密钥。

## 1. 首次引导与 Node API 原子发布

先在目标 Ubuntu 手工安装系统 Node/npm（可选 Java 21+，如计划使用内置 Flowable）。从项目工作目录执行：

```bash
# 远端创建服务用户、系统目录、systemd unit 和仅首次生成的环境模板。
# 已存在的 Node/Flowable 环境配置会保留。
./deploy/ubuntu/bootstrap-remote.sh deployer@your-ubuntu-host

# 只在本地构建并审查 release 内容，不发起 SSH。
./deploy/ubuntu/deploy.sh --dry-run

# 连接目标机，上传并发布 Node API + React 静态资源。
./deploy/ubuntu/deploy.sh deployer@your-ubuntu-host

# 失败时手动切回 previous release。
./deploy/ubuntu/rollback.sh deployer@your-ubuntu-host
```

SSH 非默认端口可作第二个参数，例如 `.../deploy.sh deployer@host 2222`。部署要求 key/agent 登录以及非交互 `sudo -n`，不会采集或保存 SSH 密码。

`bootstrap-remote.sh` 只传输 `deploy/ubuntu/` 运维模板并运行 `bootstrap.sh`。Bootstrap 创建 `momentum` 与 `momentum-flowable` 受限系统用户，持久目录 `/var/lib/momentum/`、`/var/lib/momentum-flowable/`，以及各自 systemd 服务。初始生成 `/etc/momentum/momentum.env` 与 `/etc/momentum-flowable/momentum-flowable.env`，均为 root 管理的 0600；以后运行 bootstrap 会保留现有文件。

Node release 是在本机构建的选择性 tar 包，包含 `client/dist`、`server/dist`、由 Flowable 引擎 BPMN 源同步生成的 `server/workflow/processes/`、package manifests 与受控种子文件；不包含 `.env`、真实 SQLite、运行附件、node_modules、密钥或现场流程/审批/计划数据。目标机执行 `npm ci --omit=dev` 后，以 symlink 原子切换 `/opt/momentum/current` 并重启 `momentum.service`；本地 health check 失败会自动恢复前一版本。release 默认保留活动/前一版及近期版本。

### 检查服务

```bash
sudo systemctl status momentum.service
sudo journalctl -u momentum.service -n 100 --no-pager
curl -fsS http://127.0.0.1:4000/api/health
```

服务日志可能包含网络/第三方状态错误，但不应包含 Secret 值。API 使用应用密码登录、HttpOnly Cookie 会话和移动 Bearer token。首次打开首页的管理员初始化界面创建唯一初始管理员；不要部署预设默认口令。

## 2. SQLite、密钥与附件持久化

Node systemd 的默认持久路径：

| 数据 | 路径 |
|---|---|
| SQLite 数据库（WAL） | `/var/lib/momentum/momentum.sqlite` |
| AES-256-GCM 连接器密钥 | `/var/lib/momentum/.app-encryption-key` |
| 图文档附件内容 | `/var/lib/momentum/documents/` |
| Node 环境配置 | `/etc/momentum/momentum.env` |

SQLite/密钥/附件在 `/opt/momentum/releases` 之外；发布和回滚都不会移动或删除这些数据。`DATABASE_FILE`、`APP_ENCRYPTION_KEY_FILE`、`DOCUMENT_STORAGE_DIR` 可覆写默认路径，但必须位于 `momentum` 可写的受控路径。不要将数据库放在 release、临时目录或普通 Web 静态根目录。

初始化后服务会在首次运行创建/加载 SQLite、启用 WAL/外键，并生成持久 AES 密钥文件。**备份数据库时必须一并保留密钥与图文档附件。** 有密钥却没数据库，或有加密凭据数据库却丢密钥，均无法完整恢复。

### 在线一致性备份

发布后在目标机执行：

```bash
sudo bash /opt/momentum/current/deploy/ubuntu/backup-sqlite.sh
# 查看校验文件及权限
sudo ls -l /var/backups/momentum
sudo sha256sum -c /var/backups/momentum/momentum-<UTC时间>.tar.gz.sha256
```

脚本调用 better-sqlite3 的 SQLite backup API（能一致包含已提交 WAL 内容），同时把 AES key 和附件目录收入 tar archive，文件权限限制为 root-only（目录 0700、归档 0600）。归档**本身不是加密文件**，包含应用数据、连接器密钥和用户附件；应尽快使用企业批准的加密/离机备份系统转储，并限制备份管理员访问。不要把归档邮件转发、提交 Git 或放进公开对象存储。

**恢复演练（建议在维护窗口，先确认归档和校验值）：** 停止 `momentum.service`；将校验过的归档解压到 root-only 临时目录；把其中 `db/momentum.sqlite` 还原到 `/var/lib/momentum/momentum.sqlite`，把 `.app-encryption-key` 还原到 `/var/lib/momentum/.app-encryption-key`，把 `documents/` 还原到 `/var/lib/momentum/documents/`；恢复 `momentum:momentum` 所属关系与目录权限；确认密钥备份对应此数据库后再启动服务并检查 `/api/health`。不要在在线数据库文件上直接用 `cp` 覆盖，也不要执行没有审核的全量覆盖命令。

Flowable 内置 H2 引擎数据在 `/var/lib/momentum-flowable/flowable.mv.db`，上述 SQLite 备份**不包含**它。若用 H2，应停 `momentum-flowable.service` 后单独备份其数据目录；多副本/生产 HA 宜使用受控 PostgreSQL，并按数据库自身备份方案处理。连接器/流程发布不会将 H2 文件随 release 清理。

## 3. Nginx 与网络边界

`nginx/momentum.conf.example` 默认只监听 `127.0.0.1:8080`：静态资源来自 `/opt/momentum/current/client/dist`，`/api/` 反代到仅监听 loopback 的 Node API；上传上限为 26 MB（略高于 API 的 25 MB 上限）。先人工审核配置，设置真实 `server_name`、正式 HTTPS/TLS 与安全头，再复制到 `sites-available`、启用并运行 `nginx -t`。本机代理验证：

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

样例未设置公网 TLS 监听，不要直接将该 8080 监听改成全网 IP 后对外开放。生产公开访问需配置真实域名与 TLS、运维防火墙规则和 CORS 原点；由反代或客户端直接 HTTPS 访问都应始终保留应用自身的用户/角色/账套授权。用户注册不公开；只有首次 setup 可创建初始账户，后续由账套管理员邀请。

## 4. Flowable 独立引擎（可选）

内置 Flowable 不是 Node 进程的一部分。首次引导会安装但不会自动启用 Flowable unit。请先设置 `/etc/momentum-flowable/momentum-flowable.env`，至少配置 24 字符以上的随机 `FLOWABLE_REST_PASSWORD`；service host 默认仅 `127.0.0.1:8090`，单机 H2 默认存储在 `/var/lib/momentum-flowable/`。引擎不要直接暴露公网。

```bash
# 本地 Maven 构建 + 检查 JAR 包内容，无 SSH
./deploy/ubuntu/deploy-flowable.sh --dry-run

# 单独上传/原子发布 Flowable，health 失败时恢复 previous release
./deploy/ubuntu/deploy-flowable.sh deployer@your-ubuntu-host

sudo systemctl status momentum-flowable.service
sudo journalctl -u momentum-flowable.service -n 100 --no-pager
curl -fsS http://127.0.0.1:8090/flowable-rest/actuator/health
```

具体 REST 用户同步、BPMN tenant 部署、邮箱到引擎用户映射，以及将 Node API 连接到 Flowable 的步骤见 [独立 Flowable 运行手册](flowable-service-README.md) 与 [连接器配置](../../docs/INTEGRATIONS.md)。Flowable 和 Node API 是两个独立 release，不会假设其中一个已安装或已连通。

## 5. 热修、热更新与回滚

`deploy.sh` 是**短暂重启式发布**：构建于本地、上传可执行产物、原子切换当前 symlink、重启 systemd 并检查 API。不是零停机蓝绿更新；Node 进程在收到 SIGTERM 后执行优雅关闭。health 失败自动切回旧代码，但**不会自动回滚已执行的 SQLite schema migration，也不替代数据库备份**。变更数据库表结构时需先审查迁移、备份和恢复兼容性；Flowable 需要用单独 `deploy-flowable.sh` 发布，并独立检查健康状态。

## 常用入口

- `sudo systemctl restart momentum.service`：重启 API。
- `sudo journalctl -u momentum.service -f`：API 实时日志。
- `sudo systemctl restart momentum-flowable.service`：重启独立 Flowable。
- `sudo journalctl -u momentum-flowable.service -f`：Flowable 日志。
- `./deploy/ubuntu/deploy.sh --dry-run`：主服务发布包安全检查。
- `./deploy/ubuntu/deploy-flowable.sh --dry-run`：Flowable 发布包安全检查。
- `sudo bash /opt/momentum/current/deploy/ubuntu/backup-sqlite.sh`：一致性备份 Node SQLite、key 与附件。
- `./deploy/ubuntu/rollback.sh deployer@host`：主服务切到前一 release。

若服务失败，查看各自 journal、`/etc/momentum/*.env`、`/etc/momentum-flowable/*.env` 权限/变量、Java/Node 版本、磁盘空间与健康 endpoint。切勿删除或覆盖 `/var/lib/momentum/`、`/var/lib/momentum-flowable/`、或密钥文件以“重置”故障。
