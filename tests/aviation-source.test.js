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
 await assert.rejects(inspectAviation({env:{INCHEON_API_SERVICE_KEY:'test'},fetcher:async url=>new Response(xml(item(),2,Number(url.searchParams.get('pageNo')),1))}),/중복/);
});
test('missing key, empty results, and network errors do not expose secrets',async()=>{
 await assert.rejects(inspectAviation({env:{}}),/INCHEON_API_SERVICE_KEY/);
 const result=await inspectAviation({env:{INCHEON_API_SERVICE_KEY:'secret'},fetcher:async()=>new Response(xml('',0))});assert.equal(result.status,'empty');assert.equal(result.totals.totalEff,null);
 await assert.rejects(inspectAviation({env:{INCHEON_API_SERVICE_KEY:'secret'},fetcher:async()=>{throw new Error('URL?serviceKey=secret');}}),e=>!e.message.includes('secret')&&e.code==='aviation_connection_error');
});
