import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
const server = resolve(import.meta.dirname, '..')

test('automatic Flowable identities: independent scope, disable and claimed-role revocation', async t => {
  const dir=mkdtempSync(join(tmpdir(),'flowable-identity-')), file=join(dir,'identity.sqlite')
  const db=new Database(file)
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true})})
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,disabled INTEGER NOT NULL);
    CREATE TABLE tenants(id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE organizations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE accounts(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE tenant_memberships(user_id TEXT,tenant_id TEXT,organization_id TEXT,account_id TEXT,role TEXT,disabled INTEGER);
    CREATE TABLE bpmn_versions(id TEXT,model_id TEXT,tenant_id TEXT,organization_id TEXT,account_id TEXT,graph TEXT);
    CREATE TABLE bpmn_publish(version_id TEXT,model_id TEXT,tenant_id TEXT,organization_id TEXT,account_id TEXT,status TEXT,definition_id TEXT);`)
  const scopes=[['t1','o1','a1'],['t1','o1','a2'],['t1','o2','a3'],['t2','o3','a4']].map(([tenantId,organizationId,accountId])=>({tenantId,organizationId,accountId}))
  const scope=scopes[0]
  db.prepare('INSERT INTO users VALUES(?,?,0)').run('same-user','same@example.test')
  for(const s of scopes){
    db.prepare('INSERT OR IGNORE INTO tenants VALUES(?,?)').run(s.tenantId,'active')
    db.prepare('INSERT OR IGNORE INTO organizations VALUES(?,?,?)').run(s.organizationId,s.tenantId,'active')
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(s.accountId,s.tenantId,s.organizationId,'active')
    db.prepare('INSERT INTO tenant_memberships VALUES(?,?,?,?,?,0)').run('same-user',s.tenantId,s.organizationId,s.accountId,'reviewer')
  }
  function probe(code){
    const script=`import assert from 'node:assert/strict'; import {resolveFlowableIdentity,resolveFlowableRoleGroup,resolveFlowableMemberReference,publishedTaskAssignmentAllowed} from './dist/flowable-identity.js'; const s=${JSON.stringify(scope)}; ${code}`
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:server,env:{...process.env,NODE_ENV:'test',DATABASE_FILE:file},encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
    return result.stdout.trim()?JSON.parse(result.stdout):null
  }
  await t.test('same user and role produce distinct safe IDs for every scope layer',()=>{
    const out=probe(`console.log(JSON.stringify(${JSON.stringify(scopes)}.map(s=>resolveFlowableIdentity(s,'same-user'))))`)
    assert.equal(new Set(out.map(x=>x.actor)).size,4);assert.equal(new Set(out.map(x=>x.groups[0])).size,4)
    for(const x of out){assert.match(x.actor,/^plm_[a-f0-9]{32}_u_[a-f0-9]{32}$/);assert.match(x.groups[0],/^plm_[a-f0-9]{32}_r_reviewer$/)}
    const again=probe("console.log(JSON.stringify(resolveFlowableIdentity(s,'same-user')))");assert.deepEqual(again,out[0])
  })
  await t.test('PLM ID/email resolve without hand-entered engine mapping; arbitrary ID denied',()=>{
    probe("assert.equal(resolveFlowableMemberReference(s,'same-user').actor,resolveFlowableMemberReference(s,'same@example.test').actor); assert.throws(()=>resolveFlowableMemberReference(s,'foreign@example.test'))")
  })
  await t.test('role change removes former group and forbids an already claimed role task',()=>{
    const graph={nodes:[{id:'review',type:'userTask',assignment:{kind:'candidateRole',role:'reviewer'}}]}
    db.prepare('INSERT INTO bpmn_versions VALUES(?,?,?,?,?,?)').run('v','m','t1','o1','a1',JSON.stringify(graph))
    db.prepare('INSERT INTO bpmn_publish VALUES(?,?,?,?,?,?,?)').run('v','m','t1','o1','a1','published','def')
    const before=probe("assert(publishedTaskAssignmentAllowed(s,'same-user',{taskDefinitionKey:'review',processDefinitionId:'def',assignee:'claimed'}));console.log(JSON.stringify(resolveFlowableIdentity(s,'same-user')))")
    db.exec("UPDATE tenant_memberships SET role='member' WHERE account_id='a1'")
    const after=probe("assert.equal(publishedTaskAssignmentAllowed(s,'same-user',{taskDefinitionKey:'review',processDefinitionId:'def',assignee:'claimed'}),false);console.log(JSON.stringify(resolveFlowableIdentity(s,'same-user')))")
    assert.equal(before.actor,after.actor);assert.notEqual(before.groups[0],after.groups[0])
    db.exec("UPDATE tenant_memberships SET role='reviewer' WHERE account_id='a1'")
  })
  const disable=[
    ["membership","UPDATE tenant_memberships SET disabled=1 WHERE account_id='a1'"],
    ["user","UPDATE users SET disabled=1 WHERE id='same-user'"],
    ["account","UPDATE accounts SET status='disabled' WHERE id='a1'"],
    ["organization","UPDATE organizations SET status='disabled' WHERE id='o1'"],
    ["tenant","UPDATE tenants SET status='disabled' WHERE id='t1'"],
  ]
  for(const [name,sql] of disable) await t.test(`independent ${name} disable denies actor resolution`,()=>{
    db.exec("UPDATE tenant_memberships SET disabled=0;UPDATE users SET disabled=0;UPDATE accounts SET status='active';UPDATE organizations SET status='active';UPDATE tenants SET status='active'")
    probe("resolveFlowableIdentity(s,'same-user')")
    db.exec(sql)
    probe("assert.throws(()=>resolveFlowableIdentity(s,'same-user'),/not an active member/)")
  })
  await t.test('nonmember and malformed scope, actor and role are rejected',()=>{
    probe("for(const [scope,id] of [[s,'absent'],[s,'bad\\u0000id'],[{...s,tenantId:'x'.repeat(257)},'same-user'],[{...s,organizationId:''},'same-user']]) assert.throws(()=>resolveFlowableIdentity(scope,id)); for(const role of ['root','reviewer,admin','']) assert.throws(()=>resolveFlowableRoleGroup(s,role))")
  })
})
