// Local-only preview. No inherited integration credentials, remote K3 calls, or production databases.
// Run after building server and client: node scripts/operational-reports-preview.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = mkdtempSync(join(tmpdir(), 'plm-operational-fixture-'))
const apiPort = Number(process.env.LOCAL_OPERATIONAL_API_PORT || 4263)
const webPort = Number(process.env.LOCAL_OPERATIONAL_WEB_PORT || 5263)
if (![apiPort, webPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536) || apiPort === webPort) throw new Error('Invalid local preview ports')
const origin = `http://127.0.0.1:${apiPort}`
const databaseFile = join(tempDir, 'fixture.sqlite')
const childEnv = {
  PATH: process.env.PATH, HOME: tempDir, TMPDIR: tempDir,
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(apiPort),
  DATABASE_FILE: databaseFile, DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'),
  APP_ENCRYPTION_KEY: '7c'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'local-encryption.key'),
  DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
  CORS_ORIGIN: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
}
const child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] })
let web
function stop() { web?.close(); child.kill('SIGTERM') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', code => { web?.close(); if (code) process.exitCode = code })
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Local API stopped before readiness')
    try { ready = (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok } catch { /* startup only */ }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  if (!ready) throw new Error('Local API health check failed')
  const result = await fetch(`${origin}/api/auth/mobile/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: '本地验收管理员', email: 'operations-fixture@example.test', password: 'LocalFixture-Only-20261023!', tenantName: '本地示例租户（非生产）', organizationName: '本地示例组织', accountName: 'LOCAL_FIXTURE' }),
  })
  if (result.status !== 201) throw new Error(`Local setup failed: ${result.status}`)
  const setup = await result.json()
  // Seeding is an offline, local SQLite operation, never an HTTP write endpoint.
  const seed = spawn(process.execPath, ['scripts/seed-operational-reports-preview.mjs'], {
    cwd: serverDir,
    env: { ...childEnv, LOCAL_FIXTURE_SCOPE: JSON.stringify(setup.user) }, stdio: ['ignore', 'inherit', 'inherit'],
  })
  const seedExit = await new Promise(resolve => seed.on('exit', resolve))
  if (seedExit !== 0) throw new Error(`Local fixture seeding failed: ${seedExit}`)
  const app = express()
  app.use('/api', async (req, res) => {
    try {
      const headers = { ...req.headers, host: `127.0.0.1:${apiPort}`, origin }
      delete headers['content-length']
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const upstream = await fetch(`${origin}/api${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}), redirect: 'manual' })
      res.status(upstream.status)
      for (const [name, value] of upstream.headers) if (!['transfer-encoding', 'content-encoding', 'content-length', 'set-cookie'].includes(name)) res.setHeader(name, value)
      const cookies = upstream.headers.getSetCookie()
      if (cookies.length) res.setHeader('Set-Cookie', cookies)
      res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { res.status(502).json({ error: 'local_preview_proxy_failed' }) }
  })
  app.use(express.static(resolve(serverDir, '../client/dist')))
  app.get('*', (_req, res) => res.sendFile(resolve(serverDir, '../client/dist/index.html')))
  web = app.listen(webPort, '127.0.0.1', () => console.log(`LOCAL FIXTURE ONLY: http://127.0.0.1:${webPort}/?page=operational-reports`))
  writeFileSync(join(tempDir, 'preview-scope.json'), JSON.stringify({ user: setup.user, apiPort, webPort, databaseFile }, null, 2) + '\n', { mode: 0o600 })
  console.log(`Temporary local database: ${databaseFile}`)
} catch (error) {
  console.error(error.message)
  stop()
  process.exitCode = 1
}
