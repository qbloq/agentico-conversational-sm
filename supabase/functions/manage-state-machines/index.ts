
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
      const id = url.searchParams.get('id');
      const name = url.searchParams.get('name');
      
      if (id) {
        // Fetch specific by ID (UUID)
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .eq('id', id)
          .single();
          
        if (error) throw error;

        // Fetch associated KBs
        const { data: kbAssociations } = await supabase
          .schema(schemaName)
          .from('state_machine_knowledge_bases')
          .select('kb_id')
          .eq('state_machine_id', id);

        const knowledgeBaseIds = (kbAssociations || []).map((assoc: any) => assoc.kb_id);
        
        return new Response(JSON.stringify({ ...data, knowledgeBaseIds }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else if (name) {
        // Fetch specific by name (backward compatibility)
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .eq('name', name)
          .eq('is_active', true)
          .single();
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // List all state machines
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('id, name, version, is_active, created_at, updated_at')
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST: Create or Update
    if (req.method === 'POST') {
      const body = await req.json();
      const { id, name, states, initial_state, version = '1.0.0', visualization, knowledgeBaseIds = [] } = body;
      
      if (!name || !states || !initial_state) {
        throw new Error('Missing required fields: name, states, initial_state');
      }

      const payload = {
        name,
        states, // JSONB
        initial_state,
        version,
        is_active: true,
        updated_at: new Date(),
        visualization: visualization // TEXT for Mermaid diagram
      };
      
      let result;
      
      // If ID is provided, update that specific record
      if (id) {
        result = await supabase
          .schema(schemaName)
          .from(table)
          .update(payload)
          .eq('id', id)
          .select()
          .single();
      } else {
        // No ID provided - check if a state machine with this name exists
        const { data: existing } = await supabase
          .schema(schemaName)
          .from(table)
          .select('id')
          .eq('name', name)
          .maybeSingle();
          
        if (existing) {
          // Update existing by name
          result = await supabase
            .schema(schemaName)
            .from(table)
            .update(payload)
            .eq('id', existing.id)
            .select()
            .single();
        } else {
          // Create new
          result = await supabase
            .schema(schemaName)
            .from(table)
            .insert(payload)
            .select()
            .single();
        }
      }

      if (result.error) throw result.error;

      const stateMachineId = result.data.id;

      // Update KB associations
      // First, delete existing associations
      await supabase
        .schema(schemaName)
        .from('state_machine_knowledge_bases')
        .delete()
        .eq('state_machine_id', stateMachineId);

      // Then, insert new associations
      if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
        const associations = knowledgeBaseIds.map((kbId: string) => ({
          state_machine_id: stateMachineId,
          kb_id: kbId
        }));

        const { error: assocError } = await supabase
          .schema(schemaName)
          .from('state_machine_knowledge_bases')
          .insert(associations);

        if (assocError) throw assocError;
      }

      return new Response(JSON.stringify({ ...result.data, knowledgeBaseIds }), {
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
