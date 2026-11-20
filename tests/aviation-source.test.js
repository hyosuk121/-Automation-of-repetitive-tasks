import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectAviation,parseAviationPage} from '../lib/aviation-source.js';
const item=(regular=0)=>`<item><yearMonth>202609</yearMonth><airlineIataCode>OZ</airlineIataCode><airlineIcaoCode>AAR</airlineIcaoCode><airportCode>NRT</airportCode><nationCode>1</nationCode><nationName>일본</nationName><routeCode>10</routeCode><departuresOrArrivals>출발</departuresOrArrivals><paxCode>여객</paxCode><regularCode>${regular?'부정기':'정기'}</regularCode><flightCount>2</flightCount><totalEff>100</totalEff><totalNff>2</totalNff><totalTrf>10</totalTrf></item>`;
const xml=(rows,total=1,page=1,size=100)=>`<response><header><resultCode>00</resultCode></header><body><items>${rows}</items><numOfRows>${size}</numOfRows><pageNo>${page}</pageNo><totalCount>${total}</totalCount></body></response>`;
test('official XML labels, absent metrics, and invalid scope are handled without inventing totals',()=>{
 const page=parseAviationPage(xml(item()),{page:1,regular:0});assert.equal(page.rows[0].totalEff,100);
 assert.equal(parseAviationPage(xml(item().replace('<totalNff>2</totalNff>','')),{page:1,regular:0}).rows[0].totalNff,null);
 assert.throws(()=>parseAviationPage(xml(item().replace('출발','도착')),{page:1,regular:0}));
 assert.throws(()=>parseAviationPage(xml(item().replace('>100<','>-1<')),{page:1,regular:0}));
 assert.throws(()=>parseAviationPage('Unauthorized',{page:1,regular:0}),/인증키/);
});
test('inspection uses HTTPS, encoded server key, both departure groups; no invented historical parameters',async()=>{
 const calls=[];
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'a%2Bb%3D'},fetcher:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');assert.equal(url.protocol,'https:');assert.equal(url.searchParams.get('serviceKey'),'a+b=');assert.equal(url.searchParams.get('departuresOrArrivals'),'D');assert.equal(url.searchParams.has('yearMonth'),false);
  return new Response(xml(item(Number(url.searchParams.get('regularCode')))));
 }});
 assert.equal(calls.length,2);assert.equal(result.rowCount,2);assert.deepEqual(result.months,['202609']);assert.equal(result.totals.totalEff,200);assert.equal(result.totals.totalTrf,20);assert.equal(result.dailySupported,false);
 assert.equal(JSON.stringify(result).includes('a+b='),false);
});
test('pagination completeness and duplicate detection fail closed',async()=>{
 let calls=0;
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'test'},fetcher:async url=>{
  calls++;const p=Number(url.searchParams.get('pageNo')),r=Number(url.searchParams.get('regularCode'));
  return new Response(xml(item(r).replace('NRT',p===1?'NRT':'KIX'),2,p,1));
 }});
 assert.equal(calls,4);assert.equal(result.rowCount,4);
 await assert.rejects(inspectAviation({env:{INCHEON_API_SERVICE_KEY:'test'},fetcher:async()=>new Response(xml('',1))}),/누락/);
 const repeated=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'test'},fetcher:async url=>new Response(xml(item(Number(url.searchParams.get('regularCode'))),2,Number(url.searchParams.get('pageNo')),1))});
 assert.equal(repeated.status,'review_required');assert.equal(repeated.duplicates.identical,2);assert.equal(repeated.totals.totalEff,null);
 assert.equal(repeated.duplicates.samples[0].first.page,1);assert.equal(repeated.duplicates.samples[0].next.page,2);
});
test('missing key, empty results, and network errors do not expose secrets',async()=>{
 await assert.rejects(inspectAviation({env:{}}),/INCHEON_API_SERVICE_KEY/);
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'secret'},fetcher:async()=>new Response(xml('',0))});assert.equal(result.status,'empty');assert.equal(result.totals.totalEff,null);
 await assert.rejects(inspectAviation({env:{INCHEON_API_SERVICE_KEY:'secret'},fetcher:async()=>{throw new Error('URL?serviceKey=secret');}}),e=>!e.message.includes('secret')&&e.code==='aviation_connection_error');
});

test('same identity with different statistics is diagnostic, never summed or discarded',async()=>{
 const data=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'secret'},fetcher:async url=>{
  const r=Number(url.searchParams.get('regularCode'));
  return new Response(xml(item(r)+item(r).replace('<totalEff>100</totalEff>','<totalEff>200</totalEff>'),2));
 }});
 assert.equal(data.status,'review_required');assert.equal(data.rowCount,4);assert.equal(data.duplicates.different,2);
 assert.deepEqual(data.duplicates.samples[0].differingFields,['totalEff']);
 assert.ok(Object.values(data.totals).every(v=>v===null));assert.equal(JSON.stringify(data).includes('secret'),false);
});

test('missing identifiers and invalid numbers produce bounded diagnostics across all pages',async()=>{
 let calls=0;
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'private-key'},fetcher:async url=>{
  calls++;const r=Number(url.searchParams.get('regularCode')),p=Number(url.searchParams.get('pageNo'));
  const bad=item(r).replace('<yearMonth>202609</yearMonth>','<yearMonth/>').replace('<airportCode>NRT</airportCode>','<airportCode/>').replace('<totalEff>100</totalEff>','<totalEff>not-a-number</totalEff>');
  return new Response(xml(p===1?bad:item(r),2,p,1));
 }});
 assert.equal(calls,4);assert.equal(result.rowCount,4);assert.equal(result.invalidRows.count,2);
 assert.equal(result.invalidRows.fields.yearMonth,2);assert.equal(result.invalidRows.fields.airportCode,2);assert.equal(result.invalidRows.fields.totalEff,2);
 assert.equal(result.invalidRows.samples[0].page,1);assert.equal(result.invalidRows.samples[0].row,1);
 assert.equal(result.invalidRows.samples[0].values.totalEff,'not-a-number');
 assert.deepEqual(result.months,['202609']);assert.equal(result.status,'review_required');
 assert.ok(Object.values(result.totals).every(n=>n===null));assert.equal(JSON.stringify(result).includes('private-key'),false);
});
test('invalid records are not counted as duplicate identities and samples are capped',async()=>{
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'key'},fetcher:async url=>{
  const row=item(Number(url.searchParams.get('regularCode'))).replace('<nationName>일본</nationName>','<nationName/>').replace('출발','도착');
  return new Response(xml(row.repeat(10),10));
 }});
 assert.equal(result.invalidRows.count,20);assert.equal(result.invalidRows.samples.length,5);
 assert.equal(result.invalidRows.fields.departuresOrArrivals,20);assert.deepEqual(result.countries,[]);
 assert.equal(result.duplicates.identical,0);assert.equal(result.duplicates.different,0);
});
