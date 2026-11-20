import {createHash} from 'node:crypto';
import {transaction} from './db.js';
import {ensureSnapshotSchema} from './snapshot-schema.js';
import {inspectAviation} from './aviation-source.js';

const sourceVersion='incheon-route-v1:departure:pax:regular-and-irregular';
// Preserve multiplicity but ignore provider row order. Raw known fields are kept,
// including blank country names and zero-flight rows; no country inference or sum.
export async function captureAviation(database,owner,options={}){
 const {sourceRows,...report}=await inspectAviation({...options,includeRows:true});
 if(!sourceRows.length)return {...report,archive:null};
 const canonical=sourceRows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).sort();
 const hash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
 const archive=await transaction(database,async client=>{
  await ensureSnapshotSchema(client);
  return (await client.query(`INSERT INTO aviation_archives(owner_id,source_version,content_hash,months,row_count,quality,source_rows,diagnostics,first_seen_at,last_seen_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
    ON CONFLICT(owner_id,source_version,content_hash) DO UPDATE SET
      last_seen_at=GREATEST(aviation_archives.last_seen_at,EXCLUDED.last_seen_at),
      first_seen_at=LEAST(aviation_archives.first_seen_at,EXCLUDED.first_seen_at),
      check_count=aviation_archives.check_count+1
    RETURNING id,first_seen_at,last_seen_at,check_count`,
  [owner,sourceVersion,hash,report.months,sourceRows.length,report.status,JSON.stringify(sourceRows),JSON.stringify(report),report.checkedAt])).rows[0];
 });
 return {...report,archive};
}
export async function listAviationArchives(database,owner){
 return (await database.query(`SELECT id,months,row_count,quality,first_seen_at,last_seen_at,check_count FROM aviation_archives WHERE owner_id=$1 ORDER BY last_seen_at DESC,id LIMIT 50`,[owner])).rows;
}
export async function getAviationArchive(database,owner,id){
 const row=(await database.query(`SELECT id,source_version,months,row_count,quality,first_seen_at,last_seen_at,check_count,source_rows,diagnostics FROM aviation_archives WHERE owner_id=$1 AND id=$2`,[owner,id])).rows[0];
 if(!row)throw Object.assign(new Error('보관된 항공 응답을 찾을 수 없습니다.'),{status:404});return row;
}
