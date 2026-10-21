import {applyFeatureSchema} from '../lib/automation.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { parseStoreUrl,parseAppleHistory,normalizeApple,CollectionError } from '../lib/stores.js';
import { changes,saveSnapshot } from '../lib/history.js';
import { saveCompetitor,listCompetitors,appHistory,reorder } from '../lib/repository.js';
import { enqueue,workOnce,claim,scheduleDaily,drainQueue } from '../lib/queue.js';
import { importRecords } from '../lib/importer.js';
import { exportData,safeCell } from '../lib/export.js';
import { transaction } from '../lib/db.js';
import { checkOrigin,checkCron,allowedEmail,setSession } from '../lib/auth.js';
import { period,createHandler } from '../lib/http.js';
import { createServer } from 'node:http';
import { vercelHandler } from '../lib/vercel-handler.js';
import ExcelJS from 'exceljs';

const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
let database;
const payload=(version='1.0',notes='Original',extra={})=>({
  appName:'Test App',developerName:'Developer',iconUrl:null,version,sourceUpdatedAt:'2026-01-01',
  rating:4.2,ratingCount:10,reviewCount:null,downloadsText:null,latestNotes:notes,
  releases:[{version,releaseDate:'2026-01-01',notes}],historyComplete:true,quality:'complete',...extra
});
async function add(name='Competitor',both=false) {
  return saveCompetitor(database,owner,{name,service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123456',...(both?{play_store:'https://play.google.com/store/apps/details?id=com.example.app'}:{})});
}
before(async()=>{
  database=new PGlite();
  await database.exec(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));
  await applyFeatureSchema(database);
  process.env.COLLECTION_INTERVAL_SECONDS='0';
  process.env.APP_ORIGIN='http://localhost:4173';
});
after(()=>database.close());

test('store URLs are canonicalized and reject SSRF destinations',()=>{
  assert.equal(parseStoreUrl('https://apps.apple.com/kr/app/example/id123?x=1','app_store').external_id,'123');
  assert.equal(parseStoreUrl('https://play.google.com/store/apps/details?id=com.test.app&hl=en&gl=US','play_store').country,'us');
  for(const url of ['http://apps.apple.com/kr/app/id123','https://apps.apple.com.evil.com/kr/app/id123','https://localhost/api','https://user@apps.apple.com/kr/app/id123','https://apps.apple.com:9999/kr/app/id123'])assert.throws(()=>parseStoreUrl(url,'app_store'));
  assert.throws(()=>parseStoreUrl('https://play.google.com/store/apps/details?id=../../etc','play_store'));
});
test('Apple history recognizes structured records and distinguishes fallback',()=>{
  const history=parseAppleHistory('<script type="application/json">'+JSON.stringify({data:{versionHistory:[{versionDisplay:'2.1',releaseDate:'2026-01-01',releaseNotes:'Hi'}]}})+'</script>');
  assert.equal(history[0].notes,'Hi');
  assert.equal(parseAppleHistory('<html>unknown format</html>'),null);
  const apple=normalizeApple({trackName:'A',trackId:1,version:'1.0'},null);
  assert.equal(apple.quality,'partial');assert.equal(apple.historyComplete,false);
  assert.equal(changes(payload(),payload('1.0','Changed')).find(c=>c.field==='latestNotes').oldValue,'Original');
});
test('auth rejects unknown origin and cron bearer; secure cookies never expose tokens in JSON',()=>{
  assert.throws(()=>checkOrigin({headers:{origin:'https://evil.test'}}));
  checkOrigin({headers:{origin:'http://localhost:4173'}});
  process.env.CRON_SECRET='a-test-secret';
  assert.throws(()=>checkCron({headers:{authorization:'Bearer bad'}}));
  checkCron({headers:{authorization:'Bearer a-test-secret'}});
  process.env.ADMIN_EMAILS='Admin@example.com';
  assert.equal(allowedEmail('admin@example.com'),true);
  assert.equal(allowedEmail('stranger@example.com'),false);
  let cookies;
  const prev=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.com';
  setSession({setHeader:(_,v)=>{cookies=v;}},{access_token:'a',refresh_token:'b',expires_in:3600});
  process.env.APP_ORIGIN=prev;
  assert.ok(cookies.every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Strict')));
});
test('Korean date filters include the full selected day',()=>{
  assert.deepEqual(period(new URLSearchParams('from=2026-10-20&to=2026-10-20')),{from:'2026-10-19T15:00:00.000Z',to:'2026-10-20T14:59:59.999Z'});
  assert.throws(()=>period(new URLSearchParams('from=invalid')));
});
test('register, enqueue and collect; repeated worker delivery cannot duplicate snapshots',async()=>{
  const c=await add();
  const run=await enqueue(database,owner,{ids:[c.id]});
  await assert.rejects(()=>enqueue(database,owner,{ids:[c.id]}),/이미/);
  assert.equal(await workOnce(database,async()=>payload()),true);
  const rows=await listCompetitors(database,owner);
  const app=rows.find(x=>x.id===c.id).apps[0];
  assert.equal(app.snapshot.version,'1.0');
  assert.equal((await database.query('SELECT status FROM collection_runs WHERE id=$1',[run.id])).rows[0].status,'succeeded');
  assert.equal(await transaction(database,tx=>saveSnapshot(tx,app,run.id,payload())),false);
  await assert.rejects(()=>database.query('DELETE FROM store_snapshots WHERE store_app_id=$1',[app.id]),/append-only/);
  await assert.rejects(()=>appHistory(database,other,app.id,'1970-01-01','2100-01-01'),/찾을 수/);
});
test('notes revisions, missing history and reappearance preserve every observation',async()=>{
  const c=await add('History');
  for(const result of [payload(),payload('1.0','Edited'),payload('2.0'),payload('2.0','New',{historyComplete:false,releases:[{version:'3.0',releaseDate:'2026-01-01',notes:'partial'}],quality:'partial'}),payload('1.0','Edited')]) {
    await enqueue(database,owner,{ids:[c.id]});await workOnce(database,async()=>result);
  }
  const app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  const history=await appHistory(database,owner,app.id,'1970-01-01','2100-01-01');
  assert.equal(history.snapshots.length,1);
  const old=history.releases.find(r=>r.version==='1.0');
  assert.equal(old.revisions.length,2);assert.equal(old.is_present_in_source,true);assert.equal(old.missing_since,null);
  assert.ok(history.releases.some(r=>r.version==='2.0'&&!r.is_present_in_source));
  assert.ok(history.changes.length>0);
});
test('partial parsing never marks a previously present release missing',async()=>{
  const c=await add('Partial');
  await enqueue(database,owner,{ids:[c.id]});await workOnce(database,async()=>payload());
  await enqueue(database,owner,{ids:[c.id]});await workOnce(database,async()=>payload('2.0','New',{historyComplete:false,quality:'partial'}));
  const app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  const old=(await database.query("SELECT is_present_in_source,missing_since FROM release_history WHERE store_app_id=$1 AND version='1.0'",[app.id])).rows[0];
  assert.equal(old.is_present_in_source,true);assert.equal(old.missing_since,null);
});
test('one platform failure does not overwrite last good data or roll back another platform',async()=>{
  const c=await add('Two stores',true);
  const run=await enqueue(database,owner,{ids:[c.id]});
  const collector=async app=>{if(app.platform==='play_store')throw new CollectionError('Bad parser');return payload();};
  await workOnce(database,collector);await workOnce(database,collector);
  assert.equal((await database.query('SELECT status FROM collection_runs WHERE id=$1',[run.id])).rows[0].status,'partial');
  const app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps.find(a=>a.platform==='app_store');
  await enqueue(database,owner,{ids:[c.id]});
  await workOnce(database,async()=>{throw new CollectionError('Failed');});
  await workOnce(database,async()=>{throw new CollectionError('Failed');});
  const current=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps.find(a=>a.platform==='app_store');
  assert.equal(current.snapshot.id,app.snapshot.id);
});
test('transient failures retry, expired leases recover, and last-attempt crashes finalize',async()=>{
  const c=await add('Recovery');
  const run=await enqueue(database,owner,{ids:[c.id]});
  await workOnce(database,async()=>{throw new CollectionError('temporary','network',true);});
  let item=(await database.query('SELECT * FROM collection_items WHERE collection_run_id=$1',[run.id])).rows[0];
  assert.equal(item.status,'queued');assert.equal(item.attempts,1);
  await database.query("UPDATE collection_items SET available_at=now()-interval '1 minute' WHERE id=$1",[item.id]);
  item=await claim(database);assert.equal(item.attempts,2);
  await database.query("UPDATE collection_items SET lease_until=now()-interval '1 minute' WHERE id=$1",[item.id]);
  await workOnce(database,async()=>payload());
  assert.equal((await database.query('SELECT status FROM collection_runs WHERE id=$1',[run.id])).rows[0].status,'succeeded');
  const r2=await enqueue(database,owner,{ids:[c.id]});
  const crashed=await claim(database);
  await database.query("UPDATE collection_items SET attempts=4,lease_until=now()-interval '1 minute' WHERE id=$1",[crashed.id]);
  await claim(database);
  assert.equal((await database.query('SELECT status FROM collection_runs WHERE id=$1',[r2.id])).rows[0].status,'failed');
});
test('changing store identity separates history and archive retains old snapshots',async()=>{
  const c=await add('Old identity');
  await enqueue(database,owner,{ids:[c.id]});await workOnce(database,async()=>payload());
  const before=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  await saveCompetitor(database,owner,{name:'New identity',service_scope:'global',app_store:'https://apps.apple.com/us/app/id999999'},c.id);
  const after=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  assert.notEqual(before.id,after.id);
  assert.equal((await appHistory(database,owner,before.id,'1970-01-01','2100-01-01')).snapshots.length,1);
  await database.query('UPDATE competitors SET archived_at=now() WHERE id=$1',[c.id]);
  assert.ok(!(await listCompetitors(database,owner)).some(x=>x.id===c.id));
  assert.ok((await listCompetitors(database,owner,true)).some(x=>x.id===c.id));
});
test('lease token prevents a recovered stale worker from overwriting newer results',async()=>{
  const c=await add('Fenced worker');
  await enqueue(database,owner,{ids:[c.id]});
  let resume,started;
  const ready=new Promise(r=>{started=r;});
  const gate=new Promise(r=>{resume=r;});
  const stale=workOnce(database,async()=>{started();await gate;return payload('stale');});
  await ready;
  await database.query("UPDATE collection_items SET lease_until=now()-interval '1 minute' WHERE status='running'");
  await workOnce(database,async()=>payload('fresh'));
  resume();await stale;
  const app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  assert.equal(app.snapshot.version,'fresh');
  assert.equal((await database.query('SELECT count(*) FROM store_snapshots WHERE store_app_id=$1',[app.id])).rows[0].count,1);
});
test('Play Store replaces current notes while keeping old unknown-version releases',async()=>{
  const c=await saveCompetitor(database,owner,{name:'Play only',service_scope:'domestic',play_store:'https://play.google.com/store/apps/details?id=com.example.play'});
  for(const notes of ['First notes','Second notes']) {
    await enqueue(database,owner,{ids:[c.id]});
    await workOnce(database,async()=>payload(null,notes,{historyComplete:false,releases:[{version:null,releaseDate:'2026-01-01',notes}]}));
  }
  const app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
  const history=await appHistory(database,owner,app.id,'1970-01-01','2100-01-01');
  assert.equal(history.releases.length,2);
  assert.equal(history.releases.filter(r=>r.is_present_in_source).length,1);
  assert.ok(history.releases.every(r=>r.version===null));
});
test('legacy JSON import is repeatable and preserves old note revisions and latest ordering',async()=>{
  const record={recordId:'legacy-1',competitorName:'Imported',serviceScope:'domestic',refreshedAt:'2026-02-01T00:00:00Z',appStore:{trackId:'55555',name:'Imported app',version:'2.0',versions:[{version:'1.0',releaseDate:'2026-01-01',notes:'new text'}]}};
  const first=await importRecords(database,owner,[record],'file1',{current:true});
  assert.equal(first.insertedSnapshots,1);
  assert.equal((await importRecords(database,owner,[record],'file1',{current:true})).insertedSnapshots,0);
  const old=structuredClone(record);old.refreshedAt='2026-01-01T00:00:00Z';old.appStore.versions[0].notes='old text';
  await importRecords(database,owner,[old],'file2');
  const imported=(await listCompetitors(database,owner)).find(c=>c.name==='Imported');
  assert.equal(imported.sort_order,0);
  const history=await appHistory(database,owner,imported.apps[0].id,'1970-01-01','2100-01-01');
  assert.equal(history.snapshots.length,2);assert.equal(history.releases[0].revisions.length,2);
  assert.equal(new Date(history.releases[0].first_seen_at).toISOString(),old.refreshedAt.replace('Z','.000Z'));
  await assert.rejects(()=>importRecords(database,owner,[{...record,refreshedAt:null}],'bad'),/refreshedAt/);
});
test('JSON, HTML, CSV, Markdown and XLSX exports work without formula or HTML execution',async()=>{
  assert.equal(safeCell('=1+1'),"'=1+1");
  const c=await add('<script>alert(1)</script>');
  await enqueue(database,owner,{ids:[c.id]});await workOnce(database,async()=>payload('3','=WEBSERVICE("bad")'));
  const options={mode:'latest',from:'1970-01-01',to:'2100-01-01'};
  for(const format of ['json','html','csv','markdown','xlsx']) {
    const result=await exportData(database,owner,{...options,format});
    assert.ok(result.body.length>0);
    if(format==='html')assert.ok(!result.body.includes('<script>alert(1)</script>'));
    if(format==='csv')assert.ok(result.body.includes("'=WEBSERVICE"));
    if(format==='xlsx'){const book=new ExcelJS.Workbook();await book.xlsx.load(result.body);assert.equal(book.worksheets.length,2);assert.ok(book.worksheets[1].rowCount>1);}
  }
  for(const mode of ['releases','snapshots','changes'])assert.ok((await exportData(database,owner,{...options,mode,format:'json'})).body.includes('Asia/Seoul'));
});
test('reordering enforces full owned set and scheduled collection is once per Korean date',async()=>{
  const ids=(await listCompetitors(database,owner)).map(c=>c.id).reverse();
  await reorder(database,owner,ids);
  assert.deepEqual((await listCompetitors(database,owner)).map(c=>c.id),ids);
  await assert.rejects(()=>reorder(database,other,ids));
  const first=await scheduleDaily(database,new Date('2026-10-20T01:00:00Z'));
  const again=await scheduleDaily(database,new Date('2026-10-20T02:00:00Z'));
  assert.equal(first[0].id,again[0].id);
});
test('HTTP routes enforce auth/origin, reject invalid identifiers, and return real queries',async()=>{
  const handler=createHandler({database:()=>database,authenticate:async req=>{
    if(req.headers.authorization!=='test-admin')throw Object.assign(new Error('Login required'),{status:401});
    return {id:owner,email:'admin@example.com'};
  }});
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/competitors')).status,401);
    const headers={authorization:'test-admin','content-type':'application/json'};
    assert.equal((await fetch(base+'/api/collections',{method:'POST',headers,body:'{}'})).status,403);
    const response=await fetch(base+'/api/competitors',{headers});assert.equal(response.status,200);assert.ok((await response.json()).competitors.length>0);
    assert.equal((await fetch(base+'/api/store-apps/bad/history',{headers})).status,400);
    assert.equal((await fetch(base+'/api/competitors',{method:'POST',headers:{...headers,origin:'http://localhost:4173'},body:'null'})).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('Vercel rewrite reaches nested login and protected history routes, preserving query filters',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.rewrites[0].source,'/api/:path*');
  assert.equal(config.rewrites[0].destination,'/api/handler?__route=:path*');
  let loginCalls=0;
  const handler=vercelHandler(createHandler({
    database:()=>database,
    authenticate:async()=>{throw Object.assign(new Error('로그인이 필요합니다.'),{status:401});},
    login:async(email,password)=>{
      loginCalls++;
      assert.equal(email,'admin@example.com');
      assert.equal(password,'fixture-password');
      return {user:{id:owner,email},session:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}};
    }
  }));
  const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const response=await fetch(base+'/api/handler?__route=auth%2Flogin',{
      method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:4173'},
      body:JSON.stringify({email:'admin@example.com',password:'fixture-password'})
    });
    assert.equal(response.status,200);
    assert.equal((await response.json()).user.id,owner);
    assert.equal(loginCalls,1);
    assert.equal(response.headers.getSetCookie().length,2);
    const me=await fetch(base+'/api/handler?__route=auth/me');
    assert.equal(me.status,401);
    assert.equal((await me.json()).error,'로그인이 필요합니다.');
    const original=await fetch(base+'/api/auth/me?__route=auth/me');
    assert.equal(original.status,401);
  } finally {await new Promise(r=>server.close(r));}
  let observed;
  const router=vercelHandler(req=>{observed=req.url;});
  router({url:'/api/handler?__route=store-apps%2Fabc%2Fhistory&from=2026-01-01&offset=200'},{});
  assert.equal(observed,'/api/store-apps/abc/history?from=2026-01-01&offset=200');
});


test('serverless collection resumes existing jobs, scopes ownership, and cron drains without a worker',async()=>{
  const previousHour=process.env.SCHEDULE_HOUR_KST;
  process.env.SCHEDULE_HOUR_KST='0';
  const isolated=new PGlite();
  await isolated.exec(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));
  await applyFeatureSchema(isolated);
  const make=async(id,name)=>{
    const c=await saveCompetitor(isolated,id,{name,service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123456'});
    await enqueue(isolated,id,{ids:[c.id]});return c;
  };
  await make(other,'Other owner');
  const mine=await make(owner,'My queued job');
  let called=0;
  const server=createServer(createHandler({database:()=>isolated,authenticate:async req=>{
    if(req.headers.authorization!=='admin')throw Object.assign(new Error('Login required'),{status:401});
    return {id:owner};
  },collector:async()=>{called++;return payload();},chartCollector:async()=>Array.from({length:100},(_,i)=>String(i+1))}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={authorization:'admin',origin:process.env.APP_ORIGIN};
  try {
    assert.equal((await fetch(base+'/api/collections/process',{method:'POST',headers:{origin:process.env.APP_ORIGIN}})).status,401);
    assert.equal((await fetch(base+'/api/collections/process',{method:'POST',headers:{authorization:'admin',origin:'https://evil.test'}})).status,403);
    const response=await fetch(base+'/api/collections/process',{method:'POST',headers});
    assert.equal(response.status,200);assert.equal((await response.json()).processed,true);
    assert.equal(called,1);
    assert.equal((await isolated.query('SELECT status FROM collection_runs WHERE owner_id=$1',[other])).rows[0].status,'queued');
    assert.equal((await fetch(base+'/api/collections/process',{method:'POST',headers}).then(r=>r.json())).processed,false);
    // A timed-out invocation is recovered through the same owner-scoped endpoint.
    await enqueue(isolated,owner,{ids:[mine.id]});
    await claim(isolated,owner);
    await isolated.query("UPDATE collection_items SET lease_until=now()-interval '1 second' WHERE status='running'");
    assert.equal((await fetch(base+'/api/collections/process',{method:'POST',headers}).then(r=>r.json())).processed,true);
    assert.equal((await isolated.query('SELECT count(*)::int n FROM store_snapshots')).rows[0].n,1);
    await isolated.query('UPDATE competitors SET auto_collect=false WHERE owner_id=$1',[other]);
    assert.equal((await fetch(base+'/api/cron')).status,401);
    const cron=await fetch(base+'/api/cron',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}});
    assert.equal(cron.status,200);assert.ok((await cron.json()).processed>=1);
    assert.equal((await isolated.query("SELECT count(*)::int n FROM collection_items WHERE status IN ('queued','running')")).rows[0].n,0);
    // A second cron invocation on the same day does not create duplicate runs.
    const count=(await isolated.query('SELECT count(*)::int n FROM collection_runs')).rows[0].n;
    await fetch(base+'/api/cron',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}});
    assert.equal((await isolated.query('SELECT count(*)::int n FROM collection_runs')).rows[0].n,count);
  } finally {
    await new Promise(r=>server.close(r));await isolated.close();
    if(previousHour===undefined)delete process.env.SCHEDULE_HOUR_KST;else process.env.SCHEDULE_HOUR_KST=previousHour;
  }
});

