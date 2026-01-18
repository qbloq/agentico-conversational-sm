-- Migration: 00028_sessions_state_machine
-- Description: Add state_machine_id to sessions table
-- Date: 2026-01-13

-- =============================================================================
-- ADD STATE_MACHINE_ID TO SESSIONS (TEMPLATE)
-- =============================================================================

ALTER TABLE client_template.sessions
  ADD COLUMN IF NOT EXISTS state_machine_id UUID REFERENCES client_template.state_machines(id);

-- =============================================================================
-- ADD STATE_MACHINE_ID TO SESSIONS (TAG MARKETS)
-- =============================================================================

ALTER TABLE client_tag_markets.sessions
  ADD COLUMN IF NOT EXISTS state_machine_id UUID REFERENCES client_tag_markets.state_machines(id);

-- =============================================================================
-- BACKFILL EXISTING SESSIONS
-- =============================================================================

-- Backfill existing sessions with default state machine
UPDATE client_tag_markets.sessions
SET state_machine_id = (
  SELECT id FROM client_tag_markets.state_machines 
  WHERE name = 'default_sales_flow' AND is_active = TRUE
  LIMIT 1
)
WHERE state_machine_id IS NULL;

-- =============================================================================
-- MAKE COLUMN NOT NULL
-- =============================================================================

-- Make it NOT NULL after backfill
ALTER TABLE client_tag_markets.sessions
  ALTER COLUMN state_machine_id SET NOT NULL;

-- Also update template for future clients
ALTER TABLE client_template.sessions
  ALTER COLUMN state_machine_id SET NOT NULL;

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sessions_state_machine 
  ON client_tag_markets.sessions(state_machine_id);

CREATE INDEX IF NOT EXISTS idx_sessions_state_machine 
  ON client_template.sessions(state_machine_id);

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- RLS is already enabled on sessions table, but verify service role has access
-- (This should already exist from the original schema creation, but adding for completeness)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'client_tag_markets' 
    AND tablename = 'sessions' 
    AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON client_tag_markets.sessions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
