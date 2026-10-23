import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import express from 'express'

const directory = mkdtempSync(join(tmpdir(), 'k3-customer-only-'))
process.env.DATABASE_FILE = join(directory, 'test.sqlite')
process.env.INTEGRATION_DATA_DIR = directory
process.env.APP_ENCRYPTION_KEY = '6e'.repeat(32)
process.env.REDIS_URL = ''
process.env.NODE_ENV = 'test'
const { db } = await import('../dist/database.js')
const { syncK3CloudMasterData, readK3CloudMasterData } = await import('../dist/k3cloud-master-data.js')
const { saveConnectorConfig } = await import('../dist/integrations/configuration.js')
const { createIntegrationRouter, stopIntegrationServices } = await import('../dist/integration-api.js')
const { closeCache } = await import('../dist/integrations/cache.js')
const now = new Date().toISOString()
db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('admin','admin@example.test','Admin','not-password',now,now)
function scope(tenantId, organizationId, accountId) {
  db.prepare('INSERT OR IGNORE INTO tenants(id,name,code,created_at,updated_at) VALUES(?,?,?,?,?)').run(tenantId,tenantId,tenantId,now,now)
  db.prepare('INSERT OR IGNORE INTO organizations(id,tenant_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(organizationId,tenantId,organizationId,organizationId,now,now)
  db.prepare('INSERT INTO accounts(id,tenant_id,organization_id,name,code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(accountId,tenantId,organizationId,accountId,accountId,now,now)
  return {tenantId,organizationId,accountId,tenantName:tenantId,organizationName:organizationId,accountName:accountId,role:'admin',isPlatformAdmin:false}
}
const home = scope('t1','o1','a1')
const siblings = [scope('t1','o1','a2'),scope('t1','o2','a3'),scope('t2','o3','a4')]
const mapping = { formId:'BD_Customer',organizationField:'FUseOrgId.FNumber',fields:{id:'FCUSTID',number:'FNumber',name:'FName'} }
const config = {baseUrl:'http://172.16.77.90/k3cloud',accountId:'erp-a',username:'test',organization:"001'X",appId:'test-app',appSecret:'fake-secret',lcid:'2052',formAllowlist:{BD_Customer:['FCUSTID','FNumber','FName','FUseOrgId.FNumber']},masterDataSources:{customer:mapping,supplier:{formId:'BD_Supplier',fields:{}}},dailyReportSources:{},k3DataSyncSchedule:{enabled:true,intervalHours:6,mode:'customer-only'}}
saveConnectorConfig(home,'k3cloud',config,'admin')
const originalFetch = globalThis.fetch
const queries = []
let rejectCustomer = false
let releaseQuery
let waitQuery = false
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith(config.baseUrl)) return originalFetch(url,init)
  assert.equal(init.redirect,'error')
  if (String(url).includes('LoginByAppSecret')) return Response.json({LoginResultType:1},{headers:{'set-cookie':'sid=customer; Path=/'}})
  assert.ok(String(url).includes('ExecuteBillQuery'))
  const body = JSON.parse(init.body)
  assert.equal(Array.isArray(body),false)
  const q=body.data;queries.push(q)
  assert.equal(q.FormId,'BD_Customer')
  assert.equal(q.FilterString,"FUseOrgId.FNumber = '001''X'")
  assert.equal(q.OrderString,'FCUSTID ASC')
  if(waitQuery) await new Promise(resolve=>{releaseQuery=resolve})
  if(rejectCustomer) return Response.json({Result:{ResponseStatus:{IsSuccess:false,Errors:[{Message:'private upstream error'}]}}})
  return Response.json([['101','C001','Customer One']])
}
let router = createIntegrationRouter()
const app = express();app.use(express.json())
app.use((req,res,next)=>{req.authUser={id:'admin',disabled:false,...(req.headers['x-test-sibling']?siblings[0]:home)};next()})
app.use('/api',(req,res,next)=>router(req,res,next))
const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
const origin = `http://127.0.0.1:${server.address().port}`
async function api(path,body,headers={}) { const r=await originalFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()} }
after(async()=>{stopIntegrationServices();globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));await closeCache();db.close();rmSync(directory,{recursive:true,force:true})})

