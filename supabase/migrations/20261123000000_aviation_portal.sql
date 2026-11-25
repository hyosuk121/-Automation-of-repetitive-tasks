CREATE TABLE IF NOT EXISTS aviation_portal_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('monthly','daily')),
 period text NOT NULL,
 metric text NOT NULL,
 source_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('observed','review_required')),
 total bigint,
 unmapped integer NOT NULL DEFAULT 0,
 source_rows jsonb NOT NULL,
 countries jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 check_count integer NOT NULL DEFAULT 1,
 UNIQUE(owner_id,kind,period,source_hash)
);
CREATE INDEX IF NOT EXISTS aviation_portal_owner_period ON aviation_portal_snapshots(owner_id,kind,period DESC,last_seen_at DESC);
ALTER TABLE aviation_portal_snapshots ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS aviation_portal_checks (
 owner_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('monthly','daily')),
 period text NOT NULL,
 status text NOT NULL CHECK (status IN ('running','succeeded','unavailable','failed')),
 attempts integer NOT NULL DEFAULT 1,
 lease_token uuid NOT NULL,
 retry_after timestamptz NOT NULL,
 last_checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,kind,period)
);
ALTER TABLE aviation_portal_checks ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES('20261123000000') ON CONFLICT DO NOTHING;
