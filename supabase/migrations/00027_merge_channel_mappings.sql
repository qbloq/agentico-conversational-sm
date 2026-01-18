-- Migration: 00027_merge_channel_mappings
-- Description: Merge channel_mappings into client_configs and add state_machine_name
-- Date: 2026-01-13

-- =============================================================================
-- ADD CHANNEL MAPPING COLUMNS TO CLIENT_CONFIGS
-- =============================================================================

-- Add channel columns to client_configs
ALTER TABLE public.client_configs 
  ADD COLUMN IF NOT EXISTS channel_type TEXT CHECK (channel_type IN ('whatsapp', 'instagram', 'messenger')),
  ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- Add state machine reference
ALTER TABLE public.client_configs
  ADD COLUMN IF NOT EXISTS state_machine_name TEXT NOT NULL DEFAULT 'default_sales_flow';

-- =============================================================================
-- MIGRATE DATA FROM CHANNEL_MAPPINGS
-- =============================================================================

-- Migrate data from channel_mappings to client_configs
UPDATE public.client_configs cc
SET 
  channel_type = cm.channel_type::text,
  channel_id = cm.channel_id
FROM public.channel_mappings cm
WHERE cc.client_id = cm.client_id;

-- =============================================================================
-- CONSTRAINTS AND INDEXES
-- =============================================================================

-- Create unique constraint for channel mapping
ALTER TABLE public.client_configs
  ADD CONSTRAINT unique_channel_mapping UNIQUE (channel_type, channel_id);

-- Create index for fast channel lookups
CREATE INDEX IF NOT EXISTS idx_client_configs_channel_lookup 
  ON public.client_configs (channel_type, channel_id) 
  WHERE is_active = TRUE;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- Verify RLS policies exist for service role access
-- (These should already exist from migration 00025, but adding for completeness)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'client_configs' 
    AND policyname = 'Service role has full access to client_configs'
  ) THEN
    CREATE POLICY "Service role has full access to client_configs"
      ON public.client_configs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- CLEANUP (commented out for safety - run manually after verification)
-- =============================================================================

-- After verifying the migration works correctly, you can drop the old table:
-- DROP TABLE IF EXISTS public.channel_mappings;
