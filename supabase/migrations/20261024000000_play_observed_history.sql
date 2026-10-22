-- Withdraw only July 9 imported Play observations; retain all real collections and Apple history.
LOCK TABLE store_snapshots IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE withdrawn_play_snapshots ON COMMIT DROP AS
 SELECT s.id FROM store_snapshots s JOIN store_apps a ON a.id=s.store_app_id
 JOIN collection_runs c ON c.id=s.collection_run_id
 WHERE a.platform='play_store' AND c.trigger_type='migration'
 AND (s.collected_at AT TIME ZONE 'Asia/Seoul')::date=DATE '2026-07-09';
DELETE FROM release_note_revisions n USING release_history r
 WHERE n.release_history_id=r.id AND r.first_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots)
 AND r.last_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots);
DELETE FROM release_history WHERE first_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots)
 AND last_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots);
-- A release also observed live must survive the import withdrawal.
UPDATE release_history SET first_snapshot_id=last_snapshot_id,first_seen_at=last_seen_at
 WHERE first_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots);
UPDATE release_history SET last_snapshot_id=first_snapshot_id,last_seen_at=first_seen_at
 WHERE last_snapshot_id IN (SELECT id FROM withdrawn_play_snapshots);
DELETE FROM change_events WHERE snapshot_id IN (SELECT id FROM withdrawn_play_snapshots);
DROP TRIGGER IF EXISTS protect_snapshots ON store_snapshots;
DELETE FROM store_snapshots WHERE id IN (SELECT id FROM withdrawn_play_snapshots);
CREATE TRIGGER protect_snapshots BEFORE DELETE ON store_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
DELETE FROM report_imports r USING store_apps a WHERE r.store_app_id=a.id AND a.platform='play_store';

-- Recover dated updates that the old collector omitted when no description was supplied.
DO $$
DECLARE s record; rid uuid;
BEGIN
 FOR s IN SELECT obs.* FROM store_snapshots obs JOIN store_apps a ON a.id=obs.store_app_id
   JOIN collection_runs c ON c.id=obs.collection_run_id
   WHERE a.platform='play_store' AND c.trigger_type<>'migration' AND obs.source_updated_at IS NOT NULL
   ORDER BY obs.collected_at
 LOOP
   SELECT id INTO rid FROM release_history WHERE store_app_id=s.store_app_id
     AND left(release_date,10)=left(s.source_updated_at,10)
     AND (version IS NOT DISTINCT FROM s.version OR version IS NULL)
     ORDER BY last_seen_at DESC LIMIT 1;
   IF rid IS NULL THEN
     INSERT INTO release_history(store_app_id,release_key,version,release_date,first_seen_at,last_seen_at,first_snapshot_id,last_snapshot_id)
       VALUES(s.store_app_id,'play-observed:'||s.id,s.version,s.source_updated_at,s.collected_at,s.collected_at,s.id,s.id) RETURNING id INTO rid;
   ELSE
     UPDATE release_history SET version=COALESCE(s.version,version),
       last_snapshot_id=CASE WHEN s.collected_at>=last_seen_at THEN s.id ELSE last_snapshot_id END,
       last_seen_at=GREATEST(last_seen_at,s.collected_at) WHERE id=rid;
   END IF;
   INSERT INTO release_note_revisions(release_history_id,notes,notes_hash,first_seen_at,last_seen_at)
     VALUES(rid,COALESCE(s.latest_notes,''),encode(sha256(convert_to(COALESCE(s.latest_notes,''),'UTF8')),'hex'),s.collected_at,s.collected_at)
     ON CONFLICT(release_history_id,notes_hash) DO NOTHING;
 END LOOP;
END $$;
-- Missing descriptions are valid observations, not partial collection errors.
UPDATE store_snapshots s SET normalized_payload=(s.normalized_payload || '{"quality":"complete","warning":null}'::jsonb),
 content_hash=encode(sha256(convert_to((s.normalized_payload || '{"quality":"complete","warning":null}'::jsonb)::text,'UTF8')),'hex')
 FROM store_apps a WHERE s.store_app_id=a.id AND a.platform='play_store' AND s.source_updated_at IS NOT NULL
 AND s.normalized_payload->>'warning'='업데이트 날짜 또는 새로운 기능을 확인하지 못했습니다.';
INSERT INTO schema_migrations(version) VALUES('20261024000000') ON CONFLICT DO NOTHING;
