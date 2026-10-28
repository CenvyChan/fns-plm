import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as netServer } from 'node:net'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer as createVite } from 'vite'
import { chromium } from 'playwright'

// Real browser -> real loopback API -> temporary SQLite. No mocked API responses.
const root = resolve(import.meta.dirname, '..'), serverDir = resolve(root, '../server')
const requireServer = createRequire(join(serverDir, 'package.json'))
const Database = requireServer('better-sqlite3'), ExcelJS = requireServer('exceljs')
const evidence = resolve(root, '../qa-evidence/daily-record-filters')
let temp, db, apiOrigin, service, vite, browser, user
const apiRequests = [], writes = [], pageErrors = [], results = []
const pickPort = async () => { const s = netServer(); const p = await new Promise((r,j)=>s.listen(0,'127.0.0.1',()=>r(s.address().port)).once('error',j)); await new Promise(r=>s.close(r)); return p }
const report = (id,type,date,createdBy,currency,amount) => ({ id,type,date,partyName:type==='sales'?'隔离测试客户':'隔离测试供应商',documentNo:`LOCAL-${id}`,quantity:1,currency,originalAmount:amount,exchangeRate:currency==='USD'?7.2:1,amountCny:Number((currency==='USD'?amount*7.2:amount).toFixed(2)),note:'本地人工测试数据',source:'manual',createdAt:`${date}T10:00:00.000Z`,updatedAt:`${date}T10:00:00.000Z`,createdBy,createdByName:({alice:'张三',bob:'李四',charlie:'王五',importer:'导入管理员'})[createdBy],updatedBy:createdBy })
function putState(key,value) { db.prepare('INSERT INTO app_state(key,value,updated_at,revision) VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,revision=app_state.revision+1').run(key,JSON.stringify(value),new Date().toISOString()) }
async function startApi() {
  temp=mkdtempSync(join(tmpdir(),'daily-record-filters-')); const port=await pickPort(); apiOrigin=`http://127.0.0.1:${port}`
  const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DATABASE_FILE:join(temp,'local.sqlite'),APP_ENCRYPTION_KEY:'6a'.repeat(32),APP_ENCRYPTION_KEY_FILE:join(temp,'key'),DATA_FILE:join(temp,'missing.json'),LEGACY_DATA_FILE:join(temp,'missing.json'),DOCUMENT_STORAGE_DIR:join(temp,'docs'),INTEGRATION_DATA_DIR:temp,REDIS_URL:'',CORS_ORIGIN:`http://127.0.0.1:${vite.httpServer.address().port}`,FLOWABLE_BASE_URL:'',FLOWABLE_USERNAME:'',FLOWABLE_PASSWORD:'',K3CLOUD_BASE_URL:'',K3CLOUD_ACCOUNT_ID:'',K3CLOUD_USERNAME:'',K3CLOUD_ORGANIZATION:'',K3CLOUD_APP_ID:'',K3CLOUD_APP_SECRET:'',K3CLOUD_PASSWORD:'',K3CLOUD_QUERY_ALLOWLIST:'{}',DINGTALK_WEBHOOK_URL:'',DINGTALK_ROBOT_WEBHOOK:'',DINGTALK_WEBHOOK_SECRET:'',DINGTALK_ROBOT_SECRET:'',DINGTALK_CARD_CALLBACK_SECRET:'',DINGTALK_APP_KEY:'',DINGTALK_APP_SECRET:'',DINGTALK_USER_MAP_JSON:'{}',DINGTALK_SSO_CLIENT_ID:'',DINGTALK_SSO_CLIENT_SECRET:'',DINGTALK_SSO_CORP_ID:'',DINGTALK_SSO_TENANT_ID:'',DINGTALK_SSO_ORGANIZATION_ID:'',CONNECTOR_DEFAULT_TENANT_ID:'',CONNECTOR_DEFAULT_ORGANIZATION_ID:'',CONNECTOR_DEFAULT_ACCOUNT_ID:''}
  service=spawn(process.execPath,['dist/index.js'],{cwd:serverDir,env,stdio:['ignore','pipe','pipe']}); let err='';service.stderr.on('data',x=>err+=x)
  for(let i=0;i<200;i++){try{if((await fetch(`${apiOrigin}/api/health`)).ok)break}catch{} await new Promise(r=>setTimeout(r,100));if(i===199)throw Error(`local API failed: ${err}`)}
  const setup=await fetch(`${apiOrigin}/api/auth/mobile/setup`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'隔离测试员',email:'daily-filter@example.test',password:'local-test-password-123'})}); assert.equal(setup.status,201); ({user}=await setup.json())
  db=new Database(join(temp,'local.sqlite'))
  putState(`daily-reporting-admin:${user.tenantId}:${user.organizationId}:${user.accountId}`,{masterDataConfigured:true,parties:[{id:'cust',kind:'customer',name:'隔离测试客户',aliases:[],active:true},{id:'supp',kind:'supplier',name:'隔离测试供应商',aliases:[],active:true}],exchangeRates:[],assignments:[],partyMappings:[],legacyMemberships:[],importBatches:[]})
  const rows=['sales','purchase'].flatMap((type,index)=>[
    report(`${type}-a`,type,'2024-03-01','alice','CNY',11+index*10), report(`${type}-b`,type,'2024-03-01','bob','USD',20+index*10), report(`${type}-c`,type,'2024-03-01','alice','USD',30+index*10), report(`${type}-other`,type,'2024-03-01','charlie','CNY',40),
    report(`${type}-previous`,type,'2024-02-23','alice','CNY',5), report(`${type}-leap`,type,'2024-02-29','bob','CNY',6), report(`${type}-yearend`,type,'2023-12-31','alice','CNY',7), report(`${type}-newyear`,type,'2024-01-07','alice','CNY',8),
    {...report(`${type}-history-a`,type,'2024-03-01','importer','CNY',60),source:'history-import',legacyCompanyCode:'LOCAL',legacyUserId:'h1',legacyUserName:'历史员工甲'},
    {...report(`${type}-history-b`,type,'2024-03-01','importer','USD',7),source:'history-import',legacyCompanyCode:'LOCAL',legacyUserId:'h2',legacyUserName:'历史员工乙'},
  ])
  putState(`daily-reporting:${user.tenantId}:${user.organizationId}:${user.accountId}`,{reports:rows,k3Rows:[],links:[],snapshots:[],corrections:[],deliveries:[],mockSnapshotAt:null,mockEnabled:false,k3Sync:null,k3HistoricalHeaders:[],importPreviews:[],importBatches:[]})
}
const sameEntries = (left,right) => JSON.stringify([...left.entries()].sort()) === JSON.stringify([...right.entries()].sort())
test('sales and purchase filters use real API dates, multi-select identities and matching Excel exports', {concurrency:false, timeout:120_000}, async()=>{
  mkdirSync(evidence,{recursive:true})
  try {
    vite=await createVite({root,server:{host:'127.0.0.1',port:0}}); await vite.listen(); await startApi()
    browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']})
    const page=await browser.newPage({viewport:{width:1550,height:1100},acceptDownloads:true,locale:'zh-CN'});page.setDefaultTimeout(12000)
    page.on('pageerror',e=>pageErrors.push(e.message))
    page.on('request',req=>{const u=new URL(req.url());if(u.origin===apiOrigin&&u.pathname.startsWith('/api/')){apiRequests.push({path:u.pathname,query:u.search,method:req.method()});if(req.method()!=='GET'&&!u.pathname.startsWith('/api/auth/'))writes.push({path:u.pathname,method:req.method()})}})
    const url=`http://127.0.0.1:${vite.httpServer.address().port}`
    await page.addInitScript(({apiOrigin})=>{localStorage.setItem('momentum.api-base-url',apiOrigin)}, {apiOrigin})
    await page.goto(url)
    await page.getByLabel('企业邮箱',{exact:true}).fill('daily-filter@example.test');await page.getByLabel('密码',{exact:true}).fill('local-test-password-123');await page.getByRole('button',{name:'安全登录',exact:true}).click();await page.locator('.sidebar').waitFor()
    const screenshot = async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:join(evidence,`${name}.png`),fullPage:true,animations:'disabled'})}
    for(const kind of ['sales','purchase']){
      await page.setViewportSize({width:1550,height:1100})
      // Simulate old scalar/source metadata. The removed source must not hide historical records.
      const storageKey=['plm-tabs-v1',user.id,user.tenantId,user.organizationId,user.accountId,user.role].map(encodeURIComponent).join(':')+`:daily-filters:daily-${kind}`
      await page.evaluate(({key})=>sessionStorage.setItem(key,JSON.stringify({date:'2024-03-01',filters:{q:'',from:'2024-03-01',to:'2024-03-01',partyName:'',createdBy:'',currency:'',source:'manual'}})),{key:storageKey})
      const load=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/daily-reports/analysis'&&new URL(r.url()).searchParams.get('type')===kind)
      await page.goto(`${url}/?page=daily-${kind}&date=2024-03-01`);let applied=await (await load).json()
      const filters=page.locator('.dba-filters'),records=page.locator('.dba-records');await filters.waitFor();await records.waitFor()
      const waitRows = async data=>{
        assert.equal(data.filters.type,kind)
        await page.waitForFunction(docs=>JSON.stringify([...document.querySelectorAll('.dba-records tbody tr td:nth-child(2)')].map(n=>n.textContent))===JSON.stringify(docs),data.reports.map(row=>row.documentNo))
        assert.equal(await page.locator('.dba-summary strong').first().innerText(),String(data.summary.count))
      }
      await waitRows(applied);assert.equal(applied.summary.count,6)
      const run = async(action, expected={})=>{
        const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/daily-reports/analysis'&&u.searchParams.get('type')===kind&&Object.entries(expected).every(([key,value])=>u.searchParams.get(key)===value)})
        await action();const actual=await response;assert.equal(actual.status(),200);applied=await actual.json();await waitRows(applied);return applied
      }
      const click=name=>()=>page.getByRole('button',{name,exact:true}).click()
      const setRange=async(from,to)=>{await page.getByLabel('开始日期',{exact:true}).fill(from);await page.getByLabel('结束日期',{exact:true}).fill(to);await run(click('应用筛选'),{from,to})}
      const choose=async(label, names)=>{
        await page.getByRole('button',{name:`${label}筛选`,exact:true}).click();const group=page.getByRole('group',{name:`${label}多选`,exact:true});await group.getByRole('button',{name:`全部${label}`,exact:true}).click()
        for(const name of names) await group.getByRole('checkbox',{name,exact:true}).check()
        await page.getByRole('button',{name:`${label}筛选`,exact:true}).press('Escape')
      }
      assert.equal(await filters.locator('input[type=date]').count(),2)
      assert.equal(await page.locator('.dr-source-banner').count(),0)
      assert.equal(await page.locator('.dr-header').count(),0)
      assert.equal(await page.getByRole('button',{name:'刷新当前口径',exact:true}).count(),0)
      assert.equal(await filters.getByText('来源',{exact:true}).count(),0)
      for(const copy of ['按日期记录销售与采购日报，关联 ERP 快照并进行可追溯对账。','数据来源与完整性','明细、汇总、趋势和导出使用同一筛选口径；不触发 ERP 同步。'])assert.equal((await page.locator('body').innerText()).includes(copy),false)
      const actions=page.locator('.dr-list-actions');assert.match(await actions.locator('button').nth(1).innerText(),/导入/);assert.match(await actions.locator('button').nth(2).innerText(),/导出/)
      for(const name of ['前7天','后7天','本周','本月','本年','应用筛选','重置'])assert.equal(await page.getByRole('button',{name,exact:true}).locator('svg').count(),1)
      const boxes=await Promise.all(['本周','本月','本年','应用筛选','重置'].map(name=>page.getByRole('button',{name,exact:true}).boundingBox()));assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<2),'presets and apply/reset share one desktop row')
      await run(click('前7天'),{from:'2024-02-23',to:'2024-02-23'});assert.equal(applied.summary.count,1);assert.equal(await page.getByLabel('开始日期',{exact:true}).inputValue(),'2024-02-23');assert.equal(await page.getByLabel('结束日期',{exact:true}).inputValue(),'2024-02-23')
      await run(click('后7天'),{from:'2024-03-01',to:'2024-03-01'});assert.equal(applied.summary.count,6)
      await setRange('2024-03-01','2024-03-07');await run(click('前7天'),{from:'2024-02-23',to:'2024-02-29'});assert.equal(applied.summary.count,2)
      await setRange('2023-12-31','2023-12-31');await run(click('后7天'),{from:'2024-01-07',to:'2024-01-07'});assert.equal(applied.summary.count,1)
      await run(click('重置'),{from:'2024-03-01',to:'2024-03-01'})
      const presets=await page.evaluate(()=>{const now=new Date(),day=value=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`,week=new Date(now.getFullYear(),now.getMonth(),now.getDate());week.setDate(week.getDate()-((week.getDay()+6)%7));return [{name:'本周',from:day(week),to:day(now)},{name:'本月',from:day(new Date(now.getFullYear(),now.getMonth(),1)),to:day(now)},{name:'本年',from:day(new Date(now.getFullYear(),0,1)),to:day(now)}]})
      for(const preset of presets){await run(click(preset.name),{from:preset.from,to:preset.to});assert.equal(await page.getByLabel('开始日期',{exact:true}).inputValue(),preset.from);assert.equal(await page.getByLabel('结束日期',{exact:true}).inputValue(),preset.to)}
      await run(click('重置'),{from:'2024-03-01',to:'2024-03-01'})
      await choose('录入人',['张三','李四']);await choose('币种',['CNY','USD']);await run(click('应用筛选'));assert.deepEqual(applied.filters.createdBy.sort(),['alice','bob']);assert.deepEqual(applied.filters.currency.sort(),['CNY','USD']);assert.equal(applied.summary.count,3)
      await choose('币种',['CNY']);await run(click('应用筛选'));assert.equal(applied.summary.count,1);assert.equal(applied.reports[0].createdBy,'alice')
      await choose('录入人',['李四']);await choose('币种',['USD']);await run(click('应用筛选'));assert.equal(applied.summary.count,1);assert.equal(applied.reports[0].createdBy,'bob')
      await choose('录入人',['历史员工甲（历史）','历史员工乙（历史）']);await choose('币种',['CNY','USD']);await run(click('应用筛选'));assert.equal(applied.summary.count,2);assert.ok(applied.reports.every(row=>row.createdBy==='importer'&&row.recordedByName.includes('历史员工')))
      const expected=applied, expectedQuery=new URLSearchParams(apiRequests.filter(r=>r.path==='/api/daily-reports/analysis').at(-1).query)
      const partyLabel=kind==='sales'?'客户名称':'供应商名称';await page.getByLabel(partyLabel,{exact:true}).fill('未应用条件，不应影响导出')
      await choose('币种',['CNY'])
      const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前口径 Excel',exact:true}).click();const download=await downloaded,file=join(evidence,`${kind}-applied-filter-export.xlsx`);await download.saveAs(file)
      const exportQuery=new URLSearchParams(apiRequests.filter(r=>r.path.endsWith('/analysis/export.xlsx')).at(-1).query);assert.ok(sameEntries(exportQuery,expectedQuery),'export uses the applied API query, never unapplied draft')
      const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);const detail=wb.getWorksheet('日报明细'),summary=wb.getWorksheet('摘要');assert.equal(detail.rowCount,expected.reports.length+1)
      for(const [index,row]of expected.reports.entries()){assert.equal(detail.getRow(index+2).getCell(11).value,row.id);assert.equal(detail.getRow(index+2).getCell(8).value,row.amountCny);assert.equal(detail.getRow(index+2).getCell(9).value,row.recordedByName)}
      let amount;summary.eachRow(row=>{if(row.getCell(1).value==='amountCny')amount=row.getCell(2).value});assert.equal(amount,expected.summary.amountCny)
      await run(click('重置'));assert.equal(applied.summary.count,6);assert.deepEqual(applied.filters.createdBy,[]);assert.deepEqual(applied.filters.currency,[])
      await screenshot(`${kind}-desktop`)
      await page.getByRole('button',{name:'录入人筛选',exact:true}).click();assert.equal(await page.getByRole('group',{name:'录入人多选',exact:true}).getByRole('checkbox').count(),5);await screenshot(`${kind}-multi-select`);await page.getByRole('button',{name:'录入人筛选',exact:true}).press('Escape')
      for(const width of [768,390,360]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${kind} page fits ${width}`);if(width===390)await screenshot(`${kind}-mobile`)}
      assert.equal(await page.locator('.workspace-unsaved').count(),0)
      results.push({kind,defaultRows:6,multiSelectRows:3,exportRows:expected.reports.length,exportAmount:expected.summary.amountCny,presetButtonsApplyActualDateRanges:true,dateRollAcrossLeapMonth:true,dateRollAcrossYear:true,legacyRecorderSeparatedFromImporter:true,viewportWidths:[1550,768,390,360]})
    }
    assert.deepEqual(writes,[]);assert.deepEqual(pageErrors,[]);assert.ok(apiRequests.every(r=>!/(sync|refresh-mock)/.test(r.path)))
    assert.ok(apiRequests.filter(r=>r.path.includes('/analysis')).every(r=>!new URLSearchParams(r.query).has('source')))
    writeFileSync(join(evidence,'validation.json'),JSON.stringify({mode:'Real loopback API and browser; isolated artificial data only',results,pageErrors,writes,analysisRequests:apiRequests.filter(r=>r.path.includes('/analysis'))},null,2)+'\n')
  } finally { await browser?.close(); await vite?.close();if(service&&service.exitCode===null){service.kill('SIGTERM');await new Promise(r=>service.once('exit',r))};db?.close();if(temp)rmSync(temp,{recursive:true,force:true}) }
})
