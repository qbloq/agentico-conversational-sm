-- Migration 00038: Robust Follow-up Queue
-- Adds processing locks and retry tracking to the followup_queue table in all client schemas.

DO $$
DECLARE
    schema_name_record RECORD;
BEGIN
    FOR schema_name_record IN 
        SELECT DISTINCT schema_name 
        FROM public.client_configs 
        WHERE is_active = TRUE
    LOOP
        -- 1. Add processing_started_at for concurrency control
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = schema_name_record.schema_name 
            AND table_name = 'followup_queue' 
            AND column_name = 'processing_started_at'
        ) THEN
            EXECUTE format('ALTER TABLE %I.followup_queue ADD COLUMN processing_started_at TIMESTAMPTZ', schema_name_record.schema_name);
        END IF;

        -- 2. Add retry_count for reliability
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = schema_name_record.schema_name 
            AND table_name = 'followup_queue' 
            AND column_name = 'retry_count'
        ) THEN
            EXECUTE format('ALTER TABLE %I.followup_queue ADD COLUMN retry_count INTEGER DEFAULT 0', schema_name_record.schema_name);
        END IF;

        -- 3. Add last_error for debugging
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = schema_name_record.schema_name 
            AND table_name = 'followup_queue' 
            AND column_name = 'last_error'
        ) THEN
            EXECUTE format('ALTER TABLE %I.followup_queue ADD COLUMN last_error TEXT', schema_name_record.schema_name);
        END IF;

        -- 4. Add index for efficient querying of pending items
        EXECUTE format('
            CREATE INDEX IF NOT EXISTS idx_followup_queue_pending_process 
            ON %I.followup_queue (status, scheduled_at) 
            WHERE status = ''pending'' AND processing_started_at IS NULL
        ', schema_name_record.schema_name);

    END LOOP;
END $$;
