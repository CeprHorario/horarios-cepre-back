ALTER TABLE class_session_records ADD COLUMN class_state VARCHAR(2);
ALTER TABLE class_session_records ADD CONSTRAINT session_class_state CHECK (class_state IS NULL OR class_state IN ('N','T','SD','RN','RE'));
