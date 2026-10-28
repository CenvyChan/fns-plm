# 物料规格／型号搜索审计与修复

## 结论

部署基线 `7b0f2133353a5ddcf155cd0fbedddba70f7b322a` 并非所有入口都只搜编码／名称：物料主档和来源快照接口已经能搜自由文本 `specification`。真正缺口是结构化型号值、文档关联物料搜索、BOM／草稿选择器，以及后端对关联物料的查询。

本分支补齐上述本地 PLM 路径，不新增生产规格、独立型号字段、K3 FieldKey 或 ERP 查询。型号来自现有 `specification` 或 `specificationFields`（如 `productModel`）中的值。没有保存到这些字段的数据无法凭空搜索。

- 工作树：`/workspace/plm-material-spec-search-20261023`
- 分支：`fix/material-spec-search-audit-20261023`
- 基线：`7b0f2133353a5ddcf155cd0fbedddba70f7b322a`
- 只形成本地提交；未推送、合并、部署或修改生产配置。

## 逐入口核对

| 入口 | 基线行为／缺口 | 本轮结果 |
| --- | --- | --- |
| 物料主档列表 `MaterialWorkbench.tsx` | 已搜编码、名称、分类、自由文本规格；未搜结构化规格／型号值，提示也未写规格 | 统一搜上述字段，以及 `specificationFields`、`dimensions` 的值；状态筛选保留 |
| BOM 列表 `BomWorkbench.tsx` | 只有类型切换，没有关键词搜索 | 新增按 BOM 编号、修订、范围及父项／组件／销售映射物料编码、名称、规格／型号搜索 |
| 新建 BOM 父项产品 | 原生下拉仅显示编码／名称 | 搜索型原生下拉，选项含规格／结构化型号；提交仍为 `parentMaterialId` |
| 设计／生产 BOM 添加组件 | 无关键词输入，选项仅编码／名称 | 搜索规格／型号；父项自引用排除规则不变，必选验证保留 |
| 销售 BOM 条件映射组件 | 只有物料类型过滤，无关键词搜索 | 类型资格筛选后再搜索规格／型号；不能搜索绕过类型限制 |
| 新建生产／销售 BOM 来源基线 | 无关键词搜索，选项缺规格 | 可搜父项及组件规格／型号；保留“已发布设计 BOM”来源限制，提交仍为 `sourceBomId` |
| 本地订单 BOM 快照历史 | 无关键词搜索，仅展示当前 BOM 最近 5 条 | 新增订单号、BOM 编号、父项／组件规格搜索；先筛选再取 5 条；不改历史快照 |
| 图文档列表 `DocumentWorkbench.tsx` | 只搜文档元信息和关联物料编码／名称 | 加入关联物料自由文本及结构化规格／型号 |
| 登记／编辑图文档的关联物料 | 下拉仅编码／名称，无搜索 | 共用规格／型号选择器；仍允许“暂不关联”，提交真实 `materialId` |
| 物料闭环来源快照 `MaterialClosurePanel.tsx` | 后端已搜 number/name/specification；前端提示仅编码／名称 | 修正提示，保留既有缓存来源接口；不改刷新、复制、分配逻辑 |
| 来源复制产生的本地草稿选择 | 无搜索，选项只编码／名称 | 搜索规格／型号、展示规格，保留受控选中状态和草稿编辑逻辑 |
| 通用共享选择器 | 基线各工作台内联原生下拉，无统一物料搜索组件 | 新增 `MaterialSelect`／`SearchableSelect`；不使用输入文本替代记录 ID，不因搜索自动换选其他记录 |
| 流程业务编号、表单设计器、导航／路由 | 手工业务编号或表单字段配置，不是物料库选择器 | 已查，无需要接线的物料搜索入口；不修改 |
| 日报／业务单据 `DailyReportingWorkbench.tsx` | `materialName` 合同只有物料名称；单据关键词过滤不包含独立物料编码／规格 | **保留缺口并交 Cue**：不能从现有名称合同推导规格。未修改任何 K3 报表专属文件或映射 |
| `K3CloudFormsPanel.tsx` 的字段映射 | ERP 原始字段映射配置，不是 PLM 物料选择器；相关 canonical 行只有 `materialName` | 不猜 FieldKey，不扩充 ERP 业务映射 |
| 新 K3 OperationalReports 报表 | 不在部署基线树中；在 Cue 报表候选树中开发 | 归 Cue；本分支不修改页面、CSS、测试、模型或服务端报表文件 |

BOM 行表、销售映射表及版本历史原来是详情展示，不是独立选择器；本轮通过 BOM 列表搜索关联物料定位 BOM，不把详情表伪装为新的远程查询接口。

