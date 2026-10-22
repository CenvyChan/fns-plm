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
  if (path.endsWith('/flowable-rest/process-api')) return '该示例路径不适合作为 REST Base URL；请使用部署提供的 REST context，通常为 /flowable-rest/service。'
  if (path.endsWith('/flowable-rest/service')) return null
  return '请确认 Base URL 指向 Flowable REST context（通常路径为 /flowable-rest/service），而非仅含进程 API 的子路径。'
}
