import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import Database from 'better-sqlite3'

const serverDir = resolve(import.meta.dirname, '..')
let tempDir, databaseFile, origin, child, adminToken, adminUser
const scopes = new Map()
const port = async () => {
  const s = createServer(); await new Promise((resolve, reject) => s.listen(0, '127.0.0.1', resolve).once('error', reject))
  const value = s.address().port; await new Promise(resolve => s.close(resolve)); return value
}
async function start() {
  const p = await port(); origin = `http://127.0.0.1:${p}`
  const env = { PATH: process.env.PATH, HOME: tempDir, TMPDIR: tempDir, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(p), DATABASE_FILE: databaseFile,
    APP_ENCRYPTION_KEY: '6a'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(tempDir, 'encryption.key'), DATA_FILE: join(tempDir, 'missing.json'), LEGACY_DATA_FILE: join(tempDir, 'missing.json'), DOCUMENT_STORAGE_DIR: join(tempDir, 'documents'), INTEGRATION_DATA_DIR: tempDir,
    REDIS_URL: '', CORS_ORIGIN: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', K3CLOUD_BASE_URL: '', K3CLOUD_ACCOUNT_ID: '', K3CLOUD_USERNAME: '', K3CLOUD_ORGANIZATION: '', K3CLOUD_APP_ID: '', K3CLOUD_APP_SECRET: '', K3CLOUD_PASSWORD: '', K3CLOUD_QUERY_ALLOWLIST: '{}',
    DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', DINGTALK_WEBHOOK_SECRET: '', DINGTALK_ROBOT_SECRET: '', DINGTALK_CARD_CALLBACK_SECRET: '', DINGTALK_APP_KEY: '', DINGTALK_APP_SECRET: '', DINGTALK_USER_MAP_JSON: '{}', DINGTALK_SSO_CLIENT_ID: '', DINGTALK_SSO_CLIENT_SECRET: '', DINGTALK_SSO_CORP_ID: '', DINGTALK_SSO_TENANT_ID: '', DINGTALK_SSO_ORGANIZATION_ID: '', DINGTALK_SSO_ACCOUNT_ID: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '' }
  child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderrText = ''; child.stderr.on('data', x => child.stderrText += x)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { if (child.exitCode !== null) throw Error(`API exited: ${child.stderrText}`); try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return } catch {} await new Promise(r => setTimeout(r, 100)) }
  throw Error(`API health timeout: ${child.stderrText}`)
}
async function stop() { if (!child || child.exitCode !== null) return; child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 4000))]); if (child.exitCode === null) child.kill('SIGKILL') }
async function api(path, { method='GET', body, token=adminToken, scope=true, headers={} }={}) {
  const h = {}; if (token) { h.Authorization = `Bearer ${token}`; const s = scope && scopes.get(token); if (s) { h['X-Tenant-ID']=s.tenantId; h['X-Organization-ID']=s.organizationId; h['X-Account-ID']=s.accountId } }
  Object.assign(h, headers); if (body !== undefined) h['Content-Type']='application/json'
  const response=await fetch(origin+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)}); const text=await response.text(); let data; try { data=JSON.parse(text) } catch { data=text }; return {response,data,text}
}
function assertRuntimePending(data) {
  assert.equal(data.metadataPreflight.metadataConfirmed, false)
  assert.deepEqual(data.metadataPreflight.confirmedFields, [])
  assert.equal(data.metadataPreflight.stockOrganizationMapping, 'pending')
  assert.equal(data.metadataPreflight.liveBusinessQueriesAllowed, false)
  assert.equal('readOnlyEvidence' in data.metadataPreflight, false, 'historical range/filter values are not exposed to the browser')
  assert.equal(data.metadataPreflight.inventoryGetInventoryDataReadOnlyObservation, null)
  assert.ok(data.metadataPreflight.reportCandidates.every(candidate => candidate.targetAccountReadOnlyObservation === null && candidate.sourceAttachment === null && candidate.requestedAttachment === null))
  for (const report of data.reports || [data.report]) {
    assert.equal(report.metadataConfirmed, false)
    assert.ok(report.fieldSpecs.every(field => field.status === 'candidate_unverified'))
    assert.notEqual(report.status, 'live_sampled_verified')
    assert.equal('readOnlyEvidence' in report, false)
  }
}
function seed(scope, rows, overrides={}) {
  const key=`operational-reporting-fixture:${scope.tenantId}:${scope.organizationId}:${scope.accountId}`
  const value={source:'fixture',status:'fixture',scope:{tenantId:scope.tenantId,organizationId:scope.organizationId,accountId:scope.accountId},generatedAt:new Date().toISOString(),rows,...overrides}
  const db=new Database(databaseFile); db.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,revision=app_state.revision+1').run(key,JSON.stringify(value),new Date().toISOString()); db.close(); return key
}
async function invited(role, email) {
  const invite=await api('/api/auth/users',{method:'POST',body:{displayName:role,email,role}}); assert.equal(invite.response.status,201,JSON.stringify(invite.data))
  const password=randomBytes(24).toString('base64url'); const activation=await api('/api/auth/activate',{method:'POST',token:'',body:{token:invite.data.activationToken,password}}); assert.equal(activation.response.status,200,JSON.stringify(activation.data))
  const login=await api('/api/auth/mobile/login',{method:'POST',token:'',body:{email,password,accountId:adminUser.accountId}}); assert.equal(login.response.status,200,JSON.stringify(login.data)); scopes.set(login.data.accessToken,login.data.user); return login.data.accessToken
}
before(async()=>{ tempDir=mkdtempSync(join(tmpdir(),'operational-reports-http-')); databaseFile=join(tempDir,'isolated.sqlite'); await start() })
after(async()=>{ await stop(); if(tempDir) rmSync(tempDir,{recursive:true,force:true}) })

