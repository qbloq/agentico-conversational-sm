-- Migration: 00038_agent_allowed_clients
-- Description: Add allowed_client_ids column to human_agents for multi-client access control
-- Date: 2026-02-12

-- =============================================================================
-- CLIENT TEMPLATE SCHEMA
-- =============================================================================

ALTER TABLE client_template.human_agents
  ADD COLUMN IF NOT EXISTS allowed_client_ids TEXT[];

COMMENT ON COLUMN client_template.human_agents.allowed_client_ids
  IS 'Array of client_id values from public.client_configs that this agent can access. NULL or empty = access to all clients in the schema.';

-- =============================================================================
-- CLIENT TAG_MARKETS SCHEMA
-- =============================================================================

ALTER TABLE client_tag_markets.human_agents
  ADD COLUMN IF NOT EXISTS allowed_client_ids TEXT[];

COMMENT ON COLUMN client_tag_markets.human_agents.allowed_client_ids
  IS 'Array of client_id values from public.client_configs that this agent can access. NULL or empty = access to all clients in the schema.';
