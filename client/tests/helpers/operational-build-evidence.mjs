import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const repository = fileURLToPath(new URL('../../../', import.meta.url))
export const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
const filesUnder = directory => readdirSync(directory).sort().flatMap(name => {
  const path = join(directory, name)
  return statSync(path).isDirectory() ? filesUnder(path) : [path]
})

/**
 * Candidate acceptance must remain uncommitted. Fingerprint the exact dirty
 * source/test files and production assets instead of requiring a commit.
 * Generated qa-evidence files are excluded from the source fingerprint so the
 * evidence cannot hash itself.
 */
export function buildEvidence() {
  const productionBuild = process.env.OP_ACCEPTANCE_BUILD === '1'
  const buildOutput = process.env.OP_ACCEPTANCE_OUT_DIR ? resolve(process.env.OP_ACCEPTANCE_OUT_DIR) : join(repository, 'client/dist')
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repository, encoding: 'utf8' })
  const changed = status.split('\n').filter(Boolean)
    .map(line => line.slice(3)).filter(path => path && !path.startsWith('qa-evidence/')).sort()
  const sourceFiles = changed.map(path => ({ path, sha256: sha256(readFileSync(join(repository, path))) }))
  const assets = productionBuild ? filesUnder(buildOutput).map(path => ({
    path: relative(repository, path), bytes: statSync(path).size, sha256: sha256(readFileSync(path)),
  })) : []
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceTree: git('rev-parse', 'HEAD^{tree}'),
    branch: git('branch', '--show-current'),
    mode: productionBuild ? 'vite-production-preview-uncommitted-candidate' : 'vite-development',
    dirtySourceFiles: sourceFiles,
    worktreeFingerprint: sha256(JSON.stringify(sourceFiles)),
    buildFingerprint: assets.length ? sha256(JSON.stringify(assets)) : null,
    buildFingerprintAlgorithm: 'SHA-256 of JSON.stringify(assets), sorted by path within each directory',
    assets,
    testSha256: sha256(readFileSync(new URL('../operational-reports.browser.mjs', import.meta.url))),
    fixtureMetadataSha256: sha256(readFileSync(join(repository, 'server/src/operational-reports.ts'))),
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    boundaries: 'loopback only; API fixtures intercepted; no production, credentials, real business rows, K3 queries or allowlist changes',
  }
}
