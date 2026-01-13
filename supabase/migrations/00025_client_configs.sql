-- Migration: 00025_client_configs
-- Description: Database-driven client configuration tables
-- Date: 2026-01-12

-- ============================================================================
-- CLIENT CONFIGS TABLE
-- ============================================================================
-- Stores non-sensitive client configuration (business info, LLM settings, etc.)

CREATE TABLE IF NOT EXISTS public.client_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Client identification
  client_id TEXT NOT NULL UNIQUE,           -- e.g., 'tag_markets'
  schema_name TEXT NOT NULL,                -- e.g., 'client_tag_markets'
  storage_bucket TEXT,                      -- e.g., 'media-tag-markets'
  
  -- Configuration (JSONB for flexibility)
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Expected structure:
  -- {
  --   "business": { "name": "...", "description": "...", "language": "...", "timezone": "..." },
  --   "llm": { "provider": "...", "model": "...", "fallbackProvider": "...", "fallbackModel": "..." },
  --   "debounce": { "enabled": true, "delayMs": 3000 },
  --   "escalation": { "enabled": true, "notifyWhatsApp": "..." },
  --   "knowledgeBase": { "storeIds": ["..."] }
  -- }
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by client_id
CREATE INDEX IF NOT EXISTS idx_client_configs_client_id 
  ON public.client_configs (client_id) 
  WHERE is_active = TRUE;

-- Comments
COMMENT ON TABLE public.client_configs IS 'Stores non-sensitive client configuration for multi-tenant architecture';
COMMENT ON COLUMN public.client_configs.client_id IS 'Human-readable client identifier (e.g., tag_markets)';
COMMENT ON COLUMN public.client_configs.schema_name IS 'PostgreSQL schema name for this client (e.g., client_tag_markets)';
COMMENT ON COLUMN public.client_configs.config IS 'JSONB configuration object containing business, LLM, debounce, escalation, and knowledge base settings';

-- ============================================================================
-- CLIENT SECRETS TABLE
-- ============================================================================
-- Stores sensitive credentials (API tokens, app secrets, etc.)

CREATE TABLE IF NOT EXISTS public.client_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Client reference
  client_id TEXT NOT NULL REFERENCES public.client_configs(client_id) ON DELETE CASCADE,
  
  -- Channel identification
  channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram', 'messenger')),
  
  -- Secrets (JSONB for flexibility)
  secrets JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Expected structure for WhatsApp:
  -- {
  --   "phoneNumberId": "...",
  --   "accessToken": "...",
  --   "appSecret": "..."
  -- }
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: One set of secrets per client per channel
  UNIQUE(client_id, channel_type)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_client_secrets_lookup 
  ON public.client_secrets (client_id, channel_type);

-- Comments
COMMENT ON TABLE public.client_secrets IS 'Stores sensitive credentials for client channels (tokens, secrets, etc.)';
COMMENT ON COLUMN public.client_secrets.secrets IS 'JSONB object containing channel-specific credentials (phoneNumberId, accessToken, appSecret, etc.)';

-- ============================================================================
-- SEED DATA: TAG Markets
-- ============================================================================
-- Migrate existing TAG Markets configuration from hardcoded values

INSERT INTO public.client_configs (client_id, schema_name, storage_bucket, config, is_active)
VALUES (
  'tag_markets',
  'client_tag_markets',
  'media-tag-markets',
  jsonb_build_object(
    'business', jsonb_build_object(
      'name', 'TAG Markets',
      'description', 'Broker de trading con cuentas amplificadas 12x.',
      'language', 'es',
      'timezone', 'America/Bogota'
    ),
    'llm', jsonb_build_object(
      'provider', 'gemini',
      'model', 'gemini-2.5-flash',
      'fallbackProvider', 'anthropic',
      'fallbackModel', 'claude-sonnet-4-20250514'
    ),
    'debounce', jsonb_build_object(
      'enabled', true,
      'delayMs', 3000
    ),
    'escalation', jsonb_build_object(
      'enabled', true,
      'notifyWhatsApp', NULL  -- Will be set from env var in secrets
    ),
    'knowledgeBase', jsonb_build_object(
      'storeIds', jsonb_build_array('fileSearchStores/tagmarketsknowledgebase-iq7fy85qzt2f')
    )
  ),
  true
)
ON CONFLICT (client_id) DO UPDATE SET
  schema_name = EXCLUDED.schema_name,
  storage_bucket = EXCLUDED.storage_bucket,
  config = EXCLUDED.config,
  updated_at = NOW();

-- Note: Secrets will be populated from environment variables at runtime
-- or manually inserted via secure process
-- Example for WhatsApp (DO NOT commit actual secrets):
-- INSERT INTO public.client_secrets (client_id, channel_type, secrets)
-- VALUES (
--   'tag_markets',
--   'whatsapp',
--   jsonb_build_object(
--     'phoneNumberId', 'YOUR_PHONE_NUMBER_ID',
--     'accessToken', 'YOUR_ACCESS_TOKEN',
--     'appSecret', 'YOUR_APP_SECRET'
--   )
-- );

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
-- Enable RLS for security

ALTER TABLE public.client_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_secrets ENABLE ROW LEVEL SECURITY;

-- Service role can access everything
CREATE POLICY "Service role has full access to client_configs"
  ON public.client_configs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to client_secrets"
  ON public.client_secrets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read configs (but not secrets)
CREATE POLICY "Authenticated users can read client_configs"
  ON public.client_configs
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- No direct access to secrets for authenticated users
-- Secrets should only be accessed via Edge Functions with service role
