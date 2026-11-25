import {randomUUID} from 'node:crypto';
import {capturePortal} from './airportal-archive.js';
import {publicOwner} from './public-read.js';
const dayInSeoul=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const hourInSeoul=at=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(at));
const compact=date=>date.toISOString().slice(0,10).replaceAll('-','');
export function portalPeriods(kind,at=new Date()){
 const today=new Date(dayInSeoul(at)+'T00:00:00Z'),periods=[];
 if(kind==='daily'){for(let n=8;n<78;n++){const d=new Date(today);d.setUTCDate(d.getUTCDate()-n);periods.push(compact(d));}}
 else{const d=new Date(today);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);while(compact(d).slice(0,6)>='202101'){periods.push(compact(d).slice(0,6));d.setUTCMonth(d.getUTCMonth()-1);}}
 return periods;
}
export async function collectPortalTick(database,{at=new Date(),resolveOwner=publicOwner,capture=capturePortal}={}){
 if(hourInSeoul(at)<9)return {status:'not_due'};
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
   const status=report.snapshot?'succeeded':'unavailable',retryHours=report.snapshot?(index<2?24:24*365*100):24;
   await database.query(`UPDATE aviation_portal_checks SET status=$4,retry_after=$5::timestamptz+($6::int*interval '1 hour') WHERE owner_id=$1 AND kind=$2 AND period=$3 AND lease_token=$7`,[owner,kind,period,status,at.toISOString(),retryHours,token]);
   results[kind]={status,period,quality:report.status};
  }catch{
   await database.query(`UPDATE aviation_portal_checks SET status='failed',retry_after=$4::timestamptz+interval '6 hours' WHERE owner_id=$1 AND kind=$2 AND period=$3 AND lease_token=$5`,[owner,kind,period,at.toISOString(),token]);
   results[kind]={status:'failed',period};
  }
 }
 return results;
}
