# 流程设计器 UX 验收

## 结果

基线：`0fdbc9694690c73cd97884d6091bc393a4c22e42`。隔离工作树：`/workspace/plm-flowable-bpmn-modeler-ux`，分支：`feat/flowable-bpmn-modeler-ux`。

客户端构建和 TypeScript 检查通过；客户端测试 **22/22**；服务端构建和完整回归 **123/123**。`git diff --check` 通过。没有连接真实 Flowable 8.0.0，没有 push 或部署。

浏览器使用 `http://localhost:4520`、API `127.0.0.1:4521`、Flowable mock `127.0.0.1:4522`，数据全部来自 `/tmp/bpmn-ui-isolated-xhlyxh/ui.sqlite` 的合成账号和临时工作区。证据收集脚本只读数据库，且拒绝临时预览目录以外的数据库路径。

## 浏览器实际走过的操作

1. 合成管理员登录，进入空的模型设计器，新建串行模板，重命名为“采购变更审批 · UX验收”。
2. 添加“部门复核”用户任务，自动插入原审批节点后，检查新增的两条连接和下游位置。
3. 分配策略选“工作区角色”，选择 PLM 工作区的管理员角色 `admin`，保存服务端草稿。
4. 在表单管理创建 `purchaseChange`，字段“变更说明”，发布不可变表单 v1，回到流程节点绑定该固定版本。
5. 保存、校验通过、冻结流程 v1，预览差异，勾选明确确认，向 loopback mock 发布；发布记录为 `published / ui-mock-deployment`，审计链完整。
6. 刷新页面后重新选择模型，确认任务、连线、角色、固定表单 v1、冻结版本和发布历史可回读。
7. 在实际 **390 CSS 像素** iframe 中切换模型/画布/属性/发布，改名为“部门复核（移动端确认）”，保存成功。`innerWidth === 390`、`documentElement.scrollWidth === 390`，无横向溢出；原生水印在画布内可见。
8. 桌面通过连线属性删除审批到复核的连线，再点击新增连线，编辑目标并保存、校验。修正后的新增连线还复验了“立即打开连线属性”和默认向前方节点连接，不再默认连回开始节点。最终草稿修订为 r6。
9. 编辑表单字段为“变更原因与影响”，保存并发布 v2；界面立即回读当前 v2 及两个不可变版本。流程节点及冻结流程仍绑定表单 v1，冻结 XML 的 SHA-256 与数据库中原哈希一致。
10. 另建并行模板，校验、冻结、可读差异、明确确认和 mock 发布通过；另建条件模板，图形显示通过/驳回两条路径并校验通过。

390px 入口使用同源 iframe 的实际 CSS viewport，不声称是原生手机、触控设备或设备模拟器。导出的 390px 图片只是从原始 1280px 截图裁出 iframe 所占的 x=445..835 区间，没有绘制、拼接或改写页面内容。原图一并保留。浏览器的控件自动滚动可能令截图不包含页面顶部，不代表顶部控件缺失。

## 截图

- [桌面最终画布与角色/表单属性](desktop-canvas.png)
- [可读差异预览](desktop-diff-preview.png)
- [串行流程模拟发布后](desktop-mock-published.png)
- [并行流程模拟发布后](desktop-parallel-published.png)
- [表单 v1/v2 及当前版本](desktop-form-versions.png)
- [390px 画布与原生水印](mobile-canvas-390px.png)
- [390px 属性编辑保存](mobile-properties-390px.png)
- [390px 画布原始截图](mobile-canvas-raw.png)
- [390px 属性原始截图](mobile-properties-raw.png)

## 可复核证据

- [浏览器操作后的持久化数据与断言](browser-persistence-evidence.json)：增加节点、连接、PLM 角色、冻结图、XML 哈希、表单 v1/v2、mock 发布、审计事件。
- [完整服务端测试日志](server-tests.log)
- [完整客户端测试日志](client-tests.log)
- [客户端构建日志](client-build.log)
- [服务端构建日志](server-build.log)
- [客户端 TypeScript 检查日志](client-types.log)：成功时为空。
- [隔离 HTTP 生命周期证据](http-persistence-evidence.json)

在 `server` 目录下重新收集已完成浏览器操作的数据：

```bash
node scripts/bpmn-modeler-ux-evidence.mjs /tmp/bpmn-ui-isolated-xhlyxh/ui.sqlite '采购变更审批 · UX验收'
```

临时目录可能在后续环境清理时消失；已归档 JSON、日志和截图不依赖该临时数据库继续存在。完整实现边界及本地预览启动方式见 [设计器增量说明](../../docs/BPMN_MODELER_UX.md)。真实引擎、真实任务提交、多实例会签和候选组映射均没有伪装成已完成能力。
