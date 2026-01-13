-- Migration: 00024_independent_knowledge_bases
-- Description: Create independent Knowledge Bases that can be associated with State Machines
-- Date: 2026-01-08

-- =============================================================================
-- KNOWLEDGE_BASES TABLE (client_template)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- KNOWLEDGE_BASES TABLE (client_tag_markets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ADD KB_ID TO KNOWLEDGE_BASE TABLE (client_template)
-- =============================================================================

-- Add kb_id foreign key column (nullable for now to allow gradual migration)
ALTER TABLE client_template.knowledge_base 
  ADD COLUMN IF NOT EXISTS kb_id UUID REFERENCES client_template.knowledge_bases(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_kb_kb_id ON client_template.knowledge_base(kb_id) WHERE is_active = TRUE;

-- =============================================================================
-- ADD KB_ID TO KNOWLEDGE_BASE TABLE (client_tag_markets)
-- =============================================================================

ALTER TABLE client_tag_markets.knowledge_base 
  ADD COLUMN IF NOT EXISTS kb_id UUID REFERENCES client_tag_markets.knowledge_bases(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_kb_kb_id ON client_tag_markets.knowledge_base(kb_id) WHERE is_active = TRUE;

-- =============================================================================
-- STATE_MACHINE_KNOWLEDGE_BASES JUNCTION TABLE (client_template)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.state_machine_knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_machine_id UUID NOT NULL REFERENCES client_template.state_machines(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES client_template.knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state_machine_id, kb_id)
);

CREATE INDEX IF NOT EXISTS idx_sm_kb_state_machine ON client_template.state_machine_knowledge_bases(state_machine_id);
CREATE INDEX IF NOT EXISTS idx_sm_kb_kb ON client_template.state_machine_knowledge_bases(kb_id);

-- =============================================================================
-- STATE_MACHINE_KNOWLEDGE_BASES JUNCTION TABLE (client_tag_markets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.state_machine_knowledge_bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_machine_id UUID NOT NULL REFERENCES client_tag_markets.state_machines(id) ON DELETE CASCADE,
  kb_id UUID NOT NULL REFERENCES client_tag_markets.knowledge_bases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state_machine_id, kb_id)
);

CREATE INDEX IF NOT EXISTS idx_sm_kb_state_machine ON client_tag_markets.state_machine_knowledge_bases(state_machine_id);
CREATE INDEX IF NOT EXISTS idx_sm_kb_kb ON client_tag_markets.state_machine_knowledge_bases(kb_id);

-- =============================================================================
-- ROW LEVEL SECURITY (client_template)
-- =============================================================================

ALTER TABLE client_template.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.state_machine_knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON client_template.knowledge_bases
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON client_template.state_machine_knowledge_bases
  FOR ALL USING (auth.role() = 'service_role');

-- Public access for anon/authenticated (since we're using no-verify-jwt in dev)
CREATE POLICY "Public full access" ON client_template.knowledge_bases
  FOR ALL USING (true);

CREATE POLICY "Authenticated full access" ON client_template.knowledge_bases
  FOR ALL TO authenticated USING (true);

CREATE POLICY "Public full access" ON client_template.state_machine_knowledge_bases
  FOR ALL USING (true);

CREATE POLICY "Authenticated full access" ON client_template.state_machine_knowledge_bases
  FOR ALL TO authenticated USING (true);

-- =============================================================================
-- ROW LEVEL SECURITY (client_tag_markets)
-- =============================================================================

ALTER TABLE client_tag_markets.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tag_markets.state_machine_knowledge_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON client_tag_markets.knowledge_bases
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON client_tag_markets.state_machine_knowledge_bases
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public full access" ON client_tag_markets.knowledge_bases
  FOR ALL USING (true);

CREATE POLICY "Authenticated full access" ON client_tag_markets.knowledge_bases
  FOR ALL TO authenticated USING (true);

CREATE POLICY "Public full access" ON client_tag_markets.state_machine_knowledge_bases
  FOR ALL USING (true);

CREATE POLICY "Authenticated full access" ON client_tag_markets.state_machine_knowledge_bases
  FOR ALL TO authenticated USING (true);

-- =============================================================================
-- TRIGGERS (client_template)
-- =============================================================================

CREATE TRIGGER knowledge_bases_updated_at
  BEFORE UPDATE ON client_template.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();

-- =============================================================================
-- TRIGGERS (client_tag_markets)
-- =============================================================================

CREATE TRIGGER knowledge_bases_updated_at
  BEFORE UPDATE ON client_tag_markets.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION client_tag_markets.update_updated_at();

-- =============================================================================
-- GRANTS (client_template)
-- =============================================================================

GRANT ALL ON TABLE client_template.knowledge_bases TO service_role;
GRANT ALL ON TABLE client_template.knowledge_bases TO postgres;
GRANT ALL ON TABLE client_template.knowledge_bases TO authenticated;
GRANT ALL ON TABLE client_template.knowledge_bases TO anon;

GRANT ALL ON TABLE client_template.state_machine_knowledge_bases TO service_role;
GRANT ALL ON TABLE client_template.state_machine_knowledge_bases TO postgres;
GRANT ALL ON TABLE client_template.state_machine_knowledge_bases TO authenticated;
GRANT ALL ON TABLE client_template.state_machine_knowledge_bases TO anon;

-- =============================================================================
-- GRANTS (client_tag_markets)
-- =============================================================================

GRANT ALL ON TABLE client_tag_markets.knowledge_bases TO service_role;
GRANT ALL ON TABLE client_tag_markets.knowledge_bases TO postgres;
GRANT ALL ON TABLE client_tag_markets.knowledge_bases TO authenticated;
GRANT ALL ON TABLE client_tag_markets.knowledge_bases TO anon;

GRANT ALL ON TABLE client_tag_markets.state_machine_knowledge_bases TO service_role;
GRANT ALL ON TABLE client_tag_markets.state_machine_knowledge_bases TO postgres;
GRANT ALL ON TABLE client_tag_markets.state_machine_knowledge_bases TO authenticated;
GRANT ALL ON TABLE client_tag_markets.state_machine_knowledge_bases TO anon;
