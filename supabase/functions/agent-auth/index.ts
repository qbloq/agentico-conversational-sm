/**
 * Agent Auth Edge Function
 * 
 * Handles WhatsApp OTP-based authentication for human agents.
 * Flow:
 * 1. POST /request-otp - Check phone in DB, send 6-digit OTP via WhatsApp
 * 2. POST /verify-otp - Verify OTP, return JWT token
 * 3. POST /complete-profile - First login: capture name/email
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { create, verify, getNumericDate } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/').pop();

  try {
    switch (path) {
      case 'request-otp':
        return await handleRequestOtp(req);
      case 'verify-otp':
        return await handleVerifyOtp(req);
      case 'complete-profile':
        return await handleCompleteProfile(req);
      default:
        return new Response(
          JSON.stringify({ error: 'Unknown endpoint' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Request OTP - check phone in DB and send OTP via WhatsApp
 */
async function handleRequestOtp(req: Request): Promise<Response> {
  const { phone, clientSchema } = await req.json();

  if (!phone || !clientSchema) {
    return new Response(
      JSON.stringify({ error: 'Phone and clientSchema are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createSupabaseClient();

  console.log('Client schema:', clientSchema);
  // Check if agent exists in the client schema
  const { data: agent, error: agentError } = await supabase
    .schema(clientSchema)
    .from('human_agents')
    .select('id, phone, first_name, is_active')
    .eq('phone', phone)
    .single();

  if (agentError || !agent) {
    console.error('Agent not found:', agentError);
    return new Response(
      JSON.stringify({ error: 'Agent not found. Contact your administrator.' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!agent.is_active) {
    return new Response(
      JSON.stringify({ error: 'Agent account is deactivated. Contact your administrator.' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Store OTP session
  const { error: otpError } = await supabase
    .from('agent_otp_sessions')
    .insert({
      phone,
      otp_code: otp,
      client_schema: clientSchema,
      expires_at: expiresAt.toISOString(),
    });

  if (otpError) {
    console.error('Failed to create OTP session:', otpError);
    return new Response(
      JSON.stringify({ error: 'Failed to create OTP session' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Send OTP via WhatsApp
  const whatsappSent = await sendWhatsAppOtp(phone, otp, clientSchema);

  if (!whatsappSent) {
    return new Response(
      JSON.stringify({ error: 'Failed to send OTP via WhatsApp' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'OTP sent to your WhatsApp',
      isFirstLogin: !agent.first_name, // Need to complete profile if no name
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Verify OTP and return JWT token
 */
async function handleVerifyOtp(req: Request): Promise<Response> {
  const { phone, otp, clientSchema } = await req.json();

  if (!phone || !otp || !clientSchema) {
    return new Response(
      JSON.stringify({ error: 'Phone, OTP, and clientSchema are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createSupabaseClient();

  // Find valid OTP session
  const { data: session, error: sessionError } = await supabase
    .from('agent_otp_sessions')
    .select('*')
    .eq('phone', phone)
    .eq('otp_code', otp)
    .eq('client_schema', clientSchema)
    .eq('verified', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (sessionError || !session) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired OTP' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Mark session as verified
  await supabase
    .from('agent_otp_sessions')
    .update({ verified: true })
    .eq('id', session.id);

  // Get agent details
  const { data: agent, error: agentError } = await supabase
    .schema(clientSchema)
    .from('human_agents')
    .select('*')
    .eq('phone', phone)
    .single();

  if (agentError || !agent) {
    return new Response(
      JSON.stringify({ error: 'Agent not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Update last login
  await supabase
    .schema(clientSchema)
    .from('human_agents')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', agent.id);

  // Generate JWT
  const jwtSecret = Deno.env.get('AGENT_JWT_SECRET') || 'your-secret-key';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  const token = await create(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub: agent.id,
      phone: agent.phone,
      clientSchema,
      exp: getNumericDate(60 * 60 * 24 * 7), // 7 days
    },
    key
  );

  return new Response(
    JSON.stringify({
      success: true,
      token,
      agent: {
        id: agent.id,
        phone: agent.phone,
        firstName: agent.first_name,
        lastName: agent.last_name,
        email: agent.email,
      },
      isFirstLogin: !agent.first_name,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Complete profile - first login name/email capture
 */
async function handleCompleteProfile(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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

    const payload = await verify(token, key);
    const { firstName, lastName, email } = await req.json();

    if (!firstName) {
      return new Response(
        JSON.stringify({ error: 'First name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createSupabaseClient();

    const { error: updateError } = await supabase
      .schema(payload.clientSchema as string)
      .from('human_agents')
      .update({
        first_name: firstName,
        last_name: lastName || null,
        email: email || null,
      })
      .eq('id', payload.sub as string);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to update profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Profile updated' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Send OTP via WhatsApp template message
 */
async function sendWhatsAppOtp(phone: string, otp: string, clientSchema: string): Promise<boolean> {
  // Get client config for WhatsApp credentials
  // For now, use environment variables directly
  const phoneNumberId = Deno.env.get('TAG_WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN');
  const templateName = Deno.env.get('WHATSAPP_TPL_OTP') || 'agent_otp_code';

  if (!phoneNumberId || !accessToken) {
    console.error('WhatsApp credentials not configured');
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
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: otp },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('WhatsApp API error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp OTP:', error);
    return false;
  }
}
