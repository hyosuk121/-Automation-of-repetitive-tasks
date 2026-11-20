import {randomUUID} from 'node:crypto';
import {aviationConfigured} from './aviation-source.js';
import {captureAviation} from './aviation-archive.js';
import {publicOwner} from './public-read.js';

// Invoked only after existing collections finish with sufficient time remaining.
// Daily source verification is not daily passenger data.
export async function collectAviationDaily(database,{env=process.env,at=new Date(),resolveOwner=publicOwner,capture=captureAviation}={}){
 if(!aviationConfigured(env))return {status:'not_configured'};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(at);
 const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
 if(Number(p.hour)<9)return {status:'not_due'};
 const owner=await resolveOwner(database);if(!owner)return {status:'no_owner'};
 const day=`${p.year}-${p.month}-${p.day}`,token=randomUUID();
 const claimed=(await database.query(`INSERT INTO aviation_daily_checks(owner_id,check_day,status,lease_token,retry_after)
   VALUES($1,$2,'running',$3,$4::timestamptz+interval '3 minutes')
   ON CONFLICT(owner_id,check_day) DO UPDATE SET status='running',lease_token=EXCLUDED.lease_token,
    retry_after=EXCLUDED.retry_after,attempts=aviation_daily_checks.attempts+1,error_code=NULL
   WHERE aviation_daily_checks.status<>'succeeded' AND aviation_daily_checks.attempts<3 AND aviation_daily_checks.retry_after<=$4
   RETURNING owner_id`,[owner,day,token,at.toISOString()])).rows.length;
 if(!claimed)return {status:'already_checked_or_waiting'};
 try{
  const data=await capture(database,owner,{env});
  if(!data.archive)throw new Error('Empty monthly response');
  await database.query("UPDATE aviation_daily_checks SET status='succeeded',archive_id=$4 WHERE owner_id=$1 AND check_day=$2 AND lease_token=$3",[owner,day,token,data.archive.id]);
  return {status:'succeeded',quality:data.status};
 }catch{
  await database.query("UPDATE aviation_daily_checks SET status='failed',error_code='collection_failed',retry_after=$4::timestamptz+interval '15 minutes' WHERE owner_id=$1 AND check_day=$2 AND lease_token=$3",[owner,day,token,at.toISOString()]);
  return {status:'failed'};
 }
}
