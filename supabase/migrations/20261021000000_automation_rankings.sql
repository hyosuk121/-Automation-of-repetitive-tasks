CREATE TABLE IF NOT EXISTS ranking_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 platform text NOT NULL CHECK(platform IN ('app_store','play_store')),
 country text NOT NULL CHECK(country ~ '^[a-z]{2}$'),
 chart_day date NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_token uuid,
 collected_at timestamptz, error_message text,
 source_count integer,
 UNIQUE(platform,country,chart_day)
);
CREATE TABLE IF NOT EXISTS ranking_entries (
 run_id uuid NOT NULL REFERENCES ranking_runs(id),
 external_id text NOT NULL,
 rank integer NOT NULL CHECK(rank BETWEEN 1 AND 100),
 PRIMARY KEY(run_id,external_id), UNIQUE(run_id,rank)
);
CREATE TABLE IF NOT EXISTS report_imports (
 owner_id uuid NOT NULL,
 report_key text NOT NULL,
 store_app_id uuid NOT NULL REFERENCES store_apps(id),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,report_key)
);
CREATE TABLE IF NOT EXISTS automation_ticks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 status text NOT NULL DEFAULT 'running',
 error_message text
);
ALTER TABLE ranking_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_ticks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ranking_queue ON ranking_runs(status,available_at);
