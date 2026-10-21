import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHandler} from '../lib/http.js';
import {saveCompetitor,listCompetitors} from '../lib/repository.js';
import {applyFeatureSchema} from '../lib/automation.js';
import {saveSnapshot} from '../lib/history.js';
import {transaction} from '../lib/db.js';
import {publicOwner} from '../lib/public-read.js';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
test('public APIs isolate the published owner, strip internal data, cache only successful reads and reject writes',async()=>{
 const db=new PGlite();let server;
 try{
  await db.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(db);
  const a=await saveCompetitor(db,owner,{name:'Public app',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id12345'});
  await saveCompetitor(db,other,{name:'Private app',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id54321'});
  const app=(await listCompetitors(db,owner))[0].apps[0],privateApp=(await listCompetitors(db,other))[0].apps[0];
  const run=(await db.query("INSERT INTO collection_runs(owner_id,trigger_type,status) VALUES($1,'manual','succeeded') RETURNING id",[owner])).rows[0];
  await transaction(db,c=>saveSnapshot(c,app,run.id,{version:'1',rating:4,quality:'complete',internal:'not public',releases:[{version:'1',releaseDate:'2026-10-01',notes:'Release notes'}]}));
  const handler=createHandler({database:()=>db,resolvePublicOwner:async()=>owner,authenticate:async()=>{throw Object.assign(new Error('Login required'),{status:401});}});
  server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=base;
  const response=await fetch(base+'/api/public/competitors?owner_id='+other+'&archived=true');
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/s-maxage=30/);
  const data=await response.json();assert.deepEqual(data.competitors.map(c=>c.name),['Public app']);
  assert.equal(data.competitors[0].owner_id,undefined);assert.equal(data.competitors[0].apps[0].snapshot.normalized_payload,undefined);
  const history=await (await fetch(base+`/api/public/store-apps/${app.id}/history`)).json();
  assert.equal(history.releases[0].revisions[0].notes,'Release notes');assert.equal(history.app.last_error_message,undefined);assert.equal(history.snapshots[0].collection_run_id,undefined);
  assert.equal((await fetch(base+`/api/public/store-apps/${privateApp.id}/history`)).status,404);
  assert.equal((await fetch(base+'/api/public/rankings?days=7')).status,200);
  for(const [path,method] of [['/api/public/competitors','POST'],['/api/public/competitors','DELETE'],['/api/public/imports/july','POST']])assert.equal((await fetch(base+path,{method})).status,405);
  for(const [path,method] of [['/api/competitors','POST'],[`/api/competitors/${a.id}`,'PATCH'],[`/api/competitors/${a.id}`,'DELETE'],['/api/collections','POST'],['/api/automation/install','POST'],['/api/export','GET']]){
   const result=await fetch(base+path,{method,headers:{origin:base}});assert.equal(result.status,401);assert.equal(result.headers.get('cache-control'),'no-store');
  }
  await db.query('UPDATE competitors SET archived_at=now() WHERE id=$1',[a.id]);
  assert.equal((await (await fetch(base+'/api/public/competitors')).json()).competitors.length,0);
  assert.equal((await fetch(base+`/api/public/store-apps/${app.id}/history`)).status,404);
 }finally{if(server)await new Promise(r=>server.close(r));await db.close();}
});
test('default public owner resolves only the first configured administrator',async()=>{
 const old=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS='First@example.com,second@example.com';
 try{assert.equal(await publicOwner({query:async(sql,params)=>{assert.deepEqual(params,['first@example.com']);assert.match(sql,/auth.users/);return {rows:[{id:owner}]};}}),owner);}finally{if(old===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=old;}
});
