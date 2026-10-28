import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

// Only a deliberately provisioned loopback engine is accepted. Never pass a production URL.
const root = resolve(import.meta.dirname, '..')
const { FLOWABLE_BASE_URL: baseUrl, FLOWABLE_USERNAME: username, FLOWABLE_PASSWORD: password } = process.env
assert(baseUrl && username && password, 'Set credentials for an isolated loopback Flowable service')
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(baseUrl).hostname), 'Only loopback test engines are allowed')
const work = mkdtempSync(join(tmpdir(), 'plm-runtime-gap-e2e-'))
const logPath = process.env.E2E_LOG || join(tmpdir(), 'plm-runtime-real-e2e.log')
const suffix = randomBytes(6).toString('hex'), log = []
const reserve = createServer()
await new Promise(r=>reserve.listen(0,'127.0.0.1',r))
const port = reserve.address().port
await new Promise(r=>reserve.close(r))
const origin = `http://127.0.0.1:${port}`
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const childEnv = {
  PATH:process.env.PATH, HOME:work, NODE_ENV:'test', HOST:'127.0.0.1', PORT:String(port),
  DATABASE_FILE:join(work,'test.sqlite'), APP_ENCRYPTION_KEY:randomBytes(32).toString('hex'), APP_ENCRYPTION_KEY_FILE:join(work,'encryption.key'),
  DATA_FILE:join(work,'absent.json'), LEGACY_DATA_FILE:join(work,'absent.json'), DOCUMENT_STORAGE_DIR:join(work,'documents'), INTEGRATION_DATA_DIR:join(work,'integrations'),
  REDIS_URL:'', FLOWABLE_BASE_URL:'', FLOWABLE_USERNAME:'', FLOWABLE_PASSWORD:'', FLOWABLE_USER_MAP_JSON:'{}',
  K3CLOUD_BASE_URL:'', DINGTALK_WEBHOOK_URL:'', DINGTALK_ROBOT_WEBHOOK:'',
  CONNECTOR_DEFAULT_TENANT_ID:'', CONNECTOR_DEFAULT_ORGANIZATION_ID:'', CONNECTOR_DEFAULT_ACCOUNT_ID:'',
  BPMN_MODELER_ALLOW_TEST_MOCK:'true',
}
let child, token, scope
const instances = [], deployments = []
async function api(path, method='GET', body, extra={}) {
  const headers = {...(token ? {Authorization:`Bearer ${token}`,'X-Tenant-ID':scope.tenantId,'X-Organization-ID':scope.organizationId,'X-Account-ID':scope.accountId} : {}),...extra}
  if(body!==undefined) headers['Content-Type']='application/json'
  const res=await fetch(origin+'/api'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
  const data=await res.json().catch(()=>({}))
  log.push(`${method} ${path} -> ${res.status}`)
  return {status:res.status,data}
}
function expect(r,status) {assert.equal(r.status,status,JSON.stringify(r.data));return r.data}
async function engine(path,method='GET') {
  const r=await fetch(`${baseUrl}${path}`,{method,headers:{Authorization:auth},signal:AbortSignal.timeout(15000)})
  if(!r.ok) throw Error(`isolated engine ${method} ${path}: HTTP ${r.status}`)
  return r.status===204?null:r.json()
}
async function switchTo(accountId) {scope=expect(await api('/auth/switch-scope','POST',{accountId}),200).user}
async function configure() {expect(await api('/integrations/settings/flowable','PUT',{baseUrl,username,password,userMap:{},groupMap:{}}),200)}
async function publishModel(kind) {
  const assignment=kind==='role'?{kind:'candidateRole',role:'admin'}:{kind:'assignee',userIds:[scope.id]}
  const graph={key:`testRuntimeGap${kind}${suffix}`,name:`Isolated ${kind} runtime test`,nodes:[
    {id:'Start',type:'startEvent',name:'Start'},
    {id:'Review',type:'userTask',name:'Review',assignment,formBinding:{formKey:'runtimeForm',formVersion:1}},
    {id:'End',type:'endEvent',name:'End'}],flows:[{id:'f1',source:'Start',target:'Review'},{id:'f2',source:'Review',target:'End'}]}
  const m=expect(await api('/bpmn-models','POST',{graph}),201)
  const v=expect(await api(`/bpmn-models/${m.id}/versions`,'POST',{expectedRevision:1}),201)
  assert.match(v.xml,/plm-form:runtimeForm:v1/)
  if(kind==='role') assert.match(v.xml,/flowable:candidateGroups="plm_[a-f0-9]{32}_r_admin"/)
  const preview=expect(await api(`/bpmn-models/${m.id}/preview`,'POST',{version:1}),200)
  const publication=expect(await api(`/bpmn-models/${m.id}/publish`,'POST',{version:1,confirmationToken:preview.confirmationToken,confirm:true}),200)
  if(publication.deploymentId) deployments.push(publication.deploymentId)
  return m
}
async function start(m,kind) {
  const body={title:'Temporary test',businessId:`testRuntimeGap-${kind}-${suffix}`,businessType:'isolated-test',changeSummary:'No external data or messages'}
  const headers={'Idempotency-Key':`testRuntimeGap-${kind}-${suffix}`}
  const started=expect(await api(`/bpmn-models/${m.id}/start`,'POST',body,headers),201)
  instances.push(started.processInstanceId)
  const replay=expect(await api(`/bpmn-models/${m.id}/start`,'POST',body,headers),200)
  assert.equal(replay.processInstanceId,started.processInstanceId)
  expect(await api(`/bpmn-models/${m.id}/start`,'POST',{...body,title:'Changed request'},headers),409)
  return started
}
async function taskFor(instanceId) {
  const tasks=expect(await api('/workflow/tasks'),200).tasks
  const task=tasks.find(t=>t.processInstanceId===instanceId)
  assert(task,'real engine task must be visible through PLM')
  expect(await api(`/workflow/tasks/${task.id}`),200)
  return task
}
async function finishWithForm(task) {
  const complete={decision:'approved',comment:'Isolated test approval'}
  expect(await api(`/workflow/tasks/${task.id}/complete`,'POST',complete),409)
  const path='/forms/runtimeForm/versions/1/submissions'
  expect(await api(path,'POST',{taskId:task.id,values:{decision:''}}),400)
  expect(await api(path,'POST',{taskId:task.id,processInstanceId:'forged',values:{decision:'Approve'}}),400)
  const submitted=expect(await api(path,'POST',{taskId:task.id,values:{decision:'Approve'}}),201)
  const repeated=expect(await api(path,'POST',{taskId:task.id,values:{decision:'Approve'}}),201)
  assert.equal(repeated.id,submitted.id)
  expect(await api(path,'POST',{taskId:task.id,values:{decision:'Reject'}}),409)
  expect(await api(`/workflow/tasks/${task.id}/complete`,'POST',complete),200)
}
async function ended(id) {
  const history=await engine(`/history/historic-process-instances/${encodeURIComponent(id)}`)
  assert(history.endTime,'real Flowable history must record process completion')
  log.push(`PASS ended process=${id} definition=${history.processDefinitionId}`)
}
try {
  assert(Array.isArray((await engine('/runtime/tasks?size=1')).data))
  child=spawn(process.execPath,['dist/index.js'],{cwd:root,env:childEnv,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',b=>log.push(b.toString().trim()));child.stderr.on('data',b=>log.push(b.toString().trim()))
  let ready=false
  for(let i=0;i<200;i++) {if(child.exitCode!==null)throw Error('isolated PLM exited');try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100))}
  assert(ready,'isolated PLM did not become healthy')
  const setup=expect(await api('/auth/mobile/setup','POST',{displayName:'Runtime test admin',email:`runtime-${suffix}@example.test`,password:`Isolated-${randomBytes(20).toString('hex')}`}),201)
  token=setup.accessToken;scope=setup.user
  const scopeA={...scope}
  const accountB=expect(await api('/auth/accounts','POST',{accountName:`Test account ${suffix}`}),201).account.id
  const orgB=expect(await api('/auth/organizations','POST',{organizationName:`Test org ${suffix}`,accountName:`Test org account ${suffix}`}),201).account.id
  const tenantB=expect(await api('/auth/tenants','POST',{tenantName:`Test tenant ${suffix}`,organizationName:`Test tenant org ${suffix}`,accountName:`Test tenant account ${suffix}`}),201).scope.accountId
  await configure()
  expect(await api('/forms','POST',{key:'runtimeForm',name:'Runtime test form',definition:{dslVersion:1,fields:[{id:'decision',label:'Decision',type:'text',required:true,min:2,max:80}]}}),201)
  expect(await api('/forms/runtimeForm/publish','POST',{revision:1}),201)
  const model=await publishModel('assignee'), started=await start(model,'assignee'), task=await taskFor(started.processInstanceId)
  for(const account of [accountB,orgB,tenantB]) {
    await switchTo(account);await configure()
    expect(await api(`/workflow/tasks/${task.id}`),403)
    expect(await api(`/workflow/tasks/${task.id}/complete`,'POST',{decision:'approved',comment:'Cross-scope denied'}),403)
    expect(await api(`/bpmn-models/${model.id}/start`,'POST',{}, {'Idempotency-Key':`cross-scope-${account}`}),404)
    expect(await api('/forms/runtimeForm/versions/1/submissions','POST',{taskId:task.id,values:{decision:'Approve'}}),404)
    assert(!expect(await api('/workflow/tasks'),200).tasks.some(t=>t.id===task.id))
  }
  await switchTo(scopeA.accountId)
  await finishWithForm(task);await ended(started.processInstanceId)
  const roleModel=await publishModel('role'), roleStarted=await start(roleModel,'role'), roleTask=await taskFor(roleStarted.processInstanceId)
  const rawRoleTask=await engine(`/runtime/tasks/${encodeURIComponent(roleTask.id)}`)
  assert.equal(rawRoleTask.assignee,null,'role group task is initially unclaimed')
  await finishWithForm(roleTask);await ended(roleStarted.processInstanceId)
  expect(await api('/workflow/instances','POST',{processDefinitionKey:'materialApproval',variables:{businessType:'material',businessId:`testRuntimeGap-builtin-${suffix}`,title:'Test material',assignee:'foreign-member@example.test'}}),403)
  const builtin=expect(await api('/workflow/instances','POST',{processDefinitionKey:'materialApproval',variables:{businessType:'material',businessId:`testRuntimeGap-builtin-${suffix}`,title:'Test material',assigneeUserId:scope.id}}),201)
  assert.equal(builtin.notification.ok,false,'no external notification may be sent')
  instances.push(builtin.process.id)
  const builtinTask=await taskFor(builtin.process.id)
  expect(await api(`/workflow/tasks/${builtinTask.id}/complete`,'POST',{decision:'approved',comment:'Temporary builtin test'}),200)
  await ended(builtin.process.id)
  log.push('PASS real PLM API + patched Flowable: automatic users, dynamic role group, custom start/idempotency, pinned forms/replays, completion/history, all three scope dimensions, builtin assignee mapping; no production or external messages')
  console.log(`PASS real isolated Flowable E2E: ${instances.length} completed processes; log=${logPath}`)
} catch(e) {log.push(`FAIL ${e.stack||e}`);console.error(e.message);process.exitCode=1}
finally {
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,4000))]);if(child.exitCode===null)child.kill('SIGKILL')}
  writeFileSync(logPath,log.join('\n')+'\n')
  rmSync(work,{recursive:true,force:true})
}
