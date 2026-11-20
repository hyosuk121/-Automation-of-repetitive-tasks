CREATE TABLE aviation_personal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('preferences','filter','note')),
 title text NOT NULL, payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX aviation_preferences_owner ON aviation_personal(owner_id) WHERE kind='preferences';
CREATE INDEX aviation_personal_owner ON aviation_personal(owner_id,updated_at DESC);
ALTER TABLE aviation_personal ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES('20261120010000') ON CONFLICT DO NOTHING;
