# PLM 表单设计与运行：第一阶段 API

## 已接通的闭环

自有 JSON DSL v1 → React 字段编辑/高级 JSON 编辑 → SQLite 草稿 → 不可变发布版本 → 固定版本运行 → 服务端字段、规则与授权校验 → 持久化 submission。未安装或分发 `@flowable/forms`，不依赖其内部仓库或未确认的许可。

设计器入口在「流程审批 → 表单设计」，没有修改流程画布。当前正式服务没有接入 Flowable 任务适配器，因此设计、保存、发布、版本读取可使用；运行提交明确返回 **501**，不会把任意客户端任务/流程 ID 当成授权，也不会声称已完成 Flowable 用户任务。隔离 HTTP 测试通过注入本地可信任务适配器验证真实成功提交及数据库重读。

## 请求与权限

所有 `/api/forms` 接口要求实际登录会话，以及与服务端已验证成员关系一致的 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID`。不允许通过请求体选择租户、组织、账套或冒充 actor。未登录返回 401；缺 scope 返回 400；伪造 scope 或不具备设计权限返回 403。

创建、更新和发布限 `admin`、`plm_manager`。其他已登录成员可读取本 scope 定义；执行必须另外得到可信任务适配器的具体任务授权。submission 仅创建者或同 scope 的上述管理角色可读取，其他情况返回 404。响应不缓存。

| 方法与路径（省略 `/api/forms`） | 请求体 | 结果 |
|---|---|---|
| GET `/` | — | `{forms:[{key,name,revision,latestVersion}]}` |
| POST `/` | `{key,name,definition}` | 201 草稿详情，revision=1 |
| GET `/:key` | — | 草稿详情 |
| PUT `/:key` | `{name,definition,revision}` | revision CAS 更新，冲突 409 |
| POST `/:key/publish` | `{revision}` | 201 `{key,version,bindingKey,definition}` |
| GET `/:key/versions` | — | `{versions:[{version,createdAt,createdBy}]}` |
| GET `/:key/versions/:version` | — | `{key,version,bindingKey,definition}` |
| GET `/lookups/users` | — | `{options:[{value,label}]}` |
| GET `/lookups/customers` | — | 同上，组合本 scope 客户与供应商 |
| POST `/:key/versions/:version/submissions` | `{values,taskId}` | 201 submission；未接适配器则 501 |
| GET `/:key/submissions/:id` | — | 经访问控制后的 submission |

草稿表按 tenant/org/account/form key 复合主键隔离。发布使用 SQLite `IMMEDIATE` 事务，在事务内读取当前定义、检查 revision 并分配递增版本；更新最新版本指针有 CAS。版本表的 UPDATE/DELETE 触发器阻止修改或删除历史定义。编辑只改草稿；再次发布得到新版本，不覆盖旧版本。发布保存的是定义；展示名称保存在草稿元数据中，不是历史版本的名称快照。

submission 保存实际 session actor ID、tenant/org/account、form key/version、可信适配器返回的 processInstanceId/taskId、规范化后的值及创建时间。客户端传 `processInstanceId`、`actorId` 等字段会被拒绝。提交只保存 PLM 表单记录，**不调用 Flowable complete，不代表流程任务已完成**；真实引擎完成动作、并发任务状态检查、幂等重试/事务 outbox 仍属后续适配范围。

## DSL v1

```json
{
  "dslVersion": 1,
  "fields": [
    { "id": "mode", "label": "模式", "type": "select", "required": true,
      "options": [{ "value": "normal", "label": "常规" }, { "value": "special", "label": "特殊" }] },
    { "id": "code", "label": "编号", "type": "text", "required": true,
      "min": 2, "max": 32, "pattern": "^[A-Z][A-Z0-9_-]{1,31}$" },
    { "id": "reason", "label": "原因", "type": "textarea",
      "requiredWhen": { "field": "mode", "op": "eq", "value": "special" },
      "visibleWhen": { "field": "mode", "op": "eq", "value": "special" } }
  ],
  "events": []
}
```

字段支持 `text`、`textarea`、`number`、`date`、`select`、`multiselect`、`customer`（客商）、`user`。`min/max` 分别约束数字范围、文本长度或多选数量；长度/数量界限必须是非负整数。日期验证真实日历日期，日期范围暂不支持。单/多选仅接受定义内的选项，多选不允许重复值。

条件为 `{field,op,value}`，`op` 仅 `eq`、`neq`、`in`，`in` 要求数组；比较不执行表达式，采用严格相等，缺失值也会参与 `neq`。有效必填为 `(required || requiredWhen成立) && visible && enabled`。隐藏/禁用字段可省略或为空；提交非空值会被服务端拒绝。空值为 undefined、null、空字符串或多选空数组；数字 0、布尔 false 不是空值，字段类型校验仍然执行。

事件仅支持 `{on:"change",field,actions:[{type:"set",target,value}|{type:"clear",target}]}`，set 只能是标量常量。每次变更和服务端提交均按定义顺序规范化全部事件；源非空才执行，后续事件看到前面的结果，不递归调用。事件源不得重复，动作若指向另一个事件源，必须先于该源声明，反向依赖、自环和循环均被拒绝，保证重复规范化幂等。不会执行任意 JS/eval、URL、HTML 或脚本回调。React 将标签作为普通文本渲染。

pattern 为有界安全正则子集：ASCII 字面字符、简单字符类、可选首尾锚点、`?` 和最大 256 的 `{m,n}`；最多一个可变长度量词。禁分组、交替、反向引用、转义及 `*`/`+`，避免组合回溯。使用 `[0-9]` 而不是 `\d`；不是完整 JavaScript 正则语言。

用户选项及提交值验证来自精确 scope 的启用 PLM 成员关系。客商仅从本地 `readK3CloudMasterData(scope)` 的客户/供应商快照读取，使用已有稳定 record ID，无数据返回空列表，不调用 ERP 远端同步。原始 ERP status 尚未规范化，因此不猜测过滤状态。

## 可替换适配边界

前端 `FormDesignerWorkbench` 接受 `api` 与 `renderer` 注入；默认 HTTP adapter 复用项目真实认证及 scope，默认 React renderer 不依赖 Flowable SDK。纯规则模块有跨前后端契约测试。

服务端仅通过 `createFormsRouter({taskAdapter})` 注入 `FormTaskAdapter.resolve`。没有全局 setter、HTTP 管理入口或可由请求体切换的 adapter。未来 adapter 必须从实际 Flowable task 查询：当前有效 assignee/candidate、完整租户范围、实际 task/processInstanceId，以及该任务固定的 formKey/version；路由逐项复核返回上下文后才保存。

稳定 Flowable task `formKey` 格式为 **`plm-form:<formKey>:v<version>`**，例如 `plm-form:inspection:v2`。`server/src/form-binding.ts` 提供格式化与严格解析，拒绝 latest、0、非规范版本和 URL。API 返回 `bindingKey` 供后续绑定；本阶段未改 BPMN 或远端任务，未安装官方 SDK。

接官方 SDK 之前仍需确认内部包访问授权、可分发许可、确切包版本和当前 OSS 引擎兼容性；后续开发也需要另行授权的隔离 Flowable 环境与身份/tenant 映射配置。不得以生产凭证或生产实例作为此阶段测试条件。
