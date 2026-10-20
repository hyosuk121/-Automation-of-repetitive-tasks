import { readFile } from 'node:fs/promises';
import { db } from '../lib/db.js';
import { hash } from '../lib/history.js';
import { importRecords } from '../lib/importer.js';
const [owner,...files]=process.argv.slice(2);
if(!/^[0-9a-f-]{36}$/i.test(owner || '') || !files.length) {
  console.error('Usage: npm run import:json -- <Supabase user UUID> <current apps.json> [backup.json ...]');
  process.exit(1);
}
const database=db();
try {
  // Establish current membership and ordering first; backups add older observations.
  for(const [index,file]of files.entries()) {
    const raw=await readFile(file,'utf8');
    const result=await importRecords(database,owner,JSON.parse(raw),hash(raw),{current:index===0});
    console.log(JSON.stringify({file,...result}));
  }
  const counts=(await database.query(`SELECT
    (SELECT count(*) FROM competitors WHERE owner_id=$1) competitors,
    (SELECT count(*) FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE c.owner_id=$1) store_apps,
    (SELECT count(*) FROM release_history r JOIN store_apps a ON a.id=r.store_app_id JOIN competitors c ON c.id=a.competitor_id WHERE c.owner_id=$1) releases`,[owner])).rows[0];
  console.log(JSON.stringify({totals:counts}));
} finally {await database.end();}
