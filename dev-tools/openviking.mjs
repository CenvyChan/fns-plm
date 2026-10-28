#!/usr/bin/env node
/**
 * Developer-only OpenViking helper. This file is deliberately outside server/src,
 * is never imported by the application, and refuses to run in production mode.
 * It performs no network request until an explicit search or confirmed import command.
 */
import process from 'node:process'

const PROJECT_ROOT = 'viking://resources/projects/personal-todo-project'
const DEFAULT_BASE_URL = 'http://127.0.0.1:1933'
const usage = `OpenViking developer helper (not part of the Momentum runtime)

Commands:
  node dev-tools/openviking.mjs health [--base-url ${DEFAULT_BASE_URL}]
  node dev-tools/openviking.mjs search --target-uri <viking-uri> --query <text> [--limit 8]
  node dev-tools/openviking.mjs import-url --target-uri <viking-uri> --source-url <https-url>
      Preview only by default. Add --confirm-import to submit the import request.

The default endpoint is the local, no-auth Dev-mode server. You can override it with --base-url
or OPENVIKING_BASE_URL, but only loopback addresses are allowed. Health checks require no key.

The target URI must be under ${PROJECT_ROOT}/. Search/import require explicit commands; imports also require --confirm-import.
`

function fail(message, code = 2) {
  console.error(message)
  process.exitCode = code
}

function parseArgs(values) {
  const result = {}
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i]
    if (token === '--confirm-import') { result.confirmImport = true; continue }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    if (!['base-url', 'target-uri', 'query', 'limit', 'source-url'].includes(key)) throw new Error(`未知参数：${token}`)
    const value = values[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`参数 ${token} 缺少值。`)
    result[key] = value
    i += 1
  }
  return result
}

function validateBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('请显式提供有效的 OpenViking HTTP(S) 服务地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址必须是没有凭证、查询参数或片段的 HTTP(S) URL。')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('该开发工具只允许连接本机 loopback OpenViking 服务，远程服务地址被拒绝。')
  return url.toString().replace(/\/+$/, '')
}

function validateTargetUri(value) {
  if (typeof value !== 'string' || !(value === PROJECT_ROOT || value.startsWith(`${PROJECT_ROOT}/`)) || value.includes('..') || /[?#\s]/.test(value)) {
    throw new Error(`目标 URI 必须位于开发专用项目目录 ${PROJECT_ROOT}/ 下。`)
  }
  return value.replace(/\/+$/, '')
}

async function requestJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const text = await response.text()
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { /* report status, not raw response */ }
  if (!response.ok || payload.status === 'error') {
    const code = payload?.error?.code ? ` ${payload.error.code}` : ''
    throw new Error(`OpenViking 请求失败（HTTP ${response.status}${code}）。`)
  }
  return payload
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('此开发脚本在 NODE_ENV=production 时禁用。')
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === '--help' || command === '-h') { console.log(usage); return }
  if (!['health', 'search', 'import-url'].includes(command)) throw new Error(`未知命令：${command}\n\n${usage}`)
  const args = parseArgs(rest)
  const baseUrl = validateBaseUrl(args['base-url'] || process.env.OPENVIKING_BASE_URL || DEFAULT_BASE_URL)

  if (command === 'health') {
    let response
    try { response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) }) }
    catch { throw new Error(`无法连接本机 OpenViking：${baseUrl}/health。请先启动服务。`) }
    let payload = {}
    try { payload = await response.json() } catch { /* use HTTP status below */ }
    if (!response.ok || payload.status !== 'ok') throw new Error(`本机 OpenViking 健康检查失败（HTTP ${response.status}）。`)
    console.log(JSON.stringify({ endpoint: baseUrl, connected: true, health: payload }, null, 2))
    return
  }

  const targetUri = validateTargetUri(args['target-uri'])

  if (command === 'search') {
    const query = args.query?.trim()
    if (!query || query.length > 500) throw new Error('请提供 1–500 个字符的 --query。')
    const limit = Number(args.limit ?? 8)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('--limit 须为 1–20 的整数。')
    const payload = await requestJson(baseUrl, '/api/v1/search/find', { query, target_uri: targetUri, context_type: ['resource'], limit })
    const result = payload.result && typeof payload.result === 'object' ? payload.result : {}
    console.log(JSON.stringify({ total: Number(result.total ?? 0), resources: Array.isArray(result.resources) ? result.resources : [] }, null, 2))
    return
  }

  let source
  try { source = new URL(args['source-url'] ?? '') } catch { throw new Error('请提供有效的 --source-url HTTP(S) 地址。') }
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password || source.hash) throw new Error('来源必须是没有 URL 凭证或片段的 HTTP(S) URL。')
  if (!args.confirmImport) {
    console.log('导入预览（尚未连接 OpenViking，也未发送任何请求）：')
    console.log(JSON.stringify({ service: baseUrl, sourceUrl: source.toString(), targetUri }, null, 2))
    console.log('\n若已选定该服务和目标、并获准导入此来源，请重新运行并添加 --confirm-import。')
    return
  }
  const payload = await requestJson(baseUrl, '/api/v1/resources', {
    path: source.toString(), parent: targetUri, create_parent: true,
    reason: '由开发者显式确认导入 personal-todo-project 开发上下文',
    tags: ['project=personal-todo-project', 'purpose=development'],
  })
  console.log(JSON.stringify(payload.result ?? payload, null, 2))
}

main().catch(error => fail(error instanceof Error ? error.message : 'OpenViking 开发工具执行失败。'))
