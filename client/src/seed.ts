import type { Bom, KpiRule, Material, PerformanceReview, PlmDocument, Project, SalesBomSnapshot, Task, WorkspaceData } from './types'

const day = (offset: number) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10) }
const now = new Date().toISOString()
export const seedProjects: Project[] = [
  { id: 'project-brand', name: '品牌焕新计划', description: '让产品体验和品牌表达，成为同一件事。', color: '#8d7cf6', dueDate: day(12), createdAt: now },
  { id: 'project-growth', name: '个人成长系统', description: '为专注、运动和持续学习留出空间。', color: '#56b89a', dueDate: day(23), createdAt: now },
  { id: 'project-reading', name: '年度阅读清单', description: '每周读一点，把好想法真正用起来。', color: '#efa869', dueDate: day(35), createdAt: now },
]
export const seedTasks: Task[] = [
  { id: 'task-1', title: '梳理首页的信息层级与关键路径', dueDate: day(0), priority: 'high', status: 'in-progress', projectId: 'project-brand', createdAt: now },
  { id: 'task-2', title: '整理本周产品需求与待确认项', dueDate: day(0), priority: 'high', status: 'todo', projectId: 'project-brand', createdAt: now },
  { id: 'task-3', title: '完成 30 分钟力量训练', dueDate: day(0), priority: 'medium', status: 'todo', projectId: 'project-growth', createdAt: now },
  { id: 'task-4', title: '给下一阶段写下三个优先目标', dueDate: day(0), priority: 'low', status: 'done', projectId: 'project-growth', createdAt: now },
  { id: 'task-5', title: '确认视觉方向与色彩系统', dueDate: day(1), priority: 'medium', status: 'todo', projectId: 'project-brand', createdAt: now },
  { id: 'task-6', title: '完成《原子习惯》第五章', dueDate: day(2), priority: 'low', status: 'in-progress', projectId: 'project-reading', createdAt: now },
  { id: 'task-7', title: '复盘本周：记录一个进步和一个问题', dueDate: day(3), priority: 'medium', status: 'todo', projectId: 'project-growth', createdAt: now },
  { id: 'task-8', title: '整理项目交付清单', dueDate: day(4), priority: 'medium', status: 'done', projectId: 'project-brand', createdAt: now },
  { id: 'task-9', title: '标记三段值得回看的阅读笔记', dueDate: day(6), priority: 'low', status: 'todo', projectId: 'project-reading', createdAt: now },
]
export const seedKpiRules: KpiRule[] = [
  { id: 'kpi-001', code: 'KPI-QA-001', name: '一次交检合格率', category: '质量', formula: '首次检验合格批次 ÷ 检验批次 × 100%', unit: '%', target: 98, direction: 'higher', weight: 25, cycle: '月度', owner: '质量部', status: 'active', updatedAt: now },
  { id: 'kpi-002', code: 'KPI-ENG-002', name: '工程变更平均周期', category: '流程效率', formula: '变更关闭日期 − 变更发起日期', unit: '天', target: 5, direction: 'lower', weight: 20, cycle: '月度', owner: '工程部', status: 'active', updatedAt: now },
  { id: 'kpi-003', code: 'KPI-DATA-003', name: 'BOM 数据准确率', category: '数据治理', formula: '抽检正确行数 ÷ BOM 抽检总行数 × 100%', unit: '%', target: 99.5, direction: 'higher', weight: 20, cycle: '季度', owner: 'PLM 管理员', status: 'active', updatedAt: now },
  { id: 'kpi-004', code: 'KPI-DOC-004', name: '图纸受控发布率', category: '数据治理', formula: '已批准受控图纸 ÷ 有效图纸总数 × 100%', unit: '%', target: 100, direction: 'higher', weight: 15, cycle: '月度', owner: '文控中心', status: 'active', updatedAt: now },
  { id: 'kpi-005', code: 'KPI-PM-005', name: '设计任务按期交付率', category: '交付', formula: '按期完成任务数 ÷ 到期任务数 × 100%', unit: '%', target: 95, direction: 'higher', weight: 10, cycle: '月度', owner: '项目管理部', status: 'active', updatedAt: now },
  { id: 'kpi-006', code: 'KPI-COST-006', name: '关键物料复用率', category: '成本与复用', formula: '复用物料项数 ÷ 新建物料项数 × 100%', unit: '%', target: 60, direction: 'higher', weight: 10, cycle: '季度', owner: '研发中心', status: 'draft', updatedAt: now },
]
export const seedReviews: PerformanceReview[] = [
  { id: 'review-001', employee: '林予安', department: '研发中心', period: '2026 Q3', reviewer: '陈主管', status: 'manager-review', score: 92, note: '交付稳定，建议加强跨部门变更闭环。', updatedAt: now },
  { id: 'review-002', employee: '周昕', department: '质量部', period: '2026 Q3', reviewer: '王经理', status: 'self-review', score: 0, note: '', updatedAt: now },
  { id: 'review-003', employee: '许承远', department: '工程部', period: '2026 Q2', reviewer: '陈主管', status: 'approved', score: 88, note: '目标达成，流程合规表现良好。', updatedAt: now },
]
export const seedMaterials: Material[] = [
  { id: 'mat-1000', partNo: 'DEMO-ASM-1000', name: '智能台灯整机', category: '成品', family: '成品', groupNodeId: 'finished.01.01.01', classificationPath: ['注塑件', '冷插骨架', '单槽型'], dimensions: { 'injection-material': 'injection-material.01' }, specificationFields: { power: '12W', connector: 'USB-C' }, specification: 'LED / 12W / USB-C', unit: '台', revision: 'B', lifecycle: 'released', owner: '林予安', codePreview: '正式编码待规则确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-1001', partNo: 'DEMO-MEC-2101', name: '铝合金灯臂', category: '机械件', specification: '6061-T6 / 阳极氧化', unit: '件', revision: 'A', lifecycle: 'released', owner: '许承远', codePreview: '演示资料 · 非 ERP 物料号', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-1002', partNo: 'DEMO-ELE-3102', name: 'LED 光源模组', category: '电子件', specification: '双色温 / CRI ≥ 90', unit: '件', revision: 'C', lifecycle: 'released', owner: '周昕', codePreview: '演示资料 · 非 ERP 物料号', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-1003', partNo: 'DEMO-ELE-3110', name: '触控驱动板', category: '电子件', specification: 'PCB / Rev 2.1 / 12V', unit: '件', revision: 'B', lifecycle: 'review', owner: '周昕', codePreview: '演示资料 · 非 ERP 物料号', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-1004', partNo: 'DEMO-MEC-2108', name: '压铸底座', category: '机械件', specification: 'ADC12 / 喷砂黑', unit: '件', revision: 'A', lifecycle: 'released', owner: '许承远', codePreview: '演示资料 · 非 ERP 物料号', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-1005', partNo: 'DEMO-STD-0004', name: '内六角螺钉 M4×10', category: '标准件', specification: '不锈钢 A2-70', unit: '颗', revision: 'A', lifecycle: 'released', owner: '林予安', codePreview: '演示资料 · 非 ERP 物料号', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-pack-standard', partNo: 'DEMO-PKG-STD', name: '通用运输外箱', category: '包装材料', family: '原材料', groupNodeId: 'raw.04.01', proposedGroupNumber: '3.04.01', specification: '订单可配置包装示例', unit: '个', revision: 'A', lifecycle: 'released', owner: '文控中心', codePreview: '规则待确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-pack-gift', partNo: 'DEMO-PKG-GIFT', name: '礼盒包装', category: '包装材料', family: '原材料', groupNodeId: 'raw.04.01', proposedGroupNumber: '3.04.01', specification: '订单可配置包装示例', unit: '个', revision: 'A', lifecycle: 'released', owner: '文控中心', codePreview: '规则待确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-label-zh', partNo: 'DEMO-LBL-ZH', name: '中文铭牌标签', category: '标签', family: '原材料', groupNodeId: 'raw.04.08', specification: '简体中文标签示例', unit: '张', revision: 'A', lifecycle: 'released', owner: '文控中心', codePreview: '规则待确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-label-ja', partNo: 'DEMO-LBL-JA', name: '日文铭牌标签', category: '标签', family: '原材料', groupNodeId: 'raw.04.08', specification: '日文标签示例', unit: '张', revision: 'A', lifecycle: 'released', owner: '文控中心', codePreview: '规则待确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
  { id: 'mat-label-en', partNo: 'DEMO-LBL-EN', name: '英文铭牌标签', category: '标签', family: '原材料', groupNodeId: 'raw.04.08', specification: '英文标签示例', unit: '张', revision: 'A', lifecycle: 'released', owner: '文控中心', codePreview: '规则待确认', codeState: 'blocked', erpSyncState: 'unverified', createdAt: now, updatedAt: now },
]
const designBom: Bom = { id: 'bom-ebom-b', bomNo: 'EBOM-ASM-1000', parentMaterialId: 'mat-1000', kind: 'design', revision: 'B', lifecycle: 'released', effectiveDate: day(-45), updatedAt: now, scope: '产品基线', lines: [
  { id: 'line-ebom-1', materialId: 'mat-1001', quantity: 1, findNumber: '0010', role: 'component' }, { id: 'line-ebom-2', materialId: 'mat-1002', quantity: 1, findNumber: '0020', role: 'component' }, { id: 'line-ebom-3', materialId: 'mat-1003', quantity: 1, findNumber: '0030', role: 'component' }, { id: 'line-ebom-4', materialId: 'mat-1004', quantity: 1, findNumber: '0040', role: 'component' }, { id: 'line-ebom-5', materialId: 'mat-1005', quantity: 4, findNumber: '0050', role: 'component' },
] }
export const seedBoms: Bom[] = [
  designBom,
  { id: 'bom-ebom-a', bomNo: 'EBOM-ASM-1000', parentMaterialId: 'mat-1000', kind: 'design', revision: 'A', lifecycle: 'obsolete', effectiveDate: day(-120), updatedAt: now, scope: '历史设计基线', lines: designBom.lines.slice(0, 3).map((line, i) => ({ ...line, id: `line-ebom-a-${i}` })) },
  { id: 'bom-mbom-a', bomNo: 'MBOM-ASM-1000-L1', parentMaterialId: 'mat-1000', kind: 'manufacturing', revision: 'A', lifecycle: 'released', effectiveDate: day(-20), updatedAt: now, scope: '总装线 A', sourceBomId: designBom.id, sourceRevision: designBom.revision, lines: [
    { id: 'line-mbom-1', materialId: 'mat-1001', quantity: 1, findNumber: '0010', role: 'process', operation: '工位 10 · 安装灯臂', referenceDesignLineId: 'line-ebom-1' }, { id: 'line-mbom-2', materialId: 'mat-1002', quantity: 1, findNumber: '0020', role: 'process', operation: '工位 20 · 装配光源', referenceDesignLineId: 'line-ebom-2' }, { id: 'line-mbom-3', materialId: 'mat-1003', quantity: 1, findNumber: '0030', role: 'process', operation: '工位 30 · 接线与测试', referenceDesignLineId: 'line-ebom-3' }, { id: 'line-mbom-4', materialId: 'mat-1005', quantity: 4, findNumber: '0040', role: 'process', operation: '工位 40 · 紧固', referenceDesignLineId: 'line-ebom-5' },
  ] },
  { id: 'bom-sbom-cn', bomNo: 'SBOM-ASM-1000-CN', parentMaterialId: 'mat-1000', kind: 'sales', revision: 'A', lifecycle: 'released', effectiveDate: day(-10), updatedAt: now, scope: '中国市场 · 电商', sourceBomId: designBom.id, sourceRevision: designBom.revision, lines: [],
    configAttributes: [
      { key: 'market', label: '销售市场', required: true, values: [{ value: 'CN', label: '中国' }] },
      { key: 'salesChannel', label: '销售渠道', required: true, values: [{ value: 'ecommerce', label: '电商' }, { value: 'dealer', label: '经销' }] },
      { key: 'packaging', label: '包装方案', required: true, values: [{ value: 'standard', label: '标准运输箱' }, { value: 'gift', label: '礼盒' }] },
      { key: 'labelLanguage', label: '标签语言', required: true, values: [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: '英文' }] },
    ],
    configGroups: [{ key: 'packaging', label: '外包装', required: true }, { key: 'label', label: '销售标签', required: true }],
    salesRules: [
      { id: 'rule-cn-package-standard', groupKey: 'packaging', conditions: [{ attributeKey: 'packaging', value: 'standard' }], materialId: 'mat-pack-standard', quantity: 1, priority: 1 },
      { id: 'rule-cn-package-gift', groupKey: 'packaging', conditions: [{ attributeKey: 'packaging', value: 'gift' }], materialId: 'mat-pack-gift', quantity: 1, priority: 1 },
      { id: 'rule-cn-label-zh', groupKey: 'label', conditions: [{ attributeKey: 'labelLanguage', value: 'zh-CN' }], materialId: 'mat-label-zh', quantity: 1, priority: 1 },
      { id: 'rule-cn-label-en', groupKey: 'label', conditions: [{ attributeKey: 'labelLanguage', value: 'en-US' }], materialId: 'mat-label-en', quantity: 1, priority: 1 },
    ] },
  { id: 'bom-sbom-jp', bomNo: 'SBOM-ASM-1000-JP', parentMaterialId: 'mat-1000', kind: 'sales', revision: 'A', lifecycle: 'released', effectiveDate: day(-8), updatedAt: now, scope: '日本市场 · OEM', sourceBomId: designBom.id, sourceRevision: designBom.revision, lines: [],
    configAttributes: [
      { key: 'market', label: '销售市场', required: true, values: [{ value: 'JP', label: '日本' }] },
      { key: 'salesChannel', label: '销售渠道', required: true, values: [{ value: 'oem', label: 'OEM' }, { value: 'retail', label: '零售' }] },
      { key: 'packaging', label: '包装方案', required: true, values: [{ value: 'standard', label: '标准运输箱' }, { value: 'gift', label: '礼盒' }] },
      { key: 'labelLanguage', label: '标签语言', required: true, values: [{ value: 'ja-JP', label: '日文' }, { value: 'en-US', label: '英文' }] },
    ],
    configGroups: [{ key: 'packaging', label: '外包装', required: true }, { key: 'label', label: '销售标签', required: true }],
    salesRules: [
      { id: 'rule-jp-package-standard', groupKey: 'packaging', conditions: [{ attributeKey: 'packaging', value: 'standard' }], materialId: 'mat-pack-standard', quantity: 1, priority: 1 },
      { id: 'rule-jp-package-gift', groupKey: 'packaging', conditions: [{ attributeKey: 'packaging', value: 'gift' }], materialId: 'mat-pack-gift', quantity: 1, priority: 1 },
      { id: 'rule-jp-label-ja', groupKey: 'label', conditions: [{ attributeKey: 'labelLanguage', value: 'ja-JP' }], materialId: 'mat-label-ja', quantity: 1, priority: 1 },
      { id: 'rule-jp-label-en', groupKey: 'label', conditions: [{ attributeKey: 'labelLanguage', value: 'en-US' }], materialId: 'mat-label-en', quantity: 1, priority: 1 },
    ] },
]
export const seedSalesBomSnapshots: SalesBomSnapshot[] = [
  { id: 'sales-snapshot-001', orderNo: 'SO-DEMO-2600458', parentMaterialId: 'mat-1000', bomId: 'bom-sbom-jp', bomNo: 'SBOM-ASM-1000-JP', bomRevision: 'A', quantity: 12, attributes: { market: 'JP', salesChannel: 'oem', packaging: 'gift', labelLanguage: 'ja-JP' }, lines: [
    ...designBom.lines.map(line => ({ id: `snap-${line.id}`, materialId: line.materialId, quantity: line.quantity * 12, role: line.role ?? 'component', sourceBomId: designBom.id, sourceRevision: designBom.revision, findNumber: line.findNumber })),
    { id: 'snap-pack-jp', materialId: 'mat-pack-gift', quantity: 12, role: 'packaging', sourceBomId: 'bom-sbom-jp', sourceRevision: 'A', sourceRuleId: 'rule-jp-package-gift', findNumber: 'S001' },
    { id: 'snap-label-jp', materialId: 'mat-label-ja', quantity: 12, role: 'label', sourceBomId: 'bom-sbom-jp', sourceRevision: 'A', sourceRuleId: 'rule-jp-label-ja', findNumber: 'S002' },
  ], createdAt: now },
]
export const seedDocuments: PlmDocument[] = [
  { id: 'doc-001', docNo: 'DWG-MEC-2101', title: '灯臂零件图', type: '工程图', materialId: 'mat-1001', revision: 'A', lifecycle: 'released', owner: '许承远', updatedAt: now, fileName: 'DWG-MEC-2101-A.pdf' },
  { id: 'doc-002', docNo: 'SPEC-ELE-3102', title: 'LED 模组技术规格书', type: '规格书', materialId: 'mat-1002', revision: 'C', lifecycle: 'released', owner: '周昕', updatedAt: now, fileName: 'SPEC-ELE-3102-C.pdf' },
  { id: 'doc-003', docNo: 'DWG-MEC-2108', title: '压铸底座二维工程图', type: '工程图', materialId: 'mat-1004', revision: 'A', lifecycle: 'review', owner: '许承远', updatedAt: now, fileName: 'DWG-MEC-2108-A.pdf' },
  { id: 'doc-004', docNo: 'WI-ASM-1000', title: '智能台灯总装作业指导书', type: '工艺文件', materialId: 'mat-1000', revision: 'B', lifecycle: 'released', owner: '王工', updatedAt: now, fileName: 'WI-ASM-1000-B.pdf' },
]
export const seedWorkspace: WorkspaceData = { tasks: seedTasks, projects: seedProjects, kpiRules: seedKpiRules, reviews: seedReviews, materials: seedMaterials, boms: seedBoms, salesBomSnapshots: seedSalesBomSnapshots, documents: seedDocuments, projectPhases: [], projectMilestones: [], projectEvents: [], projectEventReviews: [], projectReports: [], projectTemplates: [] }
