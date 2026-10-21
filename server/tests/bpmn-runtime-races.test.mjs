import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every case uses this process-local DB singleton and loopback-only engine; keep it open
// until the complete test has finished (closing it breaks later cases in this file).
process.env.NODE_ENV = 'test'
process.env.BPMN_MODELER_ALLOW_TEST_MOCK = 'true'
const dir = mkdtempSync(join(tmpdir(), 'plm-bpmn-races-'))
process.env.DATABASE_FILE = join(dir, 'race.sqlite')
process.env.APP_ENCRYPTION_KEY = 'a7'.repeat(32)
process.env.CONNECTOR_DEFAULT_TENANT_ID = 'tenant-race'
process.env.CONNECTOR_DEFAULT_ORGANIZATION_ID = 'org-race'
process.env.CONNECTOR_DEFAULT_ACCOUNT_ID = 'account-race'
await import('../dist/bpmn-modeler.js')
const { db } = await import('../dist/database.js')
// Reproduce the pre-fix schema so this suite also proves additive legacy migration.
db.exec(`CREATE TABLE bpmn_runtime_starts (
  idempotency_key TEXT NOT NULL,tenant_id TEXT NOT NULL,organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,actor_id TEXT NOT NULL,request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('starting','started','uncertain')),
  process_instance_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,organization_id,account_id,actor_id,idempotency_key))`)
