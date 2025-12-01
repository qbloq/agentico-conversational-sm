-- Migration: 00008_llm_logs
-- Description: Centralized LLM usage and cost tracking
-- Date: 2024-11-30
--
-- This table lives in the public schema because LLM costs are operational/billing data,
-- not client business data. This enables:
-- - Cross-client cost analytics with single queries
-- - Easy billing/invoicing aggregation
-- - Centralized monitoring and alerting
-- - No schema template changes needed for new clients

-- =============================================================================
-- LLM LOGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.llm_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Client context
  client_id TEXT NOT NULL,                -- e.g., 'tag_markets'
  session_id UUID,                        -- Optional link to session (for tracing)
  
  -- Request context
  request_type TEXT NOT NULL CHECK (request_type IN ('chat', 'embedding', 'vision', 'transcription')),
  
  -- Provider info
  provider TEXT NOT NULL,                 -- 'gemini', 'anthropic', 'openai', 'assemblyai'
  model TEXT NOT NULL,                    -- 'gemini-2.0-flash', 'claude-sonnet-4-20250514', etc.
  
  -- Token usage
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  
  -- Cost (calculated at log time based on model pricing)
  cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  
  -- Content (for debugging/auditing - truncated previews)
  input_preview TEXT,                     -- First N chars of input
  output_preview TEXT,                    -- First N chars of output
  input_hash TEXT,                        -- SHA256 for deduplication/cache analysis
  
  -- Performance
  latency_ms INT,
  finish_reason TEXT CHECK (finish_reason IN ('stop', 'length', 'content_filter', 'error')),
  
  -- Error tracking
  is_error BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Primary query patterns
CREATE INDEX idx_llm_logs_client_date ON public.llm_logs(client_id, created_at DESC);
CREATE INDEX idx_llm_logs_provider_model ON public.llm_logs(provider, model, created_at DESC);

-- Cost analysis
CREATE INDEX idx_llm_logs_cost_date ON public.llm_logs(created_at DESC) WHERE cost_usd > 0;

-- Error monitoring
CREATE INDEX idx_llm_logs_errors ON public.llm_logs(created_at DESC) WHERE is_error = TRUE;

-- Session tracing (when debugging specific conversations)
CREATE INDEX idx_llm_logs_session ON public.llm_logs(session_id) WHERE session_id IS NOT NULL;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.llm_logs ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role full access" ON public.llm_logs
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.llm_logs IS 'Centralized LLM usage and cost tracking across all clients';
COMMENT ON COLUMN public.llm_logs.client_id IS 'Client identifier for cost attribution';
COMMENT ON COLUMN public.llm_logs.request_type IS 'Type of LLM request: chat, embedding, vision, or transcription';
COMMENT ON COLUMN public.llm_logs.cost_usd IS 'Calculated cost in USD based on model pricing at time of request';
COMMENT ON COLUMN public.llm_logs.input_preview IS 'Truncated input for debugging (first 500 chars)';
COMMENT ON COLUMN public.llm_logs.output_preview IS 'Truncated output for debugging (first 500 chars)';
COMMENT ON COLUMN public.llm_logs.input_hash IS 'SHA256 hash of full input for cache hit analysis';

-- =============================================================================
-- HELPER VIEWS
-- =============================================================================

-- Daily cost summary by client
CREATE OR REPLACE VIEW public.llm_costs_daily AS
SELECT 
  client_id,
  DATE(created_at) as date,
  provider,
  model,
  request_type,
  COUNT(*) as request_count,
  SUM(prompt_tokens) as total_prompt_tokens,
  SUM(completion_tokens) as total_completion_tokens,
  SUM(total_tokens) as total_tokens,
  SUM(cost_usd) as total_cost_usd,
  AVG(latency_ms)::INT as avg_latency_ms,
  COUNT(*) FILTER (WHERE is_error) as error_count
FROM public.llm_logs
GROUP BY client_id, DATE(created_at), provider, model, request_type;

COMMENT ON VIEW public.llm_costs_daily IS 'Aggregated daily LLM costs by client, provider, and model';
