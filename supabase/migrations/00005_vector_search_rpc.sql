-- Migration: 00005_vector_search_rpc
-- Description: RPC function for vector similarity search in knowledge base
-- Date: 2024-11-28

-- Generic vector search function that works across client schemas
CREATE OR REPLACE FUNCTION public.match_knowledge(
  schema_name TEXT,
  query_embedding VECTOR(768),
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
BEGIN
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
      1 - (kb.embedding <=> $1) as similarity
    FROM %I.knowledge_base kb
    WHERE kb.is_active = true
      AND kb.embedding IS NOT NULL
    ORDER BY kb.embedding <=> $1
    LIMIT $2',
    schema_name
  )
  USING query_embedding, match_count;
END;
$$;

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION public.match_knowledge TO service_role;

-- Comment
COMMENT ON FUNCTION public.match_knowledge IS 'Vector similarity search for knowledge base articles using pgvector cosine distance';
