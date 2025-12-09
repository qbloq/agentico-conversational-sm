
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { createSupabaseStateMachineStore } from '../_shared/adapters/index.ts';

serve(async (req) => {
  // CORS configuration
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createSupabaseClient();
    // Use the schema from the request or default. 
    // In production, this should probably come from an API key or auth token claim.
    // For now, we'll use a query param 'schema' or default to primary schema
    const url = new URL(req.url);
    const schemaName = url.searchParams.get('schema') || 'client_tag_markets';
    
    // Check authentication - for now we rely on Supabase Service Role Key protection
    // ensuring this function is only callable by authorized clients (or if anon is allowed via RLS which we set up)

    const table = 'state_machines';

    // GET: List or Fetch State Machine
    if (req.method === 'GET') {
      const name = url.searchParams.get('name');
      
      if (name) {
        // Fetch specific by name
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*, visualization')
          .eq('name', name)
          .eq('is_active', true)
          .single();
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // List all
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('id, name, version, is_active, created_at, visualization');
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST: Create or Update (Upsert based on name/version strategy)
    if (req.method === 'POST') {
      const body = await req.json();
      const { name, states, initial_state, version = '1.0.0', visualization } = body;
      
      if (!name || !states || !initial_state) {
        throw new Error('Missing required fields: name, states, initial_state');
      }

      // Check if exists to determine if we update or insert new version
      // For simplicity in this iteration, we'll upsert based on name and mark as active
      // In a real robust system we might want versioning history.
      
      // 1. Deactivate others with same name? Optional, but good practice if only one active allowed.
      // For now, let's just upsert the row.
      
      const payload = {
        name,
        states, // JSONB
        initial_state,
        version,
        is_active: true,
        updated_at: new Date(),
        visualization: visualization // TEXT for Mermaid diagram
      };
      
      // We need to query first to see if we update by ID or Name
      // Assuming 'name' is unique for active config in this simple implementation
      const { data: existing } = await supabase
        .schema(schemaName)
        .from(table)
        .select('id')
        .eq('name', name)
        .single();
        
      let result;
      if (existing) {
        result = await supabase
          .schema(schemaName)
          .from(table)
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single();
      } else {
         result = await supabase
          .schema(schemaName)
          .from(table)
          .insert(payload)
          .select()
          .single();
      }

      if (result.error) throw result.error;

      return new Response(JSON.stringify(result.data), {
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
