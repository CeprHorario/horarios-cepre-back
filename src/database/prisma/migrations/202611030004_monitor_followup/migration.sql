CREATE TABLE session_monitor_observations (
  id UUID PRIMARY KEY DEFAULT uuidv7(), date DATE NOT NULL,
  class_id UUID NOT NULL REFERENCES classes(id), shift_id SMALLINT NOT NULL REFERENCES shifts(id),
  monitor_id UUID NOT NULL REFERENCES monitors(id), monitor_snapshot JSONB NOT NULL,
  text TEXT NOT NULL CHECK(length(btrim(text)) BETWEEN 3 AND 2000),
  author JSONB NOT NULL, updated_by JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  version INT NOT NULL DEFAULT 1 CHECK(version>0),
  deleted_at TIMESTAMPTZ, deleted_by JSONB, deletion_reason TEXT
);
CREATE INDEX session_monitor_observations_journal_idx ON session_monitor_observations(class_id,date,shift_id,monitor_id,created_at DESC,id);
CREATE TRIGGER session_monitor_observations_no_delete BEFORE DELETE ON session_monitor_observations FOR EACH ROW EXECUTE FUNCTION session_prevent_delete();
