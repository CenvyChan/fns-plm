import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import express from 'express'
const dir = mkdtempSync(join(tmpdir(), 'plm-form-runtime-'))
Object.assign(process.env, { DATABASE_FILE:join(dir,'isolated.sqlite'), DATA_FILE:join(dir,'absent.json'), APP_ENCRYPTION_KEY:'bc'.repeat(32), NODE_ENV:'test', INTEGRATION_DATA_DIR:join(dir,'integrations') })
const {db} = await import('../dist/database.js')
const {createAuthRouter} = await import('../dist/auth.js')
const {createFormsRouter} = await import('../dist/forms.js')
await import('../dist/bpmn-modeler.js')
const {flowableFormTaskAdapter,taskFormSubmissionReady} = await import('../dist/flowable-form-tasks.js')
const {resolveFlowableIdentity} = await import('../dist/flowable-identity.js')
const {saveConnectorConfig} = await import('../dist/integrations/configuration.js')
let task = null
let engineRequests = []
const engine = createServer((req,res) => {
  engineRequests.push(req.url)
  res.setHeader('Content-Type','application/json')
  if (req.url.startsWith('/runtime/tasks/')) { if (!task) {res.statusCode=404; return res.end('{}')} return res.end(JSON.stringify(task)) }
  const q = new URL(req.url,'http://localhost').searchParams
  const visible = task && task.tenantId === q.get('tenantId') && (!q.get('candidateGroup') || task.candidateGroup === q.get('candidateGroup')) && (!q.get('candidateUser') || task.candidateUser === q.get('candidateUser'))
  return res.end(JSON.stringify({data:visible ? [task] : []}))
})
await new Promise(r => engine.listen(0,'127.0.0.1',r))
const app = express(); app.use(express.json()); app.use('/api/auth',createAuthRouter()); app.use('/api',createFormsRouter({taskAdapter:flowableFormTaskAdapter}))
const server = createServer(app); await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let identity
async function api(path,body) {
 const headers = identity ? {Authorization:`Bearer ${identity.accessToken}`,'X-Tenant-ID':identity.user.tenantId,'X-Organization-ID':identity.user.organizationId,'X-Account-ID':identity.user.accountId} : {}
 const response=await fetch(`${origin}/api${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
 return {status:response.status,data:await response.json()}
}
await test('verified form task adapter: real sessions, pinned publication, scope and immutable replay',async t=>{
 t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>engine.close(r));db.close();rmSync(dir,{recursive:true,force:true})})
 const setup=await api('/auth/mobile/setup',{displayName:'Runtime test admin',email:'runtime-form@example.test',password:'RuntimeTest-Only-2026!'});assert.equal(setup.status,201);identity=setup.data
 const s=identity.user, tenant=`tenant:${s.tenantId}:organization:${s.organizationId}:account:${s.accountId}`
 saveConnectorConfig(s,'flowable',{baseUrl:`http://127.0.0.1:${engine.address().port}`,username:'test-only',password:'temporary-test-credentials',userMap:{},groupMap:{}},s.id)
 assert.equal((await api('/forms',{key:'testRuntimeForm',name:'Test runtime form',definition:{dslVersion:1,fields:[{id:'note',label:'Note',type:'text',required:true,max:30}]}})).status,201)
 assert.equal((await api('/forms/testRuntimeForm/publish',{revision:1})).status,201)
 const graph={key:'testRuntimeGapForm',name:'Test runtime gap',nodes:[{id:'review',type:'userTask',assignment:{kind:'assignee',userIds:[s.id]},formBinding:{formKey:'testRuntimeForm',formVersion:1}}]}
 const xml='<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="https://momentum.local/bpmn"><process id="testRuntimeGapForm" name="Test" isExecutable="true"><startEvent id="start"/><userTask id="review" name="Review" flowable:assignee="testUser" flowable:formKey="plm-form:testRuntimeForm:v1"/><endEvent id="end"/><sequenceFlow id="f1" sourceRef="start" targetRef="review"></sequenceFlow><sequenceFlow id="f2" sourceRef="review" targetRef="end"></sequenceFlow></process></definitions>'
 const now=new Date().toISOString()
 db.prepare('INSERT INTO bpmn_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('test-v',s.tenantId,s.organizationId,s.accountId,'test-model',1,JSON.stringify(graph),xml,createHash('sha256').update(xml).digest('hex'),s.id,now)
 db.prepare('INSERT INTO bpmn_publish VALUES(?,?,?,?,?,?,?,?,?,?)').run('test-p',s.tenantId,s.organizationId,s.accountId,'test-model','test-v','published','test-deployment','test-definition',now)
 const mapped=resolveFlowableIdentity(s,s.id)
 const original={id:'test-task',tenantId:tenant,processInstanceId:'test-process',processDefinitionId:'test-definition',taskDefinitionKey:'review',formKey:'plm-form:testRuntimeForm:v1',assignee:mapped.actor}
 task={...original}
 const submit=()=>api('/forms/testRuntimeForm/versions/1/submissions',{taskId:'test-task',values:{note:'validated'}})
 assert.equal(taskFormSubmissionReady(s,s.id,task),false)
 assert.equal((await api('/forms/testRuntimeForm/versions/1/submissions',{taskId:'test-task',values:{}})).status,400)
 const success=await submit();assert.equal(success.status,201,JSON.stringify(success));assert.equal(success.data.processInstanceId,'test-process');assert.equal(taskFormSubmissionReady(s,s.id,task),true)
 const retry=await submit();assert.equal(retry.status,201);assert.equal(retry.data.id,success.data.id)
 assert.equal((await api('/forms/testRuntimeForm/versions/1/submissions',{taskId:'test-task',values:{note:'different'}})).status,409)
 assert.equal(db.prepare('SELECT count(*) AS n FROM form_submissions').get().n,1)
 assert.equal((await api('/forms/testRuntimeForm/versions/1/submissions',{taskId:'test-task',processInstanceId:'forged',values:{note:'validated'}})).status,400)
 for(const patch of [{tenantId:`${tenant}-other`},{assignee:'unrelated'},{formKey:'plm-form:testRuntimeForm:v2'},{processDefinitionId:'unpublished'},{taskDefinitionKey:'wrong-node'}]) {task={...original,...patch};assert.equal((await submit()).status,403,JSON.stringify(patch))}
 task={...original,assignee:null,candidateUser:mapped.actor};assert.equal((await submit()).status,201,'unclaimed candidate-user task is authorized')
 task={...original,assignee:null,candidateGroup:mapped.groups[0]};assert.equal((await submit()).status,201,'current role group task is authorized')
 task={...original,assignee:null,candidateGroup:'foreign-role'};assert.equal((await submit()).status,403)
 task={...original};db.prepare("UPDATE bpmn_publish SET status='uncertain' WHERE id='test-p'").run();assert.equal((await submit()).status,403);assert.equal(taskFormSubmissionReady(s,s.id,task),false)
 assert.ok(engineRequests.length>0)
})
