import {readFile} from 'node:fs/promises';
// Caller owns the transaction. Apply each migration once, serialized across deployments.
export async function ensureSnapshotSchema(client){
 const versions=['20261022000000','20261023000000'];
 const existing=async()=>new Set((await client.query("SELECT version FROM schema_migrations WHERE version=ANY($1::text[])",[versions])).rows.map(r=>r.version));
 let applied=await existing();if(versions.every(v=>applied.has(v)))return;
 await client.query("SELECT pg_advisory_xact_lock(hashtext('automation_schema_migration'))");
 applied=await existing();
 for(const [version,file] of [['20261022000000','daily_snapshots'],['20261023000000','remove_july_ratings']]){
  if(applied.has(version))continue;
  const sql=await readFile(new URL(`../supabase/migrations/${version}_${file}.sql`,import.meta.url),'utf8');
  if(client.exec)await client.exec(sql);else await client.query(sql);
 }
}
