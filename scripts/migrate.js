import { readFile } from 'node:fs/promises';
import { db,transaction } from '../lib/db.js';
const database=db();
try {
  await transaction(database,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('automation_schema_migration'))");
    await client.query(await readFile(new URL('../supabase/migrations/20261020000000_initial.sql',import.meta.url),'utf8'));
    await client.query("INSERT INTO schema_migrations(version) VALUES('001') ON CONFLICT DO NOTHING");
  });
  console.log('Schema migration 001 complete.');
} finally {await database.end();}
