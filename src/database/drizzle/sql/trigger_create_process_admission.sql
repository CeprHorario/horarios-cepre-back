-- Función para copiar un esquema completo
CREATE OR REPLACE FUNCTION copy_schema_structure(
    source_schema TEXT, 
    target_schema TEXT
) RETURNS VOID AS $$
DECLARE 
    r RECORD;
    ddl TEXT;
    script TEXT := '';
BEGIN
    -- Crear el nuevo esquema si no existe
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', target_schema);

    -- Copiar ENUMS
    FOR r IN 
        SELECT 
            pg_type.typname AS enum_name, 
            array_agg(pg_enum.enumlabel ORDER BY pg_enum.enumsortorder) AS enum_values
        FROM 
            pg_type 
        JOIN 
            pg_enum ON pg_enum.enumtypid = pg_type.oid 
        JOIN 
            pg_namespace ON pg_namespace.oid = pg_type.typnamespace
        WHERE 
            pg_namespace.nspname = source_schema
        GROUP BY 
            pg_type.typname
    LOOP
        EXECUTE format(
            'CREATE TYPE %I.%I AS ENUM (%L)', 
            target_schema, 
            r.enum_name, 
            array_to_string(r.enum_values, ',')
        );
    END LOOP;

    -- Copiar TABLAS con estructura completa, incluyendo relaciones y constraints
    FOR r IN 
        SELECT 
            table_name AS tablename
        FROM 
            information_schema.tables
        WHERE 
            table_schema = source_schema 
            AND table_type = 'BASE TABLE'
            AND table_name != '_prisma_migrations'
    LOOP
        -- Crear tabla con toda su estructura
        EXECUTE format(
            'CREATE TABLE %I.%I (LIKE %I.%I INCLUDING ALL)', 
            target_schema, 
            r.tablename, 
            source_schema, 
            r.tablename
        );
    END LOOP;

    -- Copiar CONSTRAINTS y FOREIGN KEYS
    FOR r IN 
        SELECT 
            tc.constraint_name, 
            tc.table_name, 
            kcu.column_name, 
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name 
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu 
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu 
              ON ccu.constraint_name = tc.constraint_name
        WHERE 
            tc.constraint_type = 'FOREIGN KEY' 
            AND tc.table_schema = source_schema
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I (%I)',
                target_schema, 
                r.table_name, 
                r.constraint_name, 
                r.column_name, 
                target_schema, 
                r.foreign_table_name, 
                r.foreign_column_name
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not copy foreign key constraint %: %', r.constraint_name, SQLERRM;
        END;
    END LOOP;

    -- Copiar VISTAS
    FOR r IN 
        SELECT 
            table_name AS viewname, 
            view_definition AS definition
        FROM 
            information_schema.views
        WHERE 
            table_schema = source_schema
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE VIEW %I.%I AS %s', 
            target_schema, 
            r.viewname, 
            replace(r.definition, source_schema || '.', target_schema || '.')
        );
    END LOOP;

    -- Copiar SECUENCIAS
    FOR r IN 
        SELECT 
            sequence_name AS sequencename
        FROM 
            information_schema.sequences
        WHERE 
            sequence_schema = source_schema
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE VIEW %I.%I AS %s', 
            target_schema, 
            r.viewname, 
            replace(replace(r.definition, source_schema || '.', target_schema || '.'), E'\n', ' ')
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Modificación del trigger para usar la nueva función
CREATE OR REPLACE FUNCTION trigger_create_process_admission() 
RETURNS TRIGGER AS $$
BEGIN 
    -- Marcar los demás procesos como no actuales
    UPDATE admission_processes SET is_current = false WHERE id <> NEW.id;
    
    -- Copiar la estructura completa del esquema
    PERFORM copy_schema_structure('core_schema', NEW.name);
    
    RETURN NEW; 
END; 
$$ LANGUAGE plpgsql;

-- Crear el trigger
CREATE OR REPLACE TRIGGER after_insert_admission_process
AFTER INSERT ON admission_processes 
FOR EACH ROW 
EXECUTE FUNCTION trigger_create_process_admission();