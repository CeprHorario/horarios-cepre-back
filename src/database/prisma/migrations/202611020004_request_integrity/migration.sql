ALTER TABLE replacement_requests ADD COLUMN payload_sha256 VARCHAR(64);
CREATE FUNCTION replacement_request_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','version','decided_by','decision_reason','decided_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','decided_by','decision_reason','decided_at']) THEN RAISE EXCEPTION 'REQUEST_PAYLOAD_IMMUTABLE'; END IF;
 IF OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','CANCELLED') OR NEW.version<>OLD.version+1 OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR length(trim(NEW.decision_reason))<3 THEN RAISE EXCEPTION 'REQUEST_INVALID_TRANSITION'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER replacement_requests_integrity BEFORE UPDATE ON replacement_requests FOR EACH ROW EXECUTE FUNCTION replacement_request_integrity();
