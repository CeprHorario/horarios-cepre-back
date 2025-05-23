-- Trigger para asegurar que solo un proceso de admisión puede ser actual
CREATE OR REPLACE FUNCTION trigger_process_admission() 
RETURNS TRIGGER AS $$
DECLARE
  schema_name TEXT;
BEGIN
  IF NEW.is_current THEN
    UPDATE admission_processes
    SET is_current = FALSE
    WHERE is_current = TRUE AND id IS DISTINCT FROM NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger solo para INSERT y UPDATE
DROP TRIGGER IF EXISTS trg_single_current_process ON admission_processes;

CREATE OR REPLACE TRIGGER trg_single_current_process
BEFORE INSERT OR UPDATE ON admission_processes
FOR EACH ROW
EXECUTE FUNCTION trigger_process_admission();
