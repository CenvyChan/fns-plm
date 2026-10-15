# K3Cloud BD_MATERIAL 只读对齐证据

状态：`PENDING_EXTERNAL`

本工作树未获得可用的真实 K3Cloud 只读账套，因此没有编造响应行、账号、组织或规格数据。服务和测试只冻结了已存在的 ExecuteBillQuery 客户端契约与字段顺序；真实样本必须在授权测试账套中重新取得并脱敏。

## 已冻结的只读字段

`FNumber,FName,FSpecification,FMaterialGroup.FNumber,FMaterialGroup.FName,FBaseUnitId.FNumber,FBaseUnitId.FName,FCreateOrgId.FNumber,FUseOrgId.FNumber,FForbidStatus,FModifyDate`

## 安全边界

- 查询必须提供 ERP 账套、创建组织和使用组织。
- 查询只调用 `ExecuteBillQuery`，不调用 Save、Submit 或 Audit。
- 旧 `K3CloudBaseDataService.queryMaterialData` 的九字段位置契约保持不变。
- 末尾数字解析是保守的字符串解析；正式流水号切分必须由已确认的规则版本提供，不能从物料编码文本猜测。

## 外部样本待补字段

真实取证时需记录脱敏后的响应封套、查询日期、账套/组织上下文、代表性编码/名称/规格、同编码多使用组织行、非数字后缀和规格异常。URL、账号凭据、Cookie、Token 和全量物料数据禁止写入本仓库。
