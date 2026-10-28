# 功能性表单设计器：增量契约

既有 DSL、API 与任务适配边界见 [form-design-api.md](form-design-api.md)。完整验收与 OA/BPM 差距见 [验收说明](../qa-evidence/form-designer-ux/ACCEPTANCE.md)。

保持 `dslVersion:1` 与严格白名单、安全规则、授权及固定版本语义。新增可选 `sections:[{id,title,description?}]` 与字段 `section`；分区 ID 安全且唯一，字段不能引用不存在的分区。旧定义无需迁移内容；SQLite forms 表增加 nullable `active_version`，已有定义与历史版本不会被改写。

| 方法与路径 | 请求 / 返回 | 约束 |
|---|---|---|
| `POST /api/forms/:key/activate` | body `{version}`；返回 `{key,activeVersion}` | admin/plm_manager；只能激活本 scope 已发布版本；修改 activeVersion，不修改 latestVersion 或历史定义/绑定 |
| `GET /api/forms/:key/bindings` | `{bindings:[{processKey,nodeKey,version,bindingKey,updatedBy,updatedAt}]}` | 已认证同 scope 读取 |
| `PUT /api/forms/:key/bindings/:nodeKey` | body `{processKey,version}`；返回固定 `bindingKey` | admin/plm_manager；登记身份为完整 scope + formKey + processKey + nodeKey，两个流程同名节点不会覆盖 |

列表与详情新增 `activeVersion`；`latestVersion` 仍表示最高发布版本。前端比较两个真实不可变定义，不引入独立 diff 缓存。节点登记目前只是 PLM 本地配置，不校验远端引擎是否存在该 process/node，也不会自动部署 BPMN、切换现有任务版本或完成流程。真实任务必须由可信适配器返回固定 formKey/version，不能因为客户端登记或 activeVersion 指针而绕过任务授权。

新节点登记表为真实 SQLite 持久化，若存在本次开发期间的 scope+form+node 旧主键，将在事务中迁移为包含 processKey 的完整主键并保留记录。没有生产迁移执行、push 或部署。
