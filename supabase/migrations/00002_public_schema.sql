-- Migration: 00002_public_schema
-- Description: Public schema tables for multi-tenant client routing
-- Date: 2024-11-28

-- Channel mappings: Maps channel IDs to client schemas
-- Used by webhooks to route incoming messages to the correct client
CREATE TABLE IF NOT EXISTS public.channel_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Client identification
  client_id TEXT NOT NULL,              -- e.g., 'tag_markets'
  schema_name TEXT NOT NULL,            -- e.g., 'client_tag_markets'
  
  -- Channel identification
  channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram', 'messenger')),
  channel_id TEXT NOT NULL,             -- WhatsApp phone_number_id, Instagram page_id, etc.
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: One channel_id per channel_type
  UNIQUE(channel_type, channel_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_channel_mappings_lookup 
  ON public.channel_mappings (channel_type, channel_id) 
  WHERE is_active = TRUE;

-- Comments
COMMENT ON TABLE public.channel_mappings IS 'Maps incoming webhook channel IDs to client schemas for multi-tenant routing';
COMMENT ON COLUMN public.channel_mappings.client_id IS 'Human-readable client identifier (e.g., tag_markets)';
COMMENT ON COLUMN public.channel_mappings.schema_name IS 'PostgreSQL schema name for this client (e.g., client_tag_markets)';
COMMENT ON COLUMN public.channel_mappings.channel_id IS 'Platform-specific channel ID (WhatsApp phone_number_id, Instagram page_id, etc.)';
