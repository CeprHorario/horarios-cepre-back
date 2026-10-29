-- Apply inside the explicitly selected academic schema; never rebuild public.
CREATE UNIQUE INDEX schedules_class_id_weekday_hour_session_id_key ON schedules(class_id, weekday, hour_session_id);

CREATE TABLE class_session_records (
  id SERIAL PRIMARY KEY, date DATE NOT NULL,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  hour_session_id SMALLINT NOT NULL REFERENCES hour_sessions(id) ON DELETE RESTRICT,
  shift_id SMALLINT NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  area_id SMALLINT NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  course_id SMALLINT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  schedule_id INT REFERENCES schedules(id) ON DELETE RESTRICT,
  origin VARCHAR(16) NOT NULL DEFAULT 'REGULAR' CHECK (origin IN ('REGULAR','RECOVERY')),
  original_record_id INT REFERENCES class_session_records(id) ON DELETE RESTRICT,
  scheduled_start TIMESTAMPTZ(3) NOT NULL, scheduled_end TIMESTAMPTZ(3) NOT NULL,
  shift_end TIMESTAMPTZ(3) NOT NULL, edit_deadline TIMESTAMPTZ(3) NOT NULL,
  period INT NOT NULL CHECK (period > 0), pedagogical_minutes INT NOT NULL CHECK (pedagogical_minutes > 0),
  titular_teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
  effective_teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
  titular_monitor_id UUID REFERENCES monitors(id) ON DELETE RESTRICT,
  effective_monitor_id UUID REFERENCES monitors(id) ON DELETE RESTRICT,
  monitor_account_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  supervisor_id UUID REFERENCES supervisors(id) ON DELETE RESTRICT,
  snapshot JSONB NOT NULL, effective_snapshot JSONB NOT NULL DEFAULT '{}',
  actual_start TIMESTAMPTZ(3), actual_end TIMESTAMPTZ(3),
  teaching_status VARCHAR(24) NOT NULL DEFAULT 'UNCONFIRMED' CHECK (teaching_status IN ('UNCONFIRMED','TAUGHT','NOT_TAUGHT','INTERRUPTED')),
  titular_outcome VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN' CHECK (titular_outcome IN ('UNKNOWN','PRESENT','ABSENT','PLANNED_REPLACEMENT')),
  incidents TEXT, initial_file_id UUID, final_file_id UUID,
  initial_associated_at TIMESTAMPTZ(3), final_associated_at TIMESTAMPTZ(3),
  initial_associated_by JSONB, final_associated_by JSONB,
  timing_policy JSONB NOT NULL, version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(3), deleted_by JSONB, deletion_reason TEXT,
  CONSTRAINT class_session_records_date_class_id_hour_session_id_key UNIQUE(date,class_id,hour_session_id),
  CHECK(scheduled_end > scheduled_start AND shift_end >= scheduled_end),
  CHECK(edit_deadline = shift_end + INTERVAL '90 minutes'),
  CHECK(actual_start IS NULL OR actual_end IS NULL OR actual_end >= actual_start),
  CHECK(origin <> 'RECOVERY' OR original_record_id IS NOT NULL)
);
CREATE INDEX class_session_records_titular_monitor_id_date_idx ON class_session_records(titular_monitor_id,date);
CREATE INDEX class_session_records_effective_teacher_id_date_idx ON class_session_records(effective_teacher_id,date);
CREATE INDEX session_followup_idx ON class_session_records(scheduled_start) WHERE deleted_at IS NULL AND actual_start IS NULL;

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT uuidv7(), record_id INT REFERENCES class_session_records(id) ON DELETE RESTRICT,
  bucket TEXT NOT NULL, object_name TEXT NOT NULL UNIQUE, generation TEXT,
  original_name TEXT NOT NULL, content_type TEXT NOT NULL, size INT NOT NULL CHECK(size > 0),
  checksum TEXT, uploaded_by JSONB NOT NULL, uploaded_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','AVAILABLE','FAILED')),
  deleted_at TIMESTAMPTZ(3), deleted_by JSONB, deletion_reason TEXT,
  CHECK(status <> 'AVAILABLE' OR (generation IS NOT NULL AND checksum IS NOT NULL))
);
ALTER TABLE class_session_records ADD CONSTRAINT class_session_records_initial_file_id_fkey FOREIGN KEY(initial_file_id) REFERENCES files(id) ON DELETE RESTRICT;
ALTER TABLE class_session_records ADD CONSTRAINT class_session_records_final_file_id_fkey FOREIGN KEY(final_file_id) REFERENCES files(id) ON DELETE RESTRICT;

