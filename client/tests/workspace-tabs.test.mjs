import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { build } from 'esbuild'
const load = async name => {
  const result = await build({ entryPoints:[new URL(`../src/${name}`,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const nav = await load('navigation.ts')
const tabs = await load('workspace-tabs.ts')
const areas = await load('navigation-areas.ts')
const admin = { id:'u',tenantId:'t',organizationId:'o',accountId:'a',role:'admin',isPlatformAdmin:true }
const full = { sales:true,purchase:true,canWrite:true,canManage:true }

test('hierarchy has top-level pages plus K3 read-only submenus, but no create/edit shortcuts', () => {
  const entries = areas.navigationAreas.flatMap(a=>a.sections.flatMap(s=>s.pages))
  assert.equal(entries.length,new Set(entries).size)
  assert.deepEqual([...entries].sort(),nav.pages.filter(p=>!p.parent || p.parent==='operational-reports').map(p=>p.id).sort())
  for (const id of entries) {
    assert.ok(!nav.pageById[id].parent || nav.pageById[id].parent==='operational-reports')
    assert.doesNotMatch(id,/-(new|edit)$/)
  }
  assert.deepEqual(areas.navigationPath('daily-sales-new'),['经营日报','销售','新增销售日报'])
  assert.equal(areas.navigationPath('reports')[0],'经营日报')
  assert.equal(areas.navigationPath('kpi')[0],'产品与项目')
})
test('tab families keep list/editor context together without mixing sales and purchase', () => {
  assert.equal(tabs.tabId('daily-sales-edit'),'daily-sales')
  assert.equal(tabs.tabId('daily-purchase-new'),'daily-purchase')
  assert.equal(tabs.tabId('report-definitions-edit'),'report-definitions')
  assert.notEqual(tabs.tabId('daily-sales-edit'),tabs.tabId('daily-purchase-edit'))
  const routes=['daily-sales','daily-sales-analysis','daily-purchase','daily-purchase-analysis']
  assert.deepEqual(routes.map(tabs.tabId),routes)
  assert.equal(new Set(routes.map(tabs.tabId)).size,4)
})
test('storage isolation includes user, tenant, organization, account and role', () => {
  const base = tabs.scopeKey(admin)
  for (const field of ['id','tenantId','organizationId','accountId','role']) assert.notEqual(tabs.scopeKey({...admin,[field]:'different'}),base)
  assert.notEqual(tabs.scopeKey({...admin,id:'u:x',tenantId:'t'}),tabs.scopeKey({...admin,id:'u',tenantId:'x:t'}))
})
test('restored pages are validated, deduplicated and permission-filtered; editors return to safe records page', () => {
  const raw=JSON.stringify([{page:'users',url:'/?page=users'},{page:'daily-sales-edit',url:'/?page=daily-sales-edit&date=2026-10-21'},{page:'daily-sales',url:'/'},{page:'unknown',url:'/'},{page:'materials',url:'/'}])
  const restored=tabs.restoreTabs(raw,page=>nav.canAccessPage(page,{...admin,role:'member',isPlatformAdmin:false},full))
  assert.deepEqual(restored.map(t=>t.page),['daily-sales','materials'])
  assert.equal(restored[0].url,'/?date=2026-10-21&page=daily-sales')
  assert.deepEqual(tabs.restoreTabs('{oops',()=>true),[])
  assert.deepEqual(tabs.restoreTabs('{}',()=>true),[])
  assert.deepEqual(tabs.restoreTabs('[{"page":"daily-purchase"}]',p=>nav.canAccessPage(p,admin,null)),[])
  const routes=['daily-sales','daily-sales-analysis','daily-purchase','daily-purchase-analysis']
  const saved=JSON.stringify(routes.map(page=>({page,url:`/?page=${page}`})))
  assert.deepEqual(tabs.restoreTabs(saved,()=>true).map(tab=>tab.page),routes)
  assert.deepEqual(tabs.restoreTabs(saved,page=>nav.canAccessPage(page,{...admin,role:'member',isPlatformAdmin:false},{...full,sales:false})).map(tab=>tab.page),['daily-purchase','daily-purchase-analysis'])
})
test('saved URLs only retain allowed route metadata and never credentials or drafts', () => {
  const url=tabs.safeTabUrl('/?page=materials&token=private&password=private&note=draft&date=2026-10-21&definitionId=def','materials')
  assert.equal(url,'/?date=2026-10-21&definitionId=def&page=materials')
  assert.ok(!tabs.safeTabUrl('https://evil.test/path?token=private','materials').startsWith('https:'))
  assert.ok(!tabs.safeTabUrl('https://local.invalid//evil.test/path','materials').startsWith('//'))
})
test('integration retains hidden panels, scoped portal hosts and cancelable workspace leave guard', () => {
  const read=n=>readFileSync(new URL(`../src/${n}`,import.meta.url),'utf8')
  const app=read('App.tsx'), panels=read('WorkspaceTabs.tsx'), filters=read('workspace-view-state.ts')
  assert.match(app,/scopeKey\(authUser\)/)
  assert.match(app,/workspace:before-discard', \{ cancelable: true \}/)
  assert.match(panels,/hidden=\{!active\}/)
  assert.match(panels,/beforeunload/)
  assert.match(panels,/WorkspacePortalContext.Provider/)
  assert.match(panels,/tabIndex=\{tab.id === activeId \? 0 : -1\}/)
  assert.match(filters,/Explicit allowlist/)
  assert.match(filters,/closest\('form, \[role="dialog"\], .modal-card'\)/)
})

test('filter persistence survives editor-only snapshots and rejects invalid stored state', async () => {
  const view=await load('workspace-view-state.ts')
  const storage=new Map()
  const oldStorage=globalThis.sessionStorage, oldWindow=globalThis.window
  globalThis.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}
  globalThis.window={scrollY:240}
  try {
    const field={tagName:'INPUT',value:'NAV-SALES-026',closest:()=>null,getAttribute:name=>name==='placeholder'?'客商、单号或备注':null}
    view.saveViewState({querySelectorAll:selector=>selector.includes('.module-search')?[field]:[]},'scope:view:sales')
    assert.equal(Object.values(view.readViewState('scope:view:sales').filters)[0],'NAV-SALES-026')
    view.saveViewState({querySelectorAll:()=>[]},'scope:view:sales')
    assert.equal(Object.values(view.readViewState('scope:view:sales').filters)[0],'NAV-SALES-026')
    assert.equal(view.readViewState('scope:view:sales').scrollY,240)
    storage.set('bad',JSON.stringify({filters:null,scrollY:0}))
    assert.equal(view.readViewState('bad'),null)
    storage.set('bad',JSON.stringify({filters:{},scrollY:-1}))
    assert.equal(view.readViewState('bad'),null)
  } finally { globalThis.sessionStorage=oldStorage; globalThis.window=oldWindow }
})
