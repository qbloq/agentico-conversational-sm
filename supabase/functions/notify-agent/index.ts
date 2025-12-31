import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// Use npm: specifier for better compatibility with Node.js modules in Deno/Supabase
import webpush from 'npm:web-push@3.6.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, record, schema } = await req.json();
    const supabase = createSupabaseClient(schema);

    console.log(`Notification trigger: ${type} in schema ${schema}`);

    let targetAgentId: string | null = null;
    let notificationTitle = '';
    let notificationBody = '';
    let data: any = {};

    if (type === 'new_escalation') {
      // Broadcast to ALL agents
      notificationTitle = '🚀 New Escalation';
      notificationBody = record.reason || 'Management required for a new session.';
      data = {
        type: 'escalation',
        id: record.id,
        sessionId: record.session_id,
        schema: schema,
      };
    } else if (type === 'new_message') {
      // Find the active escalation for this session
      const { data: escalation } = await supabase
        .from('escalations')
        .select('id, assigned_to, status')
        .eq('session_id', record.session_id)
        .in('status', ['open', 'assigned', 'in_progress'])
        .single();
      
      if (escalation?.assigned_to) {
        targetAgentId = escalation.assigned_to;
        notificationTitle = 'New Message 💬';
        notificationBody = record.content || 'New message received';
        data = { sessionId: record.session_id, escalationId: escalation.id };
      } else {
        console.log('No assigned agent for message notification, skipping.');
        return new Response(JSON.stringify({ success: true, message: 'No assigned agent' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else if (type === 'test_trigger') {
      console.log('Handling test_trigger');
      notificationTitle = 'Test Notification';
      notificationBody = 'This is a test notification from Supabase';
      data = { test: true };
    }

    console.log(`Searching for subscriptions. Target Agent: ${targetAgentId || 'ALL'}`);
    let subscriptionsQuery = supabase.from('push_subscriptions').select('subscription');
    if (targetAgentId) {
      subscriptionsQuery = subscriptionsQuery.eq('agent_id', targetAgentId);
    }

    const { data: subscriptions, error: subsError } = await subscriptionsQuery;
    
    if (subsError) {
      console.error('Error fetching subscriptions:', subsError);
      throw subsError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No subscriptions found for this notification.');
      return new Response(JSON.stringify({ success: true, message: 'No subscriptions' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Sending notifications to ${subscriptions.length} subscribers...`);
    
    const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const VAPID_EMAIL = Deno.env.get('VAPID_EMAIL') || 'mailto:admin@example.com';

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error('VAPID keys missing in environment!');
      throw new Error('VAPID keys not configured');
    }

    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({
      title: notificationTitle,
      body: notificationBody,
      data: data,
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub: any, idx: number) => {
        try {
          console.log(`Sending to subscriber ${idx}...`);
          const res = await webpush.sendNotification(sub.subscription, payload);
          console.log(`Subscriber ${idx} success:`, res.statusCode);
          return res;
        } catch (err: any) {
          console.error(`Subscriber ${idx} failed:`, {
            statusCode: err.statusCode,
            body: err.body,
            message: err.message
          });
          throw err;
        }
      })
    );

    console.log('Final results summary:', JSON.stringify(results, null, 2));
    const failedPromises = results
      .map((res, idx) => ({ res, idx }))
      .filter(({ res }) => res.status === 'rejected');
    
    if (failedPromises.length > 0) {
      console.log(`${failedPromises.length} notifications failed.`);
      // Optional: Delete subscriptions that returned 410 (Gone) or 404
      for (const { res, idx } of failedPromises) {
        const error = (res as PromiseRejectedResult).reason;
        if (error.statusCode === 410 || error.statusCode === 404) {
          const subToDelete = subscriptions[idx].subscription;
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('subscription', JSON.stringify(subToDelete));
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sentCount: subscriptions.length,
        results: results.map((r: any) => r.status === 'fulfilled' ? { status: 'success', value: r.value.statusCode } : { status: 'failed', error: r.reason })
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('CRITICAL ERROR in notify-agent:', error);
    return new Response(JSON.stringify({ 
      error: error.message, 
      stack: error.stack,
      details: 'Check function logs for more info'
    }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
