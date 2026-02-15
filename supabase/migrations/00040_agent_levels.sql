-- Migration: 00040_agent_levels
-- Description: Add role level to human_agents for RBAC in human agent app
-- Date: 2026-02-14

-- =============================================================================
-- CLIENT TEMPLATE SCHEMA
-- =============================================================================

ALTER TABLE client_template.human_agents
  ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'agent'
  CHECK (level IN ('agent', 'manager', 'admin'));

COMMENT ON COLUMN client_template.human_agents.level
  IS 'Agent role level for app authorization: agent, manager, admin.';

-- =============================================================================
-- CLIENT TAG_MARKETS SCHEMA
-- =============================================================================

ALTER TABLE client_tag_markets.human_agents
  ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'agent'
  CHECK (level IN ('agent', 'manager', 'admin'));

COMMENT ON COLUMN client_tag_markets.human_agents.level
  IS 'Agent role level for app authorization: agent, manager, admin.';
