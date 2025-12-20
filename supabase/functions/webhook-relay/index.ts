/**
 * Webhook Relay Edge Function
 * 
 * Simple proxy that receives a payload and forwards it to another URL.
 * Called internally from Supabase client only.
 * 
 * Configure the target URL via WEBHOOK_RELAY_TARGET_URL env var.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const targetUrl = Deno.env.get('WEBHOOK_RELAY_TARGET_URL');
  
  if (!targetUrl) {
    console.error('[Webhook Relay] WEBHOOK_RELAY_TARGET_URL not configured');
    return new Response(JSON.stringify({ error: 'Target URL not configured' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.text();
    console.log('[Webhook Relay] Relaying to:', targetUrl);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
      },
      body: body,
    });

    const responseText = await response.text();
    console.log(`[Webhook Relay] Target responded: ${response.status}`);

    return new Response(JSON.stringify({
      success: true,
      targetStatus: response.status,
      targetResponse: responseText.slice(0, 500),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Webhook Relay] Error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to relay',
      details: String(error),
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
