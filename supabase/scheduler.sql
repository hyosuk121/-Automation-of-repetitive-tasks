-- Installed by the authenticated setup endpoint after Vault credentials are saved.
-- Every five minutes includes 00:00 UTC (09:00 KST). The API creates daily jobs
-- only after 09:00 KST, but resumes manual/unfinished jobs around the clock.
CREATE SCHEMA IF NOT EXISTS automation_private;
REVOKE ALL ON SCHEMA automation_private FROM PUBLIC;
CREATE OR REPLACE FUNCTION automation_private.dispatch() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target text; token text; request_id bigint;
BEGIN
 SELECT decrypted_secret INTO target FROM vault.decrypted_secrets WHERE name='automation_hub_origin';
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='automation_hub_cron_secret';
 IF target IS NULL OR token IS NULL THEN RAISE EXCEPTION 'Automation Vault settings missing'; END IF;
 SELECT net.http_post(url := target || '/api/cron',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || token),
   body := '{}'::jsonb, timeout_milliseconds := 280000) INTO request_id;
 RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION automation_private.dispatch() FROM PUBLIC;
SELECT cron.schedule('automation-hub-pump','*/5 * * * *','SELECT automation_private.dispatch();');
