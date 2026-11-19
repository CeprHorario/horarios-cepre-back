ALTER TABLE replacement_requests ALTER COLUMN status TYPE varchar(24);
ALTER TABLE replacement_requests DROP CONSTRAINT replacement_requests_subject_role_check;
ALTER TABLE replacement_requests ADD CHECK(subject_role IN ('profesor','monitor','supervisor','coordinador'));
ALTER TABLE replacement_requests DROP CONSTRAINT replacement_requests_status_check;
ALTER TABLE replacement_requests ADD CHECK(status IN ('PENDING','ADMIN_PENDING','CHANGES','APPROVED','REJECTED','CANCELLED','SUPERSEDED'));
ALTER TABLE replacement_requests ADD COLUMN approver_coordinator_id uuid REFERENCES users(id),
 ADD COLUMN reviewed_by jsonb, ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN cancellation_stage varchar(16) CHECK(cancellation_stage IN ('REVIEW','ADMIN','CHANGES')),
 ADD COLUMN cancellation_reason text,
 ADD COLUMN revises_id uuid UNIQUE REFERENCES replacement_requests(id),
 ADD COLUMN same_turn_reason text NOT NULL DEFAULT '',
 ADD COLUMN document_data jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN docx_object varchar(300), ADD COLUMN docx_generation varchar(32), ADD COLUMN docx_sha256 varchar(64);
CREATE TABLE replacement_application_snapshots (
 request_id uuid NOT NULL REFERENCES replacement_requests(id), record_id integer NOT NULL REFERENCES class_session_records(id),
 before_value jsonb NOT NULL, applied_version integer NOT NULL, PRIMARY KEY(request_id,record_id)
);
CREATE OR REPLACE FUNCTION replacement_request_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','decided_by','decision_reason','decided_at','reviewed_by','reviewed_at','cancellation_stage','cancellation_reason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','decided_by','decision_reason','decided_at','reviewed_by','reviewed_at','cancellation_stage','cancellation_reason']) THEN RAISE EXCEPTION 'REQUEST_PAYLOAD_IMMUTABLE'; END IF;
 IF NEW.version<>OLD.version+1 OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR length(trim(NEW.decision_reason))<3 THEN RAISE EXCEPTION 'REQUEST_INVALID_TRANSITION'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
  (OLD.status='PENDING' AND NEW.status IN ('ADMIN_PENDING','CHANGES','REJECTED','CANCELLED','APPROVED')) OR
  (OLD.status='ADMIN_PENDING' AND NEW.status IN ('APPROVED','CHANGES','REJECTED','CANCELLED')) OR
  (OLD.status='CHANGES' AND NEW.status IN ('SUPERSEDED','CANCELLED')) OR
  (OLD.status='APPROVED' AND NEW.status='CANCELLED')
 ) THEN RAISE EXCEPTION 'REQUEST_INVALID_TRANSITION'; END IF;
 IF NEW.status IN ('APPROVED','CANCELLED') AND NEW.status IS DISTINCT FROM OLD.status AND NEW.decided_by->>'role'<>'administrador' THEN RAISE EXCEPTION 'REQUEST_ADMIN_FINAL_ONLY'; END IF;
 IF NEW.status=OLD.status AND NEW.cancellation_stage IS NOT DISTINCT FROM OLD.cancellation_stage THEN RAISE EXCEPTION 'REQUEST_INVALID_TRANSITION'; END IF;
 RETURN NEW;
END; $$;
