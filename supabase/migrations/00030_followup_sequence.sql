-- Migration 00030: Add sequence_index to followup_queue in all client schemas

DO $$
DECLARE
    schema_name_record RECORD;
BEGIN
    FOR schema_name_record IN 
        SELECT DISTINCT schema_name 
        FROM public.client_configs 
        WHERE is_active = TRUE
    LOOP
        -- Check if followup_queue table exists in this schema
        IF EXISTS (
            SELECT 1 
            FROM information_schema.tables 
            WHERE table_schema = schema_name_record.schema_name 
            AND table_name = 'followup_queue'
        ) THEN
            -- Check if sequence_index column already exists
            IF NOT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = schema_name_record.schema_name 
                AND table_name = 'followup_queue' 
                AND column_name = 'sequence_index'
            ) THEN
                EXECUTE format('ALTER TABLE %I.followup_queue ADD COLUMN sequence_index INTEGER DEFAULT 0', schema_name_record.schema_name);
                RAISE NOTICE 'Added sequence_index to %.followup_queue', schema_name_record.schema_name;
            END IF;
        END IF;
    END LOOP;
END $$;
