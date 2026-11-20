import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {applyFeatureSchema} from '../lib/automation.js';
import {captureAviation,listAviationArchives,getAviationArchive} from '../lib/aviation-archive.js';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const diagnostic=JSON.parse(await readFile(new URL('./fixtures/aviation-diagnostics-20261120.json',import.meta.url),'utf8'));
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const samples=[...diagnostic.invalidRows.samples.map(s=>s.values),...diagnostic.duplicates.samples.flatMap(s=>[s.first.values,s.next.values])];
function fetcher({reverse=false,changed=false,fail=false}={}){return async url=>{
 if(fail)return new Response('Unavailable',{status:503});
 const regular=Number(url.searchParams.get('regularCode'));
 let rows=samples.filter(r=>String(r.regularCode)===(regular?'부정기':'정기')||r.regularCode===regular).map(r=>({...r}));
 if(reverse)rows.reverse();if(changed)rows[0].totalEff='999';
 return new Response(`<response><header><resultCode>00</resultCode></header><body><items>${rows.map(r=>'<item>'+Object.entries(r).map(([k,v])=>`<${k}>${escape(v)}</${k}>`).join('')+'</item>').join('')}</items><pageNo>1</pageNo><numOfRows>100</numOfRows><totalCount>${rows.length}</totalCount></body></response>`);
};}
test('real diagnostic cases are preserved without inferred countries or duplicate merging; captures are idempotent and scoped',async()=>{
 const d=new PGlite();try{
  await d.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(d);
  const options={env:{INCHEON_API_SERVICE_KEY:'not-for-storage'},fetcher:fetcher()};
  const first=await captureAviation(d,owner,options);
  assert.equal(first.rowCount,5);assert.equal(first.status,'review_required');assert.equal(first.invalidRows.count,1);assert.equal(first.duplicates.different,2);assert.equal(first.sourceRows,undefined);
  assert.ok(Object.values(first.totals).every(n=>n===null));
  const record=await getAviationArchive(d,owner,first.archive.id);
  assert.equal(record.source_rows.length,5);assert.equal(record.source_rows.find(r=>r.airportCode==='YCU').nationName,'');
  assert.equal(record.source_rows.filter(r=>r.airportCode==='URC'&&r.flightCount==='0').length,2);
  assert.equal(JSON.stringify(record).includes('not-for-storage'),false);
  const same=await captureAviation(d,owner,{...options,fetcher:fetcher({reverse:true})});
  assert.equal(same.archive.id,first.archive.id);assert.equal(same.archive.check_count,2);
  const changed=await captureAviation(d,owner,{...options,fetcher:fetcher({changed:true})});
  assert.notEqual(changed.archive.id,first.archive.id);assert.equal((await listAviationArchives(d,owner)).length,2);
  assert.equal((await getAviationArchive(d,owner,first.archive.id)).source_rows.length,5);
  assert.deepEqual(await listAviationArchives(d,other),[]);
  await assert.rejects(getAviationArchive(d,other,first.archive.id),e=>e.status===404);
  await assert.rejects(captureAviation(d,owner,{...options,fetcher:fetcher({fail:true})}));
  assert.equal((await listAviationArchives(d,owner)).length,2);
 }finally{await d.close();}
});

test('daily archive checks are KST scoped, lease protected, retry bounded, and failure isolated',async()=>{
 const {collectAviationDaily}=await import('../lib/aviation-schedule.js');
 const d=new PGlite();try{
  await d.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(d);
  const saved=await captureAviation(d,owner,{env:{INCHEON_API_SERVICE_KEY:'test'},fetcher:fetcher()});
  let calls=0;
  const options={env:{INCHEON_API_SERVICE_KEY:'test'},resolveOwner:async()=>owner,capture:async()=>{calls++;return saved;},at:new Date('2026-11-20T00:00:00Z')};
  assert.equal((await collectAviationDaily(d,{...options,at:new Date('2026-11-19T23:59:00Z')})).status,'not_due');
  assert.equal((await collectAviationDaily(d,options)).status,'succeeded');
  await collectAviationDaily(d,options);assert.equal(calls,1);
  const failed={...options,at:new Date('2026-11-21T00:00:00Z'),capture:async()=>{calls++;throw new Error('secret');}};
  assert.equal((await collectAviationDaily(d,failed)).status,'failed');
  await collectAviationDaily(d,failed);assert.equal(calls,2);
  for(const time of ['00:16','00:32','00:48'])await collectAviationDaily(d,{...failed,at:new Date('2026-11-21T'+time+':00Z')});
  assert.equal(calls,4);
  const check=(await d.query("SELECT * FROM aviation_daily_checks WHERE check_day='2026-11-21'")).rows[0];
  assert.equal(check.attempts,3);assert.equal(check.error_code,'collection_failed');
  await d.query("INSERT INTO aviation_daily_checks(owner_id,check_day,status,lease_token,retry_after) VALUES($1,'2026-11-22','running',gen_random_uuid(),'2026-11-22T00:03:00Z')",[owner]);
  await collectAviationDaily(d,{...options,at:new Date('2026-11-22T00:01:00Z')});assert.equal(calls,4);
  await collectAviationDaily(d,{...options,at:new Date('2026-11-22T00:04:00Z')});assert.equal(calls,5);
 }finally{await d.close();}
});
