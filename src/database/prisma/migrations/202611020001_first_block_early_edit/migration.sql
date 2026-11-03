-- El primer bloque se prepara cinco minutos antes del inicio del turno.
-- Los siguientes mantienen su inicio y ningún permiso amplía el cierre original.
CREATE OR REPLACE FUNCTION session_check_write_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r class_session_records; account TEXT;
BEGIN
  account := current_setting('cepr.session_account',true);
  IF account IS NULL OR account='' OR current_setting('cepr.session_override',true)='true' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='files' THEN
    IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO r FROM class_session_records WHERE id=NEW.record_id;
  ELSE r := OLD; END IF;
  IF r.deleted_at IS NOT NULL
     OR clock_timestamp() < (r.scheduled_start - (CASE WHEN r.period=1 THEN interval '5 minutes' ELSE interval '0 minutes' END))
     OR clock_timestamp() >= r.edit_deadline
    THEN RAISE EXCEPTION 'SESSION_EDIT_CLOSED' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END;
$$;
