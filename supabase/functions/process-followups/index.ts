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
  createSupabaseFollowupStore,
  createSupabaseLLMLogger,
} from '../_shared/adapters/index.ts';
import { createConversationEngine } from '../_shared/sales-engine.bundle.ts';
import { createGeminiProvider } from '../_shared/sales-engine-llm.bundle.ts';

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
  sequence_index: number;
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
  
  // 1. Get pending items due now
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
  
  // 2. Initialize stores and engine
  const sessionStore = createSupabaseSessionStore(supabase, schemaName);
  const messageStore = createSupabaseMessageStore(supabase, schemaName);
  const followupStore = createSupabaseFollowupStore(supabase, schemaName);
  const engine = createConversationEngine();

  // 3. Process each item
  for (const item of pendingItems) {
    try {
      // 3.1 Get session to know where to send and current state
      const session = await sessionStore.findById(item.session_id);
      if (!session) {
        await markFailed(supabase, schemaName, item.id, 'Session not found');
        continue;
      }

      // 3.2 Load client config (needed for engine and channel credentials)
      const { data: settings } = await supabase
        .schema(schemaName)
        .from('settings')
        .select('config')
        .single();
      
      const clientConfig = settings?.config;
      if (!clientConfig) {
        await markFailed(supabase, schemaName, item.id, 'Client config not found');
        continue;
      }

      // 3.3 Create LLM provider
      const llmProvider = createGeminiProvider({
        apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
        model: clientConfig.llm.model,
      });

      // 3.4 Generate Follow-up Content using LLM
      console.log(`[Follow-up] Generating content for session ${session.id} (State: ${session.currentState}, Seq Index: ${item.sequence_index})`);
      const responses = await engine.generateFollowup(session.id, {
        sessionStore,
        messageStore,
        llmProvider,
        clientConfig,
      } as any);

      // 3.5 Send Message(s)
      const accessToken = clientConfig.channels.whatsapp?.accessToken || Deno.env.get('WHATSAPP_ACCESS_TOKEN');
      
      for (const response of responses) {
        if (session.channelType === 'whatsapp') {
          // Find the correct phone_number_id for this channel
          const mapping = allMappings.find(
            m => m.schema_name === schemaName && 
                 m.channel_type === session.channelType && 
                 m.channel_id === session.channelId
          );

          if (!mapping) {
            console.error(`[Follow-up] Mapping not found for session ${session.id}`);
            continue;
          }

          await sendWhatsAppMessage(
            mapping.channel_id,
            session.channelUserId,
            response.content,
            accessToken
          );
        }

        // Save to message history
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: 'text',
          content: response.content,
        });
      }

      // 3.6 Update Queue Status for CURRENT item
      await supabase
        .schema(schemaName)
        .from('followup_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      // 3.7 Schedule NEXT follow-up in the sequence
      await followupStore.scheduleNext(session.id, session.currentState, item.sequence_index);
      
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
  // Registration check follow-up
  if (item.followup_type === 'custom' && item.template_name === 'registration_check') {
    const registrationStatus = session.registration_status;
    
    if (registrationStatus === 'registered') {
      return "¡Felicidades! 🎉 Veo que completaste tu registro. ¿Ya realizaste tu primer depósito? Estoy aquí para ayudarte con cualquier duda.";
    } else if (registrationStatus === 'link_clicked') {
      return "Hola! 👋 Vi que abriste el enlace de registro. ¿Necesitas ayuda para completar el proceso? Estoy aquí para asistirte.";
    } else {
      return "Hola! 👋 ¿Pudiste revisar el enlace de registro que te envié? Si tienes alguna duda sobre el proceso, con gusto te ayudo.";
    }
  }
  
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
