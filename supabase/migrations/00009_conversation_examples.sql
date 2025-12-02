-- Migration: 00009_conversation_examples
-- Description: Add conversation_examples table for few-shot prompting
--              Update conversation_state enum with new states
-- Date: 2024-12-01

-- =============================================================================
-- UPDATE CONVERSATION_STATE ENUM (client_template schema)
-- =============================================================================

-- Add new states to the enum
-- Note: PostgreSQL doesn't support removing enum values, only adding
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'returning_customer' AFTER 'initial';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'promotion_inquiry' AFTER 'returning_customer';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'education_redirect' AFTER 'post_registration';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'technical_support' AFTER 'education_redirect';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'platform_support' AFTER 'deposit_support';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'withdrawal_support' AFTER 'platform_support';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'disqualified' AFTER 'completed';

-- =============================================================================
-- UPDATE CONVERSATION_STATE ENUM (client_tag_markets schema)
-- =============================================================================

ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'returning_customer' AFTER 'initial';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'promotion_inquiry' AFTER 'returning_customer';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'education_redirect' AFTER 'post_registration';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'technical_support' AFTER 'education_redirect';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'platform_support' AFTER 'deposit_support';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'withdrawal_support' AFTER 'platform_support';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'disqualified' AFTER 'completed';

-- =============================================================================
-- CONVERSATION EXAMPLES TABLE (public schema - shared across clients)
-- =============================================================================

-- Stores sample conversations with per-message state annotations
-- Used to inject behavioral templates into LLM prompts (few-shot learning)

CREATE TABLE IF NOT EXISTS public.conversation_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identification
  example_id TEXT UNIQUE NOT NULL,        -- e.g., 'conv_001'
  
  -- Classification
  scenario TEXT NOT NULL,                 -- Brief description of the scenario
  category TEXT NOT NULL                  -- 'happy_path', 'deviation', 'edge_case', 'complex'
    CHECK (category IN ('happy_path', 'deviation', 'edge_case', 'complex')),
  outcome TEXT NOT NULL                   -- 'success', 'escalation', 'dropout', 'redirect'
    CHECK (outcome IN ('success', 'escalation', 'dropout', 'redirect')),
  
  -- State flow (for filtering)
  -- Using TEXT instead of enum for flexibility across schemas
  primary_state TEXT,                     -- Main state this example demonstrates
  state_flow TEXT[],                      -- Sequence of states traversed
  
  -- Content
  -- messages: Array of {role: 'customer'|'agent', content: string, state?: string}
  messages JSONB NOT NULL,
  notes TEXT,                             -- Optional notes about this conversation
  
  -- Vector embedding for semantic retrieval
  embedding VECTOR(1536),                 -- Embedding of full conversation text
  
  -- Metadata
  source TEXT DEFAULT 'synthetic'         -- 'synthetic', 'real_anonymized', 'manual'
    CHECK (source IN ('synthetic', 'real_anonymized', 'manual')),
  version INT DEFAULT 1,                  -- For tracking updates
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Index for state-based retrieval
CREATE INDEX IF NOT EXISTS idx_examples_primary_state 
  ON public.conversation_examples(primary_state) 
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_examples_category 
  ON public.conversation_examples(category) 
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_examples_outcome 
  ON public.conversation_examples(outcome) 
  WHERE is_active = TRUE;

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_examples_state_category 
  ON public.conversation_examples(primary_state, category) 
  WHERE is_active = TRUE;

-- Vector index for semantic similarity search
-- Using ivfflat for approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_examples_embedding 
  ON public.conversation_examples 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE public.conversation_examples ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access" ON public.conversation_examples
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read active examples
CREATE POLICY "Authenticated read active" ON public.conversation_examples
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to search examples by state with optional semantic similarity
CREATE OR REPLACE FUNCTION public.search_conversation_examples(
  p_state TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_embedding VECTOR(1536) DEFAULT NULL,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  example_id TEXT,
  scenario TEXT,
  category TEXT,
  outcome TEXT,
  primary_state TEXT,
  messages JSONB,
  notes TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ce.id,
    ce.example_id,
    ce.scenario,
    ce.category,
    ce.outcome,
    ce.primary_state,
    ce.messages,
    ce.notes,
    CASE 
      WHEN p_embedding IS NOT NULL AND ce.embedding IS NOT NULL 
      THEN 1 - (ce.embedding <=> p_embedding)
      ELSE NULL
    END as similarity
  FROM public.conversation_examples ce
  WHERE ce.is_active = TRUE
    AND (p_state IS NULL OR ce.primary_state = p_state)
    AND (p_category IS NULL OR ce.category = p_category)
  ORDER BY 
    CASE 
      WHEN p_embedding IS NOT NULL AND ce.embedding IS NOT NULL 
      THEN ce.embedding <=> p_embedding
      ELSE 0
    END
  LIMIT p_limit;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION public.search_conversation_examples TO service_role;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE public.conversation_examples IS 
  'Sample conversations for few-shot prompting. Each conversation is annotated with per-message states.';

COMMENT ON COLUMN public.conversation_examples.messages IS 
  'Array of message objects: [{role: "customer"|"agent", content: string, state?: string}]';

COMMENT ON COLUMN public.conversation_examples.primary_state IS 
  'The main conversation state this example demonstrates (for filtering)';

COMMENT ON COLUMN public.conversation_examples.state_flow IS 
  'Sequence of states traversed in this conversation';

COMMENT ON COLUMN public.conversation_examples.embedding IS 
  'Vector embedding of the full conversation text for semantic search';
