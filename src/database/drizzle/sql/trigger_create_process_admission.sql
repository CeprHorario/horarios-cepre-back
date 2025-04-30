-- Paso 1: Define solo la función trigger (ejecutar primero)
CREATE OR REPLACE FUNCTION trigger_create_process_admission() 
RETURNS TRIGGER AS $$
BEGIN 
    -- Marcar los demás procesos como no actuales
    UPDATE admission_processes SET is_current = false WHERE id <> NEW.id;
    
    -- Crear un esquema vacío con el nombre del nuevo proceso
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', NEW.name);
    
    RETURN NEW; 
END; 
$$ LANGUAGE plpgsql;

-- Paso 2: Una vez que la tabla ya existe, agrega el trigger (ejecutar después)
-- Este paso debería ejecutarse después de que la tabla admission_processes
-- haya sido creada por el sistema de migraciones.
DROP TRIGGER IF EXISTS after_insert_admission_process ON admission_processes;

CREATE TRIGGER after_insert_admission_process
AFTER INSERT ON admission_processes 
FOR EACH ROW 
EXECUTE FUNCTION trigger_create_process_admission();