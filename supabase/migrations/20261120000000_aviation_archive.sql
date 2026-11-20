-- Source observations are separate from approved, aggregated aviation statistics.
CREATE TABLE IF NOT EXISTS aviation_archives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 source_version text NOT NULL,
 content_hash text NOT NULL,
 months text[] NOT NULL,
 row_count integer NOT NULL CHECK(row_count>0),
 quality text NOT NULL CHECK(quality IN ('received','review_required')),
 source_rows jsonb NOT NULL CHECK(jsonb_typeof(source_rows)='array'),
 diagnostics jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL,
 last_seen_at timestamptz NOT NULL,
 check_count integer NOT NULL DEFAULT 1,
 UNIQUE(owner_id,source_version,content_hash)
);
CREATE INDEX IF NOT EXISTS aviation_archives_owner_seen ON aviation_archives(owner_id,last_seen_at DESC);
ALTER TABLE aviation_archives ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS aviation_daily_checks (
 owner_id uuid NOT NULL,
 check_day date NOT NULL,
 status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 1,
 lease_token uuid NOT NULL,
 retry_after timestamptz NOT NULL,
 archive_id uuid REFERENCES aviation_archives(id),
 error_code text,
 PRIMARY KEY(owner_id,check_day)
);
ALTER TABLE aviation_daily_checks ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES('20261120000000') ON CONFLICT DO NOTHING;
