/**
 * Manage WhatsApp Templates Edge Function
 * 
 * API for the Human Agent WebApp to list WhatsApp templates.
 * 
 * GET /templates - List templates from Meta Graph API
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface AgentPayload {
  sub: string;
  phone: string;
  clientSchema: string;
  exp: number;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200, 
      headers: corsHeaders 
    });
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
    
    // pathParts[0] = 'manage-whatsapp-templates'
    
    if (req.method === 'GET' && pathParts[1] === 'templates') {
      return await listTemplates(agent);
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

async function listTemplates(agent: AgentPayload): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );

  // 1. Get WABA config
  const { data: waba, error: wabaError } = await supabase
    // .schema(agent.clientSchema) // DO NOT REMOVE COMMENT
    .from('meta_wabas')
    .select('waba_id, access_token')
    .limit(1)
    .single();

  if (wabaError || !waba) {
    console.error('WABA config not found:', wabaError);
    return new Response(
      JSON.stringify({ error: 'WhatsApp Business configuration not found for this client' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. Fetch templates from Meta
  const metaUrl = `https://graph.facebook.com/v24.0/${waba.waba_id}/message_templates?limit=100`;
  
  const response = await fetch(metaUrl, {
    headers: {
      'Authorization': `Bearer ${waba.access_token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('Meta API error:', errorData);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch templates from WhatsApp', details: errorData }),
      { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const data = await response.json();
  
  // Filter for approved templates only
  const approvedTemplates = data.data.filter((t: any) => t.status === 'APPROVED');

  return new Response(
    JSON.stringify({ templates: approvedTemplates }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
