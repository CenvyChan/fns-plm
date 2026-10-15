import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, '../../dev-tools/openviking.mjs')
const projectUri = 'viking://resources/projects/personal-todo-project/docs'

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ...env },
    timeout: 3000,
  })
}

test('OpenViking import defaults to a preview and does not contact a service', () => {
  const result = run(['import-url', '--base-url', 'http://127.0.0.1:1933', '--target-uri', projectUri, '--source-url', 'https://docs.invalid/approved-guide'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /尚未连接 OpenViking，也未发送任何请求/)
  assert.match(result.stdout, /https:\/\/docs\.invalid\/approved-guide/)
  assert.match(result.stdout, /viking:\/\/resources\/projects\/personal-todo-project\/docs/)
})

test('OpenViking refuses a target URI outside the project-specific developer namespace', () => {
  const result = run(['search', '--base-url', 'http://127.0.0.1:1933', '--target-uri', 'viking://resources/other-project/private', '--query', 'test'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /目标 URI 必须位于开发专用项目目录/)
})

test('OpenViking developer helper is disabled in production mode', () => {
  const result = run(['search', '--base-url', 'http://127.0.0.1:1933', '--target-uri', projectUri, '--query', 'test'], { NODE_ENV: 'production' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /NODE_ENV=production 时禁用/)
})

test('OpenViking developer helper rejects all non-loopback service endpoints', () => {
  const result = run(['health', '--base-url', 'https://example.com'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /只允许连接本机 loopback/)
})
