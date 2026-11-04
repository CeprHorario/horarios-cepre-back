ALTER TABLE session_coverages ADD COLUMN proposal_hash VARCHAR(64);
CREATE UNIQUE INDEX session_coverage_operation_key ON session_coverages(operation_id,record_id,kind);
