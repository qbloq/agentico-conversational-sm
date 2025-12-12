-- Migration: 00005_vector_search_rpc
-- Description: RPC function for vector similarity search in knowledge base
-- Date: 2024-11-28

-- Drop old function signatures to avoid conflicts
DROP FUNCTION IF EXISTS public.match_knowledge(TEXT, VECTOR(1536), INT);
DROP FUNCTION IF EXISTS public.match_knowledge(TEXT, VECTOR(768), INT);
DROP FUNCTION IF EXISTS public.match_knowledge(TEXT, VECTOR, INT);
DROP FUNCTION IF EXISTS public.match_knowledge(TEXT, TEXT, INT);

-- Generic vector search function that works across client schemas
-- Accepts TEXT for embedding to work with all Supabase client libraries
CREATE OR REPLACE FUNCTION public.match_knowledge(
  schema_name TEXT,
  query_embedding TEXT,  -- Accept as TEXT to avoid serialization issues
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  answer TEXT,
  url TEXT,
  category TEXT,
  semantic_tags TEXT[],
  key_concepts TEXT[],
  related_entities TEXT[],
  summary TEXT,
  related_articles JSONB,
  priority INT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  embedding_vector VECTOR(768);
BEGIN
  -- Cast the text input to vector
  embedding_vector := query_embedding::VECTOR(768);
  
  RETURN QUERY EXECUTE format(
    'SELECT 
      kb.id,
      kb.title,
      kb.answer,
      kb.url,
      kb.category,
      kb.semantic_tags,
      kb.key_concepts,
      kb.related_entities,
      kb.summary,
      kb.related_articles,
      kb.priority,
      (kb.embedding <#> $1) * -1 as similarity
    FROM %I.knowledge_base kb
    WHERE kb.is_active = true
      AND kb.embedding IS NOT NULL
    ORDER BY kb.embedding <=> $1
    LIMIT $2',
    schema_name
  )
  USING embedding_vector, match_count;
END;
$$;

-- Grant execute permission to all roles that need it
GRANT EXECUTE ON FUNCTION public.match_knowledge TO service_role;
GRANT EXECUTE ON FUNCTION public.match_knowledge TO anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge TO authenticated;

-- Comment
COMMENT ON FUNCTION public.match_knowledge IS 'Vector similarity search for knowledge base articles using pgvector cosine distance. Accepts embedding as TEXT string for compatibility with all clients.';

