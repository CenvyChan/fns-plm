import type { Graph, Node } from './BpmnModelerWorkbench';
export type TemplateKind = 'serial' | 'exclusive' | 'parallel';
export function approvalTemplate(kind: TemplateKind, key: string, userId: string): Graph {
  const task = (id: string, name: string, x: number, y: number): Node => ({ id, type: 'userTask', name, x, y, assignment: { kind: 'assignee', userIds: [userId] } });
  const start: Node = { id: 'start', type: 'startEvent', name: '开始', x: 60, y: 200 };
  const end: Node = { id: 'end', type: 'endEvent', name: '结束', x: 840, y: 200 };
  if (kind === 'exclusive') return { key, name: '条件审批流程', nodes: [start, task('review', '初审', 160, 180), { id: 'decision', type: 'exclusiveGateway', name: '审批结果', x: 340, y: 195 }, task('approvedTask', '通过后复核', 480, 90), task('rejectedTask', '驳回处理', 480, 300), end], flows: [{id:'flow1',source:'start',target:'review'}, {id:'flow2',source:'review',target:'decision'}, {id:'approvedFlow',source:'decision',target:'approvedTask',condition:'approved',name:'审批通过'}, {id:'rejectedFlow',source:'decision',target:'rejectedTask',condition:'rejected',name:'审批驳回'}, {id:'flow5',source:'approvedTask',target:'end'}, {id:'flow6',source:'rejectedTask',target:'end'}] };
  if (kind === 'parallel') return { key, name: '并行审批流程', nodes: [start, {id:'fork',type:'parallelGateway',name:'并行分发',x:220,y:195}, task('reviewA','技术审批',400,90),task('reviewB','业务审批',400,300),{id:'join',type:'parallelGateway',name:'等待全部分支',x:650,y:195},end], flows:[{id:'flow1',source:'start',target:'fork'},{id:'branchA',source:'fork',target:'reviewA'},{id:'branchB',source:'fork',target:'reviewB'},{id:'joinA',source:'reviewA',target:'join'},{id:'joinB',source:'reviewB',target:'join'},{id:'flow6',source:'join',target:'end'}] };
  return { key, name: '串行审批流程', nodes: [start,task('review','审批',340,180),{...end,x:620}], flows:[{id:'flow1',source:'start',target:'review'},{id:'flow2',source:'review',target:'end'}] };
}
