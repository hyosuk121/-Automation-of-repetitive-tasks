import report from './fixtures/report-20260709.json' with { type:'json' };
import {transaction} from './db.js';
import {saveSnapshot} from './history.js';
import {fail} from './repository.js';
export {report};
export async function reportPreview(database,owner){
 const apps=(await database.query(`SELECT a.id,a.platform,a.external_id,a.country,c.name FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE c.owner_id=$1 AND a.is_active AND c.archived_at IS NULL`,[owner])).rows;
 const done=(await database.query('SELECT report_key,store_app_id FROM report_imports WHERE owner_id=$1',[owner])).rows;
 const normalize=s=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 return {rows:report.filter(r=>r.platform==='app_store').map(r=>{const matches=apps.filter(a=>a.platform===r.platform&&normalize(a.name)===normalize(r.name));return {key:r.key,name:r.name,platform:r.platform,at:r.at,releases:r.payload.releases.length,suggestedId:matches.length===1?matches[0].id:null,importedId:done.find(d=>d.report_key===r.key)?.store_app_id||null};}),apps};
}
export async function importReport(database,owner,mappings){
 if(!Array.isArray(mappings)||!mappings.length||mappings.length>24)fail('가져올 항목을 선택해 주세요.');
 if(new Set(mappings.map(m=>m.key)).size!==mappings.length||new Set(mappings.map(m=>m.appId)).size!==mappings.length)fail('같은 항목 또는 앱을 중복 연결할 수 없습니다.');
 return transaction(database,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
  let imported=0,skipped=0;
  for(const m of mappings){
   const row=report.find(r=>r.key===m.key);if(!row||typeof m.appId!=='string'||!/^[\da-f-]{36}$/i.test(m.appId))fail('가져오기 연결을 확인해 주세요.');
   if(row.platform==='play_store')fail('Play Store는 과거 자료 가져오기를 지원하지 않습니다. 현재 수집부터 누적합니다.');
   const app=(await client.query('SELECT a.* FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE a.id=$1 AND c.owner_id=$2 AND a.platform=$3',[m.appId,owner,row.platform])).rows[0];
   if(!app)fail('연결할 앱을 찾을 수 없습니다.',404);
   const inserted=(await client.query('INSERT INTO report_imports(owner_id,report_key,store_app_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING store_app_id',[owner,row.key,app.id])).rows;
   if(!inserted.length){const previous=(await client.query('SELECT store_app_id FROM report_imports WHERE owner_id=$1 AND report_key=$2',[owner,row.key])).rows[0];if(previous.store_app_id!==app.id)fail('이미 다른 앱에 가져온 항목입니다.');skipped++;continue;}
   const run=(await client.query(`INSERT INTO collection_runs(owner_id,trigger_type,status,created_at,started_at,finished_at,total_count,success_count) VALUES($1,'migration','succeeded',$2,$2,$2,1,1) RETURNING id`,[owner,row.at])).rows[0];
   await saveSnapshot(client,app,run.id,row.payload,row.at);imported++;
  }
  return {imported,skipped};
 });
}
