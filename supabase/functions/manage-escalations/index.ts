/**
 * Manage Escalations Edge Function
 * 
 * CRUD API for the Human Agent WebApp to manage escalations and sessions.
 * Supports multi-tenant access.
 * 
 * Endpoints:
 * - GET /escalations - List open/assigned escalations
 * - GET /escalations/:id - Get escalation with full conversation
 * - PATCH /escalations/:id/assign - Assign to agent
 * - PATCH /escalations/:id/resolve - Mark resolved + trigger enrichment
 * - GET /sessions - List all sessions with last message
 * - GET /sessions/:id - Get session with full conversation
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';
import { createGeminiProvider } from '../_shared/sales-engine-llm.bundle.ts';
import { buildEscalationResolutionPrompt } from '../_shared/sales-engine.bundle.ts';


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
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

    // Sessions routes
    if (req.method === 'GET' && pathParts.length === 2 && pathParts[1] === 'sessions') {
      // GET /manage-escalations/sessions
      return await listSessions(agent);
    }
    
    if (req.method === 'GET' && pathParts.length === 3 && pathParts[1] === 'sessions') {
      // GET /manage-escalations/sessions/:id
      return await getSession(agent, pathParts[2]);
    }

    if (req.method === 'POST' && pathParts.length === 4 && pathParts[1] === 'sessions' && pathParts[3] === 'escalate') {
      // POST /manage-escalations/sessions/:id/escalate
      return await escalateSession(agent, pathParts[2]);
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
    .select('*, session:session_id(id, current_state)')
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

  // 1. Get Conversation History
  const { data: messages } = await supabase
    .schema(agent.clientSchema)
    .from('messages')
    .select('content, direction, type')
    .eq('session_id', escalation.session.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const history = (messages || [])
    .reverse()
    .map(m => `${m.direction === 'inbound' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n');

  // 2. Get client config to determine state machine name
  const { data: clientConfig } = await supabase
    .from('client_configs')
    .select('state_machine_name')
    .eq('schema_name', agent.clientSchema)
    .eq('is_active', true)
    .single();

  const stateMachineName = clientConfig?.state_machine_name;

  // 3. Get State Machine Config
  const { data: sm } = await supabase
    .schema(agent.clientSchema)
    .from('state_machines')
    .select('states')
    .eq('name', stateMachineName)
    .eq('is_active', true)
    .single();

  let nextState = escalation.session.current_state;
  let transitionReason = 'Determined by human agent (default)';

  if (sm && sm.states) {
    try {
      // 4. Call Gemini to decide next state
      const llmProvider = createGeminiProvider({
        apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
        model: 'gemini-2.5-flash',
      });

      const systemPrompt = buildEscalationResolutionPrompt(sm.states);
      const userMessage = `Based on this conversation, what should be the next state?\n\nCONVERSATION:\n${history}\n\nAgent Notes: ${notes || 'None'}`;

      const llmResponse = await llmProvider.generateResponse({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.2,
      });

      const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.nextState && sm.states[parsed.nextState]) {
          nextState = parsed.nextState;
          transitionReason = parsed.reason;
          console.log(`[Escalation Resolution] Gemini selected next state: ${nextState} (${transitionReason})`);
        }
      }
    } catch (err) {
      console.error('[Escalation Resolution] Gemini analysis failed:', err);
    }
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

  // Update session to no longer be escalated and set new state
  await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .update({
      is_escalated: false,
      status: 'active',
      current_state: nextState,
      previous_state: escalation.session.current_state,
    })
    .eq('id', escalation.session.id);

  return new Response(
    JSON.stringify({ 
      success: true, 
      message: 'Escalation resolved',
      nextState,
      reason: transitionReason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

}

/**
 * List all sessions with contact info and last message preview
 */
async function listSessions(agent: AgentPayload): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // Fetch sessions with contact info
  const { data: sessions, error } = await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .select(`
      id,
      channel_type,
      channel_id,
      channel_user_id,
      current_state,
      is_escalated,
      last_message_at,
      created_at,
      contact:contact_id (
        id,
        full_name,
        phone
      )
    `)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    console.error('Failed to list sessions:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to list sessions' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Fetch last message for each session (batched for efficiency)
  const sessionsWithMessages = await Promise.all(
    (sessions || []).map(async (session) => {
      const { data: lastMsg } = await supabase
        .schema(agent.clientSchema)
        .from('messages')
        .select('content, direction, type, media_url')
        .eq('session_id', session.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return {
        ...session,
        last_message: lastMsg || null,
      };
    })
  );

  return new Response(
    JSON.stringify({ sessions: sessionsWithMessages }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Get single session with full conversation history
 */
async function getSession(agent: AgentPayload, sessionId: string): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // Get session details
  const { data: session, error: sessionError } = await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .select(`
      id,
      channel_type,
      channel_id,
      channel_user_id,
      current_state,
      previous_state,
      context,
      is_escalated,
      last_message_at,
      created_at,
      contact:contact_id (
        id,
        full_name,
        phone,
        email,
        country,
        language
      )
    `)
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return new Response(
      JSON.stringify({ error: 'Session not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get conversation messages
  const { data: messages, error: msgError } = await supabase
    .schema(agent.clientSchema)
    .from('messages')
    .select('id, session_id, direction, type, content, media_url, created_at, sent_by_agent_id, reply_to_message_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('Failed to get messages:', msgError);
  }

  return new Response(
    JSON.stringify({
      session,
      messages: messages || [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Manually escalate a session to the current agent
 */
async function escalateSession(agent: AgentPayload, sessionId: string): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // 1. Check if session exists and is not already escalated
  // We check BOTH the sessions flag and the escalations table for active records
  const { data: session, error: sessionError } = await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .select('id, is_escalated')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return new Response(
      JSON.stringify({ error: 'Session not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Proactive check in the escalations table
  const { data: activeEscalation } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .select('id')
    .eq('session_id', sessionId)
    .in('status', ['open', 'assigned', 'in_progress'])
    .limit(1)
    .maybeSingle();

  if (session.is_escalated || activeEscalation) {
    return new Response(
      JSON.stringify({ error: 'Session already has an active escalation' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Create escalation record
  const { data: escalation, error: escError } = await supabase
    .schema(agent.clientSchema)
    .from('escalations')
    .insert({
      session_id: sessionId,
      reason: 'explicit_request',
      ai_summary: 'Manual takeover by agent',
      status: 'assigned',
      assigned_to: agent.sub,
      assigned_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (escError) {
    console.error('Failed to create escalation:', escError);
    if ((escError as any).code === '23505') {
      return new Response(
        JSON.stringify({ error: 'Session already has an active escalation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Failed to create escalation record' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 3. Update session
  const { error: updateError } = await supabase
    .schema(agent.clientSchema)
    .from('sessions')
    .update({
      is_escalated: true,
      status: 'paused', // Pause AI while human is handling
    })
    .eq('id', sessionId);

  if (updateError) {
    console.error('Failed to update session:', updateError);
    // Continue anyway as escalation record is created
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      message: 'Session escalated successfully',
      escalationId: escalation.id 
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
