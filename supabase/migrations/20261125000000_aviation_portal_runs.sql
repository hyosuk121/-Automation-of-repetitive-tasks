CREATE TABLE IF NOT EXISTS aviation_portal_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
 summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS aviation_portal_runs_owner_started ON aviation_portal_runs(owner_id,started_at DESC);
ALTER TABLE aviation_portal_runs ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES('20261125000000') ON CONFLICT DO NOTHING;
