/**
 * Supabase Knowledge Store Adapter
 * 
 * Implements KnowledgeStore interface for Supabase with pgvector.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { KnowledgeStore, KnowledgeEntry } from '@parallelo/sales-engine';

interface KnowledgeRow {
  id: string;
  title: string;
  answer: string;
  url: string | null;
  category: string;
  semantic_tags: string[] | null;
  key_concepts: string[] | null;
  related_entities: string[] | null;
  summary: string | null;
  related_articles: { title: string; url: string }[] | null;
  priority: number;
  is_active: boolean;
}

function rowToEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    answer: row.answer,
    category: row.category,
    semanticTags: row.semantic_tags ?? [],
    summary: row.summary ?? row.answer.slice(0, 200),
    relatedArticles: row.related_articles ?? undefined,
  };
}

export function createSupabaseKnowledgeStore(
  supabase: SupabaseClient,
  schemaName: string
): KnowledgeStore {
  const tableName = `knowledge_base`;
  
  return {
    async findSimilar(embedding: number[], limit: number): Promise<KnowledgeEntry[]> {
      // Debug embedding
      // console.log('Vector search :: prod', { 
      //   schema: schemaName, 
      //   embeddingType: typeof embedding,
      //   isArray: Array.isArray(embedding),
      //   limit 
      // });


      // Use pgvector's cosine similarity search
      // Note: This requires a raw SQL query via RPC or direct query
      const { data, error } = await supabase.rpc('match_knowledge', {
        schema_name: 'public',
        query_embedding: embedding,
        match_count: limit,
      });
      
      if (error) {
        console.error('Vector search failed, falling back to category search:', error);
        // Fallback to simple query
        return this.findByCategory('Preguntas Frecuentes', limit);
      }
      
      return (data as KnowledgeRow[]).map(rowToEntry);
    },
    
    async findByCategory(category: string, limit: number): Promise<KnowledgeEntry[]> {
      const { data, error } = await supabase
        .schema('public')
        .from(tableName)
        .select('*')
        .eq('category', category)
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(limit);
      
      if (error) {
        throw new Error(`Failed to find by category: ${error.message}`);
      }
      
      return (data as KnowledgeRow[]).map(rowToEntry);
    },
    
    async findByTags(tags: string[], limit: number): Promise<KnowledgeEntry[]> {
      // Use PostgreSQL's array overlap operator
      const { data, error } = await supabase
        .schema('public')
        .from(tableName)
        .select('*')
        .overlaps('semantic_tags', tags)
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .limit(limit);
      
      if (error) {
        throw new Error(`Failed to find by tags: ${error.message}`);
      }
      
      return (data as KnowledgeRow[]).map(rowToEntry);
    },
  };
}