db.prepare('INSERT INTO bpmn_runtime_starts VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('legacy-uncertain-key','tenant-race','org-race','account-race','actor-race','legacy-hash','uncertain',null,'legacy','legacy')
const { createBpmnRuntimeRouter } = await import('../dist/bpmn-runtime.js')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) })
const { createHash } = await import('node:crypto')
async function until(predicate) {
  const deadline=Date.now()+3000
  while(!predicate()) { assert.ok(Date.now()<deadline,'timed out waiting for deterministic test barrier'); await new Promise(r=>setTimeout(r,5)) }
}
const xml = '<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="https://momentum.local/bpmn"><process id="raceModel" name="Race" isExecutable="true"><startEvent id="Start"/><endEvent id="End"/><sequenceFlow id="Flow" sourceRef="Start" targetRef="End"></sequenceFlow></process></definitions>'
const graph = JSON.stringify({ key: 'raceModel', name: 'Race', nodes: [], flows: [] })
function seed() {
  const hash = createHash('sha256').update(xml).digest('hex'), now = new Date().toISOString()
  db.prepare("INSERT INTO tenants(id,name,code,created_at,updated_at) VALUES('tenant-race','T','T',?,?)").run(now,now)
  db.prepare("INSERT INTO organizations(id,tenant_id,name,code,created_at,updated_at) VALUES('org-race','tenant-race','O','O',?,?)").run(now,now)
  db.prepare("INSERT INTO accounts(id,tenant_id,organization_id,name,code,created_at,updated_at) VALUES('account-race','tenant-race','org-race','A','A',?,?)").run(now,now)
  db.prepare("INSERT INTO users(id,email,display_name,password_hash,role,created_at,updated_at) VALUES('actor-race','race@example.test','Race Actor','unused','plm_manager',?,?)").run(now,now)
  db.prepare("INSERT INTO tenant_memberships(id,user_id,tenant_id,organization_id,account_id,role,created_at) VALUES('membership-race','actor-race','tenant-race','org-race','account-race','plm_manager',?)").run(now)
  db.prepare('INSERT INTO bpmn_models VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('model-race','tenant-race','org-race','account-race','raceModel','Race',graph,1,'actor-race','actor-race',now,now)
  db.prepare('INSERT INTO bpmn_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('version-race','tenant-race','org-race','account-race','model-race',1,graph,xml,hash,'actor-race',now)
  db.prepare('INSERT INTO bpmn_publish VALUES(?,?,?,?,?,?,?,?,?,?)').run('pub-race','tenant-race','org-race','account-race','model-race','version-race','published','deployment-race','definition-race',now)
}

test('runtime reservation races are deterministic, scoped and fail closed', async t => {
  const barriers = []
  const engineBarriers = []
  let healthMode = 'open', healthCount = 0, enginePosts = 0, engineMode = 'open'
  const engine = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/runtime/tasks')) {
      healthCount++
      if (healthMode === 'blocked') await new Promise(resolve => barriers.push(resolve))
      res.setHeader('Content-Type','application/json')
      res.statusCode = healthMode === 'fail' ? 503 : 200
      return res.end(JSON.stringify({data:[]}))
    }
    res.setHeader('Content-Type','application/json')
    if (req.method === 'GET' && req.url === '/repository/process-definitions/definition-race') return res.end(JSON.stringify({id:'definition-race',key:'raceModel',deploymentId:'deployment-race',tenantId:'tenant:tenant-race:organization:org-race:account:account-race'}))
    if (req.method === 'POST' && req.url === '/runtime/process-instances') {
      enginePosts++
      if (engineMode === 'blocked') await new Promise(resolve => engineBarriers.push(resolve))
      if (engineMode === 'uncertain') { res.statusCode=503; return res.end(JSON.stringify({error:'uncertain'})) }
      return res.end(JSON.stringify({id:`instance-${enginePosts}`}))
    }
    res.end(JSON.stringify({data:[]}))
  })
  const base = await listen(engine)
  process.env.FLOWABLE_BASE_URL = base; process.env.FLOWABLE_USERNAME = 'race'; process.env.FLOWABLE_PASSWORD = 'race'; process.env.FLOWABLE_TIMEOUT_MS = '5000'
  seed()
  const app = express(); app.use(express.json())
  app.use((req,_res,next) => { req.authUser = {id:'actor-race',displayName:'Race Actor',role:'plm_manager',tenantId:req.get('x-tenant')||'tenant-race',tenantName:'T',organizationId:'org-race',organizationName:'O',accountId:'account-race',accountName:'A',isPlatformAdmin:false}; next() })
  app.use('/bpmn-models',createBpmnRuntimeRouter())
  const server = createServer(app), origin = await listen(server)
  const req = (key, body={}, tenant='tenant-race') => fetch(`${origin}/bpmn-models/model-race/start`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'x-tenant':tenant},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)})
  const row = key => db.prepare('SELECT state FROM bpmn_runtime_starts WHERE idempotency_key=?').get(key)
  const assertLockedOrReplay = response => assert.ok([200,409].includes(response.status), `used key must never be unlockable; HTTP ${response.status}`)
  try {
    await t.test('legacy rows migrate without becoming unlockable or unattempted', async () => {
      const legacy=db.prepare('SELECT owner_token,engine_attempted,state FROM bpmn_runtime_starts WHERE idempotency_key=?').get('legacy-uncertain-key')
      assert.deepEqual(legacy,{owner_token:'',engine_attempted:1,state:'uncertain'})
      assert.equal((await req('legacy-uncertain-key')).status,409)
      assert.equal(enginePosts,0)
    })
    await t.test('same-key contender cannot run health or engine while first health is blocked; first succeeds and replays', async () => {
      healthMode='blocked'; const beforeHealth=healthCount, beforePost=enginePosts
      const first=req('race-success-01')
      await until(()=>healthCount>beforeHealth)
      const second=await req('race-success-01')
      assert.equal(second.status,409); assert.equal(healthCount,beforeHealth+1); assert.equal(enginePosts,beforePost)
      barriers.shift()()
      assert.equal((await first).status,201)
      assert.equal((await req('race-success-01')).status,200)
      assert.equal(enginePosts,beforePost+1)
      healthMode='open'
    })
    await t.test('health failure contender is locked out and first removes only its own reservation before 503', async () => {
      healthMode='blocked'; const key='race-failure-02', before=healthCount
      const first=req(key); await until(()=>healthCount>before)
      assert.equal((await req(key)).status,409); assert.equal(healthCount,before+1)
      healthMode='fail'; barriers.shift()()
      assert.equal((await first).status,503)
      assert.equal(row(key),undefined)
      healthMode='open'
    })
    for (const healthResult of ['fail','open']) for (const state of ['started','starting','uncertain']) await t.test(`health ${healthResult} cannot erase or start over competing ${state} ownership`, async () => {
      healthMode='blocked'; const key=`race-owner-${healthResult}-${state}`, before=healthCount
      const first=req(key); await until(()=>healthCount>before)
      db.prepare(`UPDATE bpmn_runtime_starts SET state=?,process_instance_id=?,owner_token='competing-owner' WHERE idempotency_key=?`).run(state,state==='started'?'external-instance':null,key)
      healthMode=healthResult; barriers.shift()()
      const response=await first; assertLockedOrReplay(response); assert.equal(enginePosts,1)
      assert.equal(row(key)?.state,state)
      const retry=await req(key)
      assert.equal(retry.status,state==='started'?200:409)
      assert.equal(row(key)?.state,state)
      healthMode='open'
    })
    await t.test('existing started key is fail-closed on malformed body; scope is isolated', async () => {
      const malformed=await fetch(`${origin}/bpmn-models/model-race/start`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'race-success-01'},body:JSON.stringify({forged:'field'})})
      assert.equal(malformed.status,409)
      const other=await req('race-success-01',{},'tenant-other'); assert.notEqual(other.status,200)
      assert.ok(row('race-success-01'))
      assert.equal(enginePosts,1)
    })
    await t.test('successful key replays after release gate closes; changed request conflicts; fresh key is rejected', async () => {
      const beforeHealth=healthCount
      process.env.BPMN_MODELER_ALLOW_TEST_MOCK='false'
      try {
        assert.equal((await req('race-success-01')).status,200)
        const changed=await req('race-success-01',{title:'Changed'})
        assert.equal(changed.status,409)
        assert.equal((await changed.json()).error,'idempotency_key_reused_with_different_request')
        const fresh=await req('gate-new-request-01')
        assert.equal(fresh.status,503)
        assert.equal((await fresh.json()).error,'custom_bpmn_runtime_release_blocked')
        assert.equal(row('gate-new-request-01'),undefined)
        for (const state of ['starting','uncertain']) assert.equal((await req(`race-owner-open-${state}`)).status,409)
        assert.equal(healthCount,beforeHealth)
        assert.equal(enginePosts,1)
      } finally { process.env.BPMN_MODELER_ALLOW_TEST_MOCK='true' }
    })
    await t.test('gate closed during health preflight is checked again before the engine attempt', async () => {
      healthMode='blocked'; const before=healthCount, key='gate-during-preflight'
      const first=req(key); await until(()=>healthCount>before)
      process.env.BPMN_MODELER_ALLOW_TEST_MOCK='false'
      healthMode='open'; barriers.shift()()
      try {
        const response=await first
        assert.equal(response.status,503)
        assert.equal((await response.json()).error,'custom_bpmn_runtime_release_blocked')
        assert.equal(row(key),undefined); assert.equal(enginePosts,1)
      } finally { process.env.BPMN_MODELER_ALLOW_TEST_MOCK='true' }
    })
    await t.test('publication changed during health preflight requires fresh confirmation, with zero engine calls', async () => {
      healthMode='blocked'; const before=healthCount, key='published-during-preflight'
      const first=req(key,{expectedVersionId:'version-race'}); await until(()=>healthCount>before)
      const now=new Date().toISOString(), hash=createHash('sha256').update(xml).digest('hex')
      db.prepare('INSERT INTO bpmn_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('version-race-v2','tenant-race','org-race','account-race','model-race',2,graph,xml,hash,'actor-race',now)
      db.prepare('INSERT INTO bpmn_publish VALUES(?,?,?,?,?,?,?,?,?,?)').run('pub-race-v2','tenant-race','org-race','account-race','model-race','version-race-v2','published','deployment-v2','definition-v2',now)
      healthMode='open'; barriers.shift()()
      const response=await first
      assert.equal(response.status,409); assert.equal((await response.json()).error,'published_version_changed')
      assert.equal(row(key),undefined); assert.equal(enginePosts,1)
      // A used key still replays its original immutable version after a new publication.
      assert.equal((await req('race-success-01')).status,200); assert.equal(enginePosts,1)
      db.prepare('DELETE FROM bpmn_publish WHERE id=?').run('pub-race-v2')
      // Frozen versions cannot be deleted; retain v2 history without a published pointer.
    })
    await t.test('replaced request hash must conflict instead of replaying another request on either health outcome', async () => {
      for (const result of ['fail','open']) {
        healthMode='blocked'; const before=healthCount, key=`replaced-hash-${result}`
        const first=req(key); await until(()=>healthCount>before)
        db.prepare("UPDATE bpmn_runtime_starts SET state='started',process_instance_id='other-request',request_hash='different',owner_token='other' WHERE idempotency_key=?").run(key)
        healthMode=result; barriers.shift()()
        const response=await first
        assert.equal(response.status,409); assert.equal(enginePosts,1)
        assert.equal(row(key)?.state,'started')
      }
      healthMode='open'
    })
    await t.test('an unexpectedly vanished reservation cannot be called definitely-not-started', async () => {
      for (const outcome of ['fail','open']) {
        healthMode='blocked'; const before=healthCount, key=`vanished-reservation-${outcome}`
        const first=req(key); await until(()=>healthCount>before)
        db.prepare('DELETE FROM bpmn_runtime_starts WHERE idempotency_key=?').run(key)
        healthMode=outcome; barriers.shift()()
        const response=await first
        assert.equal(response.status,409)
        assert.equal((await response.json()).error,'start_outcome_uncertain_no_retry')
        assert.equal(enginePosts,1)
      }
      healthMode='open'
    })
    await t.test('same key during an actual engine POST cannot make a second call; uncertain outcome stays locked', async () => {
      for (const outcome of ['open','uncertain']) {
        engineMode='blocked'; const before=enginePosts, key=`engine-inflight-${outcome}`
        const first=req(key)
        await until(()=>enginePosts>before)
        const stored=db.prepare('SELECT state,engine_attempted FROM bpmn_runtime_starts WHERE idempotency_key=?').get(key)
        assert.deepEqual(stored,{state:'starting',engine_attempted:1})
        const competitor=await req(key)
        assert.equal(competitor.status,409); assert.equal(enginePosts,before+1)
        engineMode=outcome; engineBarriers.shift()()
        const response=await first
        assert.equal(response.status,outcome==='open'?201:502)
        assert.equal((await req(key)).status,outcome==='open'?200:409)
        assert.equal(row(key)?.state,outcome==='open'?'started':'uncertain')
        assert.equal(enginePosts,before+1)
      }
      engineMode='open'
    })
  } finally {
    healthMode='fail'; engineMode='uncertain'; barriers.splice(0).forEach(release=>release()); engineBarriers.splice(0).forEach(release=>release())
    await close(server); await close(engine); db.close(); rmSync(dir,{recursive:true,force:true})
  }
})
