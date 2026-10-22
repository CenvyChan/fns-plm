const requiredLabels: Record<string, string> = {
  baseUrl: 'REST API Base URL',
  username: '服务账号',
  password: 'Basic Auth 密码',
}

export function flowableMissingFieldLabels(fields: string[]): string[] {
  return fields.map(field => requiredLabels[field] ?? field)
}

export function flowableTestDisabledReason(fields: string[], hasUnsavedChanges = false): string | null {
  if (hasUnsavedChanges) return '测试连接禁用：当前草稿尚未保存；保存后测试仅验证服务端已加密保存的配置。'
  if (!fields.length) return null
  return `测试连接禁用：缺少必填字段 ${flowableMissingFieldLabels(fields).join('、')}；补齐并加密保存后可测试。`
}

export function flowableRestContextHint(value: string): string | null {
  let path = ''
  try { path = new URL(value).pathname.replace(/\/+$/, '') } catch { return null }
  if (path.endsWith('/flowable-rest/process-api')) return '这是本项目内置 Spring Boot Flowable 服务的路径；当前隔离标准 REST 容器使用 /flowable-rest/service。'
  if (path.endsWith('/flowable-rest/service')) return null
  return '请按目标部署方式填写 REST context：本项目内置 Spring Boot 服务使用 /flowable-rest/process-api，标准 Flowable REST 容器使用 /flowable-rest/service。'
}
