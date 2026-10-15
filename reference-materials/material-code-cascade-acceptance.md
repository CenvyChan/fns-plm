# 物料编码级联工作台人工验收

## 环境与权限

- 直接 URL：`/production/material-code-cascade`
- 查看权限：`production:material-code:view`
- 创建权限：`production:material-code:create`
- 仅使用专用测试租户、测试 ERP 账套、创建组织和使用组织；禁止生产数据。
- 当前自动化和外部收据状态：`PENDING_EXTERNAL`。
- 凭据只能通过私密环境传入，不能放入验收文档、截图或日志。

## 验收步骤

1. 用仅有 view 权限的账号打开页面，选择物料族和节点，确认级联路径和旧子节点会重置。
2. 点击预览，确认页面显示候选编码、规则版本、账套/组织上下文和冲突状态；确认没有 allocation 写入和 ERP Save。
3. 使用 create 权限账号保留候选编码，确认相同幂等键不会产生第二个根记录。
4. 用第二个组织在同一账套尝试相同候选编码，确认返回明确冲突，不会复用正式编码。
5. 用测试 ERP 账套执行一次 Save/View 回读；确认不自动提交/审核，并记录 FID/FNumber。
6. 模拟 ERP duplicate、timeout 和 `ERP_UNKNOWN`，确认只允许按原幂等根对账后重试，不盲目二次 Save。

## 清理与回滚

测试物料统一使用 `TEST_MATERIAL_CODE` 前缀并保留审计记录。清理必须由业务/运维在专用测试账套按批准方案执行；本工作台不自动删除或反审核 ERP 单据。数据库迁移为手工 DDL，失败后先核对对象状态和 receipt，不宣称自动回滚。
