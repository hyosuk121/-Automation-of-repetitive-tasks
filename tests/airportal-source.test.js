import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchPortal} from '../lib/airportal-source.js';
import {windowTotal} from '../web/aviation-portal.js';
const samples=JSON.parse(await readFile(new URL('./fixtures/airportal-observed-20261123.json',import.meta.url),'utf8'));
const sample=rows=>async()=>new Response(JSON.stringify({resultCode:'200',content:rows}),{headers:{'content-type':'application/json'}});
test('public Incheon route samples keep monthly paid and daily departures separate',async()=>{
 const monthly=await fetchPortal('monthly','202609',{fetcher:sample(samples.monthlyRoute)});
 assert.equal(monthly.total,2725422);assert.equal(monthly.rows.length,164);assert.equal(monthly.unmapped,0);assert.equal(monthly.status,'observed');
 assert.equal(monthly.countries.reduce((sum,c)=>sum+c.value,0),monthly.total);
 const historical=await fetchPortal('monthly','202101',{fetcher:sample(samples.monthlyRouteHistorical)});
 assert.equal(historical.total,94634);assert.equal(historical.unmapped,0);
 const daily=await fetchPortal('daily','20261112',{fetcher:sample(samples.dailyIncheon)});
 assert.equal(daily.rows.length,424);assert.equal(daily.unmapped,0);assert.equal(daily.countries.reduce((sum,c)=>sum+c.value,0),106135);
 assert.notEqual(daily.metric,monthly.metric);
});
test('recent comparison requires every published day and preserves zero',()=>{
 const rows=Array.from({length:14},(_,i)=>{const d=new Date('2026-11-01T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);return {period:d.toISOString().slice(0,10).replaceAll('-',''),status:'observed',countries:i===0?[]:[{code:'JP',value:10}]};});
 assert.equal(windowTotal(rows,'JP','20261107',7),60);
 assert.equal(windowTotal(rows,'JP','20261114',7),70);
 assert.equal(windowTotal(rows.slice(1),'JP','20261107',7),null);
});
test('source rejects malformed scope and never treats unavailable data as zero',async()=>{
 await assert.rejects(fetchPortal('daily','20261342',{fetcher:sample([])}),e=>e.status===400);
 const unavailable=await fetchPortal('daily','20261113',{fetcher:sample([])});
 assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.total,null);
 await assert.rejects(fetchPortal('daily','20261112',{fetcher:sample([{ap1:'김포 (RKSS)',ap_ROUTE:'RJFK',dep_PERSON:'3'}])}),e=>e.code==='airportal_scope');
});
