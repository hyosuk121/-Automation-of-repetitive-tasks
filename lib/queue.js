import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { saveSnapshot } from './history.js';
import { collectStore } from './stores.js';
import { fail } from './repository.js';

export async function enqueue(database, owner, { ids = null, trigger = 'manual', scheduleKey = null } = {}) {
  return transaction(database, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
    if (scheduleKey) {
      const existing = (await client.query('SELECT id,status FROM collection_runs WHERE owner_id=$1 AND schedule_key=$2',[owner,scheduleKey])).rows[0];
      if (existing) return existing;
    }
    const apps = (await client.query(`SELECT a.id FROM store_apps a JOIN competitors c ON c.id=a.competitor_id
      WHERE c.owner_id=$1 AND c.archived_at IS NULL AND a.is_active
      AND ($2::uuid[] IS NULL OR c.id=ANY($2))
      AND ($3::boolean=false OR c.auto_collect)
      AND NOT EXISTS(SELECT 1 FROM collection_items i WHERE i.store_app_id=a.id AND i.status IN ('queued','running'))
      AND ($3::boolean OR a.last_success_at IS NULL OR a.last_success_at < now() - ($4::integer * interval '1 second'))`,
    [owner,ids,trigger === 'scheduled',Number(process.env.COLLECTION_INTERVAL_SECONDS || 300)])).rows;
    if (!apps.length) {
      if (trigger === 'scheduled') return null;
      fail('수집할 대상이 없거나 이미 대기·실행 중입니다. 최근 성공한 앱은 5분 뒤 다시 시도해 주세요.',409);
    }
    const run = (await client.query(`INSERT INTO collection_runs(owner_id,trigger_type,schedule_key,total_count)
      VALUES($1,$2,$3,$4) RETURNING *`,[owner,trigger,scheduleKey,apps.length])).rows[0];
    for (const app of apps) await client.query('INSERT INTO collection_items(collection_run_id,store_app_id) VALUES($1,$2)',[run.id,app.id]);
    return run;
  });
}
export async function scheduleDaily(database, date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  if (kst.getUTCHours() < Number(process.env.SCHEDULE_HOUR_KST || 9)) return [];
  const day = kst.toISOString().slice(0,10);
  const owners = (await database.query('SELECT DISTINCT owner_id FROM competitors WHERE archived_at IS NULL AND auto_collect')).rows;
  const runs = [];
  for (const { owner_id } of owners) runs.push(await enqueue(database,owner_id,{trigger:'scheduled',scheduleKey:day}));
  return runs.filter(Boolean);
}
export async function claim(database) {
  return transaction(database, async client => {
    // A crash on the last attempt must terminate rather than strand a running item.
    const expired = (await client.query(`UPDATE collection_items SET status='failed',error_code='lease_expired',
      error_message='작업 실행기가 응답하지 않아 재시도 한도를 초과했습니다.',finished_at=now(),lease_token=NULL
      WHERE status='running' AND lease_until < now() AND attempts >= 4 RETURNING collection_run_id`)).rows;
    for (const row of expired) await summarize(client,row.collection_run_id);
    const item = (await client.query(`SELECT i.id FROM collection_items i
      WHERE (i.status='queued' AND i.available_at <= now()) OR
        (i.status='running' AND i.lease_until < now() AND i.attempts < 4)
      ORDER BY i.available_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!item) return null;
    const claimed = (await client.query(`UPDATE collection_items SET status='running',attempts=attempts+1,
      lease_until=now()+interval '3 minutes',lease_token=$2 WHERE id=$1 RETURNING *`,[item.id,randomUUID()])).rows[0];
    await client.query("UPDATE collection_runs SET status='running',started_at=COALESCE(started_at,now()) WHERE id=$1",[claimed.collection_run_id]);
    const app = (await client.query(`SELECT a.*,c.archived_at FROM store_apps a JOIN competitors c ON c.id=a.competitor_id WHERE a.id=$1`,[claimed.store_app_id])).rows[0];
    return { ...claimed,app };
  });
}
async function summarize(client, runId) {
  // Lock the aggregate before counting to avoid concurrent final completions leaving it running.
  await client.query('SELECT id FROM collection_runs WHERE id=$1 FOR UPDATE',[runId]);
  await client.query(`UPDATE collection_runs r SET
    success_count=t.success, failure_count=t.failure,
    status=CASE WHEN t.pending>0 THEN 'running' WHEN t.failure=t.total THEN 'failed'
      WHEN t.failure>0 OR t.partial>0 THEN 'partial' ELSE 'succeeded' END,
    finished_at=CASE WHEN t.pending=0 THEN now() ELSE NULL END
    FROM (SELECT count(*)::integer total,
      count(*) FILTER(WHERE status IN ('succeeded','partial'))::integer success,
      count(*) FILTER(WHERE status='failed')::integer failure,
      count(*) FILTER(WHERE status='partial')::integer partial,
      count(*) FILTER(WHERE status IN ('queued','running'))::integer pending
      FROM collection_items WHERE collection_run_id=$1) t WHERE r.id=$1`,[runId]);
}
export async function workOnce(database, collector = collectStore) {
  const item = await claim(database);
  if (!item) return false;
  let payload, failure;
  try {
    if (!item.app.is_active || item.app.archived_at) throw Object.assign(new Error('보관되거나 변경된 수집 대상입니다.'),{code:'inactive'});
    payload = await collector(item.app);
  } catch (error) { failure = error; }
  await transaction(database, async client => {
    const current = (await client.query('SELECT * FROM collection_items WHERE id=$1 FOR UPDATE',[item.id])).rows[0];
    if (current.lease_token !== item.lease_token || current.status !== 'running') return;
    if (failure) {
      const retry = failure.retryable && item.attempts < 4;
      const delay = Math.min(3600,Math.max(failure.retryAfter || 0,30 * 2 ** (item.attempts - 1)));
      await client.query(`UPDATE collection_items SET status=$2,error_code=$3,error_message=$4,
        available_at=now()+($5::integer*interval '1 second'),lease_token=NULL,lease_until=NULL,
        finished_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1`,
      [item.id,retry?'queued':'failed',failure.code || 'unknown',failure.message.slice(0,500),delay]);
      await client.query('UPDATE store_apps SET last_error_at=now(),last_error_message=$2 WHERE id=$1',[item.app.id,failure.message.slice(0,500)]);
    } else {
      await saveSnapshot(client,item.app,item.collection_run_id,payload);
      await client.query(`UPDATE collection_items SET status=$2,finished_at=now(),lease_token=NULL,lease_until=NULL,
        error_message=$3,error_code=$4 WHERE id=$1`,
      [item.id,payload.quality==='partial'?'partial':'succeeded',payload.warning || null,payload.quality==='partial'?'partial_parse':null]);
    }
    await summarize(client,item.collection_run_id);
  });
  console.log(JSON.stringify({event:'collection_item',itemId:item.id,attempt:item.attempts,outcome:failure?failure.code || 'failed':payload.quality}));
  return true;
}
