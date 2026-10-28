import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('chart SVG preserves zero, signed amounts, single points, full data and unique gradient ids', async () => {
  const dir = mkdtempSync(join(tmpdir(),'daily-charts-'));
  try {
    const bundle = await build({ stdin:{ resolveDir:new URL('..',import.meta.url).pathname, loader:'tsx', contents:`
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Charts from './src/DailyAnalysisCharts';
const point = (amountCny,period='2026-10-21') => ({period,count:1,quantity:2,amountCny});
const render = (dailyTrend,kind='sales') => renderToStaticMarkup(<Charts kind={kind} dailyTrend={dailyTrend} monthlyTrend={dailyTrend} counterpartRank={dailyTrend.map((r,i)=>({...r,label:'客商完整名称'+i}))}/>);
const empty = render([]);
if ((empty.match(/当前筛选没有数据/g)||[]).length !== 6) throw Error('empty chart and tables must remain readable');
for (const rows of [[point(0)],[point(123.45)],[point(-10)],[point(-500),point(100,'2026-10-22')],[point(0),point(0,'2026-10-22')],[point(1e9)]]) {
  const html=render(rows);
  if (/NaN|Infinity/.test(html)) throw Error('invalid SVG coordinate');
  const circles=[...html.matchAll(/<circle /g)];
  if(circles.length!==rows.length*2) throw Error('fake or missing trend points');
  if((html.match(/<details/g)||[]).length!==3) throw Error('accessible data tables absent');
  for(const r of rows) if(!html.includes(r.amountCny.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}))) throw Error('full precision value missing');
}
const zero=render([point(0)]);
if(!/width="0" height="18"/.test(zero)) throw Error('zero bar must not fabricate positive amount');
const purchase=render([point(10)],'purchase');
if(!purchase.includes('供应商排名（前10）') || purchase.includes('负责人排名') || purchase.includes('业务类型占比')) throw Error('unsupported business field');
const twins=renderToStaticMarkup(<><Charts kind="sales" dailyTrend={[point(1)]} monthlyTrend={[]} counterpartRank={[]}/><Charts kind="sales" dailyTrend={[point(1)]} monthlyTrend={[]} counterpartRank={[]}/></>);
const ids=[...twins.matchAll(/<linearGradient id="([^"]+)"/g)].map(m=>m[1]);
if(ids.length!==4||new Set(ids).size!==4) throw Error('gradient ids collide across retained tabs');
console.log('chart edge cases passed');
`},bundle:true,platform:'node',format:'esm',write:false,jsx:'automatic',loader:{'.css':'empty'},banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},logLevel:'silent' });
    const path=join(dir,'charts.mjs');
    writeFileSync(path,bundle.outputFiles[0].text);
    const result=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr||result.stdout);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
