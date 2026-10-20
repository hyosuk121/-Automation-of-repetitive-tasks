CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  service_scope text NOT NULL CHECK (service_scope IN ('domestic','global','unknown')),
  sort_order integer NOT NULL DEFAULT 0,
  auto_collect boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS competitors_owner ON competitors(owner_id, sort_order);

CREATE TABLE IF NOT EXISTS store_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES competitors(id),
  platform text NOT NULL CHECK (platform IN ('app_store','play_store')),
  external_id text NOT NULL,
  store_url text NOT NULL,
  country text NOT NULL,
  language text NOT NULL DEFAULT 'ko',
  is_active boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text
);
CREATE UNIQUE INDEX IF NOT EXISTS active_platform ON store_apps(competitor_id, platform) WHERE is_active;

CREATE TABLE IF NOT EXISTS collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual','scheduled','migration')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed')),
  schedule_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  UNIQUE(owner_id, schedule_key)
);
CREATE TABLE IF NOT EXISTS collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_run_id uuid NOT NULL REFERENCES collection_runs(id),
  store_app_id uuid NOT NULL REFERENCES store_apps(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  error_code text,
  error_message text,
  finished_at timestamptz,
  UNIQUE(collection_run_id,store_app_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON collection_items(store_app_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS queue_ready ON collection_items(status,available_at);

CREATE TABLE IF NOT EXISTS store_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_app_id uuid NOT NULL REFERENCES store_apps(id),
  collection_run_id uuid NOT NULL REFERENCES collection_runs(id),
  collected_at timestamptz NOT NULL,
  source_updated_at text,
  version text,
  rating numeric,
  rating_count bigint,
  review_count bigint,
  downloads_text text,
  latest_notes text,
  app_name text,
  developer_name text,
  icon_url text,
  normalized_payload jsonb NOT NULL,
  content_hash text NOT NULL,
  UNIQUE(store_app_id,collection_run_id)
);
CREATE INDEX IF NOT EXISTS snapshot_timeline ON store_snapshots(store_app_id,collected_at DESC);
CREATE TABLE IF NOT EXISTS release_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_app_id uuid NOT NULL REFERENCES store_apps(id),
  release_key text NOT NULL,
  version text,
  release_date text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  missing_since timestamptz,
  is_present_in_source boolean NOT NULL DEFAULT true,
  first_snapshot_id uuid NOT NULL REFERENCES store_snapshots(id),
  last_snapshot_id uuid NOT NULL REFERENCES store_snapshots(id),
  UNIQUE(store_app_id, release_key)
);
CREATE TABLE IF NOT EXISTS release_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_history_id uuid NOT NULL REFERENCES release_history(id),
  notes text NOT NULL,
  notes_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  UNIQUE(release_history_id,notes_hash)
);
CREATE TABLE IF NOT EXISTS change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_app_id uuid NOT NULL REFERENCES store_apps(id),
  snapshot_id uuid NOT NULL REFERENCES store_snapshots(id),
  occurred_at timestamptz NOT NULL,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb
);
CREATE INDEX IF NOT EXISTS change_timeline ON change_events(store_app_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS migration_imports (
  owner_id uuid NOT NULL,
  record_key text NOT NULL,
  competitor_id uuid NOT NULL REFERENCES competitors(id),
  PRIMARY KEY(owner_id,record_key)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1
);

-- API/worker use the trusted PostgreSQL connection. Browser roles have no direct table access.
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_note_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Snapshots are append-only'; END;
$$;
DROP TRIGGER IF EXISTS protect_snapshots ON store_snapshots;
CREATE TRIGGER protect_snapshots BEFORE UPDATE OR DELETE ON store_snapshots
FOR EACH ROW EXECUTE FUNCTION immutable_snapshot();
