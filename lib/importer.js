import { transaction } from './db.js';
import { hash,saveSnapshot } from './history.js';
import { parseStoreUrl } from './stores.js';

export function legacyRecords(data) {
  const records=Array.isArray(data)?data:data.apps;
  if(!Array.isArray(records)) throw new Error('JSON은 배열 또는 apps 배열을 가진 객체여야 합니다.');
  return records;
}
export function legacyPayload(raw,platform) {
  const sourceUpdatedAt=raw.currentVersionReleaseDate || raw.updatedDate || raw.releaseDate || null;
  const releases=platform==='app_store'
    ? (raw.versions || []).map(v=>({version:v.version || null,releaseDate:v.releaseDate || null,notes:v.notes || ''}))
    : sourceUpdatedAt && (raw.latestNotes ?? raw.recentChanges)!=null
      ? [{version:null,releaseDate:sourceUpdatedAt,notes:raw.latestNotes ?? raw.recentChanges}] : [];
  return {
    appName:raw.name || raw.appName || null,developerName:raw.developer || raw.developerName || null,
    iconUrl:raw.iconUrl || raw.icon || null,version:platform==='app_store'?(raw.version || null):null,
    sourceUpdatedAt,rating:asNumber(raw.rating),ratingCount:asNumber(raw.ratingCount),
    reviewCount:asNumber(raw.reviewCount),downloadsText:raw.downloadsText || raw.installs || null,
    latestNotes:raw.latestNotes ?? raw.releaseNotes ?? null,releases,historyComplete:false,quality:'migration',
    legacy:raw
  };
}
function asNumber(value) {return value!=null && value!=='' && Number.isFinite(Number(value))?Number(value):null;}
export async function importRecords(database,owner,data,fileHash,{current=false}={}) {
  const records=legacyRecords(data);
  return transaction(database,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
    let observations=0,releases=0;
    for(const [index,record]of records.entries()) {
      const sources=[];
      for(const platform of ['app_store','play_store']) {
        const raw=platform==='app_store'?(record.appStore || (record.trackId?record:null)):record.playStore;
        if(!raw) continue;
        const url=raw.storeUrl || raw.url || (platform==='app_store'?record.appStoreUrl:record.playStoreUrl) ||
          (platform==='app_store' && raw.trackId?`https://apps.apple.com/${raw.country || 'kr'}/app/id${raw.trackId}`:
            platform==='play_store' && raw.packageName?`https://play.google.com/store/apps/details?id=${raw.packageName}&gl=${raw.country || 'kr'}&hl=${raw.language || 'ko'}`:null);
        if(!url) throw new Error(`레코드 ${index+1}: ${platform} 링크 또는 앱 ID가 없습니다.`);
        const stamp=raw.refreshedAt || record.refreshedAt;
        if(!stamp || !Number.isFinite(Date.parse(stamp))) throw new Error(`레코드 ${index+1}: 유효한 refreshedAt이 필요합니다. 원본을 확인하세요.`);
        sources.push({link:parseStoreUrl(url,platform),payload:legacyPayload(raw,platform),at:new Date(stamp).toISOString()});
      }
      if(!sources.length) throw new Error(`레코드 ${index+1}: 이전할 스토어 데이터가 없습니다.`);
      const key=String(record.recordId || record.id || hash(sources.map(s=>[s.link.platform,s.link.external_id,s.link.country]).sort()));
      let competitorId=(await client.query('SELECT competitor_id FROM migration_imports WHERE owner_id=$1 AND record_key=$2',[owner,key])).rows[0]?.competitor_id;
      const name=record.competitorName || record.name;
      if(!name) throw new Error(`레코드 ${index+1}: 경쟁사명이 없습니다.`);
      const scope=['domestic','global','unknown'].includes(record.serviceScope)?record.serviceScope:'unknown';
      if(!competitorId) {
        competitorId=(await client.query(`INSERT INTO competitors(owner_id,name,service_scope,sort_order,archived_at)
          VALUES($1,$2,$3,$4,CASE WHEN $5 THEN NULL ELSE now() END) RETURNING id`,
        [owner,name,scope,current?index:100000+index,current])).rows[0].id;
        await client.query('INSERT INTO migration_imports(owner_id,record_key,competitor_id) VALUES($1,$2,$3)',[owner,key,competitorId]);
      } else if(current) await client.query('UPDATE competitors SET name=$2,service_scope=$3,sort_order=$4 WHERE id=$1',[competitorId,name,scope,index]);
      for(const source of sources) {
        const a=source.link;
        let app=(await client.query('SELECT * FROM store_apps WHERE competitor_id=$1 AND platform=$2 AND external_id=$3 AND country=$4 AND language=$5',[competitorId,a.platform,a.external_id,a.country,a.language])).rows[0];
        if(!app) {
          const hasActive=(await client.query('SELECT id FROM store_apps WHERE competitor_id=$1 AND platform=$2 AND is_active',[competitorId,a.platform])).rows.length>0;
          app=(await client.query(`INSERT INTO store_apps(competitor_id,platform,external_id,store_url,country,language,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[competitorId,a.platform,a.external_id,a.store_url,a.country,a.language,!hasActive])).rows[0];
        }
        if(current) {
          await client.query('UPDATE store_apps SET is_active=false WHERE competitor_id=$1 AND platform=$2 AND id<>$3',[competitorId,a.platform,app.id]);
          await client.query('UPDATE store_apps SET is_active=true WHERE id=$1',[app.id]);
        }
        const scheduleKey=`import:${fileHash}:${key}:${app.id}`;
        const run=(await client.query(`INSERT INTO collection_runs(owner_id,trigger_type,status,schedule_key,total_count,success_count,started_at,finished_at)
          VALUES($1,'migration','succeeded',$2,1,1,$3,$3) ON CONFLICT(owner_id,schedule_key) DO UPDATE SET schedule_key=EXCLUDED.schedule_key RETURNING id`,
        [owner,scheduleKey,source.at])).rows[0];
        const inserted=await saveSnapshot(client,app,run.id,source.payload,source.at);
        if(inserted) {observations++;releases+=source.payload.releases.length;}
      }
    }
    return {records:records.length,insertedSnapshots:observations,observedReleases:releases};
  });
}
