import {rankingPeriod} from './ranking-period.js';
import {listCompetitors,appHistory,fail} from './repository.js';
import {rankingHistory} from './rankings.js';
const pick=(value,keys)=>Object.fromEntries(keys.split(' ').map(k=>[k,value?.[k]]));
export async function publicOwner(database){
 // Explicit override supports workspaces with several administrators. Default is
 // the first configured admin, never an owner supplied by the visitor.
 if(process.env.PUBLIC_OWNER_ID)return process.env.PUBLIC_OWNER_ID;
 const email=(process.env.ADMIN_EMAILS||'').split(',')[0].trim().toLowerCase();
 if(!email)return null;
 return (await database.query('SELECT id FROM auth.users WHERE lower(email)=$1 LIMIT 1',[email])).rows[0]?.id||null;
}
const snapshot=s=>s?{...pick(s,'id collected_at source_updated_at version rating rating_count review_count downloads_text latest_notes app_name developer_name icon_url'),quality:s.normalized_payload?.quality}:null;
const app=a=>({...pick(a,'id competitor_id platform external_id store_url country language is_active last_success_at change_count missing_count'),snapshot:snapshot(a.snapshot)});
export async function publicRead(database,owner,path,params,period){
 if(path==='/competitors')return {competitors:owner?(await listCompetitors(database,owner)).map(c=>({...pick(c,'id name service_scope sort_order'),apps:c.apps.map(app)})):[]};
 if(path==='/rankings'){
  const range=rankingPeriod(params);
  if(!owner)return {rows:[]};
  return rankingHistory(database,owner,range);
 }
 const match=path.match(/^\/store-apps\/([0-9a-f-]{36})\/history$/i);
 if(match&&owner){
  const active=(await database.query('SELECT a.id FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE a.id=$1 AND c.owner_id=$2 AND c.archived_at IS NULL',[match[1],owner])).rows[0];
  if(!active)fail('앱을 찾을 수 없습니다.',404);
  const {from,to}=period(params),limit=100,offset=Math.max(0,Math.min(100000,Math.floor(Number(params.get('offset'))||0)));
  const data=await appHistory(database,owner,match[1],from,to,limit,offset);
  return {...data,app:app(data.app),competitor:{id:data.competitor.id,name:data.competitor.name,apps:data.competitor.apps.map(app)},snapshots:data.snapshots.map(snapshot),releases:data.releases.map(r=>({...pick(r,'id version release_date first_seen_at last_seen_at is_present_in_source'),revisions:r.revisions.map(n=>pick(n,'notes first_seen_at last_seen_at'))})),changes:data.changes.map(c=>pick(c,'id occurred_at field old_value new_value'))};
 }
 fail('요청한 공개 정보를 찾을 수 없습니다.',404);
}
