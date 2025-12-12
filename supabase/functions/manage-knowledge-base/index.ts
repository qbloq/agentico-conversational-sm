/**
 * Knowledge Base Management Edge Function
 * 
 * RESTful API for CRUD operations on the knowledge_base table.
 * Auto-generates embeddings using Gemini on create/update.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { createGeminiEmbeddingProvider } from '../_shared/sales-engine-llm.bundle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface KBEntryPayload {
  title: string;
  answer: string;
  category: string;
  url?: string;
  semanticTags?: string[];
  keyConcepts?: string[];
  relatedEntities?: string[];
  summary?: string;
  relatedArticles?: Array<{ title: string; url: string }>;
  priority?: number;
  isActive?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createSupabaseClient();
    const url = new URL(req.url);
    const schemaName = url.searchParams.get('schema') || 'public';
    const table = 'knowledge_base';

    // GET: List entries or fetch single entry
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      const id = url.searchParams.get('id');
      const category = url.searchParams.get('category');

      // Get distinct categories
      if (action === 'categories') {
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('category')
          .eq('is_active', true);

        if (error) throw error;

        // Extract unique categories
        const categories = [...new Set((data || []).map(row => row.category))].sort();
        
        return new Response(JSON.stringify({ categories }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Semantic search using embeddings
      if (action === 'search') {
        const query = url.searchParams.get('query');
        const limit = parseInt(url.searchParams.get('limit') || '5');

        console.log('[DEBUG] Search query:', query);
        console.log('[DEBUG] Limit:', limit);

        if (!query) {
          throw new Error('Missing required parameter: query');
        }

        // Generate embedding for the search query
        const queryEmbedding = await generateEmbedding(query, '');
        console.log(JSON.stringify(queryEmbedding));


        if (!queryEmbedding) {
          throw new Error('Failed to generate embedding for search query');
        }

        // Use the match_knowledge RPC for vector similarity search
        console.log('[DEBUG] Query embedding length:', queryEmbedding.length);
        console.log('[DEBUG] First 5 values:', queryEmbedding.slice(0, 5));
        
        // Format as string for TEXT parameter
        const embeddingString = `[${queryEmbedding.join(',')}]`;
        console.log('[DEBUG] Embedding string length:', embeddingString.length);
        
        // Try direct query using sql template (bypass RPC issues)
        const { data: rawData, error: rawError } = await supabase
          .from('knowledge_base')
          .select('id, title, answer, url, category, semantic_tags, key_concepts, related_entities, summary, related_articles, priority, embedding')
          .eq('is_active', true)
          .not('embedding', 'is', null)
          .limit(200);  // Get more to do local similarity calculation
        
        if (rawError) {
          console.error('[DEBUG] Raw query error:', JSON.stringify(rawError));
          throw new Error(`Query failed: ${rawError.message}`);
        }
        
        console.log('[DEBUG] Raw query returned:', rawData?.length, 'entries');
        
        // Calculate cosine similarity manually
        const queryVector = queryEmbedding;
        const resultsWithSim = (rawData || [])
          .map((row: any) => {
            // Parse the embedding if it's a string
            let docVector: number[];
            if (typeof row.embedding === 'string') {
              // Parse pgvector format: "[0.1,0.2,...]"
              docVector = JSON.parse(row.embedding);
            } else if (Array.isArray(row.embedding)) {
              docVector = row.embedding;
            } else {
              return null;
            }
            
            // Calculate cosine similarity
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < queryVector.length; i++) {
              dotProduct += queryVector[i] * docVector[i];
              normA += queryVector[i] * queryVector[i];
              normB += docVector[i] * docVector[i];
            }
            const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
            
            return {
              ...transformRow(row),
              similarity,
            };
          })
          .filter((r: any) => r !== null)
          .sort((a: any, b: any) => b.similarity - a.similarity)
          .slice(0, limit);
        
        console.log('[DEBUG] Results with similarity:', resultsWithSim.length);
        console.log('[DEBUG] Top result:', resultsWithSim[0]?.title, 'similarity:', resultsWithSim[0]?.similarity);

        return new Response(JSON.stringify({ results: resultsWithSim, query }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get single entry by ID
      if (id) {
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;

        return new Response(JSON.stringify(transformRow(data)), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // List all entries (with optional category filter)
      let query = supabase
        .schema(schemaName)
        .from(table)
        .select('id, title, answer, url, category, semantic_tags, key_concepts, related_entities, summary, related_articles, priority, is_active, created_at, updated_at')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (category) {
        query = query.eq('category', category);
      }

      // By default, only show active entries unless showAll is specified
      const showAll = url.searchParams.get('showAll') === 'true';
      if (!showAll) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      return new Response(JSON.stringify({ entries: (data || []).map(transformRow) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST: Create new entry
    if (req.method === 'POST') {
      const body: KBEntryPayload = await req.json();

      if (!body.title || !body.answer || !body.category) {
        throw new Error('Missing required fields: title, answer, category');
      }

      // Generate embedding
      const embedding = await generateEmbedding(body.title, body.summary || body.answer);

      const payload = {
        title: body.title,
        answer: body.answer,
        category: body.category,
        url: body.url || null,
        semantic_tags: body.semanticTags || [],
        key_concepts: body.keyConcepts || [],
        related_entities: body.relatedEntities || [],
        summary: body.summary || null,
        related_articles: body.relatedArticles || null,
        priority: body.priority ?? 0,
        is_active: body.isActive ?? true,
        embedding: embedding,
      };

      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(transformRow(data)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // PUT: Update existing entry
    if (req.method === 'PUT') {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        throw new Error('Missing required field: id');
      }

      // Build update payload
      const payload: Record<string, any> = {};

      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.answer !== undefined) payload.answer = updates.answer;
      if (updates.category !== undefined) payload.category = updates.category;
      if (updates.url !== undefined) payload.url = updates.url;
      if (updates.semanticTags !== undefined) payload.semantic_tags = updates.semanticTags;
      if (updates.keyConcepts !== undefined) payload.key_concepts = updates.keyConcepts;
      if (updates.relatedEntities !== undefined) payload.related_entities = updates.relatedEntities;
      if (updates.summary !== undefined) payload.summary = updates.summary;
      if (updates.relatedArticles !== undefined) payload.related_articles = updates.relatedArticles;
      if (updates.priority !== undefined) payload.priority = updates.priority;
      if (updates.isActive !== undefined) payload.is_active = updates.isActive;

      // Regenerate embedding if title or answer changed
      if (updates.title !== undefined || updates.answer !== undefined || updates.summary !== undefined) {
        // Fetch current entry to get existing values
        const { data: existing } = await supabase
          .schema(schemaName)
          .from(table)
          .select('title, answer, summary')
          .eq('id', id)
          .single();

        const title = updates.title ?? existing?.title ?? '';
        const summary = updates.summary ?? existing?.summary ?? updates.answer ?? existing?.answer ?? '';
        
        payload.embedding = await generateEmbedding(title, summary);
      }

      payload.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(transformRow(data)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // DELETE: Soft delete (set is_active = false)
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');

      if (!id) {
        throw new Error('Missing required parameter: id');
      }

      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, entry: transformRow(data) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * Transform database row to API response format (camelCase)
 */
function transformRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    answer: row.answer,
    url: row.url,
    category: row.category,
    semanticTags: row.semantic_tags || [],
    keyConcepts: row.key_concepts || [],
    relatedEntities: row.related_entities || [],
    summary: row.summary,
    relatedArticles: row.related_articles || [],
    priority: row.priority,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generate embedding for KB entry using title + summary
 */
async function generateEmbedding(title: string, summary: string): Promise<number[] | null> {
  try {
    const embeddingProvider = createGeminiEmbeddingProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || ''
    });

    const textToEmbed = `${title} ${summary}`.slice(0, 2000); // Limit length
    const embedding = await embeddingProvider.generateEmbedding(textToEmbed, { taskType: 'RETRIEVAL_QUERY' });
    
    return embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    return null;
  }
}
