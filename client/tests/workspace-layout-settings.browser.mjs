import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

// ISOLATED FIXTURE ONLY: loopback Vite, all API calls fulfilled locally, all non-loopback network aborted.
test('workspace layout and Flowable settings remain local across desktop and narrow viewports', async () => {
  const server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const evidence = new URL('../../qa-evidence/workspace-layout-settings/', import.meta.url).pathname;
  mkdirSync(evidence, { recursive: true });
  const user = { id:'fixture-user', email:'local@example.test', displayName:'隔离预览员', role:'admin', disabled:false, isPlatformAdmin:false, createdAt:'2026-10-21', tenantId:'fixture-tenant', tenantName:'隔离预览', organizationId:'fixture-org', organizationName:'本地组织', accountId:'fixture-account', accountName:'测试账套', membershipId:'fixture-member' };
  const workspace = Object.fromEntries(['tasks','projects','kpiRules','reviews','materials','boms','salesBomSnapshots','documents','projectPhases','projectMilestones','projectEvents','projectEventReviews','projectReports','projectTemplates'].map(k => [k, []]));
  let flowableConfigured = false, testMode = 'success';
  const requests = [], prohibitedWrites = [], layoutSamples = [];
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000} });
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', async route => {
      const req=route.request(), url=new URL(req.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push({path:url.pathname,method:req.method()});
      if (req.method() !== 'GET') {
        // Test button endpoint is explicitly mocked; configuration save/deploy/connector writes are forbidden.
        if (/\/api\/integrations\/settings\/flowable\/test$/.test(url.pathname) && req.method()==='POST') return route.fulfill({json:{status:testMode==='success'?{ok:true,connected:true,message:'本地模拟连接成功'}:{ok:false,message:'本地模拟连接失败'}}});
        prohibitedWrites.push({path:url.pathname,method:req.method()});
        return route.fulfill({status:400,json:{message:'隔离测试禁止配置保存、部署及实际连接器写入'}});
      }
      let data={};
      if(url.pathname==='/api/auth/status') data={setupRequired:false};
      else if(url.pathname==='/api/auth/me') data={user,scopes:[user]};
      else if(url.pathname==='/api/workspace') data=workspace;
      else if(url.pathname==='/api/material-closure/source') data={snapshot:null,rows:[],notice:'隔离只读夹具；未连接 ERP'};
      else if(url.pathname==='/api/daily-reports/analysis') data={filters:{type:url.searchParams.get('type'),q:'',from:'',to:'',partyName:'',createdBy:[],currency:[]},reports:[],summary:{count:0,quantity:0,amountCny:0,cnyAmount:0,usdAmount:0},dailyTrend:[],monthlyTrend:[],counterpartRank:[],options:{people:[]},mockEnabled:true,notice:'隔离数据',amountBasis:'人工测试夹具'};
      else if(url.pathname==='/api/integrations/settings') data={providers:{flowable:{provider:'flowable',configured:flowableConfigured,missingFields:flowableConfigured?[]:['baseUrl','username','password'],config:flowableConfigured?{baseUrl:'http://flowable.example.test/flowable-rest/service',username:'fixture-user'}:{},secrets:{password:flowableConfigured},revision:1,updatedAt:null,source:'isolated-fixture'},k3cloud:{provider:'k3cloud',configured:false,missingFields:[],config:{},secrets:{},revision:0,updatedAt:null,source:'isolated-fixture'},dingtalk:{provider:'dingtalk',configured:false,missingFields:[],config:{},secrets:{},revision:0,updatedAt:null,source:'isolated-fixture'}}};
      else if(url.pathname==='/api/k3cloud/sync-status') data={schedule:{enabled:false,intervalHours:1,timezone:'UTC',ready:false,readinessMessage:'本地夹具',schedulerState:'disabled'}};
      else if(url.pathname==='/api/k3cloud/form-catalog') data={entries:[],note:'隔离夹具'};
      else if(url.pathname==='/api/k3cloud/master-data') data={records:{customer:[],supplier:[],material:[],department:[]}};
      else if(url.pathname==='/api/daily-reports/summary') data={access:{sales:true,purchase:true,canManage:true,canWrite:true},sales:{daily:{count:0,quantity:0,amountCny:0},reconciliation:{}},purchase:{daily:{count:0,quantity:0,amountCny:0},reconciliation:{}},isMock:true,liveErpConnected:false,reportDate:'2026-10-21',notice:'隔离本地夹具；无真实业务数据或 ERP 连接。'};
      else if(url.pathname==='/api/daily-reports') data={reports:[],mockEnabled:true};
      else if(url.pathname==='/api/daily-reports/snapshots') data={snapshots:[],deliveries:[],corrections:[]};
      else if(url.pathname==='/api/daily-reports/k3-lines') data={rows:[]};
      else if(url.pathname==='/api/daily-reporting/party-options') data={parties:[],masterDataConfigured:true};
      else if(url.pathname==='/api/daily-reporting/exchange-rates') data={rates:[]};
      return route.fulfill({json:data});
    });
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    const shot=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true,animations:'disabled'});};
    const assertLayout=async width=>{
      // Sidebar has a 250ms transform transition at responsive breakpoints; measure its settled geometry.
      await page.waitForTimeout(320);
      const layout=await page.evaluate(()=>{
        const area=document.querySelector('.content-area'),main=document.querySelector('.app-main'),side=document.querySelector('.sidebar'),bar=document.querySelector('.topbar');
        if(!area||!main||!bar)return null;
        const a=area.getBoundingClientRect(),m=main.getBoundingClientRect(),s=side?.getBoundingClientRect(),b=bar.getBoundingClientRect(),f=document.querySelector('.workspace-frame')?.getBoundingClientRect();
        return {frameLeft:f?.left,frameRight:f?.right,frameTop:f?.top,left:a.left, right:a.right, top:a.top, width:a.width, mainLeft:m.left,mainRight:m.right,sideRight:s?.right ?? null,barBottom:b.bottom,scrollWidth:document.documentElement.scrollWidth,innerWidth};
      });
      assert.ok(layout, `application shell selectors present at ${page.url()} (${await page.locator('body').innerText().catch(()=> 'body unavailable')}); pageErrors=${JSON.stringify(errors)}`);
      layoutSamples.push({page:new URL(page.url()).searchParams.get('page'),viewportWidth:width,...layout});
      assert.ok(Math.abs(layout.frameLeft-layout.left)<2&&Math.abs(layout.frameRight-layout.right)<2&&Math.abs(layout.frameTop-layout.top)<2,'workspace frame fills content area without outer gutters');
      assert.ok(Math.abs(layout.left-layout.mainLeft)<2,`content starts at app-main edge: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.right-layout.mainRight)<2,`content spans app-main: ${JSON.stringify(layout)}`);
      assert.ok(Math.abs(layout.top-layout.barBottom)<2,`content follows topbar: ${JSON.stringify(layout)}`);
      if(width>=1440){assert.ok(Math.abs(layout.left-layout.sideRight)<2,`main begins at sidebar edge: ${JSON.stringify(layout)}`);assert.ok(Math.abs(layout.width-(layout.mainRight-layout.mainLeft))<2);}
      else assert.ok(layout.scrollWidth<=width,`document horizontal overflow at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(await page.locator('.workspace-tabs').count() || await page.getByRole('navigation').count(),'navigation remains accessible');
    };
    // Existing dashboard auth/navigation conventions; route via app page query.
    for(const [name,route] of [['daily-sales','daily-sales'],['daily-purchase','daily-purchase'],['materials','materials'],['settings','settings']]){
      await page.goto(`${origin}/?page=${route}`);
      await page.locator('.app-main').waitFor();
      if(route==='materials')await page.locator('.material-closure-columns').waitFor();
      if(route.startsWith('daily-'))await page.locator('.dba-filters').waitFor();
      if(route==='settings'){await page.locator('.connector-nav').waitFor();await page.getByRole('navigation',{name:'连接器',exact:true}).getByRole('button',{name:/Flowable/}).click();await page.getByRole('region',{name:'Flowable 审批引擎配置',exact:true}).waitFor();}
      for(const width of [1920,1440,900,390,360]){
        await page.setViewportSize({width,height:1000}); await assertLayout(width);
        if(width===1920) await shot(`${name}-desktop`);
        if(width===390) await shot(`${name}-390`);
      }
      assert.ok(await page.getByRole('navigation').count()>0 || await page.locator('.workspace-tabs').count()>0,`${name} navigation/tab access`);
    }
    await page.setViewportSize({width:1440,height:1000}); await page.goto(`${origin}/?page=settings`);
    await page.getByRole('navigation',{name:'连接器',exact:true}).getByRole('button',{name:/Flowable/}).click();
    await page.getByRole('region',{name:'Flowable 审批引擎配置',exact:true}).waitFor();
    await page.getByText(/缺少|必填|未配置/).first().waitFor().catch(()=>{});
    await shot('flowable-missing');
    const flowableTest=page.getByRole('button',{name:/测试连接/}).first();
    assert.equal(await flowableTest.count(),1);assert.equal(await flowableTest.isDisabled(),true,'missing required settings disable test action');
    await page.getByText(/测试连接禁用：缺少必填字段/).waitFor();
    flowableConfigured=true; await page.reload(); await page.getByRole('navigation',{name:'连接器',exact:true}).getByRole('button',{name:/Flowable/}).click();
    await page.getByRole('region',{name:'Flowable 审批引擎配置',exact:true}).waitFor();
    await shot('flowable-configured');
    assert.equal(await page.getByText('已设置；当前不会回显',{exact:true}).count(),1);assert.equal(await page.getByRole('region',{name:'Flowable 审批引擎配置',exact:true}).locator('input[type=password]').inputValue(),'');
    const testButton=page.getByRole('button',{name:/测试连接/}).first();
    assert.equal(await testButton.count(),1);assert.equal(await testButton.isEnabled(),true,'saved configured connection can be tested');
    {
      await testButton.click(); await page.getByText('本地模拟连接成功',{exact:true}).waitFor();await shot('flowable-test-success');
      testMode='fail'; await testButton.click(); await page.locator('.connector-test-result',{hasText:'本地模拟连接失败'}).waitFor();
    }
    await page.getByRole('textbox',{name:'REST API Base URL',exact:true}).fill('https://changed.example.test/flowable-rest/process-api');
    assert.equal(await testButton.isDisabled(),true,'unsaved URL must not test saved connection');
    await page.getByText(/测试连接禁用：当前草稿尚未保存/).waitFor();await shot('flowable-unsaved');
    assert.equal((await page.getByRole('textbox',{name:'REST API Base URL',exact:true}).getAttribute('placeholder')).includes('/flowable-rest/service'),true);
    await page.getByText(/本项目内置 Spring Boot Flowable 服务的路径.*当前隔离标准 REST 容器使用 \/flowable-rest\/service/).waitFor();
    assert.equal((await page.locator('body').innerText()).includes('process-api'),true);
    assert.equal((await page.locator('body').innerText()).includes('8090'),false);
    await page.getByRole('textbox',{name:'REST API Base URL',exact:true}).fill('https://changed.example.test/flowable-rest/service');
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='测试连接');return button&&!button.disabled});
    assert.equal(await page.getByRole('textbox',{name:'REST API Base URL',exact:true}).inputValue(),'http://flowable.example.test/flowable-rest/service');
    assert.equal(requests.filter(request=>request.path==='/api/integrations/settings/flowable/test').length,2,'only two explicit simulated connection tests; missing or dirty states never submit');
    writeFileSync(`${evidence}/validation.json`,JSON.stringify({layoutSamples,viewports:[1920,1440,900,390,360],pages:['daily-sales','daily-purchase','materials','settings'],requests,prohibitedWrites,errors,flowable:{missingFieldsDisable:true,savedSecretEnables:true,dirtyDraftDisables:true,refreshRestoresSavedState:true,successAndFailureMocked:true},mode:'All API/network isolated fixtures; no real Flowable/ERP tested'},null,2)+'\n');
    assert.deepEqual(prohibitedWrites,[],'no save/deploy/real connector writes');
    assert.equal(requests.some(r=>r.path.includes('8090')||r.path.includes('process-api')||r.path.includes('staging')),false,'no unsafe Flowable endpoint sent');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await server.close(); }
});
