/**
 * Process Follow-ups Edge Function
 * 
 * Triggered by pg_cron (e.g., every minute).
 * Checks for pending follow-ups in all client schemas and sends them.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { getAllClientConfigs } from '../_shared/client-router.ts';
import {
  createSupabaseSessionStore,
  createSupabaseMessageStore,
  createSupabaseFollowupStore,
  createSupabaseStateMachineStore,
  createSupabaseLLMLogger,
} from '../_shared/adapters/index.ts';
import { createConversationEngine } from '../_shared/sales-engine.bundle.ts';
import { createGeminiProvider } from '../_shared/sales-engine-llm.bundle.ts';

interface FollowupItem {
  id: string;
  session_id: string;
  scheduled_at: string;
  followup_type: 'short_term' | 'daily' | 'custom';
  template_name?: string;
  template_params?: any;
  sequence_index: number;
  followup_config_name?: string;
  status: string;
}

serve(async () => {
  const startTime = Date.now();
  console.log('[Follow-up Worker] Starting execution...');
  
  try {
    const supabase = createSupabaseClient();
    
    // 1. Get all active clients using the unified router
    const clients = await getAllClientConfigs(supabase);
    
    if (!clients || clients.length === 0) {
      console.log('[Follow-up Worker] No active clients found.');
      return new Response('OK', { status: 200 });
    }
    
    console.log(`[Follow-up Worker] Processing ${clients.length} clients`);
    
    // 2. Process each client
    for (const client of clients) {
      const { schemaName, config: clientConfig } = client;
      
      try {
        await processClientSchema(supabase, schemaName, clientConfig);
      } catch (clientError) {
        console.error(`[Follow-up Worker] Failed to process client ${client.clientId} (${schemaName}):`, clientError);
      }
    }
    
    console.log(`[Follow-up Worker] Finished in ${Date.now() - startTime}ms`);
    return new Response('OK', { status: 200 });
    
  } catch (error) {
    console.error('[Follow-up Worker] Fatal error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

async function processClientSchema(
  supabase: any,
  schemaName: string,
  clientConfig: any
) {
  console.log(`[Follow-up Worker] Checking schema: ${schemaName}`);
  
  // 1. Get pending items due now
  const now = new Date().toISOString();
  const { data: pendingItems, error: fetchError } = await supabase
    .schema(schemaName)
    .from('followup_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .limit(50);
    
  if (fetchError) {
    console.error(`[Follow-up Worker] Error fetching queue for ${schemaName}:`, fetchError);
    return;
  }
  
  if (!pendingItems || pendingItems.length === 0) {
    return;
  }
  
  console.log(`[Follow-up Worker] Found ${pendingItems.length} pending items in ${schemaName}`);
  
  // 2. Initialize stores and engine
  const sessionStore = createSupabaseSessionStore(supabase, schemaName);
  const messageStore = createSupabaseMessageStore(supabase, schemaName);
  const followupStore = createSupabaseFollowupStore(supabase, schemaName);
  const stateMachineStore = createSupabaseStateMachineStore(supabase, schemaName);
  const engine = createConversationEngine();

  // 3. Process each item
  for (const item of pendingItems) {
    try {
      // 3.1 Get session
      const session = await sessionStore.findById(item.session_id);
      if (!session) {
        await markFailed(supabase, schemaName, item.id, 'Session not found');
        continue;
      }

      // 3.2 Initialize LLM provider using client configuration
      const llmProvider = createGeminiProvider({
        apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
        model: clientConfig.llm?.model || 'gemini-2.5-flash',
      });

      const deps = { 
        sessionStore, 
        messageStore, 
        llmProvider, 
        clientConfig, 
        stateMachineStore,
        llmLogger: createSupabaseLLMLogger(supabase)
      };

      // 3.3 Resolve Follow-up Content (Registry vs LLM generation)
      let responses: any[] = [];
      let stateConfig: any = null;

      if (item.followup_config_name) {
        console.log(`[Follow-up Worker] Resolving registry config: ${item.followup_config_name}`);
        const config = await stateMachineStore.getFollowupConfig(item.followup_config_name);
        
        if (config) {
          // Resolve variables (Literal vs LLM)
          const resolvedVariables: Array<{ key: string; value: string }> = [];
          for (const v of config.variablesConfig) {
            let value = '';
            if (v.type === 'literal') {
              value = v.value || '';
            } else if (v.type === 'llm' && v.prompt) {
              value = await engine.generateFollowupVariable(session.id, v.prompt, deps);
            } else if (v.type === 'context' && v.field) {
              value = String(session.context[v.field] || '');
            }
            resolvedVariables.push({ key: v.key, value });
          }

          if (config.type === 'template') {
            responses = [{
              type: 'template',
              content: '', // Template fallback not strictly needed if template works
              templateName: config.content, 
              templateParams: resolvedVariables.map(v => v.value)
            }];
          } else {
            // Text message with variable substitution
            let body = config.content;
            for (const { key, value } of resolvedVariables) {
              body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
            }
            responses = [{ type: 'text', content: body }];
          }

          // Get state machine for next scheduling
          const sm = await stateMachineStore.findActive(clientConfig.stateMachineName);
          if (sm && sm.states) {
            stateConfig = (sm.states as any)[session.currentState];
          }
        }
      }

      // Fallback to legacy generator if no registry config found or resolved
      if (responses.length === 0) {
        console.log(`[Follow-up Worker] Falling back to dynamic generator for session ${session.id}`);
        const res = await engine.generateFollowup(session.id, deps as any);
        responses = res.responses;
        stateConfig = res.stateConfig;
      }

      // 3.4 Send Message(s)
      const whatsappSecrets = clientConfig.channels?.whatsapp;
      const accessToken = whatsappSecrets?.accessToken || Deno.env.get('WHATSAPP_ACCESS_TOKEN');
      const phoneNumberId = whatsappSecrets?.phoneNumberId;

      if (!phoneNumberId || !accessToken) {
        console.error(`[Follow-up Worker] Missing WhatsApp credentials for ${schemaName}`);
        await markFailed(supabase, schemaName, item.id, 'Missing WhatsApp credentials');
        continue;
      }
      
      for (const response of responses) {
        if (session.channelType === 'whatsapp') {
          let finalResponse = response;

          // 24h Rule: Force template if window closed
          if (isMoreThan24Hours(session.lastMessageAt) && response.type === 'text') {
            console.log(`[Follow-up Worker] 24h Window closed for ${session.id}, forcing template fallback.`);
            finalResponse = {
              type: 'template',
              templateName: Deno.env.get('WHATSAPP_TPL_ESCALATION_01') || 'followup_standard',
              templateParams: []
            };
          }

          await sendWhatsAppMessage(
            phoneNumberId,
            session.channelUserId,
            finalResponse,
            accessToken
          );
        }

        // Save to message history
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: response.type === 'template' ? 'text' : response.type,
          content: response.type === 'template' ? `[Template: ${response.templateName}]` : response.content,
        });
      }

      // 3.5 Update Queue Status
      await supabase
        .schema(schemaName)
        .from('followup_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      // 3.6 Schedule NEXT follow-up in sequence
      if (stateConfig?.followupSequence) {
        await followupStore.scheduleNext(session.id, session.currentState, item.sequence_index, stateConfig.followupSequence);
      }
      
    } catch (err) {
      console.error(`[Follow-up Worker] Failed to process item ${item.id}:`, err);
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

async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  message: any,
  accessToken: string
): Promise<void> {
  const baseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com';
  const url = `${baseUrl}/v24.0/${phoneNumberId}/messages`;

  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
  };

  if (message.type === 'template') {
    payload.type = 'template';
    payload.template = {
      name: message.templateName,
      language: { code: 'es' }, // Default to Spanish as per business requirements
      components: message.templateParams ? [
        {
          type: 'body',
          parameters: message.templateParams.map((p: string) => ({
            type: 'text',
            text: p,
          })),
        }
      ] : [],
    };
  } else {
    payload.type = 'text';
    payload.text = { body: message.content || message };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} - ${error}`);
  }
}

function isMoreThan24Hours(date: string | Date | undefined | null): boolean {
  if (!date) return true;
  const lastAt = new Date(date).getTime();
  const now = Date.now();
  return (now - lastAt) > (24 * 60 * 60 * 1000);
}
