import { transaction } from './db.js';
import { parseStoreUrl } from './stores.js';

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export async function getCompetitor(database, owner, id) {
  const row = (await database.query('SELECT * FROM competitors WHERE owner_id=$1 AND id=$2', [owner,id])).rows[0];
  if (!row) fail('경쟁사를 찾을 수 없습니다.', 404);
  return row;
}
export async function listCompetitors(database, owner, archived = false) {
  return (await database.query(`SELECT c.*, COALESCE(jsonb_agg(
    to_jsonb(a) || jsonb_build_object('snapshot',s.data,'change_count',
      (SELECT count(*) FROM change_events e WHERE e.snapshot_id=s.id),
      'missing_count',(SELECT count(*) FROM release_history r WHERE r.store_app_id=a.id AND NOT r.is_present_in_source),
      'job_status',(SELECT i.status FROM collection_items i WHERE i.store_app_id=a.id AND i.status IN ('queued','running') LIMIT 1))
    ) FILTER (WHERE a.id IS NOT NULL),'[]') AS apps
    FROM competitors c LEFT JOIN store_apps a ON a.competitor_id=c.id AND a.is_active
    LEFT JOIN LATERAL (SELECT id,(to_jsonb(ss)-'normalized_payload'-'content_hash') || jsonb_build_object('normalized_payload',jsonb_build_object('quality',ss.normalized_payload->'quality','warning',ss.normalized_payload->'warning')) AS data FROM store_snapshots ss WHERE ss.store_app_id=a.id ORDER BY collected_at DESC LIMIT 1) s ON true
    WHERE c.owner_id=$1 AND ($2::boolean OR c.archived_at IS NULL)
    GROUP BY c.id ORDER BY c.sort_order,c.created_at`, [owner,archived])).rows;
}
export async function saveCompetitor(database, owner, body, id) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) fail('경쟁사명은 1~120자로 입력해 주세요.');
  if (!['domestic','global','unknown'].includes(body.service_scope)) fail('서비스 구분이 올바르지 않습니다.');
  const links = ['app_store','play_store'].filter(p => body[p]).map(p => parseStoreUrl(body[p], p));
  if (!links.length) fail('최소 하나의 스토어 링크가 필요합니다.');
  return transaction(database, async client => {
    // Serializes edits per administrator, including competitor-limit checks.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner]);
    if (id) {
      const current = await getCompetitor(client, owner, id);
      if (current.archived_at) fail('보관한 경쟁사는 수정할 수 없습니다.', 409);
      await client.query('UPDATE competitors SET name=$1,service_scope=$2,auto_collect=$3,updated_at=now() WHERE id=$4', [name,body.service_scope,body.auto_collect !== false,id]);
    } else {
      const count = Number((await client.query('SELECT count(*) FROM competitors WHERE owner_id=$1 AND archived_at IS NULL',[owner])).rows[0].count);
      if (count >= Number(process.env.MAX_COMPETITORS || 100)) fail('등록 가능한 경쟁사 수를 초과했습니다.', 409);
      id = (await client.query(`INSERT INTO competitors(owner_id,name,service_scope,auto_collect,sort_order)
        VALUES ($1,$2,$3,$4,COALESCE((SELECT MAX(sort_order)+1 FROM competitors WHERE owner_id=$1),0)) RETURNING id`,
      [owner,name,body.service_scope,body.auto_collect !== false])).rows[0].id;
    }
    const previous = (await client.query('SELECT * FROM store_apps WHERE competitor_id=$1 AND is_active',[id])).rows;
    for (const old of previous) {
      const matching = links.find(a => a.platform === old.platform && a.external_id === old.external_id && a.country === old.country && a.language === old.language);
      if (!matching) await client.query('UPDATE store_apps SET is_active=false WHERE id=$1',[old.id]);
    }
    for (const link of links) {
      if (previous.some(a => a.platform === link.platform && a.external_id === link.external_id && a.country === link.country && a.language === link.language)) continue;
      await client.query(`INSERT INTO store_apps(competitor_id,platform,external_id,store_url,country,language) VALUES($1,$2,$3,$4,$5,$6)`,
        [id,link.platform,link.external_id,link.store_url,link.country,link.language]);
    }
    return { id };
  });
}
export async function reorder(database, owner, ids) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('정렬 목록이 올바르지 않습니다.');
  return transaction(database, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
    const actual = (await client.query('SELECT id FROM competitors WHERE owner_id=$1 AND archived_at IS NULL',[owner])).rows.map(r => r.id);
    if (actual.length !== ids.length || actual.some(id => !ids.includes(id))) fail('목록이 변경되었습니다. 새로고침 후 다시 정렬해 주세요.',409);
    for (const [i,id] of ids.entries()) await client.query('UPDATE competitors SET sort_order=$1 WHERE id=$2',[i,id]);
  });
}
export async function ownedApp(database, owner, id) {
  const app = (await database.query(`SELECT a.* FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE a.id=$1 AND c.owner_id=$2`,[id,owner])).rows[0];
  if (!app) fail('앱을 찾을 수 없습니다.',404);
  return app;
}
export async function appHistory(database, owner, id, from, to, limit = 200, offset = 0) {
  const app = await ownedApp(database,owner,id);
  const params = [id,from,to,limit,offset];
  const [snapshotResult,releaseResult,changeResult,competitor,appsResult]=await Promise.all([
    database.query(`SELECT id,store_app_id,collected_at,source_updated_at,version,rating,rating_count,review_count,downloads_text,latest_notes,app_name,icon_url,jsonb_build_object('warning',normalized_payload->'warning','quality',normalized_payload->'quality') AS normalized_payload FROM store_snapshots WHERE store_app_id=$1 AND collected_at >= $2 AND collected_at <= $3 ORDER BY collected_at DESC LIMIT $4 OFFSET $5`, params),
    database.query(`SELECT r.*, COALESCE((SELECT jsonb_agg(n ORDER BY n.last_seen_at DESC) FROM release_note_revisions n WHERE n.release_history_id=r.id),'[]') revisions
    FROM release_history r WHERE store_app_id=$1 AND first_seen_at <= $3 AND last_seen_at >= $2 ORDER BY NULLIF(substring(release_date from '^([0-9]{4}-[0-9]{2}-[0-9]{2})'),'') DESC NULLS LAST,first_seen_at DESC,id DESC LIMIT $4 OFFSET $5`,params),
    database.query(`SELECT * FROM change_events WHERE store_app_id=$1 AND occurred_at >= $2 AND occurred_at <= $3 ORDER BY occurred_at DESC LIMIT $4 OFFSET $5`,params),
    getCompetitor(database,owner,app.competitor_id),
    database.query('SELECT id,competitor_id,platform,external_id,store_url,country,language,is_active FROM store_apps WHERE competitor_id=$1 ORDER BY is_active DESC,platform',[app.competitor_id])
  ]);
  const snapshots=snapshotResult.rows,releases=releaseResult.rows,changes=changeResult.rows;
  competitor.apps=appsResult.rows;
  return { app,competitor,snapshots,releases,changes,limit,offset };
}
