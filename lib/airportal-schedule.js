import {randomUUID} from 'node:crypto';
import {capturePortal} from './airportal-archive.js';
import {publicOwner} from './public-read.js';
import {ensureSnapshotSchema} from './snapshot-schema.js';
import {transaction} from './db.js';
const dayInSeoul=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const hourInSeoul=at=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(at));
const compact=date=>date.toISOString().slice(0,10).replaceAll('-','');
export function portalPeriods(kind,at=new Date()){
 const today=new Date(dayInSeoul(at)+'T00:00:00Z'),periods=[];
 if(kind==='daily'){for(let n=8;n<78;n++){const d=new Date(today);d.setUTCDate(d.getUTCDate()-n);periods.push(compact(d));}}
 else{const d=new Date(today);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);while(compact(d).slice(0,6)>='202101'){periods.push(compact(d).slice(0,6));d.setUTCMonth(d.getUTCMonth()-1);}}
 return periods;
}
export async function collectPortalTick(database,{at=new Date(),resolveOwner=publicOwner,capture=capturePortal,force=false}={}){
 if(!force&&hourInSeoul(at)<9)return {status:'not_due'};
 const owner=await resolveOwner(database);if(!owner)return {status:'no_owner'};
 const results={};
 for(const kind of ['daily','monthly']){
  const periods=portalPeriods(kind,at);
  const checks=(await database.query('SELECT period,status,retry_after FROM aviation_portal_checks WHERE owner_id=$1 AND kind=$2',[owner,kind])).rows;
  const seen=new Map(checks.map(row=>[row.period,row]));
  let selected;
  for(const [index,period] of periods.entries()){
   const check=seen.get(period);
   if(check?.status==='succeeded'&&index>=2)continue;
   if(check&&new Date(check.retry_after)>at)continue;
   selected={period,index};break;
  }
  if(!selected){results[kind]={status:'up_to_date'};continue;}
  const token=randomUUID(),{period,index}=selected;
  const claimed=(await database.query(`INSERT INTO aviation_portal_checks(owner_id,kind,period,status,lease_token,retry_after,last_checked_at)
   VALUES($1,$2,$3,'running',$4,$5::timestamptz+interval '3 minutes',$5)
   ON CONFLICT(owner_id,kind,period) DO UPDATE SET status='running',lease_token=EXCLUDED.lease_token,
    retry_after=EXCLUDED.retry_after,last_checked_at=EXCLUDED.last_checked_at,attempts=aviation_portal_checks.attempts+1
   WHERE aviation_portal_checks.retry_after<=$5 RETURNING period`,[owner,kind,period,token,at.toISOString()])).rows.length;
  if(!claimed){results[kind]={status:'leased'};continue;}
  try{
   const report=await capture(database,owner,kind,period);
   const status=report.snapshot?'succeeded':'unavailable',retryHours=report.snapshot?(index<2?23:24*365*100):23;
   await database.query(`UPDATE aviation_portal_checks SET status=$4,retry_after=$5::timestamptz+($6::int*interval '1 hour') WHERE owner_id=$1 AND kind=$2 AND period=$3 AND lease_token=$7`,[owner,kind,period,status,at.toISOString(),retryHours,token]);
   results[kind]={status,period,quality:report.status};
  }catch{
   await database.query(`UPDATE aviation_portal_checks SET status='failed',retry_after=$4::timestamptz+interval '6 hours' WHERE owner_id=$1 AND kind=$2 AND period=$3 AND lease_token=$5`,[owner,kind,period,at.toISOString(),token]);
   results[kind]={status:'failed',period};
  }
 }
 return results;
}
export async function collectPortalNightly(database,{at=new Date(),resolveOwner=publicOwner,capture=capturePortal,now=Date.now,maxIterations=25,budgetMs=220000}={}){
 await transaction(database,ensureSnapshotSchema);
 const owner=await resolveOwner(database);
 if(!owner)return {status:'no_owner'};
 const started=now(),deadline=started+budgetMs;
 const run=(await database.query("INSERT INTO aviation_portal_runs(owner_id,status) VALUES($1,'running') RETURNING id",[owner])).rows[0];
 const summary={daily:0,monthly:0,unavailable:0,failed:0,iterations:0,last:null};
 try{
  while(summary.iterations<maxIterations&&now()<deadline-65000){
   const result=await collectPortalTick(database,{at,resolveOwner:async()=>owner,capture,force:true});
   summary.iterations++;
   for(const kind of ['daily','monthly']){
    if(result[kind]?.status==='succeeded')summary[kind]++;
    if(result[kind]?.status==='unavailable')summary.unavailable++;
    if(result[kind]?.status==='failed')summary.failed++;
   }
   summary.last=result;
   if(['daily','monthly'].every(kind=>result[kind]?.status==='up_to_date'))break;
  }
  await database.query("UPDATE aviation_portal_runs SET status='succeeded',finished_at=now(),summary=$2 WHERE id=$1",[run.id,JSON.stringify(summary)]);
  return {status:'succeeded',...summary};
 }catch(error){
  await database.query("UPDATE aviation_portal_runs SET status='failed',finished_at=now(),summary=$2 WHERE id=$1",[run.id,JSON.stringify(summary)]);
  throw error;
 }
}
