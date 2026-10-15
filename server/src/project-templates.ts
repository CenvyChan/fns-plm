export interface ProjectTemplateTask {
  title: string
  offsetDays: number
  priority: 'low' | 'medium' | 'high'
  estimateHours: number
  acceptanceCriteria: string
}
export interface ProjectTemplateMilestone { title: string; offsetDays: number; acceptanceCriteria: string }
export interface ProjectTemplatePhase {
  name: string
  durationDays: number
  deliverables: string
  acceptanceCriteria: string
  milestones: ProjectTemplateMilestone[]
  tasks: ProjectTemplateTask[]
}
export interface ProjectTemplateDefinition { id: string; code: string; name: string; type: string; description: string; phases: ProjectTemplatePhase[]; builtIn: true }

export const builtInProjectTemplates: ProjectTemplateDefinition[] = [
  {
    id: 'tpl-product-development', code: 'TPL-PD-01', name: '新产品开发', type: '产品开发', builtIn: true,
    description: '覆盖需求基线、方案设计/样机、验证与量产导入的阶段门流程。',
    phases: [
      { name: '立项与需求', durationDays: 8, deliverables: '项目章程、需求基线、成功指标', acceptanceCriteria: '需求、范围、负责人及成功指标已评审并获确认。', milestones: [{ title: '需求基线评审通过', offsetDays: 5, acceptanceCriteria: '需求清单和范围边界经相关方确认。' }], tasks: [{ title: '确认业务目标和成功指标', offsetDays: 1, priority: 'high', estimateHours: 8, acceptanceCriteria: '指标可量化且有数据来源。' }, { title: '梳理利益相关方与范围边界', offsetDays: 3, priority: 'medium', estimateHours: 6, acceptanceCriteria: '输出责任人、范围内外事项和依赖清单。' }] },
      { name: '方案设计与样机', durationDays: 20, deliverables: '方案设计包、风险清单、样机验证记录', acceptanceCriteria: '关键设计评审通过，主要风险有责任人与应对计划。', milestones: [{ title: '方案设计评审通过', offsetDays: 10, acceptanceCriteria: '设计输入、输出、关键风险和接口均有记录。' }, { title: '样机验证完成', offsetDays: 18, acceptanceCriteria: '关键功能和性能验证结果满足预设标准。' }], tasks: [{ title: '完成方案设计和关键接口评审', offsetDays: 2, priority: 'high', estimateHours: 24, acceptanceCriteria: '方案及接口问题完成评审闭环。' }, { title: '制作样机并执行关键验证', offsetDays: 12, priority: 'high', estimateHours: 32, acceptanceCriteria: '验证记录包含条件、结果、偏差和结论。' }] },
      { name: '验证与量产导入', durationDays: 15, deliverables: '验证报告、试产记录、结项清单', acceptanceCriteria: '试产/验证结果达到门槛，未结事项已指派责任人。', milestones: [{ title: '试产验收通过', offsetDays: 10, acceptanceCriteria: '试产质量、工艺和供应准备通过评审。' }, { title: '项目结项', offsetDays: 15, acceptanceCriteria: '交付物归档、问题关闭或转交、经验复盘完成。' }], tasks: [{ title: '完成产品/工艺验证报告', offsetDays: 8, priority: 'high', estimateHours: 16, acceptanceCriteria: '报告含验证范围、结果、偏差及批准记录。' }, { title: '关闭遗留事项并组织结项复盘', offsetDays: 14, priority: 'medium', estimateHours: 6, acceptanceCriteria: '遗留事项已关闭或有明确后续负责人。' }] },
    ],
  },
  {
    id: 'tpl-engineering-change', code: 'TPL-EC-01', name: '工程变更', type: '工程变更', builtIn: true,
    description: '从变更提出、影响分析到验证、批准、发布和可追溯闭环。',
    phases: [
      { name: '变更提出与影响分析', durationDays: 5, deliverables: '变更申请、影响分析、风险与库存处置建议', acceptanceCriteria: '变更原因、范围、影响对象与风险均可追溯。', milestones: [{ title: '变更影响分析评审', offsetDays: 4, acceptanceCriteria: '设计、制造、采购、质量和库存影响已覆盖。' }], tasks: [{ title: '记录变更原因、范围和期望生效日期', offsetDays: 1, priority: 'high', estimateHours: 4, acceptanceCriteria: '变更输入完整并关联受影响物料/BOM/文档。' }, { title: '完成跨职能影响与风险分析', offsetDays: 3, priority: 'high', estimateHours: 8, acceptanceCriteria: '各职能责任人已给出意见与处置建议。' }] },
      { name: '方案验证与批准', durationDays: 10, deliverables: '变更方案、验证记录、批准意见', acceptanceCriteria: '验证通过，未解决风险得到批准或有关闭计划。', milestones: [{ title: '变更方案批准', offsetDays: 4, acceptanceCriteria: '审批意见完整且决策角色分离。' }, { title: '验证通过', offsetDays: 9, acceptanceCriteria: '验证样件、判定标准和结果记录齐全。' }], tasks: [{ title: '执行变更样件或工艺验证', offsetDays: 6, priority: 'high', estimateHours: 16, acceptanceCriteria: '结果满足验收标准并保留证据。' }] },
      { name: '发布与闭环', durationDays: 6, deliverables: '受控发布记录、切换清单、关闭报告', acceptanceCriteria: '变更版本、适用范围、生效点及通知对象一致。', milestones: [{ title: '受控发布完成', offsetDays: 5, acceptanceCriteria: '相关主数据和文件按批准版本发布。' }], tasks: [{ title: '更新受影响文件并通知相关职能', offsetDays: 2, priority: 'medium', estimateHours: 8, acceptanceCriteria: '版本修订和通知记录可查。' }, { title: '确认切换与遗留问题关闭', offsetDays: 6, priority: 'medium', estimateHours: 4, acceptanceCriteria: '库存/在制品切换按批准方案完成。' }] },
    ],
  },
  {
    id: 'tpl-quality-improvement', code: 'TPL-QI-01', name: '质量改进', type: '质量改进', builtIn: true,
    description: '适用于质量异常的遏制、根因分析、纠正预防措施和效果验证。',
    phases: [
      { name: '遏制与问题定义', durationDays: 3, deliverables: '问题描述、遏制措施、受影响范围', acceptanceCriteria: '问题边界、风险等级、责任人与遏制动作已明确。', milestones: [{ title: '遏制措施确认', offsetDays: 2, acceptanceCriteria: '现场、库存及在途风险均有处理决定。' }], tasks: [{ title: '明确问题现象、范围和影响等级', offsetDays: 1, priority: 'high', estimateHours: 4, acceptanceCriteria: '使用可验证事实和数据描述问题。' }, { title: '实施临时遏制并验证有效性', offsetDays: 2, priority: 'high', estimateHours: 6, acceptanceCriteria: '遏制措施有负责人、时间与验证证据。' }] },
      { name: '根因与纠正措施', durationDays: 7, deliverables: '根因分析、纠正措施与责任计划', acceptanceCriteria: '根因有证据支撑，措施针对根因且责任期限明确。', milestones: [{ title: '根因评审完成', offsetDays: 5, acceptanceCriteria: '根因可解释问题发生及未被检出的原因。' }], tasks: [{ title: '完成根因分析与证据复核', offsetDays: 4, priority: 'high', estimateHours: 10, acceptanceCriteria: '分析过程和证据可供独立复核。' }, { title: '制定并批准纠正/预防措施', offsetDays: 6, priority: 'high', estimateHours: 6, acceptanceCriteria: '措施有责任人、期限和量化验收标准。' }] },
      { name: '效果验证与关闭', durationDays: 10, deliverables: '效果验证报告、标准化文件、复盘记录', acceptanceCriteria: '验证周期和样本满足计划，效果达标后方可关闭。', milestones: [{ title: '效果验证通过', offsetDays: 9, acceptanceCriteria: '验证结果达到预设指标且无重复发生。' }], tasks: [{ title: '执行效果验证并记录结果', offsetDays: 7, priority: 'high', estimateHours: 8, acceptanceCriteria: '记录样本量、周期、指标与偏差。' }, { title: '更新标准文件并完成经验复盘', offsetDays: 10, priority: 'low', estimateHours: 4, acceptanceCriteria: '受控文件更新，经验教训形成可复用条目。' }] },
    ],
  },
  {
    id: 'tpl-enterprise-system-implementation', code: 'TPL-SI-01', name: '企业系统实施', type: '信息化实施', builtIn: true,
    description: '覆盖业务蓝图、配置集成、用户验收、上线切换和运维移交的企业系统交付阶段门。',
    phases: [
      { name: '启动与业务蓝图', durationDays: 12, deliverables: '项目章程、流程现状与目标蓝图、需求追踪矩阵、数据责任人清单', acceptanceCriteria: '范围、流程差异、关键用户、系统边界与验收指标均完成业务确认。', milestones: [{ title: '业务蓝图评审通过', offsetDays: 10, acceptanceCriteria: '核心流程、例外场景、角色权限和待决事项形成签核记录。' }], tasks: [{ title: '召开项目启动会并建立治理节奏', offsetDays: 2, priority: 'high', estimateHours: 8, acceptanceCriteria: '发起人、工作组、例会节奏和升级路径已确认。' }, { title: '梳理现状流程并完成目标蓝图', offsetDays: 8, priority: 'high', estimateHours: 32, acceptanceCriteria: '业务负责人确认流程、边界、差异及改进目标。' }, { title: '建立需求、风险和验收追踪矩阵', offsetDays: 11, priority: 'medium', estimateHours: 12, acceptanceCriteria: '每项关键需求均有责任人、验证方式和验收依据。' }] },
      { name: '配置、开发与集成', durationDays: 25, deliverables: '配置基线、接口规格与联调记录、迁移映射、权限矩阵', acceptanceCriteria: '关键配置和接口完成代码/配置评审，数据映射与权限经业务及安全复核。', milestones: [{ title: '配置基线冻结', offsetDays: 14, acceptanceCriteria: '核心主数据、流程、角色与环境参数均有版本记录。' }, { title: '核心接口联调通过', offsetDays: 23, acceptanceCriteria: '接口正反向、错误场景、重试和审计日志验证通过。' }], tasks: [{ title: '配置系统流程、主数据和组织权限', offsetDays: 10, priority: 'high', estimateHours: 40, acceptanceCriteria: '配置与已批准蓝图一致，关键权限通过角色测试。' }, { title: '实现并联调上下游接口', offsetDays: 20, priority: 'high', estimateHours: 48, acceptanceCriteria: '接口字段、错误处理、超时和审计记录满足规格。' }, { title: '准备迁移映射和首轮数据清洗', offsetDays: 24, priority: 'high', estimateHours: 24, acceptanceCriteria: '迁移规则可复现，关键字段完整率达到项目验收阈值。' }] },
      { name: '测试、培训与用户验收', durationDays: 18, deliverables: '系统测试报告、UAT签核、培训材料、缺陷与豁免清单', acceptanceCriteria: '关键端到端场景通过，阻断级缺陷关闭，业务验收人与遗留项责任明确。', milestones: [{ title: '用户验收测试签核', offsetDays: 16, acceptanceCriteria: '业务代表按批准场景完成验收并签署结论。' }], tasks: [{ title: '执行系统集成与权限回归测试', offsetDays: 6, priority: 'high', estimateHours: 32, acceptanceCriteria: '关键接口、权限边界、失败恢复和数据一致性验证通过。' }, { title: '开展关键用户培训与操作演练', offsetDays: 12, priority: 'medium', estimateHours: 16, acceptanceCriteria: '培训覆盖目标用户，签到、材料和反馈留档。' }, { title: '完成UAT缺陷修复与业务签核', offsetDays: 17, priority: 'high', estimateHours: 28, acceptanceCriteria: '未关闭缺陷均经业务负责人书面接受并有计划。' }] },
      { name: '上线切换与运维移交', durationDays: 10, deliverables: '上线就绪检查表、切换/回退方案、生产验证记录、运维手册', acceptanceCriteria: '上线审批、回退演练、支持值守和运维接管均有明确证据。', milestones: [{ title: '生产上线验收与移交', offsetDays: 9, acceptanceCriteria: '生产关键路径验证通过，服务台、运维责任和知识库已接收。' }], tasks: [{ title: '执行上线就绪评审与回退演练', offsetDays: 4, priority: 'high', estimateHours: 12, acceptanceCriteria: '备份、回退触发条件、责任人与恢复时限已验证。' }, { title: '完成生产切换、稳定性观察与移交', offsetDays: 9, priority: 'high', estimateHours: 24, acceptanceCriteria: '生产指标稳定，运维团队签收手册、告警和遗留项。' }] },
    ],
  },
  {
    id: 'tpl-equipment-introduction', code: 'TPL-EI-01', name: '设备导入与验收', type: '设备导入', builtIn: true,
    description: '适用于生产设备、检测设备或工装导入，涵盖需求规格、供应商验收、安装调试和能力确认。',
    phases: [
      { name: '需求与技术规格', durationDays: 10, deliverables: '设备需求书、URS、布局与公用工程条件、风险评估', acceptanceCriteria: '产能、精度、安全、接口、环境和维护要求经使用部门及EHS确认。', milestones: [{ title: '技术规格批准', offsetDays: 8, acceptanceCriteria: 'URS、验收标准、工厂/现场责任边界签核完成。' }], tasks: [{ title: '确认产能、质量和工艺能力需求', offsetDays: 3, priority: 'high', estimateHours: 12, acceptanceCriteria: '目标节拍、能力指标和适用产品范围可量化。' }, { title: '完成设备布局、公用工程与安全审查', offsetDays: 7, priority: 'high', estimateHours: 16, acceptanceCriteria: '空间、能源、网络、维护和安全风险均有结论。' }] },
      { name: '采购设计与制造', durationDays: 30, deliverables: '供应商技术协议、设计评审、制造进度、预验收计划', acceptanceCriteria: '关键技术偏差获批准，供应商计划与采购交付节点受控。', milestones: [{ title: '供应商设计评审', offsetDays: 12, acceptanceCriteria: '关键部件、控制方案、接口、风险及变更流程完成评审。' }, { title: '设备制造完成待验收', offsetDays: 28, acceptanceCriteria: '设备资料、校准证书和工厂测试准备齐全。' }], tasks: [{ title: '审查设备设计、控制和接口方案', offsetDays: 11, priority: 'high', estimateHours: 20, acceptanceCriteria: '设计符合URS，安全回路和上位系统接口明确。' }, { title: '跟踪制造进度和供应风险', offsetDays: 24, priority: 'medium', estimateHours: 12, acceptanceCriteria: '关键路径、长周期件及偏差均有更新责任人。' }, { title: '审核预验收脚本和计量文件', offsetDays: 29, priority: 'high', estimateHours: 12, acceptanceCriteria: '测试用例覆盖安全、节拍、精度、报警和数据记录。' }] },
      { name: '工厂验收与现场安装', durationDays: 18, deliverables: 'FAT记录、运输交接、安装检查表、现场调试记录', acceptanceCriteria: 'FAT偏差有处置结论，安装符合布局与安全要求，调试日志完整。', milestones: [{ title: '工厂验收通过', offsetDays: 6, acceptanceCriteria: '按签核方案完成FAT，关键不符合项关闭或获批准。' }, { title: '现场安装与公用工程确认', offsetDays: 15, acceptanceCriteria: '机械、电气、公用工程及安全检查通过。' }], tasks: [{ title: '见证工厂验收并关闭偏差项', offsetDays: 6, priority: 'high', estimateHours: 20, acceptanceCriteria: 'FAT结果、仪器状态、偏差和复测证据齐全。' }, { title: '组织运输、就位和现场安装检查', offsetDays: 13, priority: 'high', estimateHours: 24, acceptanceCriteria: '运输损伤、固定、接地和安全防护检查完成。' }, { title: '完成单机调试与联机验证', offsetDays: 17, priority: 'high', estimateHours: 32, acceptanceCriteria: '设备与生产线/信息系统接口按批准方案验证。' }] },
      { name: '能力确认与正式移交', durationDays: 14, deliverables: 'SAT报告、能力验证、培训签到、备件清单、验收与资产移交', acceptanceCriteria: '安全、质量、节拍与能力门槛达标，操作维护人员完成培训并正式签收。', milestones: [{ title: '现场验收与资产移交', offsetDays: 13, acceptanceCriteria: 'SAT、能力研究、培训、备件、维护计划和未结项均有签核。' }], tasks: [{ title: '执行SAT、节拍和产品能力验证', offsetDays: 9, priority: 'high', estimateHours: 32, acceptanceCriteria: '测量方法、样本、环境条件、结果和判定均留档。' }, { title: '完成操作维护培训与点检标准', offsetDays: 11, priority: 'medium', estimateHours: 16, acceptanceCriteria: '操作员与维修人员完成分层培训，标准文件受控发布。' }, { title: '签署设备验收并移交资产责任', offsetDays: 14, priority: 'high', estimateHours: 8, acceptanceCriteria: '资产编号、保修、备件、责任人和遗留计划完整。' }] },
    ],
  },
]
