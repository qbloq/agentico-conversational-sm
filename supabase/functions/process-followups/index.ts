/**
 * Process Follow-ups Edge Function
 * 
 * Triggered by pg_cron (e.g., every minute).
 * Checks for pending follow-ups in all client schemas and sends them.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import {
  createSupabaseSessionStore,
  createSupabaseMessageStore,
} from '../_shared/adapters/index.ts';

interface ChannelMapping {
  client_id: string;
  schema_name: string;
  channel_type: string;
  channel_id: string;
}

interface FollowupItem {
  id: string;
  session_id: string;
  scheduled_at: string;
  followup_type: 'short_term' | 'daily' | 'custom';
  template_name?: string;
  template_params?: any;
  status: string;
}

serve(async (req) => {
  console.log('Processing follow-ups...');
  
  try {
    const supabase = createSupabaseClient();
    
    // 1. Get all active clients/schemas
    const { data: mappings, error: mappingError } = await supabase
      .from('channel_mappings')
      .select('*')
      .eq('is_active', true);
      
    if (mappingError) throw mappingError;
    if (!mappings || mappings.length === 0) {
      console.log('No active channel mappings found.');
      return new Response('OK', { status: 200 });
    }
    
    // Deduplicate schemas (we might have multiple channels for same client)
    const uniqueSchemas = [...new Set(mappings.map(m => m.schema_name))];
    
    // 2. Process each client schema
    for (const schemaName of uniqueSchemas) {
      await processClientSchema(supabase, schemaName, mappings);
    }
    
    return new Response('OK', { status: 200 });
    
  } catch (error) {
    console.error('Error processing follow-ups:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

async function processClientSchema(
  supabase: ReturnType<typeof createSupabaseClient>,
  schemaName: string,
  allMappings: ChannelMapping[]
) {
  console.log(`Checking schema: ${schemaName}`);
  
  // Get pending items due now
  const now = new Date().toISOString();
  const { data: pendingItems, error: fetchError } = await supabase
    .schema(schemaName)
    .from('followup_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .limit(50); // Batch size
    
  if (fetchError) {
    console.error(`Error fetching queue for ${schemaName}:`, fetchError);
    return;
  }
  
  if (!pendingItems || pendingItems.length === 0) {
    return;
  }
  
  console.log(`Found ${pendingItems.length} pending items in ${schemaName}`);
  
  const sessionStore = createSupabaseSessionStore(supabase, schemaName);
  const messageStore = createSupabaseMessageStore(supabase, schemaName);
  
  // Process each item
  for (const item of pendingItems) {
    try {
      // Get session to know where to send
      const session = await sessionStore.findById(item.session_id);
      if (!session) {
        await markFailed(supabase, schemaName, item.id, 'Session not found');
        continue;
      }
      
      // Find config for this channel
      const mapping = allMappings.find(
        m => m.schema_name === schemaName && 
             m.channel_type === session.channelType && 
             m.channel_id === session.channelId
      );
      
      if (!mapping) {
        await markFailed(supabase, schemaName, item.id, 'Channel config not found');
        continue;
      }
      
      // Get credentials (this would ideally come from a secure config store/vault)
      // For MVP, we assume env vars or config table. 
      // Here we'll try to get it from a hypothetical config function or env
      const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN'); // Fallback/Global
      // In real multi-tenant, we'd fetch specific credentials based on client_id
      
      if (!accessToken) {
        await markFailed(supabase, schemaName, item.id, 'Missing credentials');
        continue;
      }
      
      // Generate Content
      const content = generateFollowupContent(item, session);
      
      // Send Message
      if (session.channelType === 'whatsapp') {
        await sendWhatsAppMessage(
          session.channelId,
          session.channelUserId,
          content,
          accessToken
        );
      } else {
        // TODO: Implement other channels
        console.log(`Skipping non-whatsapp channel: ${session.channelType}`);
      }
      
      // Update Queue Status
      await supabase
        .schema(schemaName)
        .from('followup_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', item.id);
        
      // Save to message history
      await messageStore.save(session.id, {
        direction: 'outbound',
        type: 'text',
        content: content, // Already plain text from generateFollowupContent
      });
      
      // Update Session State if needed
      // If we are sending a follow-up, we might want to move state to 'follow_up'
      // ONLY if the session is currently 'completed' or 'disqualified' or 'follow_up'
      // If the user is active in another state, we might just be sending a nudge
      if (['completed', 'disqualified', 'follow_up'].includes(session.currentState)) {
         await sessionStore.update(session.id, {
           currentState: 'follow_up',
           lastMessageAt: new Date(),
         });
      }
      
    } catch (err) {
      console.error(`Failed to process item ${item.id}:`, err);
      await markFailed(supabase, schemaName, item.id, String(err));
    }
  }
}

async function markFailed(supabase: any, schema: string, id: string, reason: string) {
  await supabase
    .schema(schema)
    .from('followup_queue')
    .update({
      status: 'failed',
      error_message: reason,
    })
    .eq('id', id);
}

function generateFollowupContent(item: FollowupItem, session: any): string {
  // Simple logic for now - can be expanded with templates
  if (item.followup_type === 'short_term') {
    return "Hola! 👋 Sigues ahí? Avísame si tienes alguna duda.";
  }
  
  if (item.followup_type === 'daily') {
    return "Hola! Espero que estés teniendo un buen día. ¿Pudiste revisar la información sobre las cuentas 12x? Estoy aquí si necesitas ayuda para empezar. 🚀";
  }
  
  return "Hola! Solo pasaba para ver si necesitas algo más. Saludos!";
}

async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string
): Promise<void> {
  const baseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com';
  const url = `${baseUrl}/v24.0/${phoneNumberId}/messages`;

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
    throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
  }
}
