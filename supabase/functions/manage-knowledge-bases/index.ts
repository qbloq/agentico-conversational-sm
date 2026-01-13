/**
 * Knowledge Bases Metadata Management Edge Function
 * 
 * RESTful API for CRUD operations on the knowledge_bases table (metadata).
 * This manages the KB containers, not the entries themselves.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface KBMetadataPayload {
  name: string;
  description?: string;
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
    const schemaName = url.searchParams.get('schema') || 'client_tag_markets';
    const table = 'knowledge_bases';

    // GET: List all KBs or fetch single KB
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');

      // Get single KB by ID
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

      // List all KBs (with entry counts)
      const { data: kbs, error } = await supabase
        .schema(schemaName)
        .from(table)
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;

      // Get entry counts for each KB
      const kbsWithCounts = await Promise.all(
        (kbs || []).map(async (kb) => {
          const { count } = await supabase
            .schema(schemaName)
            .from('knowledge_base')
            .select('*', { count: 'exact', head: true })
            .eq('kb_id', kb.id)
            .eq('is_active', true);

          return {
            ...transformRow(kb),
            entryCount: count || 0
          };
        })
      );

      return new Response(JSON.stringify({ knowledgeBases: kbsWithCounts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST: Create new KB
    if (req.method === 'POST') {
      const body: KBMetadataPayload = await req.json();

      if (!body.name) {
        throw new Error('Missing required field: name');
      }

      const payload = {
        name: body.name,
        description: body.description || null,
        is_active: body.isActive ?? true,
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

    // PUT: Update existing KB
    if (req.method === 'PUT') {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        throw new Error('Missing required field: id');
      }

      const payload: Record<string, any> = {};

      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.description !== undefined) payload.description = updates.description;
      if (updates.isActive !== undefined) payload.is_active = updates.isActive;

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

      // Check if KB has entries
      const { count } = await supabase
        .schema(schemaName)
        .from('knowledge_base')
        .select('*', { count: 'exact', head: true })
        .eq('kb_id', id);

      if (count && count > 0) {
        return new Response(JSON.stringify({ 
          error: `Cannot delete KB with ${count} entries. Please reassign or delete entries first.` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, kb: transformRow(data) }), {
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
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
