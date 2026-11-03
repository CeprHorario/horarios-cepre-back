ALTER TABLE session_operational_config ADD COLUMN early_edit_minutes INTEGER NOT NULL DEFAULT 5 CHECK (early_edit_minutes BETWEEN 0 AND 60);
ALTER TABLE session_operational_config ADD COLUMN edit_grace_minutes INTEGER NOT NULL DEFAULT 90 CHECK (edit_grace_minutes BETWEEN 0 AND 720);
ALTER TABLE class_session_records ADD COLUMN edit_opens_at TIMESTAMPTZ;
ALTER TABLE class_session_records ADD COLUMN structured_observations JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(structured_observations)='array');
UPDATE class_session_records SET edit_opens_at=scheduled_start-(CASE WHEN period=1 THEN interval '5 minutes' ELSE interval '0 minutes' END);
CREATE OR REPLACE FUNCTION session_check_write_deadline() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r class_session_records; account TEXT;
BEGIN
 account:=current_setting('cepr.session_account',true);
 IF account IS NULL OR account='' OR current_setting('cepr.session_override',true)='true' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='files' THEN IF NEW.record_id IS NULL THEN RETURN NEW; END IF; SELECT * INTO r FROM class_session_records WHERE id=NEW.record_id;
 ELSE r:=OLD; END IF;
 IF r.deleted_at IS NOT NULL OR clock_timestamp()<COALESCE(r.edit_opens_at,r.scheduled_start-(CASE WHEN r.period=1 THEN interval '5 minutes' ELSE interval '0 minutes' END)) OR clock_timestamp()>=r.edit_deadline THEN RAISE EXCEPTION 'SESSION_EDIT_CLOSED' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END; $$;

CREATE TABLE replacement_requests (
 id UUID PRIMARY KEY DEFAULT uuidv7(), requester_user_id UUID NOT NULL, requester_role VARCHAR(48) NOT NULL,
 subject_user_id UUID, subject_role VARCHAR(16) NOT NULL CHECK(subject_role IN ('profesor','monitor','supervisor')),
 kind VARCHAR(16) NOT NULL CHECK(kind IN ('NORMAL','EMERGENCY')), replacement_user_id UUID NOT NULL REFERENCES users(id),
 class_id UUID REFERENCES classes(id), course_id SMALLINT REFERENCES courses(id), date DATE NOT NULL,
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at), blocks JSONB NOT NULL CHECK(jsonb_typeof(blocks)='array'),
 reason TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 version INTEGER NOT NULL DEFAULT 1, approver_supervisor_id UUID REFERENCES supervisors(id),
 pdf_object VARCHAR(300) NOT NULL, pdf_generation VARCHAR(32) NOT NULL, pdf_sha256 VARCHAR(64) NOT NULL,
 pdf_size INTEGER NOT NULL CHECK(pdf_size BETWEEN 1 AND 2097152), evidence_count INTEGER NOT NULL,
 decided_by JSONB, decision_reason TEXT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), operation_id UUID NOT NULL UNIQUE
);
CREATE INDEX replacement_requests_owner_idx ON replacement_requests(requester_user_id,created_at DESC);
CREATE INDEX replacement_requests_review_idx ON replacement_requests(status,approver_supervisor_id,created_at DESC);
CREATE INDEX replacement_requests_occupancy_idx ON replacement_requests(replacement_user_id,date) WHERE status='APPROVED';
CREATE TABLE replacement_request_events(id BIGSERIAL PRIMARY KEY,request_id UUID NOT NULL REFERENCES replacement_requests(id),action VARCHAR(24) NOT NULL,actor JSONB NOT NULL,reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX replacement_request_events_idx ON replacement_request_events(request_id,id);
CREATE FUNCTION operations_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OPERATIONS_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER replacement_events_immutable BEFORE UPDATE OR DELETE ON replacement_request_events FOR EACH ROW EXECUTE FUNCTION operations_history_guard();
CREATE TRIGGER replacement_requests_no_delete BEFORE DELETE ON replacement_requests FOR EACH ROW EXECUTE FUNCTION operations_history_guard();
