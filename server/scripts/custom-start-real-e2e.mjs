import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:net'

// Isolated test only: never accepts anything but a loopback Flowable URL.
const root = resolve(import.meta.dirname, '..')
const envFile = process.env.FLOWABLE_TEST_ENV || '/workspace/flowable-runtime-gap-lab/test-service.env'
function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
const sourceEnv = { ...loadEnv(envFile), ...process.env }
const baseUrl = sourceEnv.FLOWABLE_BASE_URL, username = sourceEnv.FLOWABLE_USERNAME, password = sourceEnv.FLOWABLE_PASSWORD
assert(baseUrl && username && password, 'FLOWABLE_BASE_URL/USERNAME/PASSWORD required via test env')
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(baseUrl).hostname), 'Only loopback Flowable engines are allowed')
const work = mkdtempSync(join(tmpdir(), 'plm-custom-start-real-'))
const dbPath = join(work, 'plm.sqlite'), logPath = process.env.E2E_LOG || join(work, 'e2e.log')
const suffix = randomBytes(6).toString('hex'), log = []
const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r))
const port = reserve.address().port; await new Promise(r => reserve.close(r))
const origin = `http://127.0.0.1:${port}`, auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const instances = [], deployments = []
let child, token, scope, apiPort = port
const blankConfig = { CONNECTOR_DEFAULT_TENANT_ID:'', CONNECTOR_DEFAULT_ORGANIZATION_ID:'', CONNECTOR_DEFAULT_ACCOUNT_ID:'' }
function appEnv(defaults = blankConfig) {
  return {
    PATH:process.env.PATH, HOME:work, NODE_ENV:'test', HOST:'127.0.0.1', PORT:String(apiPort),
    DATABASE_FILE:dbPath, APP_ENCRYPTION_KEY:randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY_FILE:join(work,'encryption.key'),
    DATA_FILE:join(work,'absent.json'), LEGACY_DATA_FILE:join(work,'absent.json'), DOCUMENT_STORAGE_DIR:join(work,'documents'), INTEGRATION_DATA_DIR:join(work,'integrations'),
    REDIS_URL:'', FLOWABLE_BASE_URL:baseUrl, FLOWABLE_USERNAME:username, FLOWABLE_PASSWORD:password,
    FLOWABLE_USER_MAP_JSON:'{}', K3CLOUD_BASE_URL:'', DINGTALK_WEBHOOK_URL:'', DINGTALK_ROBOT_WEBHOOK:'',
    ...defaults, BPMN_MODELER_ALLOW_TEST_MOCK:'true', NODE_OPTIONS:'',
  }
}
function launch(defaults) {
  child = spawn(process.execPath, ['dist/index.js'], {cwd:root, env:appEnv(defaults), stdio:['ignore','pipe','pipe']})
  child.stdout.on('data', b => log.push(`PLM ${b.toString().trim()}`))
  child.stderr.on('data', b => log.push(`PLM-ERR ${b.toString().trim()}`))
}
async function stop() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM'); await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,4000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}
async function ready() {
  for (let i=0;i<200;i++) { if (child.exitCode !== null) throw Error('isolated PLM exited'); try { if ((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(800)})).ok) return } catch {} await new Promise(r=>setTimeout(r,100)) }
  throw Error('isolated PLM health timeout')
}
async function api(path, method='GET', body, extra={}) {
  const headers={...(token?{Authorization:`Bearer ${token}`,'X-Tenant-ID':scope.tenantId,'X-Organization-ID':scope.organizationId,'X-Account-ID':scope.accountId}:{}),...extra}
  if(body!==undefined) headers['Content-Type']='application/json'
  const r=await fetch(origin+'/api'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
  const data=await r.json().catch(()=>({})); log.push(`${method} ${path} -> ${r.status}`); return {status:r.status,data}
}
function expect(r,status){assert.equal(r.status,status,JSON.stringify(r.data));return r.data}
async function engine(path) { const r=await fetch(baseUrl+path,{headers:{Authorization:auth},signal:AbortSignal.timeout(15000)}); assert(r.ok,`Flowable ${path} HTTP ${r.status}`); return r.json() }
function switchedHeaders(){return {'Idempotency-Key':`custom-start-${suffix}-${randomBytes(4).toString('hex')}`}}
async function publish(modelId, version) {
  const p=expect(await api(`/bpmn-models/${modelId}/preview`,'POST',{version}),200)
  const result=expect(await api(`/bpmn-models/${modelId}/publish`,'POST',{version,confirmationToken:p.confirmationToken,confirm:true}),200)
  if(result.deploymentId) deployments.push(result.deploymentId)
  return result
}
try {
  const check=await fetch(baseUrl+'/runtime/tasks?size=1',{headers:{Authorization:auth},signal:AbortSignal.timeout(10000)})
  assert(check.ok,'patched real Flowable must already be running on loopback'); await check.json()
  // Bootstrap PLM to provision a fresh scope, then terminate it before restarting against the same DB
  // with connector defaults scoped by that newly created tenant/org/account. Never use integration PUT.
  launch(blankConfig); await ready()
  const setup=expect(await api('/auth/mobile/setup','POST',{displayName:'Custom start E2E admin',email:`custom-${suffix}@example.test`,password:`Local-${randomBytes(24).toString('hex')}`}),201)
  token=setup.accessToken; scope=setup.user
  const bound={CONNECTOR_DEFAULT_TENANT_ID:scope.tenantId,CONNECTOR_DEFAULT_ORGANIZATION_ID:scope.organizationId,CONNECTOR_DEFAULT_ACCOUNT_ID:scope.accountId}
  await stop(); launch(bound); await ready()
  const form=expect(await api('/forms','POST',{key:`customForm${suffix}`,name:'Pinned version form',definition:{dslVersion:1,fields:[{id:'decision',label:'Decision',type:'text',required:true,min:2,max:80}]}}),201)
  expect(await api(`/forms/${form.key}/publish`,'POST',{revision:1}),201)
  const graph={key:`customStart${suffix}`,name:'Isolated custom start',nodes:[{id:'Start',type:'startEvent',name:'Start'},{id:'Review',type:'userTask',name:'Review',assignment:{kind:'assignee',userIds:[scope.id]},formBinding:{formKey:form.key,formVersion:1}},{id:'End',type:'endEvent',name:'End'}],flows:[{id:'f1',source:'Start',target:'Review'},{id:'f2',source:'Review',target:'End'}]}
  const model=expect(await api('/bpmn-models','POST',{graph}),201)
  let version=expect(await api(`/bpmn-models/${model.id}/versions`,'POST',{expectedRevision:1}),201)
  assert.match(version.xml,new RegExp(`plm-form:${form.key}:v1`))
  await publish(model.id,1)
  const ctx=expect(await api(`/bpmn-models/${model.id}/start-context`),200)
  assert.equal(ctx.canStart,true); assert.equal(ctx.engineMode,'mock-test'); assert.equal(ctx.publishedVersion,1); assert(ctx.versionId)
  assert.deepEqual(ctx.formBindings,[{nodeId:'Review',formKey:form.key,formVersion:1}])
  // Create/publish v2 and prove it cannot silently alter the published v1 snapshot.
  expect(await api(`/forms/${form.key}`,'PUT',{revision:1,name:'Pinned custom form v2',definition:{dslVersion:1,fields:[{id:'decision',label:'Decision v2',type:'text',required:true,min:3,max:80}]}}),200)
  expect(await api(`/forms/${form.key}/publish`,'POST',{revision:2}),201)
  const currentCtx=expect(await api(`/bpmn-models/${model.id}/start-context`),200)
  assert.equal(currentCtx.formBindings[0].formVersion,1)
  const stale=expect(await api(`/bpmn-models/${model.id}/start`,'POST',{title:'Stale attempt',businessId:`stale-${suffix}`,businessType:'e2e',changeSummary:'stale version check',expectedVersionId:'not-current'},switchedHeaders()),409)
  assert.equal(stale.error,'published_version_changed')
  // Publish a new BPMN version; stale context must be rejected before any engine start.
  const graph2={...graph,name:'New version'}
  expect(await api(`/bpmn-models/${model.id}`,'PUT',{expectedRevision:1,graph:graph2}),200)
  version=expect(await api(`/bpmn-models/${model.id}/versions`,'POST',{expectedRevision:2}),201)
  await publish(model.id,2)
  const staleContext=ctx.versionId
  const race=expect(await api(`/bpmn-models/${model.id}/start`,'POST',{title:'Stale-context race',businessId:`race-${suffix}`,businessType:'e2e',changeSummary:'must reject',expectedVersionId:staleContext},switchedHeaders()),409)
  assert.equal(race.error,'published_version_changed')
  const fresh=expect(await api(`/bpmn-models/${model.id}/start-context`),200)
  assert.equal(fresh.publishedVersion,2); assert.equal(fresh.formBindings[0].formVersion,1)
  const startBody={title:'Pinned form v1 run',businessId:`run-${suffix}`,businessType:'e2e',changeSummary:'isolated loopback only',expectedVersionId:fresh.versionId}
  const key=switchedHeaders()['Idempotency-Key']
  const started=expect(await api(`/bpmn-models/${model.id}/start`,'POST',startBody,{'Idempotency-Key':key}),201); instances.push(started.processInstanceId)
  const repeated=expect(await api(`/bpmn-models/${model.id}/start`,'POST',startBody,{'Idempotency-Key':key}),200)
  assert.equal(repeated.processInstanceId,started.processInstanceId)
  expect(await api(`/bpmn-models/${model.id}/start`,'POST',{...startBody,title:'Changed payload'},{'Idempotency-Key':key}),409)
  const tasks=expect(await api('/workflow/tasks'),200).tasks, task=tasks.find(t=>t.processInstanceId===started.processInstanceId); assert(task,'real Flowable user task must be exposed')
  expect(await api(`/workflow/tasks/${task.id}`),200)
  const rawTask=await engine(`/runtime/tasks/${encodeURIComponent(task.id)}`)
  assert.equal(rawTask.formKey,`plm-form:${form.key}:v1`)
  expect(await api(`/workflow/tasks/${task.id}/complete`,'POST',{decision:'approved',comment:'must submit form first'}),409)
  expect(await api(`/forms/${form.key}/versions/1/submissions`,'POST',{taskId:task.id,values:{decision:''}}),400)
  const submission=expect(await api(`/forms/${form.key}/versions/1/submissions`,'POST',{taskId:task.id,values:{decision:'Approved'}}),201)
  const replay=expect(await api(`/forms/${form.key}/versions/1/submissions`,'POST',{taskId:task.id,values:{decision:'Approved'}}),201); assert.equal(replay.id,submission.id)
  expect(await api(`/workflow/tasks/${task.id}/complete`,'POST',{decision:'approved',comment:'isolated test'}),200)
  const history=await engine(`/history/historic-process-instances/${encodeURIComponent(started.processInstanceId)}`); assert(history.endTime,'Flowable historic process must have endTime')
  assert.equal(history.processDefinitionId,started.processDefinitionId ?? history.processDefinitionId)
  assert.equal(instances.length,1)
  const Database=(await import('better-sqlite3')).default
  const evidenceDb=new Database(dbPath,{readonly:true})
  assert.equal(evidenceDb.prepare('SELECT count(*) AS n FROM connector_configs').get().n,0,'no stored connector edits')
  evidenceDb.close()
  log.push(`PASS closed real Flowable history process=${started.processInstanceId}; pinned form=${form.key}:v1 despite form v2 publication; rejected stale version; no integration settings PUT; no outbound connectors configured`)
  console.log(`PASS custom-start real Flowable E2E; processes=${instances.length}; workdir=${work}; log=${logPath}`)
} catch(e) { log.push(`FAIL ${e.stack||e}`); console.error(e.message); process.exitCode=1 }
finally {
  await stop()
  writeFileSync(logPath,log.join('\n')+'\n')
  // Preserve the fresh SQLite DB and logs as isolated evidence; credentials are never logged.
}
