import ExcelJS from 'exceljs'

type Row = Record<string, unknown>
export interface ImportPhase { code: string; name: string; order: number; startDate: string; dueDate: string; owner: string; status: string; progress: number; deliverables: string; acceptanceCriteria: string }
export interface ImportMilestone { code: string; title: string; phaseCode: string; dueDate: string; actualDate: string; owner: string; status: string; acceptanceCriteria: string }
export interface ImportTask { wbsCode: string; title: string; phaseCode: string; milestoneCode: string; assignee: string; startDate: string; dueDate: string; priority: 'low'|'medium'|'high'; status: 'todo'|'in-progress'|'done'; progress: number; estimateHours: number; acceptanceCriteria: string; description: string }
export interface ProjectPlanImport { phases: ImportPhase[]; milestones: ImportMilestone[]; tasks: ImportTask[] }

const text = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0,10)
  if (typeof value === 'object') {
    const item = value as { text?: unknown; richText?: Array<{text?: string}>; result?: unknown; hyperlink?: string }
    if (typeof item.text === 'string') return item.text.trim()
    if (Array.isArray(item.richText)) return item.richText.map(part => part.text ?? '').join('').trim()
    if (item.result !== undefined) return text(item.result)
  }
  return String(value).trim()
}
function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0,10)
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 100000) return new Date(Date.UTC(1899,11,30) + value * 86400000).toISOString().slice(0,10)
  const raw = text(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const match = raw.match(/^(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})日?$/)
  if (match) return `${match[1]}-${match[2]!.padStart(2,'0')}-${match[3]!.padStart(2,'0')}`
  return raw
}
function csvRows(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false
  const source = input.replace(/^\uFEFF/, '')
  for (let i=0; i<source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"' && source[i+1] === '"') { value += '"'; i++ }
      else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(value); value = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i+1] === '\n') i++
      row.push(value); value = ''
      if (row.some(cell => cell.trim() !== '')) rows.push(row)
      row = []
    } else value += char
  }
  row.push(value); if (row.some(cell => cell.trim() !== '')) rows.push(row)
  return rows
}
const headerAliases: Record<string,string[]> = {
  code: ['阶段编码','里程碑编码','编码','code'], wbsCode: ['wbs编码','wbs','任务编码','编码'], title: ['任务名称','任务','task','title'], phaseCode: ['阶段编码','阶段','所属阶段编码','phasecode'], milestoneCode: ['里程碑编码','里程碑','关联里程碑编码','milestonecode'], assignee: ['负责人','责任人','assignee','owner'], startDate: ['计划开始','开始日期','startdate'], dueDate: ['计划截止','计划完成','计划日期','截止日期','duedate'], priority: ['优先级','priority'], status: ['状态','status'], progress: ['进度','完成率','progress'], estimateHours: ['预计工时','估算工时','estimatehours'], acceptanceCriteria: ['验收标准','验收条件','acceptancecriteria'], description: ['任务说明','说明','description'],
  phaseName: ['阶段名称','阶段名','phases'], order: ['顺序','阶段顺序','order'], deliverables: ['关键交付物','交付物','deliverables'], phaseStatus: ['阶段状态','状态','status'], phaseProgress: ['阶段进度','进度','progress'], milestoneTitle: ['里程碑名称','里程碑','title'], actualDate: ['实际日期','完成日期','actualdate'], milestoneStatus: ['状态','status'],
}
function lookup(row: Map<string,string>, key: string): string {
  for (const alias of headerAliases[key] ?? [key]) { const found = row.get(alias.toLowerCase().replace(/\s/g,'')); if (found !== undefined) return found }
  return ''
}
function mapRecords(headers: string[], rows: string[][]): Array<Map<string,string>> {
  return rows.map(values => new Map(headers.map((header,index) => [header.toLowerCase().replace(/\s/g,''), values[index] ?? ''])))
}
function normalizedPriority(raw: string): ImportTask['priority'] { const value=raw.toLowerCase(); return ['high','高','紧急'].includes(value) ? 'high' : ['low','低'].includes(value) ? 'low' : 'medium' }
function normalizedStatus(raw: string): ImportTask['status'] { const value=raw.toLowerCase(); return ['done','completed','已完成','完成','关闭'].includes(value) ? 'done' : ['in-progress','in progress','进行中'].includes(value) ? 'in-progress' : 'todo' }
function finiteNumber(value: string, fallback: number, min: number, max: number): number { const number=Number(value); return Number.isFinite(number) ? Math.max(min,Math.min(max,number)) : fallback }
function parseTaskRecords(records: Array<Map<string,string>>): ImportTask[] {
  if (records.length > 5000) throw new Error('每次最多导入 5000 条任务。')
  return records.map((record,index) => {
    const title=lookup(record,'title'), dueDate=dateValue(lookup(record,'dueDate')), startDate=dateValue(lookup(record,'startDate'))
    if (!title) throw new Error(`第 ${index+2} 行缺少任务名称。`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error(`任务“${title}”的计划截止日期无效。`)
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error(`任务“${title}”的计划开始日期无效。`)
    return { wbsCode: lookup(record,'wbsCode') || `IMP-${String(index+1).padStart(4,'0')}`, title: title.slice(0,160), phaseCode: lookup(record,'phaseCode'), milestoneCode: lookup(record,'milestoneCode'), assignee: lookup(record,'assignee'), startDate, dueDate, priority: normalizedPriority(lookup(record,'priority')), status: normalizedStatus(lookup(record,'status')), progress: finiteNumber(lookup(record,'progress'),0,0,100), estimateHours: finiteNumber(lookup(record,'estimateHours'),0,0,100000), acceptanceCriteria: lookup(record,'acceptanceCriteria').slice(0,2000), description: lookup(record,'description').slice(0,2000) }
  })
}
function sheetRecords(sheet: ExcelJS.Worksheet | undefined): { headers: string[]; rows: string[][] } {
  if (!sheet || sheet.rowCount < 2) return { headers: [], rows: [] }
  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, cell => headers.push(text(cell.value)))
  const rows: string[][]=[]
  sheet.eachRow({ includeEmpty: false }, (row,rowNumber) => { if (rowNumber === 1) return; const values: string[]=[]; row.eachCell({includeEmpty:true},cell=>values.push(text(cell.value))); rows.push(values) })
  return { headers, rows }
}
function phaseRecords(headers: string[], rows: string[][]): ImportPhase[] {
  if (rows.length > 500) throw new Error('每次最多导入 500 个阶段。')
  return mapRecords(headers,rows).map((record,index)=>{
    const code=lookup(record,'code') || lookup(record,'phaseCode') || `P${index+1}`, name=lookup(record,'phaseName'), startDate=dateValue(lookup(record,'startDate')), dueDate=dateValue(lookup(record,'dueDate'))
    if (!name) throw new Error(`阶段表第 ${index+2} 行缺少阶段名称。`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error(`阶段“${name}”日期无效。`)
    const rawStatus=lookup(record,'phaseStatus').toLowerCase(), status=['completed','已完成','完成'].includes(rawStatus)?'completed':['blocked','受阻'].includes(rawStatus)?'blocked':['in-progress','进行中'].includes(rawStatus)?'in-progress':'not-started'
    return {code:code.slice(0,40),name:name.slice(0,120),order:finiteNumber(lookup(record,'order'),index+1,1,1000),startDate,dueDate,owner:lookup(record,'assignee').slice(0,120),status,progress:finiteNumber(lookup(record,'phaseProgress'),0,0,100),deliverables:lookup(record,'deliverables').slice(0,2000),acceptanceCriteria:lookup(record,'acceptanceCriteria').slice(0,2000)}
  })
}
function milestoneRecords(headers: string[], rows: string[][]): ImportMilestone[] {
  if (rows.length > 1000) throw new Error('每次最多导入 1000 个里程碑。')
  return mapRecords(headers,rows).map((record,index)=>{
    const title=lookup(record,'milestoneTitle'), dueDate=dateValue(lookup(record,'dueDate'))
    if (!title) throw new Error(`里程碑表第 ${index+2} 行缺少里程碑名称。`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error(`里程碑“${title}”计划日期无效。`)
    const rawStatus=lookup(record,'milestoneStatus').toLowerCase(), status=['completed','已完成','完成'].includes(rawStatus)?'completed':['missed','已错过','逾期'].includes(rawStatus)?'missed':'planned'
    return {code:lookup(record,'code') || `M${index+1}`,title:title.slice(0,160),phaseCode:lookup(record,'phaseCode'),dueDate,actualDate:dateValue(lookup(record,'actualDate')),owner:lookup(record,'assignee').slice(0,120),status,acceptanceCriteria:lookup(record,'acceptanceCriteria').slice(0,2000)}
  })
}
export async function parseProjectPlanFile(fileName: string, buffer: Buffer): Promise<ProjectPlanImport> {
  const ext=fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
  if (ext === '.csv') {
    const rows=csvRows(buffer.toString('utf8'))
    if (rows.length < 2) throw new Error('CSV 文件没有可导入的任务行。')
    return { phases:[], milestones:[], tasks:parseTaskRecords(mapRecords(rows[0]!,rows.slice(1))) }
  }
  if (ext !== '.xlsx') throw new Error('仅支持 CSV 或 XLSX 文件；旧版 XLS 请先另存为 XLSX。')
  const workbook=new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const phaseSheet=workbook.getWorksheet('阶段'), milestoneSheet=workbook.getWorksheet('里程碑'), taskSheet=workbook.getWorksheet('任务') ?? workbook.getWorksheet('Tasks') ?? workbook.worksheets.find(sheet=>![phaseSheet,milestoneSheet].includes(sheet))
  const phases=sheetRecords(phaseSheet), milestones=sheetRecords(milestoneSheet), tasks=sheetRecords(taskSheet)
  if (!tasks.headers.length || !tasks.rows.length) throw new Error('工作簿缺少“任务”工作表或没有任务数据。')
  return { phases:phaseRecords(phases.headers,phases.rows), milestones:milestoneRecords(milestones.headers,milestones.rows), tasks:parseTaskRecords(mapRecords(tasks.headers,tasks.rows)) }
}
const csvEscape=(value: unknown) => `"${String(value ?? '').replace(/"/g,'""')}"`
export function projectTaskCsv(phases: Row[], milestones: Row[], tasks: Row[]): Buffer {
  const phaseById=new Map(phases.map(phase=>[String(phase.id),String(phase.code ?? '')]))
  const milestoneById=new Map(milestones.map(item=>[String(item.id),String(item.code ?? '')]))
  const header=['WBS编码','任务名称','所属阶段编码','关联里程碑编码','负责人','计划开始','计划截止','优先级','状态','进度','预计工时','验收标准','任务说明']
  const rows=tasks.map(task=>[task.wbsCode,task.title,phaseById.get(String(task.phaseId ?? '')) ?? '',milestoneById.get(String(task.milestoneId ?? '')) ?? '',task.assignee,task.startDate,task.dueDate,task.priority,task.status,task.status==='done'?100:task.progress,task.estimateHours,task.acceptanceCriteria,task.description])
  return Buffer.from(`\uFEFF${[header,...rows].map(row=>row.map(csvEscape).join(',')).join('\r\n')}`,'utf8')
}
export async function projectWorkbook(project: Row, phases: Row[], milestones: Row[], tasks: Row[], events: Row[], reviews: Row[], reports: Row[], files: Row[]): Promise<Buffer> {
  const wb=new ExcelJS.Workbook(); wb.creator='Momentum PLM'; wb.created=new Date(); wb.modified=new Date()
  const add=(name:string,headers:string[],rows:unknown[][])=>{ const sheet=wb.addWorksheet(name); sheet.addRow(headers); for(const row of rows) sheet.addRow(row); sheet.views=[{state:'frozen',ySplit:1}]; if(rows.length) sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}}; sheet.getRow(1).font={bold:true,color:{argb:'FF3F376B'}}; sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1EEFF'}}; sheet.columns=headers.map((header,index)=>({width:Math.min(42,Math.max(14,header.length*2+4,index===1?26:0))})) }
  add('项目概要',['项目编号','项目名称','类型','状态','部门','负责人','发起人','计划开始','计划完成','进度','项目目标','范围边界','成功标准','简介'],[[project.code,project.name,project.type,project.status,project.department,project.owner,project.sponsor,project.startDate,project.dueDate,project.progress,project.goal,project.scope,project.successCriteria,project.description]])
  add('阶段',['阶段编码','阶段名称','顺序','计划开始','计划完成','实际开始','实际完成','负责人','阶段状态','进度','关键交付物','验收标准'],phases.map(row=>[row.code,row.name,row.order,row.startDate,row.dueDate,row.actualStartDate,row.actualEndDate,row.owner,row.status,row.progress,row.deliverables,row.acceptanceCriteria]))
  add('里程碑',['里程碑编码','里程碑名称','所属阶段编码','计划日期','实际日期','负责人','状态','验收标准'],milestones.map(row=>[row.code,row.title,phases.find(phase=>phase.id===row.phaseId)?.code,row.dueDate,row.actualDate,row.owner,row.status,row.acceptanceCriteria]))
  add('任务',['WBS编码','任务名称','所属阶段编码','关联里程碑编码','负责人','计划开始','计划截止','优先级','状态','进度','预计工时','验收标准','任务说明'],tasks.map(row=>[row.wbsCode,row.title,phases.find(phase=>phase.id===row.phaseId)?.code,milestones.find(item=>item.id===row.milestoneId)?.code,row.assignee,row.startDate,row.dueDate,row.priority,row.status,row.status==='done'?100:row.progress,row.estimateHours,row.acceptanceCriteria,row.description]))
  add('事件与绩效',['事件编号','事件标题','类型','负责人','部门','开始日期','截止日期','状态','事件权重','评审状态','自评分','最终评分','主管评语'],events.map(event=>{const review=reviews.find(item=>item.eventId===event.id);return[event.code,event.title,event.type,event.owner,event.department,event.startDate,event.dueDate,event.status,event.projectWeight,review?.status,review?.selfScore,review?.finalScore,review?.managerComment]}))
  add('汇报',['周期','进度','本期成果','阻塞项','风险','需要决策','下一步','作者','创建时间'],reports.map(row=>[row.period,row.progress,row.achievements,row.blockers,row.risks,row.decisionsNeeded,row.nextSteps,row.author,row.createdAt]))
  add('附件清单',['文件名','说明','MIME','大小字节','上传人','上传时间'],files.map(row=>[row.name,row.title,row.mimeType,row.size,row.uploadedBy,row.createdAt]))
  return Buffer.from(await wb.xlsx.writeBuffer())
}
