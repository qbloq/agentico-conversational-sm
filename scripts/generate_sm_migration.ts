
import fs from 'fs';
import path from 'path';
import { STATE_CONFIGS } from '../packages/sales-engine/src/state/machine.js';

const MIGRATION_FILE = 'supabase/migrations/00013_state_machines.sql';

const stateConfigsJson = JSON.stringify(STATE_CONFIGS, null, 2);

const sql = `-- Migration: 00013_state_machines
-- Description: Create state_machines table and decouple state definition from code
-- Date: ${new Date().toISOString().split('T')[0]}

-- =============================================================================
-- STATE MACHINES TABLE (client_template)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.state_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  states JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(name, version)
);

-- =============================================================================
-- STATE MACHINES TABLE (client_tag_markets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.state_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  states JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(name, version)
);

-- =============================================================================
-- UPDATE SESSIONS TABLE (client_template)
-- =============================================================================

-- Change current_state and previous_state to TEXT to allow dynamic states
ALTER TABLE client_template.sessions 
  ALTER COLUMN current_state DROP DEFAULT,
  ALTER COLUMN current_state TYPE TEXT USING current_state::TEXT,
  ALTER COLUMN current_state SET DEFAULT 'initial',
  ALTER COLUMN previous_state TYPE TEXT USING previous_state::TEXT;

-- =============================================================================
-- UPDATE SESSIONS TABLE (client_tag_markets)
-- =============================================================================

ALTER TABLE client_tag_markets.sessions 
  ALTER COLUMN current_state DROP DEFAULT,
  ALTER COLUMN current_state TYPE TEXT USING current_state::TEXT,
  ALTER COLUMN current_state SET DEFAULT 'initial',
  ALTER COLUMN previous_state TYPE TEXT USING previous_state::TEXT;

-- =============================================================================
-- SEED DATA (client_tag_markets)
-- =============================================================================

-- Insert the current hardcoded state machine
INSERT INTO client_tag_markets.state_machines (name, version, initial_state, states, is_active)
VALUES (
  'default_sales_flow',
  '1.0.0',
  'initial',
  '${stateConfigsJson.replace(/'/g, "''")}'::jsonb,
  TRUE
) ON CONFLICT (name, version) DO NOTHING;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE client_template.state_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tag_markets.state_machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON client_template.state_machines
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON client_tag_markets.state_machines
  FOR ALL USING (auth.role() = 'service_role');
`;

fs.writeFileSync(MIGRATION_FILE, sql);
console.log(`Migration file created at ${MIGRATION_FILE}`);
