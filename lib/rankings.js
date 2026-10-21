import gplay from 'google-play-scraper';
import {randomUUID} from 'node:crypto';
import {transaction} from './db.js';
export const koreanDay=(date=new Date())=>new Date(date.getTime()+9*3600000).toISOString().slice(0,10);
export function validateChart(ids){
 if(!Array.isArray(ids)||ids.length<100)throw new Error('상위 100개 목록을 확보하지 못했습니다. 순위권 밖으로 판정하지 않습니다.');
 const first=ids.slice(0,100).map(id=>typeof id==='string'?id.trim():'');
 if(first.some(id=>!id)||new Set(first).size!==100)throw new Error('순위 목록에 누락 또는 중복 앱이 있습니다.');
 return first;
}
export async function collectChart(platform,country){
 if(!/^[a-z]{2}$/.test(country))throw new Error('지원하지 않는 국가입니다.');
 if(platform==='app_store'){
  // iPhone free travel category (6003); this is a chart feed, never search results.
  const response=await fetch(`https://itunes.apple.com/${country}/rss/topfreeapplications/limit=100/genre=6003/json`,{signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new Error(`App Store 순위 응답 오류 (${response.status})`);
  const data=await response.json();
  return validateChart(data.feed?.entry?.map(e=>e.id?.attributes?.['im:id']));
 }
 if(platform!=='play_store')throw new Error('지원하지 않는 플랫폼입니다.');
 const apps=await gplay.list({category:gplay.category.TRAVEL_AND_LOCAL,collection:gplay.collection.TOP_FREE,country,lang:'ko',num:100,fullDetail:false,requestOptions:{timeout:{request:20000},retry:{limit:0}}});
 return validateChart(apps.map(a=>a.appId));
}
export async function scheduleRankings(database,date=new Date()){
 if(new Date(date.getTime()+9*3600000).getUTCHours()<9)return;
 await database.query(`INSERT INTO ranking_runs(platform,country,chart_day)
 SELECT DISTINCT a.platform,a.country,$1::date FROM store_apps a JOIN competitors c ON c.id=a.competitor_id
 WHERE a.is_active AND c.archived_at IS NULL AND c.auto_collect ON CONFLICT DO NOTHING`,[koreanDay(date)]);
}
export async function workRanking(database,collector=collectChart,date=new Date()){
 const day=koreanDay(date);
 const item=await transaction(database,async c=>{
  await c.query(`UPDATE ranking_runs SET status='failed',error_message='당일 수집하지 못했습니다.',lease_token=NULL WHERE chart_day<$1 AND status IN ('queued','running')`,[day]);
  await c.query(`UPDATE ranking_runs SET status='failed',error_message='순위 작업 재시도 한도를 초과했습니다.',lease_token=NULL WHERE status='running' AND lease_until<now() AND attempts>=4`);
  const r=(await c.query(`SELECT * FROM ranking_runs WHERE chart_day=$1 AND attempts<4 AND ((status IN ('queued','failed') AND available_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`,[day])).rows[0];
  if(!r)return null;
  return (await c.query(`UPDATE ranking_runs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '3 minutes' WHERE id=$1 RETURNING *`,[r.id,randomUUID()])).rows[0];
 });
 if(!item)return false;
 let ids,error;
 try{ids=validateChart(await collector(item.platform,item.country));if(koreanDay()!==day)throw new Error('수집 중 날짜가 변경되었습니다.');}catch(e){error=e;}
 await transaction(database,async c=>{
  const current=(await c.query('SELECT * FROM ranking_runs WHERE id=$1 FOR UPDATE',[item.id])).rows[0];
  if(current.lease_token!==item.lease_token||current.status!=='running')return;
  if(error){
   // Do not persist network URLs, tokens or arbitrary upstream response bodies.
   await c.query(`UPDATE ranking_runs SET status='failed',error_message=$2,available_at=now()+interval '5 minutes',lease_token=NULL,lease_until=NULL WHERE id=$1`,[item.id,'카테고리 상위 100위 수집에 실패했습니다. 자동 재시도하며 순위권 밖으로 기록하지 않습니다.']);
  }else{
   for(const [i,id]of ids.entries())await c.query('INSERT INTO ranking_entries(run_id,external_id,rank) VALUES($1,$2,$3)',[item.id,id,i+1]);
   await c.query(`UPDATE ranking_runs SET status='succeeded',collected_at=now(),source_count=100,error_message=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1`,[item.id]);
  }
 });
 return true;
}
export async function rankingHistory(database,owner,{from,to,country='kr'}){
 const rows=(await database.query(`SELECT a.id app_id,c.name,a.platform,a.country,d.chart_date::date::text AS day,r.collected_at,e.rank,
 CASE WHEN r.status='succeeded' THEN CASE WHEN e.rank IS NULL THEN 'outside' ELSE 'ranked' END
 WHEN r.status='failed' THEN 'failed' WHEN r.status IN ('queued','running') THEN r.status ELSE 'uncollected' END status
 FROM competitors c JOIN store_apps a ON a.competitor_id=c.id
 CROSS JOIN generate_series($2::date,$3::date,interval '1 day') d(chart_date)
 LEFT JOIN ranking_runs r ON r.platform=a.platform AND r.country=a.country AND r.chart_day=d.chart_date::date
 LEFT JOIN ranking_entries e ON e.run_id=r.id AND e.external_id=a.external_id
 WHERE c.owner_id=$1 AND c.archived_at IS NULL AND a.is_active AND a.country=$4 ORDER BY d.chart_date,c.sort_order,a.platform`,[owner,from,to,country])).rows;
 return {rows,from,to,country,chart:'인기 무료 · iPhone 여행 / Google Play 여행 및 지역정보 · 상위 100위'};
}
