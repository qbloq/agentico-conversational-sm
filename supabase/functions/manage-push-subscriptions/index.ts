import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { verifyAgent, corsHeaders } from '../_shared/auth.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const agent = await verifyAgent(req);
    if (!agent) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createSupabaseClient(agent.clientSchema);
    const url = new URL(req.url);

    if (req.method === 'POST') {
      const { subscription, deviceName } = await req.json();

      if (!subscription) {
        return new Response(
          JSON.stringify({ error: 'Subscription is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert({
          agent_id: agent.sub,
          subscription,
          device_name: deviceName || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'agent_id,subscription'
        });

      if (error) {
        console.error('Error saving subscription:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to save subscription' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Subscribed successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'DELETE') {
      const { subscription } = await req.json();

      if (!subscription) {
        const { error } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('agent_id', agent.sub);

        if (error) {
          return new Response(
            JSON.stringify({ error: 'Failed to delete subscriptions' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        const { error } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('agent_id', agent.sub)
          .eq('subscription', JSON.stringify(subscription));

        if (error) {
          return new Response(
            JSON.stringify({ error: 'Failed to delete subscription' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Unsubscribed successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
