ALTER TABLE replacement_requests ADD COLUMN coverage_operation_id uuid;
CREATE TABLE replacement_application_issues (
 request_id uuid NOT NULL REFERENCES replacement_requests(id), class_id uuid NOT NULL,
 hour_session_id integer NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(request_id,class_id,hour_session_id)
);
CREATE TABLE session_coverage_document_links (
 operation_id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES replacement_requests(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
