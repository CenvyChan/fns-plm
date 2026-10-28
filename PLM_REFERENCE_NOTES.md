# 市场 PLM 功能参考（用于原型取舍）

检索日期：2026-10-15。下列为官方产品资料及 PLM KPI 指标文章；这些资料用于功能建模参考，不代表对其功能的独立审计。

## 参考要点

- **Siemens Teamcenter：统一多领域 BOM 与配置/变更控制。** 面向跨域产品结构，强调唯一产品定义、历史配置/基线、发布成熟度、有效性/变体，以及工程到制造的数据连接。原型对应：物料主档—BOM 父子行—修订版本—生命周期状态和生效日期。
- **PTC Windchill：跨工程/制造的产品数据、BOM、分类与变更追溯。** 官方材料强调 eBOM/mBOM/软件 BOM 对齐、部件分类复用、工程变更/配置管理、基于角色的应用和跨域可追溯。原型对应：可检索的物料分类、可追溯 BOM 版本、后续扩展变更单与角色权限。
- **Arena PLM：受控文档与产品/质量记录关联。** 官方材料强调修订控制、审批工作流、访问角色、历史审计轨迹，以及图纸、质量、运营、供应商文档的集中管理。原型对应：图文档记录关联物料、版本/审批状态、责任人和附件/链接元数据。
- **Aletiq PLM KPI：指标体系要平衡数据、流程、开发、成本与采用度。** 可参考变更周期、流程合规率、验证返工率、产品数据完整性/重复率、按期交付、复用率、活跃用户等。指标应有清晰业务目标、可测量定义、责任方与周期，避免只追数量或速度而诱发不良行为。用户要求的个人绩效表属于与 PLM 流程指标集成的扩展，不应被表述成所有 PLM 的固有模块。

## 来源

- Siemens Teamcenter BOM Management: https://www.siemens.com/en-us/products/teamcenter/solutions/bom-bill-of-materials-management/
- PTC Windchill: https://www.ptc.com/en/products/windchill
- Arena Document Management: https://www.arenasolutions.com/solutions/document-management/
- Aletiq, “PLM KPIs: What Metrics to Track to Measure the Success of a PLM Project” (2026-01-30): https://www.aletiq.com/en/post/kpis-plm-indicateurs-performance