test('customer-only endpoint enforces server organization, queries no unrelated source and preserves snapshots', async()=>{
  await syncK3CloudMasterData(home,{supplier:{formId:'BD_Supplier',fields:{id:'FID',name:'FName'}}},async()=>[{FID:'supplier-keep',FName:'Keep Supplier'}])
  const before=readK3CloudMasterData(home).records.supplier
  const result=await api('/api/k3cloud/sync',{kind:'customer'})
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.mode,'customer-only');assert.equal('business' in result.data,false)
  assert.deepEqual(result.data.masterData.rowCounts,{customer:1});assert.equal(queries.length,1)
  assert.deepEqual(readK3CloudMasterData(home).records.supplier,before)
  for(const s of siblings)assert.deepEqual(readK3CloudMasterData(s).records,{})
  const again=await api('/api/k3cloud/sync',{kind:'customer'});assert.equal(again.status,200);assert.equal(queries.length,2,'sync must bypass cached ERP rows')
  const status=await api('/api/k3cloud/sync-status');assert.equal(status.data.lastRun.mode,'customer-only');assert.equal(status.data.lastRun.status,'success')
})

test('customer-only endpoint rejects other kinds, arbitrary filters and forged scope payloads before ERP calls', async()=>{
  const before=queries.length
  for(const body of [{kind:'supplier'},{kind:'customer',filterString:'1=1'},{kind:'customer',accountId:'a2'}])assert.equal((await api('/api/k3cloud/sync',body)).status,400)
  assert.equal((await api('/api/k3cloud/sync',{kind:'customer'},{'x-test-sibling':'1'})).status,503)
  assert.equal(queries.length,before)
  assert.equal((await api('/api/k3cloud/sync',{})).status,409,'legacy full path still requires all business mappings')
})

test('ERP failure does not replace prior scoped snapshots', async()=>{
  const before=readK3CloudMasterData(home)
  rejectCustomer=true
  try{const r=await api('/api/k3cloud/sync',{kind:'customer'});assert.equal(r.status,502);assert.equal(JSON.stringify(r.data).includes('private upstream error'),false)}finally{rejectCustomer=false}
  assert.deepEqual(readK3CloudMasterData(home),before)
})

test('enabled customer-only cron is restored on router startup with next execution time', async()=>{
  let s=(await api('/api/k3cloud/sync-status')).data.schedule
  assert.equal(s.mode,'customer-only');assert.equal(s.ready,true);assert.equal(s.schedulerState,'scheduled');assert.ok(Date.parse(s.nextRunAt)>Date.now())
  stopIntegrationServices();router=createIntegrationRouter();s=(await api('/api/k3cloud/sync-status')).data.schedule
  assert.equal(s.schedulerState,'scheduled');assert.ok(s.nextRunAt)
})

test('customer-only concurrent sync is locked and failed configuration cannot remove organization protection', async()=>{
  waitQuery=true
  const running=api('/api/k3cloud/sync',{kind:'customer'})
  for(let i=0;i<50&&!releaseQuery;i++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(typeof releaseQuery,'function')
  const overlap=await api('/api/k3cloud/sync',{kind:'customer'});assert.equal(overlap.status,409)
  waitQuery=false;releaseQuery();await running
  assert.throws(()=>saveConnectorConfig(home,'k3cloud',{k3DataSyncSchedule:{enabled:true,intervalHours:6,mode:'bad'}},'admin'),/mode/)
  assert.throws(()=>saveConnectorConfig(home,'k3cloud',{formAllowlist:{BD_Customer:['FCUSTID','FNumber','FName']}},'admin'),/白名单/)
})