## API／查询合同

`GET /api/materials`、`/api/boms`、`/api/documents`、`/api/sales-bom-snapshots` 继续使用现有 `q`。没有新增 `model`、`spec` 专用请求参数或新的搜索端点。

- 无 `q/page/pageSize` 时仍返回原始数组；任一参数出现时仍返回 `{ items, total, page, pageSize, totalPages }`。
- `q` 保持单一字符串、原始长度最多 200；页号为正安全整数，`pageSize` 为 1–200（默认 50），非法参数仍为 400 `invalid_list_query`。
- 先筛选，再分页。空／全空格查询不筛选。不改变默认顺序。
- 保留原有通用顶层字段搜索；只有这四个 PLM 集合额外搜索物料字段和明确的关联 ID。物料扩展匹配支持去首尾空白、大小写不敏感及 NFKC 全半角规范化。
- 物料：编码、名称、自由文本规格、分类／路径／拟定组号、结构化规格和维度的值。
- BOM：只解析 `parentMaterialId`、`lines[].materialId`、`salesRules[].materialId`；文档只解析 `materialId`；快照解析父项和行物料 ID。
- 索引仅来自当前请求已验证的账套工作区 `data.materials`，找不到的关联不匹配，不扫描其他账套、任意嵌套对象或 K3 主数据。
- 无实际关键词时不建立关联索引。`/api/workspace`、写入白名单、ID 验证、权限与账套加载流程均未更改。

搜索本地快照／文档关联时使用**当前工作区的物料主档**；不代表快照中保存了历史规格文本，也不提供文档附件全文检索。BOM 历史版本下拉仍遵守原有来源规则。

## 与 Cue 的文件边界

初始审查发现报表候选树相对部署基线已有 `server/src/index.ts` 改动。随后 Cue 明确授权本任务修改此文件，并确认本轮报表工作不再修改它或通用选择器。本轮唯一已知历史交集是 `server/src/index.ts`：

- 报表候选分支：导入／挂载 `createOperationalReportsRouter`。
- 本分支：导入 `resolveWorkspaceSearch`，并扩展 `registerCollection` 的 GET 处理。

因此这是**已协调授权的共享文件交集**，后续集成需保留两者，不能用本分支整个 `index.ts` 覆盖报表候选版本。本任务没有合并或改动报表工作树。其他报表、导航、App、K3 catalog、配置文件均未修改。

## 回归验证

所有新增规格／型号样本仅存在 `tests/` 文件，并明确标为 TEST ONLY；未改 `seed.ts`、生产数据或配置。

- `cd client && npm test`：89 项通过（包含新增 9 项纯函数测试）。
- `cd client && node --experimental-strip-types --test tests/material-search.browser.mjs`：4 项交互测试通过；覆盖独立选择器、主档／草稿、文档、BOM／来源／映射／快照。
- `cd client && npm run build`：通过；保留 Vite 大体积 chunk 的非阻断警告。
- `cd server && npm run build`：通过。
- `cd server && node --test tests/material-search.test.mjs tests/material-rules.test.mjs tests/material-source-identity.test.mjs`：19 项通过，其中新增查询／HTTP 合同 10 项。
- `git diff --check`：通过。

浏览器测试运行独立打包的测试组件和本地 HTTP 页面，不加载生产应用配置；API 全由本地夹具拦截，外网被阻断，测试源快照为本地响应，不发 K3 请求，也不触发来源刷新或正式编号分配。后端 HTTP 用生产查询函数和明确的测试账套夹具；附带路由接线静态断言。**未运行生产服务器、真实认证端到端、K3 查询或完整后端集成套件**。

## 完整 touched-file 清单

1. `client/src/BomWorkbench.tsx`
2. `client/src/DocumentWorkbench.tsx`
3. `client/src/MaterialClosurePanel.tsx`
4. `client/src/MaterialWorkbench.tsx`
5. `client/src/MaterialSelect.tsx`（新增）
6. `client/src/material-search.ts`（新增）
7. `client/tests/material-search.browser.mjs`（新增）
8. `client/tests/material-search.test.mjs`（新增）
9. `server/src/index.ts`（已授权历史共享交集）
10. `server/src/list-query.ts`
11. `server/src/material-search.ts`（新增）
12. `server/tests/material-search.test.mjs`（新增）
13. `docs/MATERIAL_SPEC_SEARCH_AUDIT.md`（本文，新增）

## 每个入口的实际过滤链路

下表明确区分已实现的本地过滤和后端过滤。除来源快照外，这些工作台已有完整 `workspace.materials`，因此关键词直接筛选本地工作区，不会另外发 `/api/materials?q=...`。后端四个集合的 `q` 扩展独立实现并经过 HTTP 合同测试，不以“有输入框”代替实际匹配。

