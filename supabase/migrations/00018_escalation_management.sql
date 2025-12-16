-- Migration: 00018_escalation_management
-- Description: Add human agents, OTP sessions, and escalations tables for human agent escalation management
-- Date: 2024-12-13

-- =============================================================================
-- PUBLIC SCHEMA: OTP Sessions (shared across clients)
-- =============================================================================

-- OTP sessions for WhatsApp-based agent authentication
CREATE TABLE IF NOT EXISTS public.agent_otp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp_code TEXT NOT NULL,           -- 6-digit code
  client_schema TEXT NOT NULL,      -- Which client they're logging into
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for OTP lookup
CREATE INDEX IF NOT EXISTS idx_agent_otp_phone 
  ON public.agent_otp_sessions(phone, expires_at) 
  WHERE verified = FALSE;

-- RLS for agent_otp_sessions
ALTER TABLE public.agent_otp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.agent_otp_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- Cleanup old OTP sessions (run periodically)
-- DELETE FROM public.agent_otp_sessions WHERE expires_at < NOW() - INTERVAL '1 hour';

-- =============================================================================
-- CLIENT TEMPLATE SCHEMA: Human Agents
-- =============================================================================

-- Human agents table (per client schema)
CREATE TABLE IF NOT EXISTS client_template.human_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,       -- Primary identifier for auth
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_human_agents_phone 
  ON client_template.human_agents(phone) 
  WHERE is_active = TRUE;

-- RLS
ALTER TABLE client_template.human_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_template.human_agents
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- CLIENT TEMPLATE SCHEMA: Escalations
-- =============================================================================

-- Escalations table: tracks all escalation events
CREATE TABLE IF NOT EXISTS client_template.escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_template.sessions(id),
  
  -- Escalation metadata
  reason TEXT NOT NULL,
  ai_summary TEXT,
  ai_confidence DECIMAL(3,2),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  
  -- Assignment
  assigned_to UUID REFERENCES client_template.human_agents(id),
  assigned_at TIMESTAMPTZ,
  
  -- Resolution
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'cancelled')),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Semantic enrichment (populated by LLM after resolution)
  enrichment JSONB,
  enriched_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_escalations_status 
  ON client_template.escalations(status) 
  WHERE status IN ('open', 'assigned', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_escalations_session 
  ON client_template.escalations(session_id);
CREATE INDEX IF NOT EXISTS idx_escalations_assigned 
  ON client_template.escalations(assigned_to) 
  WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS idx_escalations_created
  ON client_template.escalations(created_at DESC);

-- RLS
ALTER TABLE client_template.escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_template.escalations
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER escalations_updated_at
  BEFORE UPDATE ON client_template.escalations
  FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();

-- =============================================================================
-- CLIENT TAG_MARKETS SCHEMA: Human Agents
-- =============================================================================

-- Human agents table
CREATE TABLE IF NOT EXISTS client_tag_markets.human_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,       -- Primary identifier for auth
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_human_agents_phone 
  ON client_tag_markets.human_agents(phone) 
  WHERE is_active = TRUE;

-- RLS
ALTER TABLE client_tag_markets.human_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_tag_markets.human_agents
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- CLIENT TAG_MARKETS SCHEMA: Escalations
-- =============================================================================

-- Escalations table
CREATE TABLE IF NOT EXISTS client_tag_markets.escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_tag_markets.sessions(id),
  
  -- Escalation metadata
  reason TEXT NOT NULL,
  ai_summary TEXT,
  ai_confidence DECIMAL(3,2),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  
  -- Assignment
  assigned_to UUID REFERENCES client_tag_markets.human_agents(id),
  assigned_at TIMESTAMPTZ,
  
  -- Resolution
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'cancelled')),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Semantic enrichment (populated by LLM after resolution)
  enrichment JSONB,
  enriched_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_escalations_status 
  ON client_tag_markets.escalations(status) 
  WHERE status IN ('open', 'assigned', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_escalations_session 
  ON client_tag_markets.escalations(session_id);
CREATE INDEX IF NOT EXISTS idx_escalations_assigned 
  ON client_tag_markets.escalations(assigned_to) 
  WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS idx_escalations_created
  ON client_tag_markets.escalations(created_at DESC);

-- RLS
ALTER TABLE client_tag_markets.escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_tag_markets.escalations
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER escalations_updated_at
  BEFORE UPDATE ON client_tag_markets.escalations
  FOR EACH ROW EXECUTE FUNCTION client_tag_markets.update_updated_at();
