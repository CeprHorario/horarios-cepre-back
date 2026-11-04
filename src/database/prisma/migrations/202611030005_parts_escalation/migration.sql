-- No institutional defaults: NULL disables escalation until explicitly configured.
ALTER TABLE session_operational_config ADD COLUMN escalation_delay_minutes integer
  CHECK (escalation_delay_minutes BETWEEN 0 AND 1440);
