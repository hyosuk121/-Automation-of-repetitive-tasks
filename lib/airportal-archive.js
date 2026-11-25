import {createHash} from 'node:crypto';
import {transaction} from './db.js';
import {ensureSnapshotSchema} from './snapshot-schema.js';
import {fetchPortal} from './airportal-source.js';
export async function capturePortal(database,owner,kind,period,{source=fetchPortal}={}){
 const report=await source(kind,period);
 if(report.status==='unavailable')return {...report,snapshot:null};
 const hash=createHash('sha256').update(JSON.stringify(report.rows.map(row=>JSON.stringify(row)).sort())).digest('hex');
 const snapshot=await transaction(database,async client=>{
  await ensureSnapshotSchema(client);
  return (await client.query(`INSERT INTO aviation_portal_snapshots(owner_id,kind,period,metric,source_hash,status,total,unmapped,source_rows,countries)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
   ON CONFLICT(owner_id,kind,period,source_hash) DO UPDATE SET last_seen_at=now(),check_count=aviation_portal_snapshots.check_count+1
   RETURNING id,first_seen_at,last_seen_at,check_count`,[owner,kind,period,report.metric,hash,report.status,report.total,report.unmapped,JSON.stringify(report.rows),JSON.stringify(report.countries)])).rows[0];
 });
 return {...report,snapshot};
}
export async function listPortalSnapshots(database,owner){
 const rows=(await database.query(`SELECT DISTINCT ON (kind,period) id,kind,period,metric,status,total,unmapped,countries,first_seen_at,last_seen_at,check_count
  FROM aviation_portal_snapshots WHERE owner_id=$1 ORDER BY kind,period DESC,last_seen_at DESC,id DESC`,[owner])).rows;
 const checks=(await database.query(`SELECT kind,period,status,last_checked_at FROM aviation_portal_checks WHERE owner_id=$1 ORDER BY last_checked_at DESC LIMIT 8`,[owner])).rows;
 return {monthly:rows.filter(row=>row.kind==='monthly'),daily:rows.filter(row=>row.kind==='daily').slice(0,70),checks};
}
