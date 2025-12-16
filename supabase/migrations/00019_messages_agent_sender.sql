-- Migration: 00019_messages_agent_sender
-- Description: Add sent_by_agent_id column to messages table for human agent messages
-- Date: 2024-12-14

-- =============================================================================
-- Add sent_by_agent_id to messages tables
-- =============================================================================

-- client_template schema
ALTER TABLE client_template.messages 
  ADD COLUMN IF NOT EXISTS sent_by_agent_id UUID REFERENCES client_template.human_agents(id);

-- Index for filtering agent messages
CREATE INDEX IF NOT EXISTS idx_messages_agent_sender 
  ON client_template.messages(sent_by_agent_id) 
  WHERE sent_by_agent_id IS NOT NULL;

-- =============================================================================
-- client_tag_markets schema
-- =============================================================================

ALTER TABLE client_tag_markets.messages 
  ADD COLUMN IF NOT EXISTS sent_by_agent_id UUID REFERENCES client_tag_markets.human_agents(id);

-- Index for filtering agent messages
CREATE INDEX IF NOT EXISTS idx_messages_agent_sender 
  ON client_tag_markets.messages(sent_by_agent_id) 
  WHERE sent_by_agent_id IS NOT NULL;
