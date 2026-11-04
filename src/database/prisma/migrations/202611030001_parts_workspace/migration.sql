-- Adición específica de Partes; no modifica migraciones/checksums anteriores.
CREATE FUNCTION session_clock_now() RETURNS timestamptz
LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$;

CREATE OR REPLACE FUNCTION session_check_write_deadline() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r class_session_records; account TEXT; instant timestamptz; reason TEXT;
BEGIN
  account := current_setting('cepr.session_account',true);
  IF account IS NULL OR account='' OR current_setting('cepr.session_override',true)='true' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='files' THEN
    IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO r FROM class_session_records WHERE id=NEW.record_id FOR UPDATE;
  ELSE r := OLD; END IF;
  instant := session_clock_now();
  IF r.deleted_at IS NOT NULL OR instant < COALESCE(r.edit_opens_at,r.scheduled_start-(CASE WHEN r.period=1 THEN interval '5 minutes' ELSE interval '0 minutes' END)) THEN
    RAISE EXCEPTION 'SESSION_EDIT_CLOSED' USING ERRCODE='P0001';
  END IF;
  IF instant >= r.edit_deadline THEN
    IF NOT EXISTS (
      SELECT 1 FROM session_edit_grants g JOIN users u ON u.id=g.account_id
      WHERE g.record_id=r.id AND g.account_id=account::uuid
        AND u.is_active AND g.revoked_at IS NULL AND g.expires_at>instant
        AND ((u.role='monitor' AND r.monitor_account_id=u.id)
          OR (u.role='supervisor' AND EXISTS(SELECT 1 FROM supervisors s WHERE s.user_id=u.id AND s.id=r.supervisor_id)))
    ) THEN RAISE EXCEPTION 'SESSION_EDIT_CLOSED' USING ERRCODE='P0001'; END IF;
    reason := current_setting('cepr.session_reason',true);
    IF reason IS NULL OR length(btrim(reason))<3 THEN
      RAISE EXCEPTION 'SESSION_EDIT_REASON_REQUIRED' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- Una fila por parte: el índice parcial garantiza una cobertura activa por tipo.
-- La revisión solo corresponde a la versión actual; no hay continuidad ni historia pesada.
CREATE VIEW v_class_session_records_workspace AS
SELECT r.*,
  to_jsonb(tc) AS teacher_coverage, to_jsonb(mc) AS monitor_coverage,
  to_jsonb(review) AS current_review,
  CASE WHEN fi.id IS NOT NULL THEN jsonb_build_object('fileId',fi.id,'generation',fi.generation,'status',fi.status) END AS initial_capture,
  CASE WHEN ff.id IS NOT NULL THEN jsonb_build_object('fileId',ff.id,'generation',ff.generation,'status',ff.status) END AS final_capture
FROM class_session_records r
LEFT JOIN session_coverages tc ON tc.record_id=r.id AND tc.kind='TEACHER' AND tc.status IN ('PENDING','AUTHORIZED')
LEFT JOIN session_coverages mc ON mc.record_id=r.id AND mc.kind='MONITOR' AND mc.status IN ('PENDING','AUTHORIZED')
LEFT JOIN session_reviews review ON review.record_id=r.id AND review.record_version=r.version
LEFT JOIN files fi ON fi.id=r.initial_file_id
LEFT JOIN files ff ON ff.id=r.final_file_id;
