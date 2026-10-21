import {readFile} from 'node:fs/promises';
// Caller owns the transaction. Recheck after the lock for concurrent deployments.
export async function ensureSnapshotSchema(client){
 const applied=async()=>!!(await client.query("SELECT 1 FROM schema_migrations WHERE version='20261022000000'")).rows.length;
 if(await applied())return;
 await client.query("SELECT pg_advisory_xact_lock(hashtext('automation_schema_migration'))");
 if(await applied())return;
 const sql=await readFile(new URL('../supabase/migrations/20261022000000_daily_snapshots.sql',import.meta.url),'utf8');
 if(client.exec)await client.exec(sql);else await client.query(sql);
}
