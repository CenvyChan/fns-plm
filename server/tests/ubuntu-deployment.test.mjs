import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const deployDir = path.join(repositoryRoot, 'deploy/ubuntu')
const serverRequire = createRequire(path.join(repositoryRoot, 'server/package.json'))
const Database = serverRequire('better-sqlite3')
const user = os.userInfo().username

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options })
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function writeExecutable(file, content) {
  writeFileSync(file, content, { mode: 0o700 })
  chmodSync(file, 0o700)
}

function assertSuccessful(result, message) {
  assert.equal(result.error, undefined, `${message}: ${result.error?.message ?? ''}`)
  assert.equal(result.status, 0, `${message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
}

function assertRejected(result, message, includes) {
  assert.equal(result.error, undefined, `${message}: ${result.error?.message ?? ''}`)
  assert.notEqual(result.status, 0, `${message} should have failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  if (includes) assert.match(`${result.stdout}\n${result.stderr}`, includes)
}

test('Ubuntu release/rollback and SQLite backup restore remain confined to isolated fixtures', async t => {
  const testRoot = mkdtempSync('/tmp/momentum-deploy-drill.')
  chmodSync(testRoot, 0o700)
  const root = realpathSync(testRoot)
  const bin = path.join(root, 'bin')
  const staging = path.join(root, 'staging')
  const control = path.join(root, 'control')
  const deployRoot = path.join(root, 'opt/momentum')
  const fixtures = path.join(root, 'fixtures')
  const environment = path.join(root, 'etc/momentum.env')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  mkdirSync(control, { recursive: true, mode: 0o700 })
  mkdirSync(path.dirname(environment), { recursive: true, mode: 0o700 })
  mkdirSync(fixtures, { recursive: true, mode: 0o700 })
  writeFileSync(environment, '# isolated fictional service configuration\n', { mode: 0o600 })

  const env = {
    PATH: `${bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    HOME: path.join(root, 'home'),
    LANG: 'C',
    LC_ALL: 'C',
    MOMENTUM_DEPLOY_TEST_MODE: '1',
    MOMENTUM_DEPLOY_TEST_ROOT: root,
    MOMENTUM_TEST_USER: user,
  }
  mkdirSync(env.HOME, { recursive: true, mode: 0o700 })

  writeExecutable(path.join(bin, 'runuser'), `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\$#" -ge 4 && "\$1" == -u && "\$2" == "\$MOMENTUM_TEST_USER" && "\$3" == -- ]] || { echo 'unexpected runuser invocation' >&2; exit 97; }
shift 3
exec "\$@"
`)
  writeExecutable(path.join(bin, 'npm'), `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "\$*" >> "\$MOMENTUM_DEPLOY_TEST_ROOT/control/npm.log"
[[ "\$#" -eq 6 && "\$1" == --prefix && "\$3" == ci && "\$4" == --omit=dev && "\$5" == --no-audit && "\$6" == --no-fund ]] || { echo 'unexpected npm invocation' >&2; exit 98; }
`)
  writeExecutable(path.join(bin, 'systemctl'), `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "\$*" >> "\$MOMENTUM_DEPLOY_TEST_ROOT/control/systemctl.log"
[[ "\$#" -eq 2 && ( "\$1" == restart || "\$1" == stop ) && "\$2" == momentum.service ]] || { echo 'unexpected service command' >&2; exit 99; }
if [[ "\$1" == restart ]]; then
  active="\$(readlink -f -- "\$MOMENTUM_DEPLOY_TEST_ROOT/opt/momentum/current" 2>/dev/null || true)"
  release="\${active##*/}"
  [[ ! -e "\$MOMENTUM_DEPLOY_TEST_ROOT/control/restart-fails-\$release" ]] || exit 101
fi
`)
  writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "\${!#}" == http://127.0.0.1:4000/api/health ]] || { echo 'unexpected health endpoint' >&2; exit 100; }
active="\$(readlink -f -- "\$MOMENTUM_DEPLOY_TEST_ROOT/opt/momentum/current" 2>/dev/null || true)"
[[ -n "\$active" ]] || exit 22
release="\${active##*/}"
[[ ! -e "\$MOMENTUM_DEPLOY_TEST_ROOT/control/unhealthy-\$release" ]] || exit 22
`)

  function makeRelease(releaseId, { source = 'console.log("fixture release");\n', symlink = false } = {}) {
    const fixture = path.join(fixtures, releaseId)
    const archive = path.join(staging, `momentum-${releaseId}.tar.gz`)
    for (const directory of [
      'client/dist',
      'server/dist',
      'server/workflow/processes',
      'server/data',
      'deploy/ubuntu',
    ]) mkdirSync(path.join(fixture, directory), { recursive: true })
    writeFileSync(path.join(fixture, 'client/dist/index.html'), `<html>${releaseId}</html>\n`)
    writeFileSync(path.join(fixture, 'server/dist/index.js'), source)
    writeFileSync(path.join(fixture, 'server/workflow/processes/plm-approvals.bpmn20.xml'), '<definitions/>\n')
    writeFileSync(path.join(fixture, 'server/package.json'), '{"name":"isolated-release","version":"1.0.0"}\n')
    writeFileSync(path.join(fixture, 'server/package-lock.json'), '{"name":"isolated-release","lockfileVersion":3,"packages":{}}\n')
    writeFileSync(path.join(fixture, 'server/data/seed-workspace.json'), '{}\n')
    writeFileSync(path.join(fixture, 'server/data/seed-workflow-demo.json'), '{}\n')
    writeFileSync(path.join(fixture, 'deploy/ubuntu/backup-sqlite.sh'), '#!/usr/bin/env bash\n')
    if (symlink) symlinkSync('../../../../outside-marker', path.join(fixture, 'client/dist/escape-link'))
    const result = run('/usr/bin/tar', ['-C', fixture, '-czf', archive, 'client', 'server', 'deploy'], { env })
    assertSuccessful(result, `fixture archive creation for ${releaseId}`)
    return { releaseId, archive, hash: sha256(archive), fixture }
  }

  function publish(release, { archive = release.archive, hash = release.hash, rootArg = deployRoot } = {}) {
    return run('/bin/bash', [
      path.join(deployDir, 'release-remote.sh'),
      release.releaseId,
      archive,
      rootArg,
      hash,
    ], { env })
  }

  function activeRelease() {
    return path.basename(realpathSync(path.join(deployRoot, 'current')))
  }

  function previousRelease() {
    return path.basename(realpathSync(path.join(deployRoot, 'previous')))
  }

  try {
    await t.test('first publish creates the active release without touching host services', () => {
      const v1 = makeRelease('20261016T090001Z')
      const result = publish(v1)
      assertSuccessful(result, 'first isolated publish')
      assert.equal(activeRelease(), v1.releaseId)
      assert.equal(existsSync(path.join(deployRoot, 'previous')), false)
      assert.match(readFileSync(path.join(control, 'systemctl.log'), 'utf8'), /^restart momentum\.service\n$/)
      assert.equal(existsSync(path.join(control, 'npm.log')), true)
    })

    await t.test('second publish hot-switches current, preserves previous, and is idempotently rejected on replay', () => {
      const v2 = makeRelease('20261016T090002Z')
      const archiveBytes = readFileSync(v2.archive)
      assertSuccessful(publish(v2), 'second isolated publish')
      assert.equal(activeRelease(), v2.releaseId)
      assert.equal(previousRelease(), '20261016T090001Z')
      assert.equal(readFileSync(path.join(deployRoot, 'current/client/dist/index.html'), 'utf8'), `<html>${v2.releaseId}</html>\n`)

      // A successful publish removes its staged tarball; restore the same immutable bytes to test replay.
      writeFileSync(v2.archive, archiveBytes)
      const replay = publish(v2)
      assertRejected(replay, 'duplicate release id', /Release already exists/)
      assert.equal(activeRelease(), v2.releaseId, 'replay must not change current')
      assert.equal(previousRelease(), '20261016T090001Z', 'replay must not change previous')
    })

    await t.test('failed health check atomically restores the prior release and pointers', () => {
      const v3 = makeRelease('20261016T090003Z')
      writeFileSync(path.join(control, `unhealthy-${v3.releaseId}`), 'simulated health failure\n')
      const result = publish(v3)
      assertRejected(result, 'failed health should return a failing deployment status', /rolling back/i)
      assert.equal(activeRelease(), '20261016T090002Z')
      assert.equal(previousRelease(), '20261016T090001Z')
      assert.match(readFileSync(path.join(control, 'systemctl.log'), 'utf8'), /restart momentum\.service\nrestart momentum\.service\n$/)
    })

    await t.test('systemctl restart failure during publish restores the prior version', () => {
      const v4 = makeRelease('20261016T090010Z')
      writeFileSync(path.join(control, `restart-fails-${v4.releaseId}`), 'simulated service restart failure\n')
      const result = publish(v4)
      assertRejected(result, 'failed service restart should trigger automatic rollback', /Could not restart momentum\.service/)
      assert.equal(activeRelease(), '20261016T090002Z')
      assert.equal(previousRelease(), '20261016T090001Z')
    })

    await t.test('manual rollback succeeds, and restart failure restores the previously active pointer', () => {
      const rollbackScript = path.join(deployDir, 'rollback-remote.sh')
      let result = run('/bin/bash', [rollbackScript, deployRoot], { env })
      assertSuccessful(result, 'manual isolated rollback')
      assert.equal(activeRelease(), '20261016T090001Z')
      assert.equal(previousRelease(), '20261016T090002Z')

      writeFileSync(path.join(control, 'restart-fails-20261016T090002Z'), 'simulated rollback restart failure\n')
      result = run('/bin/bash', [rollbackScript, deployRoot], { env })
      assertRejected(result, 'manual rollback restart failure', /rollback target|health check failed/i)
      assert.equal(activeRelease(), '20261016T090001Z', 'failed manual rollback restores its original current target')
      assert.equal(previousRelease(), '20261016T090002Z', 'failed manual rollback restores its original previous target')
    })

    await t.test('checksum mismatch, syntax failure, unsafe archive links, and path escapes are refused before activation', () => {
      const badChecksum = makeRelease('20261016T090004Z')
      writeFileSync(badChecksum.archive, Buffer.concat([readFileSync(badChecksum.archive), Buffer.from('tamper')]))
      const checksumResult = publish(badChecksum)
      assertRejected(checksumResult, 'archive checksum mismatch', /SHA-256 mismatch/)
      assert.equal(existsSync(path.join(deployRoot, 'releases', badChecksum.releaseId)), false)
      assert.equal(activeRelease(), '20261016T090001Z')

      const invalidSyntax = makeRelease('20261016T090005Z', { source: 'const = 1;\n' })
      const syntaxResult = publish(invalidSyntax)
      assertRejected(syntaxResult, 'invalid server JavaScript must not activate', /SyntaxError|Unexpected token/)
      assert.equal(existsSync(path.join(deployRoot, 'releases', invalidSyntax.releaseId)), false, 'pre-activation failure cleans its partial release')
      assert.equal(activeRelease(), '20261016T090001Z')

      const linkedArchive = makeRelease('20261016T090006Z', { symlink: true })
      const linkResult = publish(linkedArchive)
      assertRejected(linkResult, 'archive with an external symlink must be rejected', /link or special file/)
      assert.equal(existsSync(path.join(root, 'outside-marker')), false)
      assert.equal(existsSync(path.join(deployRoot, 'releases', linkedArchive.releaseId)), false)

      const traversalId = '20261016T090009Z'
      const traversalFixture = path.join(fixtures, traversalId)
      const traversalArchive = path.join(staging, `momentum-${traversalId}.tar.gz`)
      mkdirSync(traversalFixture, { recursive: true })
      writeFileSync(path.join(traversalFixture, 'payload'), 'must never be extracted outside release root\n')
      const traversalTar = run('/usr/bin/tar', [
        '-P',
        '--transform=s@^payload@../../outside-marker@',
        '-C', traversalFixture,
        '-czf', traversalArchive,
        'payload',
      ], { env })
      assertSuccessful(traversalTar, 'craft path-traversal archive inside the temporary fixture')
      const traversalRelease = { releaseId: traversalId, archive: traversalArchive, hash: sha256(traversalArchive) }
      const traversalResult = publish(traversalRelease)
      assertRejected(traversalResult, 'archive member containing ../ must be rejected', /Unsafe path found/)
      assert.equal(existsSync(path.join(root, 'outside-marker')), false)
      assert.equal(existsSync(path.join(deployRoot, 'releases', traversalId)), false)

      const escapedRoot = publish(makeRelease('20261016T090007Z'), { rootArg: `${deployRoot}/../../outside` })
      assertRejected(escapedRoot, 'deployment root escape', /Test deployment root must stay inside/)
      assert.equal(existsSync(path.join(root, 'outside')), false)

      const escapedPointerTarget = path.join(root, 'outside-release')
      mkdirSync(escapedPointerTarget)
      rmSync(path.join(deployRoot, 'current'))
      symlinkSync(escapedPointerTarget, path.join(deployRoot, 'current'))
      const escapedPointer = publish(makeRelease('20261016T090008Z'))
      assertRejected(escapedPointer, 'current pointer outside managed releases', /escapes releases/)
      assert.equal(realpathSync(path.join(deployRoot, 'current')), escapedPointerTarget)
      assert.equal(existsSync(path.join(deployRoot, 'releases/20261016T090008Z')), false)
    })

    await t.test('online SQLite backup restores matching rows, key and documents with restrictive permissions', () => {
      const dataDir = path.join(root, 'data')
      const docsDir = path.join(dataDir, 'documents')
      const backupDir = path.join(root, 'backups')
      mkdirSync(docsDir, { recursive: true, mode: 0o700 })
      const dbPath = path.join(dataDir, 'momentum.sqlite')
      const keyPath = path.join(dataDir, '.app-encryption-key')
      writeFileSync(keyPath, 'fictional-test-encryption-key\n', { mode: 0o600 })
      writeFileSync(path.join(docsDir, 'fixture-document.txt'), 'fictional attachment payload\n', { mode: 0o600 })
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('wal_autocheckpoint = 0')
      db.exec('CREATE TABLE rehearsal_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare('INSERT INTO rehearsal_rows (id, value) VALUES (?, ?)').run(1, 'committed-before-backup')
      db.prepare('INSERT INTO rehearsal_rows (id, value) VALUES (?, ?)').run(2, 'second-consistent-row')
      db.close()

      const backupEnv = {
        ...env,
        DATABASE_FILE: dbPath,
        APP_ENCRYPTION_KEY_FILE: keyPath,
        DOCUMENT_STORAGE_DIR: docsDir,
        BACKUP_STAGING_DIR: dataDir,
        BACKUP_DIR: backupDir,
        MOMENTUM_SQLITE_MODULE: path.resolve(repositoryRoot, 'server/node_modules/better-sqlite3'),
        MOMENTUM_NODE_BINARY: process.execPath,
        MOMENTUM_DEPLOY_TEST_BACKUP_STAMP: '20261016T090010Z',
      }
      const backupScript = path.join(deployDir, 'backup-sqlite.sh')
      const result = run('/bin/bash', [backupScript], { env: backupEnv })
      assertSuccessful(result, 'isolated online SQLite backup')
      const archive = path.join(backupDir, 'momentum-20261016T090010Z.tar.gz')
      const checksum = `${archive}.sha256`
      assert.equal(result.stdout.includes(archive), true)
      assert.equal(lstatSync(backupDir).mode & 0o777, 0o700)
      assert.equal(lstatSync(archive).mode & 0o777, 0o600)
      assert.equal(lstatSync(checksum).mode & 0o777, 0o600)
      const checksumCheck = run('/usr/bin/sha256sum', ['-c', path.basename(checksum)], { cwd: backupDir, env })
      assertSuccessful(checksumCheck, 'backup checksum verification')

      const restored = path.join(root, 'restored')
      mkdirSync(restored, { mode: 0o700 })
      const extraction = run('/usr/bin/tar', ['-xzf', archive, '-C', restored], { env })
      assertSuccessful(extraction, 'isolated archive restore')
      const restoredDbPath = path.join(restored, 'db/momentum.sqlite')
      const restoredDb = new Database(restoredDbPath, { readonly: true, fileMustExist: true })
      assert.equal(restoredDb.pragma('integrity_check', { simple: true }), 'ok')
      assert.deepEqual(restoredDb.prepare('SELECT id, value FROM rehearsal_rows ORDER BY id').all(), [
        { id: 1, value: 'committed-before-backup' },
        { id: 2, value: 'second-consistent-row' },
      ])
      restoredDb.close()
      assert.equal(readFileSync(path.join(restored, '.app-encryption-key'), 'utf8'), 'fictional-test-encryption-key\n')
      assert.equal(readFileSync(path.join(restored, 'documents/fixture-document.txt'), 'utf8'), 'fictional attachment payload\n')
      for (const directory of [restored, path.join(restored, 'db'), path.join(restored, 'documents')]) {
        assert.equal(lstatSync(directory).mode & 0o777, 0o700, `${directory} should restore as mode 0700`)
      }
      for (const file of [restoredDbPath, path.join(restored, '.app-encryption-key'), path.join(restored, 'documents/fixture-document.txt')]) {
        assert.equal(lstatSync(file).mode & 0o777, 0o600, `${file} should restore as mode 0600`)
      }
      assert.equal(existsSync(path.join(dataDir, '.backup-stage-20261016T090010Z')), false)
      assert.deepEqual(readFileSync(checksum, 'utf8').trim().split(/\s+/).slice(1), [path.basename(archive)])

      const duplicate = run('/bin/bash', [backupScript], { env: backupEnv })
      assertRejected(duplicate, 'duplicate backup timestamp must not overwrite existing archive', /already exists/)
      assert.equal(sha256(archive), readFileSync(checksum, 'utf8').trim().split(/\s+/)[0])

      const escapedBackup = run('/bin/bash', [backupScript], {
        env: { ...backupEnv, BACKUP_DIR: path.join(root, 'outside-backups') },
      })
      assertRejected(escapedBackup, 'backup destination escape', /Test backup paths must remain inside/)
      assert.equal(existsSync(path.join(root, 'outside-backups')), false)
    })
  } finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
})
