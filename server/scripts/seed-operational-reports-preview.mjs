// Offline seed only: validate paths BEFORE importing any application database module.
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

if (process.env.NODE_ENV !== 'test') throw new Error('Preview fixture seed is restricted to NODE_ENV=test.')
const dbPath = process.env.DATABASE_FILE
if (!dbPath) throw new Error('DATABASE_FILE is required.')
const resolved = resolve(dbPath)
if (!/^\/tmp\/plm-operational-fixture-[A-Za-z0-9_-]+\/fixture\.sqlite$/.test(resolved)) throw new Error('Refusing to seed outside /tmp/plm-operational-fixture-*/fixture.sqlite.')
if (lstatSync(dirname(resolved)).isSymbolicLink() || realpathSync(dirname(resolved)) !== dirname(resolved)) throw new Error('Fixture directory must not be a symbolic link.')
if (lstatSync(resolved).isSymbolicLink() || realpathSync(resolved) !== resolved) throw new Error('Fixture database must not be a symbolic link.')
let user
try { user = JSON.parse(process.env.LOCAL_FIXTURE_SCOPE ?? '') } catch { throw new Error('LOCAL_FIXTURE_SCOPE from local setup is required.') }
for (const key of ['id', 'tenantId', 'tenantName', 'organizationId', 'organizationName', 'accountId', 'accountName', 'role']) if (typeof user[key] !== 'string' || !user[key]) throw new Error(`LOCAL_FIXTURE_SCOPE.${key} is required.`)
if (!['admin', 'plm_manager'].includes(user.role)) throw new Error('Local preview scope must be admin or plm_manager.')
const { buildOperationalInventoryFixture } = await import('../dist/operational-reports.js')
const { db, setAppState } = await import('../dist/database.js')
try {
  const member = db.prepare('SELECT 1 FROM tenant_memberships WHERE user_id=? AND account_id=? AND role=?').get(user.id, user.accountId, user.role)
  const account = db.prepare('SELECT 1 FROM accounts a JOIN organizations o ON o.id=a.organization_id WHERE a.id=? AND o.id=? AND o.tenant_id=?').get(user.accountId, user.organizationId, user.tenantId)
  if (!member || !account) throw new Error('Fixture scope must match a locally initialized member and account.')
  const scope = { tenantId: user.tenantId, tenantName: user.tenantName, organizationId: user.organizationId, organizationName: user.organizationName, accountId: user.accountId, accountName: user.accountName, role: user.role, isPlatformAdmin: false }
  const fixture = buildOperationalInventoryFixture(scope, new Date().toISOString(), [
    { id: 'fixture-stock-001', warehouse: '演示仓A', materialNumber: 'FIX-MAT-001', materialName: '演示控制模块', unit: '件', quantity: 24 },
    { id: 'fixture-stock-002', warehouse: '演示仓B', materialNumber: 'FIX-MAT-002', materialName: '演示传感组件', unit: '套', quantity: 8 },
    { id: 'fixture-stock-003', warehouse: '演示仓B', materialNumber: 'FIX-MAT-001', materialName: '演示控制模块', unit: '箱', quantity: 2 },
  ])
  setAppState(`operational-reporting-fixture:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`, fixture)
} finally { db.close() }
console.log('Seeded local fixture-only inventory; all other reports remain pending/unsupported. No K3 connection or business query was made.')
