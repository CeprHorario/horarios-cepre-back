-- date remains the operational/execution date. academic_date preserves the original journal date.
ALTER TABLE class_session_records ADD COLUMN academic_date date;
ALTER TABLE class_session_records ADD CONSTRAINT session_academic_date_order CHECK (academic_date IS NULL OR (extract(isodow FROM date)=7 AND academic_date BETWEEN date+1 AND date+6));
CREATE UNIQUE INDEX session_academic_day_key ON class_session_records((COALESCE(academic_date,date)),class_id,hour_session_id);
CREATE TABLE session_week_plans (
  week_start date PRIMARY KEY CHECK (extract(isodow FROM week_start)=1),
  advanced_weekday smallint CHECK (advanced_weekday BETWEEN 1 AND 6),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  generated_at timestamptz,
  updated_by jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE session_week_plan_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start date NOT NULL REFERENCES session_week_plans(week_start),
  actor jsonb NOT NULL, before_value jsonb, after_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION session_preserve_academic_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.academic_date IS DISTINCT FROM OLD.academic_date THEN RAISE EXCEPTION 'SESSION_ACADEMIC_DATE_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_preserve_academic_date BEFORE UPDATE ON class_session_records FOR EACH ROW EXECUTE FUNCTION session_preserve_academic_date();
