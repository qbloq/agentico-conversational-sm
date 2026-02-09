
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient, resolveSchema } from '../_shared/supabase.ts';
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
    const resource = url.searchParams.get('resource'); // 'queue' or null (configs)

    // =========================================================================
    // QUEUE ENDPOINTS (resource=queue)
    // =========================================================================
    if (resource === 'queue') {
      // GET: List queued follow-ups with contact info
      if (req.method === 'GET') {
        const status = url.searchParams.get('status'); // 'pending', 'sent', 'cancelled', 'failed' or null (all)
        const sessionId = url.searchParams.get('sessionId');

        let query = supabase
          .schema(schemaName)
          .from('followup_queue')
          .select('*, sessions!inner(contact_id, current_state, contacts!inner(phone, full_name))')
          .order('scheduled_at', { ascending: false })
          .limit(100);

        if (status) {
          query = query.eq('status', status);
        }
        if (sessionId) {
          query = query.eq('session_id', sessionId);
        }

        const { data, error } = await query;
        if (error) throw error;

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // DELETE: Cancel a queued follow-up (set status to 'cancelled')
      if (req.method === 'DELETE') {
        const queueId = url.searchParams.get('id');
        const sessionId = url.searchParams.get('sessionId');

        if (queueId) {
          // Cancel specific queue item
          const { data, error } = await supabase
            .schema(schemaName)
            .from('followup_queue')
            .update({ status: 'cancelled' })
            .eq('id', queueId)
            .eq('status', 'pending')
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else if (sessionId) {
          // Cancel all pending for a session
          const { data, error } = await supabase
            .schema(schemaName)
            .from('followup_queue')
            .update({ status: 'cancelled' })
            .eq('session_id', sessionId)
            .eq('status', 'pending')
            .select();

          if (error) throw error;

          return new Response(JSON.stringify({ cancelled: data?.length || 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else {
          throw new Error('Missing required param: id or sessionId');
        }
      }

      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    // =========================================================================
    // CONFIG ENDPOINTS (default)
    // =========================================================================
    const table = 'followup_configs';

    // GET: List or Fetch Follow-up Config
    if (req.method === 'GET') {
      const name = url.searchParams.get('name');
      
      if (name) {
        // Fetch specific by name
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .eq('name', name)
          .single();
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // List all configs
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .order('name', { ascending: true });
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST: Create or Update
    if (req.method === 'POST') {
      const body = await req.json();
      const { name, type, content, variables_config = [] } = body;
      
      if (!name || !type || content === undefined) {
        throw new Error('Missing required fields: name, type, content');
      }

      if (!['text', 'template'].includes(type)) {
        throw new Error('Invalid type: must be "text" or "template"');
      }

      const payload = {
        name,
        type,
        content,
        variables_config, // JSONB
        updated_at: new Date()
      };
      
      // Upsert: Try insert, on conflict update
      // Since 'name' is primary key
      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // DELETE: Remove a config
    if (req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!name) {
        throw new Error('Missing variable: name');
      }

      const { error } = await supabase
        .schema(schemaName)
        .from(table)
        .delete()
        .eq('name', name);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
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
    const isValidation = message.startsWith('Missing required') || message.startsWith('Invalid type');
    return new Response(JSON.stringify({ error: message }), { 
      status: isValidation ? 400 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
