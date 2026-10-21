import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function releaseKey(platform, release) {
  return hash(platform === 'app_store'
    ? [release.version, release.releaseDate]
    : [release.releaseDate, hash(release.notes || '')]);
}
export function changes(previous, next) {
  if (!previous) return [];
  return ['version', 'sourceUpdatedAt', 'rating', 'ratingCount', 'reviewCount', 'downloadsText', 'latestNotes', 'appName']
    .filter(field => JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null))
    .map(field => ({ field, oldValue: previous[field] ?? null, newValue: next[field] ?? null }));
}

// Caller owns the transaction. A run can persist a target only once.
export async function saveSnapshot(client, app, runId, payload, collectedAt = new Date().toISOString()) {
  const previous = (await client.query('SELECT normalized_payload FROM store_snapshots WHERE store_app_id=$1 ORDER BY collected_at DESC LIMIT 1', [app.id])).rows[0];
  const result = await client.query(`INSERT INTO store_snapshots
    (store_app_id,collection_run_id,collected_at,source_updated_at,version,rating,rating_count,review_count,downloads_text,latest_notes,app_name,developer_name,icon_url,normalized_payload,content_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT(store_app_id,collection_run_id) DO NOTHING RETURNING id`,
  [app.id,runId,collectedAt,payload.sourceUpdatedAt,payload.version,payload.rating,payload.ratingCount,payload.reviewCount,payload.downloadsText,payload.latestNotes,payload.appName,payload.developerName,payload.iconUrl,JSON.stringify(payload),hash(payload)]);
  if (!result.rows.length) return false;
  const snapshotId = result.rows[0].id;
  const keys = [];
  for (const release of payload.releases || []) {
    let key = releaseKey(app.platform, release);
    if(app.platform==='app_store' && release.version && release.releaseDate){
      const existing=(await client.query(`SELECT release_key FROM release_history WHERE store_app_id=$1 AND version=$2 AND left(release_date,10)=left($3,10) ORDER BY first_seen_at LIMIT 1`,[app.id,release.version,release.releaseDate])).rows[0];
      if(existing)key=existing.release_key;
    }
    keys.push(key);
    const releaseId = (await client.query(`INSERT INTO release_history
      (store_app_id,release_key,version,release_date,first_seen_at,last_seen_at,first_snapshot_id,last_snapshot_id)
      VALUES ($1,$2,$3,$4,$5,$5,$6,$6)
      ON CONFLICT(store_app_id,release_key) DO UPDATE SET
        first_seen_at=LEAST(release_history.first_seen_at,EXCLUDED.first_seen_at),
        last_seen_at=GREATEST(release_history.last_seen_at,EXCLUDED.last_seen_at),
        missing_since=CASE WHEN EXCLUDED.last_seen_at >= release_history.last_seen_at THEN NULL ELSE release_history.missing_since END,
        is_present_in_source=CASE WHEN EXCLUDED.last_seen_at >= release_history.last_seen_at THEN true ELSE release_history.is_present_in_source END,
        first_snapshot_id=CASE WHEN EXCLUDED.first_seen_at < release_history.first_seen_at THEN EXCLUDED.first_snapshot_id ELSE release_history.first_snapshot_id END,
        last_snapshot_id=CASE WHEN EXCLUDED.last_seen_at >= release_history.last_seen_at THEN EXCLUDED.last_snapshot_id ELSE release_history.last_snapshot_id END
      RETURNING id`, [app.id,key,release.version,release.releaseDate,collectedAt,snapshotId])).rows[0].id;
    await client.query(`INSERT INTO release_note_revisions(release_history_id,notes,notes_hash,first_seen_at,last_seen_at)
      VALUES($1,$2,$3,$4,$4) ON CONFLICT(release_history_id,notes_hash) DO UPDATE SET
      first_seen_at=LEAST(release_note_revisions.first_seen_at,EXCLUDED.first_seen_at),
      last_seen_at=GREATEST(release_note_revisions.last_seen_at,EXCLUDED.last_seen_at)`,
    [releaseId,release.notes || '',hash(release.notes || ''),collectedAt]);
  }
  if ((payload.historyComplete || (app.platform==='play_store' && payload.quality==='complete')) && keys.length) {
    await client.query(`UPDATE release_history SET is_present_in_source=false,missing_since=COALESCE(missing_since,$2)
      WHERE store_app_id=$1 AND NOT (release_key=ANY($3::text[])) AND last_seen_at <= $2`, [app.id,collectedAt,keys]);
  }
  // Legacy backups are not guaranteed to arrive chronologically. Preserve facts, not synthetic reverse changes.
  for (const event of payload.quality==='migration'?[]:changes(previous?.normalized_payload, payload)) {
    await client.query('INSERT INTO change_events(store_app_id,snapshot_id,occurred_at,field,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6)',
      [app.id,snapshotId,collectedAt,event.field,JSON.stringify(event.oldValue),JSON.stringify(event.newValue)]);
  }
  await client.query(`UPDATE store_apps SET last_success_at=GREATEST(COALESCE(last_success_at,$2),$2),
    last_error_message=CASE WHEN last_error_at>$2 THEN last_error_message ELSE NULL END WHERE id=$1`, [app.id,collectedAt]);
  return snapshotId;
}
