import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {applyFeatureSchema,automationStatus,automationTick} from '../lib/automation.js';
import {report,reportPreview,importReport} from '../lib/report-import.js';
import {saveCompetitor,listCompetitors,appHistory} from '../lib/repository.js';
import {enqueue,workOnce} from '../lib/queue.js';
import {scheduleRankings,workRanking,rankingHistory,koreanDay,validateChart} from '../lib/rankings.js';
import {createHandler} from '../lib/http.js';
import {createServer} from 'node:http';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
async function database(){const d=new PGlite();await d.exec(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));await applyFeatureSchema(d);return d;}
const current={appName:'현재 앱 이름',developerName:'현재 개발사',iconUrl:'https://example.com/current.png',version:'1.10.6',sourceUpdatedAt:'2026-06-24',rating:4.9,ratingCount:7000,reviewCount:null,downloadsText:null,latestNotes:'현재 수정된 설명',releases:[{version:'1.10.6',releaseDate:'2026-06-24T00:00:00Z',notes:'현재 수정된 설명'}],historyComplete:true,quality:'complete'};
const ids=Array.from({length:100},(_,i)=>String(i+1));
test('July report imports exactly once, retains newer values and combines notes across equivalent dates',async()=>{
 const d=await database();try{
  assert.equal(report.length,24);assert.equal(report.filter(r=>r.platform==='app_store').reduce((n,r)=>n+r.payload.releases.length,0),249);
  const c=await saveCompetitor(d,owner,{name:report[0].name,service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123'});
  await enqueue(d,owner,{ids:[c.id]});await workOnce(d,async()=>current);
  const preview=await reportPreview(d,owner),row=preview.rows[0],appId=row.suggestedId;
  assert.ok(appId);assert.equal((await reportPreview(d,other)).apps.length,0);
  await assert.rejects(importReport(d,other,[{key:row.key,appId}]),e=>e.status===404);
  assert.deepEqual(await importReport(d,owner,[{key:row.key,appId}]),{imported:1,skipped:0});
  assert.deepEqual(await importReport(d,owner,[{key:row.key,appId}]),{imported:0,skipped:1});
  const latest=(await listCompetitors(d,owner))[0].apps[0].snapshot;
  assert.equal(latest.rating_count,7000);assert.equal(latest.latest_notes,'현재 수정된 설명');
  const hist=await appHistory(d,owner,appId,'2000-01-01','2100-01-01');
  assert.equal(hist.releases.length,25);
  const version=hist.releases.filter(r=>r.version==='1.10.6');assert.equal(version.length,1);assert.equal(version[0].revisions.length,2);
  assert.equal(version[0].revisions[0].notes,'현재 수정된 설명');
  assert.ok(hist.releases.some(r=>r.version==='1.10.5'));
  assert.equal(hist.snapshots.length,2);
 }finally{await d.close();}
});
test('chart collection validates 100 unique entries and never records missing data as outside',async()=>{
 assert.throws(()=>validateChart(ids.slice(0,99)));assert.throws(()=>validateChart(Array(100).fill('same')));
 const d=await database();try{
  await saveCompetitor(d,owner,{name:'In chart',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id1'});
  await saveCompetitor(d,owner,{name:'Outside chart',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id999'});
  const today=koreanDay();
  // Explicit day setup makes tests independent of whether the current time is before 09:00.
  await d.query("INSERT INTO ranking_runs(platform,country,chart_day) VALUES('app_store','kr',$1)",[today]);
  assert.equal(await workRanking(d,async()=>ids.slice(0,50)),true);
  let history=await rankingHistory(d,owner,{from:today,to:today,country:'kr'});
  assert.ok(history.rows.every(r=>r.status==='failed'&&r.rank===null));
  await d.query("UPDATE ranking_runs SET available_at=now()-interval '1 second'");
  assert.equal(await workRanking(d,async()=>ids),true);
  history=await rankingHistory(d,owner,{from:today,to:today,country:'kr'});
  assert.equal(history.rows.find(r=>r.name==='In chart').rank,1);
  assert.equal(history.rows.find(r=>r.name==='Outside chart').status,'outside');
  assert.equal((await rankingHistory(d,other,{from:today,to:today,country:'kr'})).rows.length,0);
  assert.equal(await workRanking(d,async()=>{throw Error('must not recollect success');}),false);
  assert.equal((await d.query('SELECT count(*)::int n FROM ranking_entries')).rows[0].n,100);
 }finally{await d.close();}
});
test('daily schedule uses KST, retries expired claims and never backfills old ranking dates with current ranks',async()=>{
 const d=await database();try{
  await saveCompetitor(d,owner,{name:'Scheduled',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id1'});
  await scheduleRankings(d,new Date('2026-10-20T23:59:00Z'));
  assert.equal((await d.query('SELECT count(*)::int n FROM ranking_runs')).rows[0].n,0);
  await scheduleRankings(d,new Date('2026-10-21T00:00:00Z'));await scheduleRankings(d,new Date('2026-10-21T00:05:00Z'));
  assert.equal((await d.query('SELECT count(*)::int n FROM ranking_runs')).rows[0].n,1);
  await workRanking(d,async()=>ids,new Date('2026-10-22T01:00:00Z'));
  assert.equal((await d.query('SELECT status FROM ranking_runs')).rows[0].status,'failed');
  assert.equal((await d.query('SELECT count(*)::int n FROM ranking_entries')).rows[0].n,0);
  const today=koreanDay();
  await d.query("DELETE FROM ranking_runs");
  await d.query("INSERT INTO ranking_runs(platform,country,chart_day,status,attempts,lease_until) VALUES('app_store','kr',$1,'running',1,now()-interval '1 minute')",[today]);
  assert.equal(await workRanking(d,async()=>ids),true);
  assert.equal((await d.query('SELECT attempts FROM ranking_runs')).rows[0].attempts,2);
 }finally{await d.close();}
});
test('authenticated setup status/import/ranking routes and server-only cron POST work without a browser',async()=>{
 const d=await database();
 process.env.APP_ORIGIN='http://localhost:4173';process.env.CRON_SECRET='fixture-only-secret';
 const c=await saveCompetitor(d,owner,{name:'Server collection',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id1'});
 await enqueue(d,owner,{ids:[c.id]});
 const server=createServer(createHandler({database:()=>d,authenticate:async req=>{if(req.headers.authorization!=='admin')throw Object.assign(new Error('login'),{status:401});return{id:owner};},collector:async()=>current,chartCollector:async()=>ids}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/imports/july')).status,401);
  assert.equal((await fetch(base+'/api/automation/schema',{method:'POST',headers:{authorization:'admin',origin:'https://evil.test'}})).status,403);
  assert.equal((await fetch(base+'/api/automation',{headers:{authorization:'admin'}})).status,200);
  assert.equal((await fetch(base+'/api/cron',{method:'POST'})).status,401);
  const tick=await fetch(base+'/api/cron',{method:'POST',headers:{authorization:'Bearer fixture-only-secret'}});
  assert.equal(tick.status,200);assert.ok((await tick.json()).processed>=1);
  assert.equal((await automationStatus(d)).lastTick.status,'succeeded');
  assert.equal((await listCompetitors(d,owner))[0].apps[0].snapshot.version,'1.10.6');
  const ranks=await fetch(base+'/api/rankings?days=7',{headers:{authorization:'admin'}});
  assert.equal(ranks.status,200);assert.equal((await ranks.json()).rows.length,7);
 }finally{await new Promise(r=>server.close(r));await d.close();}
});

test('scheduler SQL dispatches authenticated server requests and stores only a private function call in cron',async()=>{
 const d=new PGlite();try{
  // Supabase-only extensions are represented by SQL-compatible test doubles.
  // This verifies the dispatch SQL, not availability of hosted extensions.
  await d.exec(`CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
   INSERT INTO vault.decrypted_secrets VALUES('automation_hub_origin','https://example.test'),('automation_hub_cron_secret','test-secret');
   CREATE SCHEMA net; CREATE TABLE net.requests(url text,headers jsonb,body jsonb,timeout_milliseconds integer);
   CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.requests VALUES(url,headers,body,timeout_milliseconds); SELECT 1::bigint; $$;
   CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text,schedule text,command text);
   CREATE FUNCTION cron.schedule(jobname text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES(jobname,schedule,command); SELECT 1::bigint; $$;`);
  await d.exec(await readFile(new URL('../supabase/scheduler.sql',import.meta.url),'utf8'));
  await d.query('SELECT automation_private.dispatch()');
  const request=(await d.query('SELECT * FROM net.requests')).rows[0];
  assert.equal(request.url,'https://example.test/api/cron');assert.equal(request.headers.Authorization,'Bearer test-secret');
  assert.equal(request.timeout_milliseconds,280000);
  const job=(await d.query('SELECT * FROM cron.job')).rows[0];assert.equal(job.schedule,'*/5 * * * *');assert.equal(job.command,'SELECT automation_private.dispatch();');
  assert.ok(!job.command.includes('test-secret'));
  await d.exec('CREATE ROLE anonymous_test; SET ROLE anonymous_test');
  await assert.rejects(d.query('SELECT automation_private.dispatch()'),e=>e.code==='42501');
 }finally{await d.close();}
});
