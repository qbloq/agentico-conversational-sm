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

const LOCK_TTL_MS = 60000; // 1 minute TTL for follow-up worker
const WORKER_LOCK_ID = 'process-followups';

/**
 * Try to acquire a worker lock. Returns true if acquired.
 */
async function tryAcquireLock(supabase: ReturnType<typeof createSupabaseClient>): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  
  const { data, error } = await supabase
    .from('worker_locks')
    .upsert(
      { id: WORKER_LOCK_ID, locked_at: now.toISOString(), expires_at: expiresAt.toISOString() },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    .select('id');
  
  if (error) {
    const { data: existing } = await supabase
      .from('worker_locks')
      .select('expires_at')
      .eq('id', WORKER_LOCK_ID)
      .single();
    
    if (existing && new Date(existing.expires_at) > now) {
      return false;
    }
    
    const { error: updateError } = await supabase
      .from('worker_locks')
      .update({ locked_at: now.toISOString(), expires_at: expiresAt.toISOString() })
      .eq('id', WORKER_LOCK_ID)
      .lt('expires_at', now.toISOString());
    
    return !updateError;
  }
  
  return (data?.length || 0) > 0;
}

async function releaseLock(supabase: ReturnType<typeof createSupabaseClient>): Promise<void> {
  await supabase
    .from('worker_locks')
    .delete()
    .eq('id', WORKER_LOCK_ID);
}

serve(async () => {
  const startTime = Date.now();
  const supabase = createSupabaseClient();
  
  // Single-instance guard
  const acquired = await tryAcquireLock(supabase);
  if (!acquired) {
    console.log('[Follow-up Worker] Another instance is running, skipping');
    return new Response('Locked', { status: 200 });
  }

  console.log('[Follow-up Worker] Starting execution...');
  
  try {
    
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
    
    // Release lock
    await releaseLock(supabase);
    
    return new Response('OK', { status: 200 });
    
  } catch (error) {
    console.error('[Follow-up Worker] Fatal error:', error);
    
    // Release lock on error
    const supabase = createSupabaseClient();
    await releaseLock(supabase);
    
    return new Response('Internal Server Error', { status: 500 });
  }
});

async function processClientSchema(
  supabase: any,
  schemaName: string,
  clientConfig: any
) {
  console.log(`[Follow-up Worker] Checking schema: ${clientConfig.clientId}`);
  
  const followupStore = createSupabaseFollowupStore(supabase, schemaName);
  
  // 0. Clean up stale locks first
  const cleaned = await followupStore.cleanupStaleLocks();
  if (cleaned > 0) {
    console.log(`[Follow-up Worker] Cleaned up ${cleaned} stale locks in ${schemaName}`);
  }

  // 1. Get pending items due now that are NOT already being processed
  const now = new Date().toISOString();
  const { data: pendingItems, error: fetchError } = await supabase
    .schema(schemaName)
    .from('followup_queue')
    .select('*')
    .eq('status', 'pending')
    .is('processing_started_at', null)
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
  const stateMachineStore = createSupabaseStateMachineStore(supabase, schemaName);
  const engine = createConversationEngine();

  // 3. Process each item
  for (const item of pendingItems) {
    try {
      // 3.0 Claim the item
      const claimed = await followupStore.claim(item.id);
      if (!claimed) {
        console.log(`[Follow-up Worker] Item ${item.id} already claimed by another worker, skipping`);
        continue;
      }

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
          console.log('>>>>>>>>clientConfig', clientConfig)
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
      const clientConfiguredPhoneNumberId = whatsappSecrets?.phoneNumberId;
      const phoneNumberId = session.channelId || clientConfiguredPhoneNumberId;

      if (!phoneNumberId || !accessToken) {
        const missingDetails = `Missing WhatsApp routing credentials: phoneNumberId=${phoneNumberId ? 'present' : 'missing'}, accessToken=${accessToken ? 'present' : 'missing'}`;
        console.error(`[Follow-up Worker] ${missingDetails} for ${schemaName} (item=${item.id}, session=${item.session_id})`);
        await markFailed(supabase, schemaName, item.id, missingDetails);
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
          processing_started_at: null,
        })
        .eq('id', item.id);

      // 3.6 Schedule NEXT follow-up in sequence
      if (stateConfig?.followupSequence) {
        await followupStore.scheduleNext(session.id, session.currentState, item.sequence_index, stateConfig.followupSequence);
      }
      
    } catch (err) {
      console.error(`[Follow-up Worker] Failed to process item ${item.id}:`, err);
      await followupStore.markFailed(item.id, String(err));
    }
  }
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
      language: { code: 'es_co' }, // Default to Spanish as per business requirements
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