CREATE TABLE session_coverages (
  id SERIAL PRIMARY KEY, record_id INT NOT NULL REFERENCES class_session_records(id) ON DELETE RESTRICT,
  kind VARCHAR(16) NOT NULL CHECK(kind IN ('TEACHER','MONITOR')),
  teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
  monitor_id UUID REFERENCES monitors(id) ON DELETE RESTRICT,
  mode VARCHAR(16) NOT NULL CHECK(mode IN ('PLANNED','EMERGENCY')),
  status VARCHAR(16) NOT NULL CHECK(status IN ('PENDING','AUTHORIZED','REJECTED','REVOKED')),
  person_snapshot JSONB NOT NULL, operation_id UUID NOT NULL, requested_by JSONB NOT NULL,
  requested_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by JSONB, resolved_at TIMESTAMPTZ(3), reason TEXT NOT NULL,
  CHECK((kind='TEACHER' AND teacher_id IS NOT NULL AND monitor_id IS NULL) OR (kind='MONITOR' AND monitor_id IS NOT NULL AND teacher_id IS NULL))
);
CREATE UNIQUE INDEX session_coverage_active_key ON session_coverages(record_id,kind) WHERE status IN ('PENDING','AUTHORIZED');

CREATE TABLE session_audit_events (
  id SERIAL PRIMARY KEY, record_id INT REFERENCES class_session_records(id) ON DELETE RESTRICT,
  action TEXT NOT NULL, actor JSONB NOT NULL, before JSONB, after JSONB, reason TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX session_audit_events_record_id_id_idx ON session_audit_events(record_id,id);

CREATE TABLE session_reviews (
  id SERIAL PRIMARY KEY, record_id INT NOT NULL REFERENCES class_session_records(id) ON DELETE RESTRICT,
  record_version INT NOT NULL, supervisor_id UUID NOT NULL REFERENCES supervisors(id) ON DELETE RESTRICT,
  result VARCHAR(16) NOT NULL CHECK(result IN ('CONFORMING','OBSERVED')), comments TEXT,
  files JSONB NOT NULL, actor JSONB NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(record_id,record_version)
);
CREATE TABLE session_edit_grants (
  id SERIAL PRIMARY KEY, record_id INT NOT NULL REFERENCES class_session_records(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ(3) NOT NULL, reason TEXT NOT NULL, granted_by JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMPTZ(3), revoked_by JSONB,
  CHECK(expires_at > created_at)
);
CREATE INDEX session_edit_grants_record_id_account_id_expires_at_idx ON session_edit_grants(record_id,account_id,expires_at);
CREATE TABLE session_alerts (
  id SERIAL PRIMARY KEY, record_id INT NOT NULL REFERENCES class_session_records(id) ON DELETE RESTRICT,
  type VARCHAR(32) NOT NULL, supervisor_id UUID,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ(3), acknowledged_by JSONB, UNIQUE(record_id,type)
);
CREATE INDEX session_alerts_supervisor_id_acknowledged_at_id_idx ON session_alerts(supervisor_id,acknowledged_at,id);
CREATE TABLE session_operational_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT false,
  starts_on DATE, ends_on DATE,
  lateness_tolerance_minutes INT CHECK(lateness_tolerance_minutes >= 0),
  replacement_wait_minutes INT CHECK(replacement_wait_minutes >= 0),
  alert_threshold_minutes INT CHECK(alert_threshold_minutes >= 0),
  continuity_gap_minutes INT CHECK(continuity_gap_minutes >= 0),
  version INT NOT NULL DEFAULT 1, updated_by JSONB,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CHECK(NOT enabled OR (starts_on IS NOT NULL AND ends_on IS NOT NULL))
);
INSERT INTO session_operational_config(id) VALUES(1);

-- The API has no physical-delete operation. Protect retention also against accidental ORM deletes.
CREATE FUNCTION session_prevent_delete() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Session history is retained; use logical cancellation'; END;
$$;
CREATE TRIGGER session_records_no_delete BEFORE DELETE ON class_session_records FOR EACH ROW EXECUTE FUNCTION session_prevent_delete();
CREATE TRIGGER session_files_no_delete BEFORE DELETE ON files FOR EACH ROW EXECUTE FUNCTION session_prevent_delete();
CREATE TRIGGER session_events_immutable BEFORE UPDATE OR DELETE ON session_audit_events FOR EACH ROW EXECUTE FUNCTION session_prevent_delete();
CREATE TRIGGER session_reviews_immutable BEFORE UPDATE OR DELETE ON session_reviews FOR EACH ROW EXECUTE FUNCTION session_prevent_delete();

-- clock_timestamp is evaluated at the actual write, not at request/transaction start.
CREATE FUNCTION session_check_write_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r class_session_records; account TEXT;
BEGIN
  account := current_setting('cepr.session_account',true);
  IF account IS NULL OR account='' OR current_setting('cepr.session_override',true)='true' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='files' THEN
    IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO r FROM class_session_records WHERE id=NEW.record_id;
  ELSE r := OLD; END IF;
  IF r.deleted_at IS NOT NULL OR clock_timestamp()<r.scheduled_start OR
    (clock_timestamp()>=r.edit_deadline AND NOT EXISTS (
      SELECT 1 FROM session_edit_grants g WHERE g.record_id=r.id AND g.account_id=account::uuid
        AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
    )) THEN RAISE EXCEPTION 'SESSION_EDIT_CLOSED' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_record_deadline BEFORE UPDATE ON class_session_records FOR EACH ROW EXECUTE FUNCTION session_check_write_deadline();
CREATE TRIGGER session_file_deadline BEFORE INSERT OR UPDATE ON files FOR EACH ROW EXECUTE FUNCTION session_check_write_deadline();

CREATE VIEW v_class_session_records_report AS
WITH facts AS (
  SELECT r.*, CASE WHEN tc.status='AUTHORIZED' THEN tc.teacher_id END AS authorized_teacher_id,
    tc.teacher_id AS requested_teacher_id,tc.person_snapshot AS teacher_replacement_snapshot,tc.mode AS teacher_replacement_mode,
    tc.status AS teacher_replacement_authorization, CASE WHEN mc.status='AUTHORIZED' THEN mc.monitor_id END AS authorized_monitor_id,
    mc.monitor_id AS requested_monitor_id,mc.person_snapshot AS monitor_replacement_snapshot,
    mc.mode AS monitor_replacement_mode, mc.status AS monitor_replacement_authorization,
    review.result AS review_result,
    prev.id AS previous_id, prev.effective_teacher_id AS previous_teacher_id,
    prev.actual_start AS previous_start, prev.actual_end AS previous_end, prev.teaching_status AS previous_status,
    prev.period AS previous_period, prev.scheduled_end AS previous_scheduled_end,
    (r.timing_policy->>'latenessToleranceMinutes')::int AS tolerance,
    (r.timing_policy->>'continuityGapMinutes')::int AS continuity_gap
  FROM class_session_records r
  LEFT JOIN LATERAL (SELECT * FROM session_coverages c WHERE c.record_id=r.id AND c.kind='TEACHER' ORDER BY (c.status IN ('PENDING','AUTHORIZED')) DESC,c.id DESC LIMIT 1) tc ON true
  LEFT JOIN LATERAL (SELECT * FROM session_coverages c WHERE c.record_id=r.id AND c.kind='MONITOR' ORDER BY (c.status IN ('PENDING','AUTHORIZED')) DESC,c.id DESC LIMIT 1) mc ON true
  LEFT JOIN LATERAL (SELECT v.result FROM session_reviews v WHERE v.record_id=r.id AND v.record_version=r.version LIMIT 1) review ON true
  LEFT JOIN LATERAL (SELECT p.* FROM class_session_records p WHERE p.date=r.date AND p.class_id=r.class_id AND p.shift_id=r.shift_id AND p.deleted_at IS NULL AND p.scheduled_start<r.scheduled_start ORDER BY p.scheduled_start DESC,p.id DESC LIMIT 1) prev ON true
), classified AS (
  SELECT facts.*,
    CASE
      WHEN actual_start IS NULL OR effective_teacher_id IS NULL OR teaching_status='UNCONFIRMED' THEN 'PENDING'
      WHEN previous_id IS NULL OR previous_period<>period-1 OR previous_teacher_id<>effective_teacher_id THEN 'ARRIVAL'
      WHEN previous_start IS NULL OR previous_end IS NULL OR previous_teacher_id IS NULL OR previous_status='UNCONFIRMED' THEN 'PENDING'
      WHEN continuity_gap IS NULL THEN 'UNCONFIGURED'
      WHEN EXTRACT(EPOCH FROM (scheduled_start-previous_scheduled_end))/60 > continuity_gap THEN 'RESUMPTION'
      ELSE 'CONTINUATION'
    END AS timing_kind
  FROM facts
)
SELECT id,date,class_id,hour_session_id,shift_id,area_id,course_id,origin,original_record_id,
  snapshot,effective_snapshot,titular_teacher_id,authorized_teacher_id,requested_teacher_id,teacher_replacement_snapshot,effective_teacher_id,
  titular_monitor_id,authorized_monitor_id,requested_monitor_id,monitor_replacement_snapshot,effective_monitor_id,
  teacher_replacement_mode,teacher_replacement_authorization,monitor_replacement_mode,monitor_replacement_authorization,
  scheduled_start,scheduled_end,actual_start,actual_end,period,pedagogical_minutes,
  1 AS pedagogical_blocks,
  EXTRACT(EPOCH FROM (scheduled_end-scheduled_start))/60 AS scheduled_minutes,
  CASE WHEN actual_start IS NOT NULL AND actual_end IS NOT NULL THEN EXTRACT(EPOCH FROM (actual_end-actual_start))/60 END AS actual_minutes,
  CASE WHEN actual_start IS NOT NULL AND actual_end IS NOT NULL THEN EXTRACT(EPOCH FROM (actual_end-actual_start))/3600 END AS actual_clock_hours,
  timing_policy,timing_kind,
  CASE WHEN timing_kind IN ('ARRIVAL','RESUMPTION') AND tolerance IS NULL THEN 'UNCONFIGURED'
       WHEN timing_kind IN ('ARRIVAL','RESUMPTION') THEN CASE WHEN actual_start>scheduled_start+make_interval(mins=>tolerance) THEN 'LATE' ELSE 'ON_TIME' END
       ELSE timing_kind END AS timing_classification,
  CASE WHEN timing_kind='ARRIVAL' AND tolerance IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (actual_start-scheduled_start))/60) END AS arrival_delay_minutes,
  CASE WHEN timing_kind='RESUMPTION' AND tolerance IS NOT NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (actual_start-scheduled_start))/60) END AS resumption_delay_minutes,
  titular_outcome, titular_outcome='ABSENT' AS titular_absent,teaching_status,incidents,
  CASE WHEN teaching_status='UNCONFIRMED' OR effective_monitor_id IS NULL OR initial_file_id IS NULL OR final_file_id IS NULL OR (teaching_status='TAUGHT' AND (actual_start IS NULL OR actual_end IS NULL OR effective_teacher_id IS NULL)) THEN 'INCOMPLETE' ELSE 'COMPLETE' END AS completeness,
  COALESCE(review_result,'PENDING') AS review_status, version,deleted_at
FROM classified;