test('operational reports HTTP fixture, scope isolation, access and read-only contract', {concurrency:false}, async()=>{
  const setup=await api('/api/auth/mobile/setup',{method:'POST',token:'',body:{displayName:'HTTP report admin',email:'report-admin@example.test',password:'test-password-12345'}})
  assert.equal(setup.response.status,201,JSON.stringify(setup.data)); adminToken=setup.data.accessToken; adminUser=setup.data.user; scopes.set(adminToken,adminUser)
  assert.equal((await api('/api/operational-reports',{token:''})).response.status,401)
  assert.equal((await api('/api/operational-reports',{scope:false})).response.status,400)
  assert.equal((await api('/api/operational-reports',{headers:{'X-Account-ID':'forged-account'}})).response.status,403)
  const rows=[{id:'r-1',warehouse:'North',materialNumber:'M-1',materialName:'Widget',unit:'box',quantity:4},{id:'r-2',warehouse:'North',materialNumber:'M-1',materialName:'Widget',unit:'each',quantity:9},{id:'r-3',warehouse:'South',materialNumber:'M-2',materialName:'Gizmo',unit:'box',quantity:2}]
  const stateKey=seed(adminUser,rows)
  const catalog=await api('/api/operational-reports'); assert.equal(catalog.response.status,200); assert.ok(catalog.data.metadataPreflight); assert.equal(catalog.data.metadataPreflight.metadataConfirmed,false)
  assert.equal(catalog.data.reports.find(x=>x.id==='instant-inventory').source,'fixture'); assert.equal(catalog.data.reports.find(x=>x.id==='instant-inventory').status,'fixture')
  assertRuntimePending(catalog.data)
  const listing=await api('/api/operational-reports/instant-inventory'); assert.equal(listing.response.status,200); assert.equal(listing.data.total,3); assert.equal(listing.data.report.source,'fixture'); assert.equal(listing.data.report.metadataConfirmed,false); assert.equal(listing.data.rows.length,3); assert.deepEqual(listing.data.rows.map(x=>x.quantity),[4,9,2]); assert.equal(Object.hasOwn(listing.data,'quantityTotal'),false)
  assertRuntimePending(listing.data)
  assert.equal((await api('/api/operational-reports/instant-inventory?q=widget')).data.rows.length,2)
  assert.equal((await api('/api/operational-reports/instant-inventory?warehouse=North')).data.rows.length,2)
  assert.deepEqual((await api('/api/operational-reports/instant-inventory?unit=each')).data.rows.map(x=>x.id),['r-2'])
  assert.equal((await api('/api/operational-reports/instant-inventory?q[]=widget')).response.status,400)
  assert.equal((await api('/api/operational-reports/instant-inventory?unit='+encodeURIComponent('x'.repeat(201)))).response.status,400)
  const detail=await api('/api/operational-reports/instant-inventory/rows/r-1'); assert.equal(detail.response.status,200); assert.equal(detail.data.row.id,'r-1'); assert.equal(detail.data.source,'fixture'); assert.equal(detail.data.metadataConfirmed,false)
  for(const id of ['stock-movement','purchase-execution','sales-execution','inventory-aging']) { const r=await api(`/api/operational-reports/${id}`); assert.equal(r.response.status,200); assert.deepEqual(r.data.rows,[]); assert.equal(r.data.total,null); assertRuntimePending(r.data); assert.equal(r.data.report.status,'unsupported') }
  assert.equal((await api('/api/operational-reports/missing')).response.status,404); assert.equal((await api('/api/operational-reports/instant-inventory/rows/missing')).response.status,404)
  assert.notEqual((await api('/api/operational-reports/instant-inventory',{method:'POST'})).response.status,200)
  for(const role of ['member','reviewer']) {
    const token=await invited(role,`${role}@example.test`)
    for(const path of ['/api/operational-reports','/api/operational-reports/instant-inventory','/api/operational-reports/instant-inventory/rows/r-1']) assert.equal((await api(path,{token})).response.status,403)
  }
  assert.equal((await api('/api/operational-reports',{token:await invited('plm_manager','manager@example.test')})).response.status,200)
  const original=adminUser
  const other={tenantId:'tenant-isolated-2',organizationId:'org-isolated-2',accountId:'account-isolated-2'}
  const db=new Database(databaseFile), now=new Date().toISOString()
  db.prepare("INSERT INTO tenants(id,name,code,status,created_at,updated_at) VALUES(?,? ,?,'active',?,?)").run(other.tenantId,'Other tenant','TENANT-2',now,now)
  db.prepare("INSERT INTO organizations(id,tenant_id,name,code,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(other.organizationId,other.tenantId,'Other organization','ORG-2',now,now)
  db.prepare("INSERT INTO accounts(id,tenant_id,organization_id,name,code,erp_system,status,created_at,updated_at) VALUES(?,?,?,?,?,'k3cloud','active',?,?)").run(other.accountId,other.tenantId,other.organizationId,'Other account','ACCOUNT-2',now,now)
  db.prepare('INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,disabled,created_at) VALUES(?,?,?,?,?,\'admin\',0,?)').run('membership-isolated-2',original.id,other.tenantId,other.organizationId,other.accountId,now); db.close()
  const newLogin=await api('/api/auth/mobile/login',{method:'POST',token:'',body:{email:'report-admin@example.test',password:'test-password-12345',accountId:other.accountId}}); assert.equal(newLogin.response.status,200,JSON.stringify(newLogin.data)); const otherToken=newLogin.data.accessToken; scopes.set(otherToken,newLogin.data.user)
  const changedCatalog=await api('/api/operational-reports',{token:otherToken}); assert.equal(changedCatalog.response.status,200); assert.notEqual(changedCatalog.data.reports.find(x=>x.id==='instant-inventory').source,'fixture'); assert.equal((await api('/api/operational-reports/instant-inventory/rows/r-1',{token:otherToken})).response.status,404)
  const db2=new Database(databaseFile)
  assertRuntimePending(changedCatalog.data)
  // Synthetic test scope retains its own IDs: identical display names must never authorize it.
  db2.prepare('UPDATE tenants SET name=? WHERE id=?').run('Synthetic tenant', other.tenantId)
  db2.prepare('UPDATE organizations SET name=? WHERE id=?').run('Synthetic organization', other.organizationId)
  db2.prepare('UPDATE accounts SET name=? WHERE id=?').run('Synthetic account', other.accountId)
  const namesOnly = await api('/api/operational-reports', { token: otherToken })
  assert.equal(namesOnly.response.status, 200)
  assertRuntimePending(namesOnly.data)
  const namesOnlyInventory = await api('/api/operational-reports/instant-inventory', { token: otherToken })
  assertRuntimePending(namesOnlyInventory.data)
  assert.equal(namesOnlyInventory.data.report.status, 'uncollected')
  assert.deepEqual(namesOnlyInventory.data.rows, [])
  const state=JSON.parse(db2.prepare('SELECT value FROM app_state WHERE key=?').get(stateKey).value)
  db2.prepare('UPDATE app_state SET value=?,revision=revision+1 WHERE key=?').run(JSON.stringify({...state,scope:{...state.scope,accountId:'wrong-account'}}),stateKey); db2.close()
  assert.notEqual((await api('/api/operational-reports')).data.reports.find(x=>x.id==='instant-inventory').source,'fixture')
  seed(original,[{id:'bad-row',warehouse:'North',materialNumber:'M',materialName:'Bad',unit:'box',quantity:'4'}])
  assert.notEqual((await api('/api/operational-reports')).data.reports.find(x=>x.id==='instant-inventory').source,'fixture')
})

test('purchase and sales demo rows stay local-only, filtered and paginated; all other reports remain locked', {concurrency:false}, async()=>{
  const purchase=await api('/api/operational-reports/purchase-execution/demo')
  assert.equal(purchase.response.status,200,JSON.stringify(purchase.data))
  assert.equal(purchase.data.formId,'PUR_PurchaseOrderDetailRpt')
  assert.equal(purchase.data.source,'local_demo_fixture_not_k3_tested')
  assert.equal(purchase.data.status,'fixture')
  assert.equal(purchase.data.label,'演示/fixture/非K3实测')
  assert.equal(purchase.data.liveCallsAllowed,false)
  assert.deepEqual(purchase.data.FieldKeys,['FBillNo','FDate','FSUPPLIERID','FMATERIALID','FOrderQty','FImportQty'])
  assert.deepEqual(purchase.data.mockRequest,{Limit:5})
  assert.equal(purchase.data.Result.IsSuccess,true)
  assert.equal(purchase.data.Result.RowCount,2)
  assert.deepEqual(Object.keys(purchase.data.Result).sort(),['IsSuccess','RowCount','Rows'])
  assert.equal(purchase.data.Result.Rows.length,2)
  assert.ok(purchase.data.Result.Rows.every(row=>row.length===purchase.data.FieldKeys.length))
  assert.equal(purchase.data.Result.Rows[0][purchase.data.FieldKeys.indexOf('FBillNo')],'演示采购单-001')
  assert.equal(purchase.data.Result.Rows[0][purchase.data.FieldKeys.indexOf('FImportQty')],3)

  const sales=await api('/api/operational-reports/sales-execution/demo')
  assert.equal(sales.response.status,200,JSON.stringify(sales.data))
  assert.equal(sales.data.formId,'SAL_DetailReport')
  assert.equal(sales.data.source,'local_demo_fixture_not_k3_tested')
  assert.equal(sales.data.status,'fixture')
  assert.equal(sales.data.label,'演示/fixture/非K3实测')
  assert.equal(sales.data.liveCallsAllowed,false)
  assert.equal(sales.data.rows.length,2)
  assert.equal(sales.data.rows[0].FBILLNO,'演示销售单-001')
  assert.ok(sales.data.rows.every(row=>row.FUNIT&&row.FCURRENCYID))
  assert.notDeepEqual(purchase.data.Result.Rows,sales.data.rows,'sales fixture must never reuse purchase or summary rows')

  const filtered=await api('/api/operational-reports/purchase-execution/demo?FMATERIALID='+encodeURIComponent('演示物料-002'))
  assert.equal(filtered.response.status,200); assert.equal(filtered.data.total,1); assert.equal(filtered.data.Result.Rows[0][filtered.data.FieldKeys.indexOf('FBillNo')],'演示采购单-002')
  const salesFiltered=await api('/api/operational-reports/sales-execution/demo?FDate=2026-10-22')
  assert.equal(salesFiltered.response.status,200); assert.equal(salesFiltered.data.total,1); assert.equal(salesFiltered.data.rows[0].FBILLNO,'演示销售单-002')
  const paged=await api('/api/operational-reports/purchase-execution/demo?page=2&pageSize=1')
  assert.equal(paged.response.status,200); assert.equal(paged.data.page,2); assert.equal(paged.data.Result.Rows[0][paged.data.FieldKeys.indexOf('FBillNo')],'演示采购单-002')

  assert.equal((await api('/api/operational-reports/purchase-execution/demo?FSUPPLIERID=supplier')).response.status,400)
  assert.equal((await api('/api/operational-reports/sales-execution/demo?FCUSTID=customer')).response.status,400)
  assert.equal((await api('/api/operational-reports/purchase-execution/demo?FMaterialModel=model')).response.status,400)
  assert.equal((await api('/api/operational-reports/sales-execution/demo?FSPECIFICATION=model')).response.status,400)
  assert.equal((await api('/api/operational-reports/sales-collect/demo')).response.status,404,'sales summary has no fixture demo endpoint')
  assert.equal((await api('/api/operational-reports/purchase-execution/demo?unsupported=x')).response.status,400)
  assert.equal((await api('/api/operational-reports/sales-execution/demo?pageSize=201')).response.status,400)
  assert.equal((await api('/api/operational-reports/purchase-execution/demo?pageSize=0')).response.status,400)
  assert.equal((await api('/api/operational-reports/purchase-execution/demo?page=1.5')).response.status,400)
  assert.equal((await api('/api/operational-reports/instant-inventory/demo')).response.status,404)
})
