# 权威物料分组与集团物料生命周期确认

日期：2026-10-14。范围：独立工作树 material-code-cascade；未部署、未真实ERP写入。

## 用户已确认业务口径

1. 现有ERP物料分组是分类级联权威，当前按图片构造的六物料族不能覆盖ERP树。
2. docs/materialCode图片只作为分组编码最后一个点后参数码的依据；不重复拼图片分类码。
3. 用户样例：分组1.02.02，材质01、处理30，候选1.02.02.0130####。规格显示喷粉白色/五金SPCC/激光打标/CC11-9C-MC-333，保留结构化字段用于校验。
4. 集团00建料，创建/提交/审核后回读已审核才能手动点击分配至001/002/003。界面分开“保留编码”和“组织分配”。
5. FNS/FNSDEV同家族规则证据默认可继承；实际组织授权、ERP物料身份与运行数据仍具体账套隔离。

## 2026-10-14只读MCP证据

新的独立readonly stdio进程成功读取当前连接账套，10工具0写工具。此前会话丢失不再作为当前状态；宿主MCP工具仍未暴露，不能声称已重启宿主。仅使用query_metadata/query_bill_json/view_bill。当前连接账套由User环境决定，不能仅凭集团名认定其环境是FNS或FNSDEV；后续需核对账套绑定，禁止自动跨环境切换。

BD_MATERIAL真实元数据包含Save、Submit、Audit、Allocate；操作存在不等于Allocate请求字段/返回契约已验证。代表物料1.02.02.0100001回读DocumentStatus=C、CreateOrgId.Number=00、UseOrgId.Number=00；分组Id100151/Number1.02.02/名称机壳。组织只读查询返回00飞诺斯集团、001慈溪飞诺斯电子科技有限公司、002绵阳科德瑞智能科技有限公司、003东莞钧骜电子有限公司。

FMaterialGroup元数据：LookUpObjectFormId=BOS_FORMGROUP；GroupFieldTableName=T_BD_MATERIALGROUP。BD_MATERIALGROUP不是该账套可用FormId。BOS_FORMGROUP元数据可读但无字段实体，直接查询FID/父级字段失败。完整分组树、未引用分组及父子关系尚未取得，不能把物料样本提取的分组或点号推算树冒充完整权威树。

FBaseUnitId实体SubHeadEntity，关联BD_UNIT，必填。FNumber元数据长度80，FSpecification长度510。原预览服务允许1000规格，后续应以当前目标证据调整，不能宣称已修。针对1.02.02.0130前缀/00组织的5条样本查询返回0，不据此推断全账套无号或流水四位。已有样本末段0100001、0101001不足确认参数码/流水边界，不能直接把连续数字尾缀当流水。

证据：.omo/evidence/material-code-cascade/material-group-fields-20261014.jsonl、material-group-tree-metadata-20261014.jsonl、material-group-parent-probe-20261014.jsonl、material-group-lifecycle-readonly-20261014.jsonl。

## 后续实现与验收顺序

- 权威分组读取及同步：保存真实ID/父ID/完整分组编码/名称/状态；来源账套+同步时间，读取失败显式报告。ERP树在MES只读，不通过共享字典菜单修改ERP分组。
- 分组节点至末段规则显式映射：按稳定group ID及分组编码校验，不凭名称guess；未配置末段规则拒绝生成正式号码。
- 参数共享字典菜单：家族范围、独立维护权限、版本/启停/审计；已引用码值不可原地改变。
- 最大流水只读：确定参数前缀和流水位数后解析，ERP与MES保留高水位分开；失败=未知、不占号、正式保留必须唯一/幂等。
- 集团流程：保留正式号→Save(00/00)→View→Submit→View→Audit→View(C)；审核通过后手动Allocate→逐组织View。具体Allocate报文字段与组织internalID先取证；组织FNumber用编码、不传内部ID。
- 状态/错误：创建、提交、审核、各公司分配分别记录结果；超时UNKNOWN先回读，禁止盲重建或盲重号。重复点击不重复分配，同号主身份保留跨组织关联；目标公司权限分别校验。
- 先假ERP回归覆盖未审核禁分配、审核失败、部分公司失败、超时、重复点击、越权及禁用字典；真实写入需明确测试账套及样例批准。

## 当前未交付边界

没有声称上述集团闭环已完成。项目通用gateway已有Save/Submit/Audit方法，可复用传输但须物料专用契约校验；MaterialMasterGateway.save仍为拒绝执行占位，不能当作已具备真实创建闭环。真实Allocate适配、完整权威树、字典维护菜单、码格式/规格改动都待实施。此次记录业务确认和只读取证，不修改生产/ERP数据、不提交。

## 知识决策

Blinko检索“集团物料 审核 分配 00”无直接相关笔记。当前是确认设计与只读取证，无功能完成入库声明；长期规则候选先展示待确认，未写全局记忆或Todo。
