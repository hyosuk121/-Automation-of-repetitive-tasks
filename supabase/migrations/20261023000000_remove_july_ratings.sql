-- Only the July 9 ratings/counts are withdrawn; release history and other metrics remain.
CREATE OR REPLACE FUNCTION remove_july_ratings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.collected_at AT TIME ZONE 'Asia/Seoul')::date=DATE '2026-07-09' THEN
  NEW.rating=NULL;
  NEW.rating_count=NULL;
  NEW.normalized_payload=NEW.normalized_payload-'rating'-'ratingCount' #- '{legacy,rating}' #- '{legacy,ratingCount}';
  NEW.content_hash=encode(sha256(convert_to(NEW.normalized_payload::text,'UTF8')),'hex');
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS remove_july_ratings ON store_snapshots;
CREATE TRIGGER remove_july_ratings BEFORE INSERT OR UPDATE ON store_snapshots FOR EACH ROW EXECUTE FUNCTION remove_july_ratings();
UPDATE store_snapshots SET rating=NULL,rating_count=NULL WHERE (collected_at AT TIME ZONE 'Asia/Seoul')::date=DATE '2026-07-09';
DELETE FROM change_events WHERE field IN ('rating','ratingCount') AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date=DATE '2026-07-09';
INSERT INTO schema_migrations(version) VALUES('20261023000000') ON CONFLICT DO NOTHING;
