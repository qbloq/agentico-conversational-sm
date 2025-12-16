/**
 * Manage Escalations Edge Function
 * 
 * CRUD API for the Human Agent WebApp to manage escalations.
 * Supports multi-tenant access.
 * 
 * Endpoints:
 * - GET /escalations - List open/assigned escalations
 * - GET /escalations/:id - Get escalation with full conversation
 * - PATCH /escalations/:id/assign - Assign to agent
 * - PATCH /escalations/:id/resolve - Mark resolved + trigger enrichment
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AgentPayload {
  sub: string;
  phone: string;
  clientSchema: string;
  exp: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify JWT
    const agent = await verifyAgent(req);
    if (!agent) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // pathParts[0] = 'manage-escalations' (function name)
    // pathParts[1] = 'escalations' 
    // pathParts[2] = ':id' (if present)
    // pathParts[3] = 'assign'|'resolve' (if present)
    
    console.log('Path parts:', pathParts);
    
    // Route handling
    if (req.method === 'GET' && pathParts.length === 2 && pathParts[1] === 'escalations') {
      // GET /manage-escalations/escalations
      return await listEscalations(agent);
    }
    
    if (req.method === 'GET' && pathParts.length === 3 && pathParts[1] === 'escalations') {
      // GET /manage-escalations/escalations/:id
      return await getEscalation(agent, pathParts[2]);
    }
    
    if (req.method === 'PATCH' && pathParts.length === 4 && pathParts[3] === 'assign') {
      // PATCH /manage-escalations/escalations/:id/assign
      return await assignEscalation(req, agent, pathParts[2]);
    }
    
    if (req.method === 'PATCH' && pathParts.length === 4 && pathParts[3] === 'resolve') {
      // PATCH /manage-escalations/escalations/:id/resolve
      return await resolveEscalation(req, agent, pathParts[2]);
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Verify agent JWT and return payload
 */
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

/**
 * List open/assigned escalations for the agent's client
 */
async function listEscalations(agent: AgentPayload): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  const { data: escalations, error } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .select(`
      id,
      reason,
      ai_summary,
      priority,
      status,
      created_at,
      assigned_to,
      assigned_at,
      session:session_id (
        id,
        channel_user_id,
        current_state,
        contact:contact_id (
          full_name,
          phone,
          email
        )
      )
    `)
    .in('status', ['open', 'assigned', 'in_progress'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to list escalations:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to list escalations' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ escalations }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Get single escalation with full conversation history
 */
async function getEscalation(agent: AgentPayload, escalationId: string): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // Get escalation details
  const { data: escalation, error: escError } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .select(`
      *,
      session:session_id (
        id,
        channel_type,
        channel_id,
        channel_user_id,
        current_state,
        context,
        contact:contact_id (
          id,
          full_name,
          phone,
          email,
          country,
          language
        )
      ),
      assigned_agent:assigned_to (
        id,
        first_name,
        last_name
      )
    `)
    .eq('id', escalationId)
    .single();

  if (escError || !escalation) {
    return new Response(
      JSON.stringify({ error: 'Escalation not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get conversation messages
  const { data: messages, error: msgError } = await supabase
    .schema(agent.clientSchema)
    .from('messages')
    .select('*')
    .eq('session_id', escalation.session.id)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('Failed to get messages:', msgError);
  }

  return new Response(
    JSON.stringify({
      escalation,
      messages: messages || [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Assign escalation to agent
 */
async function assignEscalation(
  req: Request,
  agent: AgentPayload,
  escalationId: string
): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  const { error } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .update({
      assigned_to: agent.sub,
      assigned_at: new Date().toISOString(),
      status: 'assigned',
    })
    .eq('id', escalationId)
    .eq('status', 'open'); // Only assign if still open

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to assign escalation' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Escalation assigned' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Resolve escalation with notes
 */
async function resolveEscalation(
  req: Request,
  agent: AgentPayload,
  escalationId: string
): Promise<Response> {
  const { notes } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // Get escalation to verify ownership
  const { data: escalation, error: escError } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .select('*, session:session_id(id)')
    .eq('id', escalationId)
    .single();

  if (escError || !escalation) {
    return new Response(
      JSON.stringify({ error: 'Escalation not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Verify agent is assigned (or allow any agent for now)
  if (escalation.assigned_to && escalation.assigned_to !== agent.sub) {
    return new Response(
      JSON.stringify({ error: 'Escalation assigned to another agent' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Update escalation
  const { error: updateError } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution_notes: notes || null,
    })
    .eq('id', escalationId);

  if (updateError) {
    return new Response(
      JSON.stringify({ error: 'Failed to resolve escalation' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Update session to no longer be escalated
  await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .update({
      is_escalated: false,
      status: 'active',
    })
    .eq('id', escalation.session.id);

  // TODO: Trigger semantic enrichment (async)
  // Could invoke another function or use a queue

  return new Response(
    JSON.stringify({ success: true, message: 'Escalation resolved' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
