/**
 * Send Human Message Edge Function
 * 
 * Endpoint for human agents to send messages to customers.
 * Messages are saved to the conversation history and sent via WhatsApp.
 * 
 * POST /send-human-message
 * Body: { escalationId, message }
 * Headers: Authorization: Bearer <agent-jwt>
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

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Verify agent
    const agent = await verifyAgent(req);
    if (!agent) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { escalationId, message } = await req.json();

    if (!escalationId || !message) {
      return new Response(
        JSON.stringify({ error: 'escalationId and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Get escalation with session details
    const { data: escalation, error: escError } = await supabase
      .schema(agent.clientSchema)
      .from('escalations')
      .select(`
        id,
        status,
        assigned_to,
        session:session_id (
          id,
          channel_type,
          channel_id,
          channel_user_id
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

    // Verify escalation status
    if (escalation.status === 'resolved' || escalation.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'Escalation is already closed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auto-assign if not assigned
    if (!escalation.assigned_to) {
      await supabase
        .schema(agent.clientSchema)
        .from('escalations')
        .update({
          assigned_to: agent.sub,
          assigned_at: new Date().toISOString(),
          status: 'in_progress',
        })
        .eq('id', escalationId);
    } else {
      // Update status to in_progress
      await supabase
        .schema(agent.clientSchema)
        .from('escalations')
        .update({ status: 'in_progress' })
        .eq('id', escalationId);
    }

    const session = escalation.session;

    // Save message to DB
    const { data: savedMessage, error: msgError } = await supabase
      .schema(agent.clientSchema)
      .from('messages')
      .insert({
        session_id: session.id,
        direction: 'outbound',
        type: 'text',
        content: message,
        sent_by_agent_id: agent.sub, // Proper FK to human_agents table
      })
      .select()
      .single();

    if (msgError) {
      console.error('Failed to save message:', msgError);
      return new Response(
        JSON.stringify({ error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send via WhatsApp
    const sent = await sendWhatsAppMessage(
      session.channel_id,          // phone_number_id
      session.channel_user_id,     // customer phone
      message,
      agent.clientSchema
    );

    if (!sent) {
      // Message saved but not sent - mark for retry or notify
      console.error('Failed to send WhatsApp message');
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Message saved but WhatsApp delivery failed',
          messageId: savedMessage.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update session last_message_at
    await supabase
      .schema(agent.clientSchema)
      .from('sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', session.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: savedMessage.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
 * Verify agent JWT
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

    return await verify(token, key) as unknown as AgentPayload;
  } catch {
    return null;
  }
}

/**
 * Send message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  clientSchema: string
): Promise<boolean> {
  // Get access token based on client (for now use env var)
  const accessToken = Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN');

  if (!accessToken) {
    console.error('WhatsApp access token not configured');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('WhatsApp API error:', error);
      return false;
    }

    console.log(`Message sent to ${to} by agent`);
    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
  }
}