test('bounded cron stops launching work at its budget and leaves remaining jobs resumable',async()=>{
  const isolated=new PGlite();
  try {
    await isolated.exec(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));
  await applyFeatureSchema(isolated);
    const c=await saveCompetitor(isolated,owner,{name:'Budget',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123456',play_store:'https://play.google.com/store/apps/details?id=com.example.app'});
    await enqueue(isolated,owner,{ids:[c.id]});
    let clock=0;
    const first=await drainQueue(isolated,{now:()=>clock,budgetMs:100,collector:async()=>{clock=101;return payload();}});
    assert.equal(first.processed,1);
    assert.equal((await isolated.query("SELECT count(*)::int n FROM collection_items WHERE status='queued'")).rows[0].n,1);
    assert.equal((await drainQueue(isolated,{collector:async()=>payload()})).processed,1);
  } finally {await isolated.close();}
});

test('daily snapshots use Korean day, preserve newer values and keep replay receipts',async()=>{
 const c=await add('Daily latest'),app=(await listCompetitors(database,owner)).find(x=>x.id===c.id).apps[0];
 const runs=[];
 for(const [at,rating,version] of [['2026-10-20T14:59:59Z',3,'1'],['2026-10-20T15:00:00Z',4,'2'],['2026-10-21T01:00:00Z',5,'3'],['2026-10-20T20:00:00Z',2,'old']]){
  const run=(await database.query("INSERT INTO collection_runs(owner_id,trigger_type,status) VALUES($1,'manual','succeeded') RETURNING id",[owner])).rows[0];runs.push(run.id);
  await transaction(database,tx=>saveSnapshot(tx,app,run.id,payload(version,version,{rating}),at));
 }
 const h=await appHistory(database,owner,app.id,'1970-01-01','2100-01-01');
 assert.equal(h.snapshots.length,2);assert.equal(Number(h.snapshots[0].rating),5);assert.equal(Number(h.snapshots[1].rating),3);
 assert.equal(h.releases.length,4);
 assert.equal(await transaction(database,tx=>saveSnapshot(tx,app,runs[1],payload('replay'))),false);
 assert.equal((await database.query('SELECT count(*)::int n FROM snapshot_receipts WHERE store_app_id=$1',[app.id])).rows[0].n,4);
});

test('daily migration merges old rows while preserving release and change references',async()=>{
 const legacy=new PGlite();
 try{
  await legacy.exec(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));
  const c=await saveCompetitor(legacy,owner,{name:'Legacy daily',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123456'}),app=(await listCompetitors(legacy,owner)).find(x=>x.id===c.id).apps[0];
  const ids=[];
  for(const [at,rating] of [['2026-10-20T16:00:00Z',3],['2026-10-21T01:00:00Z',5]]){
   const run=(await legacy.query("INSERT INTO collection_runs(owner_id,trigger_type,status) VALUES($1,'manual','succeeded') RETURNING id",[owner])).rows[0];
   ids.push((await legacy.query("INSERT INTO store_snapshots(store_app_id,collection_run_id,collected_at,rating,normalized_payload,content_hash) VALUES($1,$2,$3,$4,'{}','test') RETURNING id",[app.id,run.id,at,rating])).rows[0].id);
  }
  await legacy.query("INSERT INTO release_history(store_app_id,release_key,version,first_seen_at,last_seen_at,first_snapshot_id,last_snapshot_id) VALUES($1,'key','1',now(),now(),$2,$3)",[app.id,...ids]);
  await legacy.query("INSERT INTO change_events(store_app_id,snapshot_id,occurred_at,field) VALUES($1,$2,now(),'rating')",[app.id,ids[0]]);
  await applyFeatureSchema(legacy);await applyFeatureSchema(legacy);
  assert.equal((await legacy.query('SELECT count(*)::int n FROM store_snapshots')).rows[0].n,1);
  assert.equal((await legacy.query('SELECT rating FROM store_snapshots')).rows[0].rating,'5');
  assert.equal((await legacy.query('SELECT first_snapshot_id FROM release_history')).rows[0].first_snapshot_id,ids[1]);
  assert.equal((await legacy.query('SELECT snapshot_id FROM change_events')).rows[0].snapshot_id,ids[1]);
  assert.equal((await legacy.query('SELECT count(*)::int n FROM snapshot_receipts')).rows[0].n,2);
 }finally{await legacy.close();}
});
