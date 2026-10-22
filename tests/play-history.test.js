import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {applyFeatureSchema} from '../lib/automation.js';
import {saveSnapshot} from '../lib/history.js';
import {normalizePlay} from '../lib/stores.js';
import {transaction} from '../lib/db.js';
import {saveCompetitor} from '../lib/repository.js';
import {reportPreview,importReport,report} from '../lib/report-import.js';
const owner='00000000-0000-4000-8000-000000000001';

test('Play dated update without notes is recorded and later description stays on the same release',async()=>{
 const d=new PGlite();try{
  await d.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(d);
  const c=await saveCompetitor(d,owner,{name:'Play',service_scope:'domestic',play_store:'https://play.google.com/store/apps/details?id=com.example.app'});
  const app=(await d.query('SELECT * FROM store_apps WHERE competitor_id=$1',[c.id])).rows[0];
  const p=normalizePlay({title:'Play',appId:'com.example.app',version:'2.1.0',updated:Date.parse('2026-10-19')});
  assert.equal(p.quality,'complete');assert.equal(p.releases.length,1);assert.equal(p.latestNotes,null);
  async function save(payload,at){const run=(await d.query("INSERT INTO collection_runs(owner_id,trigger_type) VALUES($1,'manual') RETURNING id",[owner])).rows[0];return transaction(d,x=>saveSnapshot(x,app,run.id,payload,at));}
  await save(p,'2026-10-22T00:00:00Z');
  await save({...p,releases:[{...p.releases[0],notes:'Added description'}]},'2026-10-23T00:00:00Z');
  assert.equal((await d.query('SELECT * FROM release_history')).rows.length,1);
  assert.equal((await d.query('SELECT * FROM release_note_revisions')).rows.length,2);
  await save({...p,version:'2.1.1',releases:[{...p.releases[0],version:'2.1.1'}]},'2026-10-24T00:00:00Z');
  assert.equal((await d.query('SELECT * FROM release_history')).rows.length,2);
  assert.ok((await reportPreview(d,owner)).rows.every(r=>r.platform==='app_store'));
  await assert.rejects(importReport(d,owner,[{key:report.find(r=>r.platform==='play_store').key,appId:app.id}]),/Play Store/);
 }finally{await d.close();}
});

test('Play repair excludes imported July observations, preserves Apple, and backfills missing notes',async()=>{
 const d=new PGlite();try{
  await d.exec(await readFile('supabase/migrations/20261020000000_initial.sql','utf8'));await applyFeatureSchema(d);
  const c=await saveCompetitor(d,owner,{name:'Both',service_scope:'domestic',app_store:'https://apps.apple.com/kr/app/id123',play_store:'https://play.google.com/store/apps/details?id=com.example.app'});
  const apps=(await d.query('SELECT * FROM store_apps WHERE competitor_id=$1',[c.id])).rows;
  for(const a of apps){
   const run=(await d.query("INSERT INTO collection_runs(owner_id,trigger_type) VALUES($1,'migration') RETURNING id",[owner])).rows[0];
   const s=(await d.query(`INSERT INTO store_snapshots(store_app_id,collection_run_id,collected_at,source_updated_at,normalized_payload,content_hash) VALUES($1,$2,'2026-07-09T05:05:00Z','2026-06-25','{}','fixture') RETURNING id`,[a.id,run.id])).rows[0];
   const r=(await d.query(`INSERT INTO release_history(store_app_id,release_key,release_date,first_seen_at,last_seen_at,first_snapshot_id,last_snapshot_id) VALUES($1,'old','2026-06-25','2026-07-09','2026-07-09',$2,$2) RETURNING id`,[a.id,s.id])).rows[0];
   await d.query("INSERT INTO release_note_revisions(release_history_id,notes,notes_hash,first_seen_at,last_seen_at) VALUES($1,'old','old','2026-07-09','2026-07-09')",[r.id]);
  }
  const play=apps.find(a=>a.platform==='play_store');
  const run=(await d.query("INSERT INTO collection_runs(owner_id,trigger_type) VALUES($1,'manual') RETURNING id",[owner])).rows[0];
  await d.query(`INSERT INTO store_snapshots(store_app_id,collection_run_id,collected_at,source_updated_at,version,normalized_payload,content_hash) VALUES($1,$2,'2026-10-22','2026-10-19','2.1.0','{}','live')`,[play.id,run.id]);
  const sql=await readFile('supabase/migrations/20261024000000_play_observed_history.sql','utf8');
  await transaction(d,x=>x.exec(sql));
  const rows=(await d.query('SELECT * FROM release_history WHERE store_app_id=$1',[play.id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].version,'2.1.0');assert.equal(rows[0].release_date,'2026-10-19');
  assert.equal((await d.query('SELECT notes FROM release_note_revisions WHERE release_history_id=$1',[rows[0].id])).rows[0].notes,'');
  assert.equal((await d.query('SELECT * FROM store_snapshots')).rows.length,2);
  assert.equal((await d.query('SELECT * FROM release_history WHERE store_app_id=$1',[apps.find(a=>a.platform==='app_store').id])).rows.length,1);
  await transaction(d,x=>x.exec(sql));
  assert.equal((await d.query('SELECT * FROM release_history')).rows.length,2);
 }finally{await d.close();}
});
