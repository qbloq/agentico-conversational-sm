-- Migration 00036: Advanced Follow-up System v3
-- Creates a global registry for follow-up configurations and updates the queue to reference it.

DO $$
DECLARE
    schema_name_record RECORD;
BEGIN
    FOR schema_name_record IN 
        SELECT DISTINCT schema_name 
        FROM public.client_configs 
        WHERE is_active = TRUE
    LOOP
        -- 1. Create followup_configs registry table
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.followup_configs (
                name TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN (''text'', ''template'')),
                content TEXT NOT NULL,
                variables_config JSONB DEFAULT ''[]''::jsonb,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        ', schema_name_record.schema_name);

        -- 1.1 Enable RLS for followup_configs
        EXECUTE format('ALTER TABLE %I.followup_configs ENABLE ROW LEVEL SECURITY', schema_name_record.schema_name);

        -- 1.2 Create RLS policies for followup_configs
        EXECUTE format('
            DROP POLICY IF EXISTS "service_role_all" ON %I.followup_configs;
            CREATE POLICY "service_role_all" ON %I.followup_configs
                FOR ALL TO service_role USING (true) WITH CHECK (true);
        ', schema_name_record.schema_name, schema_name_record.schema_name);

        EXECUTE format('
            DROP POLICY IF EXISTS "authenticated_select" ON %I.followup_configs;
            CREATE POLICY "authenticated_select" ON %I.followup_configs
                FOR SELECT TO authenticated USING (true);
        ', schema_name_record.schema_name, schema_name_record.schema_name);

        -- 2. Update followup_queue table
        -- Check if followup_config_name column exists
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = schema_name_record.schema_name 
            AND table_name = 'followup_queue' 
            AND column_name = 'followup_config_name'
        ) THEN
            EXECUTE format('ALTER TABLE %I.followup_queue ADD COLUMN followup_config_name TEXT', schema_name_record.schema_name);
            RAISE NOTICE 'Added followup_config_name to %.followup_queue', schema_name_record.schema_name;
        END IF;

        -- 3. Ensure sequence_index column exists in followup_queue
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

    END LOOP;
END $$;
