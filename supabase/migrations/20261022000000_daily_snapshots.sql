-- Keep the newest numerical observation per app and Korean calendar day.
-- Preserve release history, note revisions, change events and delivery receipts.
LOCK TABLE store_snapshots IN ACCESS EXCLUSIVE MODE;
DROP TRIGGER IF EXISTS protect_snapshots ON store_snapshots;
CREATE TABLE IF NOT EXISTS snapshot_receipts (
 store_app_id uuid NOT NULL REFERENCES store_apps(id),
 collection_run_id uuid NOT NULL REFERENCES collection_runs(id),
 PRIMARY KEY(store_app_id,collection_run_id)
);
ALTER TABLE snapshot_receipts ENABLE ROW LEVEL SECURITY;
INSERT INTO snapshot_receipts SELECT store_app_id,collection_run_id FROM store_snapshots ON CONFLICT DO NOTHING;
CREATE TEMP TABLE snapshot_daily_merge ON COMMIT DROP AS
 SELECT id,first_value(id) OVER (PARTITION BY store_app_id,(collected_at AT TIME ZONE 'Asia/Seoul')::date ORDER BY collected_at DESC,id DESC) AS keep_id
 FROM store_snapshots;
UPDATE release_history r SET first_snapshot_id=m.keep_id FROM snapshot_daily_merge m WHERE r.first_snapshot_id=m.id AND m.id<>m.keep_id;
UPDATE release_history r SET last_snapshot_id=m.keep_id FROM snapshot_daily_merge m WHERE r.last_snapshot_id=m.id AND m.id<>m.keep_id;
UPDATE change_events e SET snapshot_id=m.keep_id FROM snapshot_daily_merge m WHERE e.snapshot_id=m.id AND m.id<>m.keep_id;
DELETE FROM store_snapshots s USING snapshot_daily_merge m WHERE s.id=m.id AND m.id<>m.keep_id;
CREATE UNIQUE INDEX IF NOT EXISTS snapshot_daily_unique ON store_snapshots(store_app_id,((collected_at AT TIME ZONE 'Asia/Seoul')::date));
CREATE TRIGGER protect_snapshots BEFORE DELETE ON store_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
INSERT INTO schema_migrations(version) VALUES('20261022000000') ON CONFLICT DO NOTHING;