| 搜索输入入口 | 关键词实际进入的位置 | 对应已有字段／合同 |
| --- | --- | --- |
| 主档列表 | 前端 `MaterialWorkbench → matchesMaterial → materialSearchText` | `partNo/name/specification/category/proposedGroupNumber/classificationPath[]/specificationFields` 值／`dimensions` 值；另叠加原 lifecycle 状态过滤 |
| BOM 列表 | 前端 `BomWorkbench → matchesBomMaterial → bomSearchText` | `bomNo/revision/scope`，父项 `parentMaterialId`、`lines[].materialId`、`salesRules[].materialId` 解析到上述物料字段 |
| BOM 父项产品输入 | 前端 `MaterialSelect → SearchableSelect.matching → matchesSearchText` | 本地 `materials` 物料字段；原始 ID 作为 option value，表单字段为 `parentMaterialId` |
| BOM 组件输入 | 同一前端过滤链路，先排除父项再构造 options | 同上；表单字段 `materialId`，父项不能重新通过关键词进入 options |
| 销售映射组件输入 | 同一前端过滤链路，先执行原物料类型资格过滤 | 同上；表单字段 `materialId`；资格变化导致不合格 ID 不能作为有效选项提交 |
| 来源 BOM 输入 | 前端 `SearchableSelect.matching`；每项 `searchText = bomSearchText(...)` | 只向选项提供已发布 design BOM；其父项／行／映射规格均进入 searchText，表单仍提交 `sourceBomId` |
| 本地订单快照输入 | 前端 `matchesSnapshotMaterial`，匹配后 `.slice(0, 5)` | `orderNo/bomNo/parentMaterialId/lines[].materialId`，关联现有主档规格／型号值 |
| 图文档列表 | 前端 `matchesDocumentMaterial` | `docNo/title/type` + `materialId` 所关联主档字段 |
| 文档关联物料输入 | 前端 `MaterialSelect → SearchableSelect.matching` | 主档物料字段，提交 `materialId` 或空值，不提交搜索文本 |
| 来源复制草稿输入 | 同一前端选择器过滤链路，候选先限定 `templateSourceId` 非空的本地草稿 | 主档物料字段；受控选中值是草稿 ID |
| 来源快照搜索按钮 | 前端 `loadSource → GET /api/material-closure/source?q=encodeURIComponent(query)`；后端 `material-closure.ts` 对缓存 rows `.filter(...)` | **既有后端已使用** `number/name/specification`；不调用 refresh，不发 live query。型号仅在来源 `specification` 有文本时可匹配，没有单独来源 model 字段 |
| `GET /api/materials?q=...` | 后端 `registerCollection → listResponse → resolveWorkspaceSearch(materials)` | 顶层旧搜索字段 + 主档已有结构化字段值，过滤后分页 |
| `GET /api/boms?q=...` | 同一后端链路，`resolveWorkspaceSearch(boms)` | 当前账套父项／行／销售映射 ID 对应物料字段；旧 `bomNo` 匹配保留 |
| `GET /api/documents?q=...` | 同一后端链路，`resolveWorkspaceSearch(documents)` | 当前账套关联 `materialId` 对应物料字段；旧 docNo/title 匹配保留 |
| `GET /api/sales-bom-snapshots?q=...` | 同一后端链路，`resolveWorkspaceSearch(salesBomSnapshots)` | 当前账套父项／行 ID 对应物料字段；旧 orderNo/bomNo 匹配保留 |

### 明确未实现／不应误报为支持

- 未新增独立 `Material.model` 存储字段、`spec/model` 查询参数、智能型号推断或模糊分词查询；只有已保存的 `specification` 和结构化规格值可搜。
- 来源快照 SourceRow 只有 `number/name/specification/unit/groupNumber/groupId`；没有独立 model 或结构化规格合同。只是自由文本规格可搜，不等于获得 K3 型号字段。
- 日报业务单据和 K3 原始来源 canonical 合同仍只有 `materialName`；规格／型号（及独立物料编码）无法在该合同内搜索。该缺口没有用名称假装成型号，也没有造 FieldKey，仍由 Cue 的报表工作协调。
- 本地没有独立 `/api/orders` 或完整销售／采购订单物料选择模型；本任务覆盖的是已有 sales BOM 规则和订单 BOM 快照。没有给不存在的数据模型添加空壳入口。
- 图文档附件内容、历史冻结规格、已删除主档的原规格、跨账套物料和 ERP 在线业务数据均不搜索。
