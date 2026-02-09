
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient, resolveSchema } from '../_shared/supabase.ts';
import { createSupabaseStateMachineStore } from '../_shared/adapters/index.ts';
import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

interface AgentPayload {
  sub: string;
  phone: string;
  clientSchema: string;
  exp: number;
}

async function verifyAgent(req: Request): Promise<AgentPayload | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const jwtSecret = Deno.env.get('AGENT_JWT_SECRET') || 'your-secret-key';

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const payload = await verify(token, key) as unknown as AgentPayload;
    return payload;
  } catch {
    return null;
  }
}

serve(async (req) => {
  // CORS configuration
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let schemaName: string | null = null;

    // Auth Strategy 1: Agent JWT (from Human Agent App)
    const agent = await verifyAgent(req);
    if (agent) {
      schemaName = agent.clientSchema;
    }

    // Auth Strategy 2: clientId query param (legacy/internal)
    if (!schemaName) {
      const clientId = url.searchParams.get('clientId');
      if (clientId) {
        const publicClient = createSupabaseClient();
        schemaName = await resolveSchema(publicClient, clientId);
      }
    }

    if (!schemaName) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized or missing clientId' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createSupabaseClient(schemaName);
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
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = message.startsWith('Missing required');
    return new Response(JSON.stringify({ error: message }), { 
      status: isValidation ? 400 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
