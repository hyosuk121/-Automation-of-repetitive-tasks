import {ensureSnapshotSchema} from './snapshot-schema.js';
import {readFile} from 'node:fs/promises';
import {transaction} from './db.js';
import {scheduleDaily,drainQueue} from './queue.js';
import {scheduleRankings,workRanking} from './rankings.js';

export async function applyFeatureSchema(database){
 await transaction(database,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtext('automation_schema_migration'))");
  const sql=await readFile(new URL('../supabase/migrations/20261021000000_automation_rankings.sql',import.meta.url),'utf8');
  if(c.exec)await c.exec(sql);else await c.query(sql);
  await c.query("INSERT INTO schema_migrations(version) VALUES('20261021000000') ON CONFLICT DO NOTHING");
  await ensureSnapshotSchema(c);
 });
}
export async function automationStatus(database){
 const ready=!!(await database.query("SELECT to_regclass('public.ranking_runs') AS table_name")).rows[0].table_name;
 if(!ready)return {schemaReady:false,schedulerInstalled:false,lastTick:null};
 const installed=!!(await database.query("SELECT to_regprocedure('automation_private.dispatch()') AS name")).rows[0].name;
 let scheduled=false;
 if(installed)scheduled=!!(await database.query("SELECT 1 FROM cron.job WHERE jobname='automation-hub-pump' AND active")).rows[0];
 return {schemaReady:true,schedulerInstalled:scheduled,lastTick:(await database.query('SELECT started_at,finished_at,status,error_message FROM automation_ticks ORDER BY started_at DESC LIMIT 1')).rows[0]||null};
}
export async function installScheduler(database,env=process.env){
 const url=new URL(env.APP_ORIGIN);
 if(url.protocol!=='https:'||!env.CRON_SECRET)throw Object.assign(new Error('HTTPS APP_ORIGIN과 CRON_SECRET이 필요합니다.'),{status:400});
 await applyFeatureSchema(database);
 await transaction(database,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtext('automation_scheduler_install'))");
  await c.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
  await c.query('CREATE EXTENSION IF NOT EXISTS pg_net');
  await c.query('CREATE EXTENSION IF NOT EXISTS supabase_vault');
  // Secrets are bound parameters, kept in Vault, never embedded in cron.job SQL.
  for(const [name,value] of [['automation_hub_origin',url.origin],['automation_hub_cron_secret',env.CRON_SECRET]]){
   const existing=(await c.query('SELECT id FROM vault.secrets WHERE name=$1',[name])).rows[0];
   if(existing)await c.query('SELECT vault.update_secret($1,$2,$3)',[existing.id,value,name]);
   else await c.query('SELECT vault.create_secret($1,$2)',[value,name]);
  }
  await c.query(await readFile(new URL('../supabase/scheduler.sql',import.meta.url),'utf8'));
 });
 return automationStatus(database);
}
export async function automationTick(database,{collector,chartCollector,now=Date.now}={}){
 await transaction(database,ensureSnapshotSchema);
 const deadline=now()+240000;
 const tick=(await database.query('INSERT INTO automation_ticks DEFAULT VALUES RETURNING id')).rows[0];
 try{
  const runs=await scheduleDaily(database);
  await scheduleRankings(database);
  let charts=0;
  // A few chart calls per invocation; remaining regions are picked up on the next tick.
  while(charts<4&&now()<deadline-60000&&await workRanking(database,chartCollector))charts++;
  const result=await drainQueue(database,{collector,budgetMs:Math.max(0,deadline-now()),now});
  await database.query("UPDATE automation_ticks SET status='succeeded',finished_at=now() WHERE id=$1",[tick.id]);
  // Only operational invocation logs expire; historical observations never do.
  await database.query("DELETE FROM automation_ticks WHERE started_at<now()-interval '30 days'");
  return {runs,charts,...result};
 }catch(e){
  await database.query("UPDATE automation_ticks SET status='failed',finished_at=now(),error_message='자동 수집 실행 오류. 서버 로그를 확인해 주세요.' WHERE id=$1",[tick.id]);throw e;
 }
}
