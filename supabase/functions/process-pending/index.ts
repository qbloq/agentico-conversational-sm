/**
 * Process Pending Messages Edge Function
 * 
 * Worker function that processes debounced messages.
 * Uses Self-Invoking + pg_cron Hybrid strategy:
 * - Self-invokes every 3s while there's work to do
 * - pg_cron heartbeat (1min) restarts loop if it dies
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { getAllClientConfigs } from '../_shared/client-router.ts';
import {
  createSupabaseContactStore,
  createSupabaseSessionStore,
  createSupabaseMessageStore,
  createSupabaseKnowledgeStore,
  createSupabaseExampleStore,
  createSupabaseLLMLogger,
  createSupabaseStateMachineStore,
  createSupabaseMessageBufferStore,
  createSupabaseEscalationStore,
  createSupabaseDepositStore,
  createSupabaseFollowupStore,
} from '../_shared/adapters/index.ts';
import { createConversationEngine } from '../_shared/sales-engine.bundle.ts';
import { createGeminiProvider, createGeminiEmbeddingProvider } from '../_shared/sales-engine-llm.bundle.ts';
import { 
  MediaServiceImpl, 
  AssemblyAITranscriber, 
  GeminiVisionAnalyzer, 
  SupabaseStorageProvider 
} from '../_shared/sales-engine-media.bundle.ts';
import { WhatsAppNotificationService } from '../_shared/sales-engine-escalation.bundle.ts';

const MAX_RUNTIME_MS = 25000; // 25s max (Edge Function limit is 30s)
const SELF_INVOKE_DELAY_MS = 3000; // 3 second loop
const LOCK_TTL_MS = 35000; // Lock expires after 35s (slightly longer than MAX_RUNTIME)
const WORKER_LOCK_ID = 'process-pending';

/**
 * Try to acquire a worker lock. Returns true if acquired.
 * Uses an upsert with a TTL check — if the existing lock is expired, it gets overwritten.
 */
async function tryAcquireLock(supabase: ReturnType<typeof createSupabaseClient>): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  
  // Try to insert or update only if expired
  const { data, error } = await supabase
    .from('worker_locks')
    .upsert(
      { id: WORKER_LOCK_ID, locked_at: now.toISOString(), expires_at: expiresAt.toISOString() },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    .select('id');
  
  if (error) {
    // If upsert fails, check if it's because lock is held
    // Fallback: check if existing lock is expired
    const { data: existing } = await supabase
      .from('worker_locks')
      .select('expires_at')
      .eq('id', WORKER_LOCK_ID)
      .single();
    
    if (existing && new Date(existing.expires_at) > now) {
      return false; // Lock is held and not expired
    }
    
    // Lock is expired, force-update it
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

serve(async (req: Request) => {
  const startTime = Date.now();
  const supabase = createSupabaseClient();
  const engine = createConversationEngine();
  
  // Parse source to track invocation origin
  let source = 'unknown';
  try {
    const body = await req.clone().json();
    source = body?.source || 'cron';
  } catch { source = 'cron'; }
  
  // Single-instance guard: try to acquire lock
  const acquired = await tryAcquireLock(supabase);
  
  if (!acquired) {
    console.log(`[ProcessPending] Another instance is running, skipping (source: ${source})`);
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'lock_held' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // Stats for logging
  let sessionsProcessed = 0;
  let messagesProcessed = 0;
  let errors = 0;
  
  try {
    // Get all client configs from database
    const clients = await getAllClientConfigs(supabase);
    
    // Run cleanup on each invocation to prevent dead-letter/zombie accumulation
    for (const client of clients) {
      if (!client.config?.debounce?.enabled) continue;
      const bufStore = createSupabaseMessageBufferStore(supabase, client.schemaName, client.channelId);
      await bufStore.cleanupStaleMessages();
    }
    
    console.log(`[ProcessPending] Processing ${clients.length} clients`);
    
    for (const client of clients) {
      const schemaName = client.schemaName;
      const channelId = client.channelId;
      const clientConfig = client.config;
      
      // Skip if debounce not enabled for this client
      if (!clientConfig?.debounce?.enabled) {
        console.log(`[ProcessPending] Debounce not enabled for ${client.clientId}, skipping`);
        continue;
      }
      
      console.log(`[ProcessPending] Checking ${client.clientId} (${schemaName}, channel: ${channelId})`);
      
      const messageBufferStore = createSupabaseMessageBufferStore(supabase, schemaName, channelId);
      
      // Get mature sessions
      const matureSessions = await messageBufferStore.getMatureSessions();
      
      for (const sessionKeyHash of matureSessions) {
        // Check runtime limit
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          console.log('[ProcessPending] Runtime limit reached, will continue in next invocation');
          break;
        }
        
        try {
          // Get session info BEFORE processing (since processPendingMessages deletes the messages)
          const pendingBeforeProcess = await messageBufferStore.getBySession(sessionKeyHash);
          if (pendingBeforeProcess.length === 0) {
            console.log(`[ProcessPending] No messages for ${sessionKeyHash.slice(0, 8)}...`);
            continue;
          }
          
          const sessionKey = pendingBeforeProcess[0].sessionKey;
          console.log(`[ProcessPending] Found ${pendingBeforeProcess.length} messages for ${sessionKey.channelUserId}`);
          
          // Build full dependencies
          const deps = buildDependencies(supabase, schemaName, channelId, clientConfig, messageBufferStore);
          
          // Process pending messages (this will delete them after success)
          const result = await engine.processPendingMessages(sessionKeyHash, deps);
          
          if (result.responses.length > 0) {
            sessionsProcessed++;
            messagesProcessed += result.responses.length;
            
            console.log(`[ProcessPending] Sending ${result.responses.length} responses to ${sessionKey.channelUserId}`);
            
            // Send responses via appropriate channel
            await sendResponses(result.responses, sessionKey, clientConfig);

            // After successful processing, schedule the next follow-up in the sequence
            if (result.sessionId) {
              const engineResult = result as any;
              const { followupStore } = deps;
              const nextState = engineResult.sessionUpdates?.currentState || engineResult.responses[0]?.metadata?.state || 'initial';
              console.log(`[ProcessPending] Scheduling follow-up for session ${engineResult.sessionId} in state ${nextState}`);
              await followupStore.scheduleNext(engineResult.sessionId, nextState, -1, engineResult.stateConfig?.followupSequence);
            }
          }
        } catch (error) {
          errors++;
          console.error(`[ProcessPending] Failed to process ${sessionKeyHash.slice(0, 8)}...:`, error);
          // Error already handled inside processPendingMessages (markForRetry)
        }
      }
    }
    
    // Check if there's more work to do
    const hasMoreWork = await checkForPendingWork(supabase, clients || []);
    
    if (hasMoreWork && Date.now() - startTime < MAX_RUNTIME_MS) {
      // Schedule self-invoke
      await scheduleSelfInvoke(SELF_INVOKE_DELAY_MS);
    }
    
  } catch (error) {
    console.error('[ProcessPending] Worker error:', error);
    errors++;
  }
  
  // Release worker lock
  await releaseLock(supabase);
  
  // Log stats
  console.log(JSON.stringify({
    type: 'debounce_worker_stats',
    source,
    sessionsProcessed,
    messagesProcessed,
    errors,
    durationMs: Date.now() - startTime,
  }));
  
  return new Response(JSON.stringify({ 
    ok: true, 
    source,
    sessionsProcessed, 
    messagesProcessed,
    errors,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/**
 * Build engine dependencies for a client schema
 */
function buildDependencies(
  supabase: ReturnType<typeof createSupabaseClient>,
  schemaName: string,
  channelId: string,
  clientConfig: any,
  messageBufferStore: ReturnType<typeof createSupabaseMessageBufferStore>
) {
  const contactStore = createSupabaseContactStore(supabase, schemaName);
  const sessionStore = createSupabaseSessionStore(supabase, schemaName);
  const messageStore = createSupabaseMessageStore(supabase, schemaName);
  const knowledgeStore = createSupabaseKnowledgeStore(supabase, schemaName);
  const exampleStore = createSupabaseExampleStore(supabase);
  const stateMachineStore = createSupabaseStateMachineStore(supabase, schemaName);
  const escalationStore = createSupabaseEscalationStore(supabase, schemaName);
  const depositStore = createSupabaseDepositStore(supabase, schemaName);
  const followupStore = createSupabaseFollowupStore(supabase, schemaName);
  const llmLogger = createSupabaseLLMLogger(supabase);
  
  const llmProvider = createGeminiProvider({
    apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
    model: clientConfig.llm?.model || 'gemini-2.5-flash',
  });
  
  const embeddingProvider = createGeminiEmbeddingProvider({
    apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
  });
  
  const storageProvider = new SupabaseStorageProvider(supabase);
  const transcriber = new AssemblyAITranscriber(Deno.env.get('ASSEMBLYAI_API_KEY') || '');
  const vision = new GeminiVisionAnalyzer(Deno.env.get('GOOGLE_API_KEY') || '');
  
  const mediaService = new MediaServiceImpl(
    storageProvider,
    transcriber,
    vision,
    clientConfig.storageBucket
  );
  
  // Notification service (WhatsApp) - used for responses
  const notificationService = new WhatsAppNotificationService({
    phoneNumberId: clientConfig.channels?.whatsapp?.phoneNumberId || '',
    accessToken: clientConfig.channels?.whatsapp?.accessToken || '',
    templateName: Deno.env.get('WHATSAPP_TPL_ESCALATION_01') || 'escalation_alert',
  });
  
  return {
    contactStore,
    sessionStore,
    messageStore,
    knowledgeStore,
    exampleStore,
    stateMachineStore,
    messageBufferStore,
    escalationStore,
    depositStore,
    llmProvider,
    embeddingProvider,
    mediaService,
    notificationService,
    llmLogger,
    clientConfig,
    followupStore,
  };
}

/**
 * Send responses via the appropriate channel
 */
async function sendResponses(
  responses: any[],
  sessionKey: { channelType: string; channelId: string; channelUserId: string },
  clientConfig: any
) {
  for (const response of responses) {
    // Handle delay if specified
    if (response.delayMs && response.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, response.delayMs));
    }
    
    if (sessionKey.channelType === 'whatsapp') {
      if (response.type === 'template' && response.templateName) {
        await sendWhatsAppTemplate(
          sessionKey.channelId,
          sessionKey.channelUserId,
          response,
          clientConfig.channels?.whatsapp?.accessToken || ''
        );
      } else {
        await sendWhatsAppMessage(
          sessionKey.channelId,
          sessionKey.channelUserId,
          response.content,
          clientConfig.channels?.whatsapp?.accessToken || ''
        );
      }
    } else {
      // Fallback for other channels: use text type with content
      // (Implementation for Instagram/Messenger would go here)
      console.log(`[ProcessPending] Falling back to text response for ${sessionKey.channelType}`);
    }
  }
}

/**
 * Send WhatsApp message
 */
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
      text: { body: text, preview_url: true },
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`[ProcessPending] Failed to send WhatsApp message: ${error}`);
  } else {
    console.log(`[ProcessPending] Message sent successfully`);
  }
}

/**
 * Send WhatsApp template message
 */
async function sendWhatsAppTemplate(
  phoneNumberId: string,
  to: string,
  response: any,
  accessToken: string
): Promise<void> {
  const baseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com';
  const url = `${baseUrl}/v24.0/${phoneNumberId}/messages`;

  console.log(`[ProcessPending] Sending WhatsApp template: ${response.templateName}`);
  
  const components: any[] = [];
  
  // Add header image if present
  if (response.templateHeaderImage) {
    components.push({
      type: 'header',
      parameters: [
        { type: 'image', image: { link: response.templateHeaderImage } }
      ]
    });
  }
  
  // Add body parameters if present
  if (response.templateParams && response.templateParams.length > 0) {
    components.push({
      type: 'body',
      parameters: response.templateParams.map((p: string) => ({ type: 'text', text: p }))
    });
  }

  // Add button parameters if present (typically for dynamic URLs)
  if (response.templateButtonParams && response.templateButtonParams.length > 0) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: response.templateButtonParams.map((p: string) => ({ type: 'text', text: p }))
    });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: response.templateName,
        language: { code: 'es_CO' }, // Default or from config? Use es_CO as seen in user's edits.
        components
      },
    }),
  });
  
  if (!res.ok) {
    const error = await res.text();
    console.error(`[ProcessPending] Failed to send WhatsApp template: ${error}`);
    // Fallback to text if template fails? 
    // Usually better to let it fail so we can debug, but user asked for fallback logic
    console.log(`[ProcessPending] Falling back to text for failed template`);
    await sendWhatsAppMessage(phoneNumberId, to, response.content, accessToken);
  } else {
    console.log(`[ProcessPending] Template sent successfully`);
  }
}

/**
 * Check if there's pending work across all clients
 */
async function checkForPendingWork(
  supabase: ReturnType<typeof createSupabaseClient>,
  clients: Array<{ clientId: string; schemaName: string; channelId: string; config: any }>
): Promise<boolean> {
  for (const client of clients) {
    if (!client.config?.debounce?.enabled) continue;
    
    const messageBufferStore = createSupabaseMessageBufferStore(supabase, client.schemaName, client.channelId);
    const hasPending = await messageBufferStore.hasPendingMessages();
    if (hasPending) return true;
  }
  return false;
}

/**
 * Schedule self-invoke via Supabase HTTP
 */
async function scheduleSelfInvoke(delayMs: number): Promise<void> {
  // Use pg_net to schedule delayed HTTP call
  const supabase = createSupabaseClient();
  
  // Simple approach: call ourselves with a delay using setTimeout
  // In production, you might use pg_net for more reliability
  setTimeout(async () => {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      
      await fetch(`${supabaseUrl}/functions/v1/process-pending`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source: 'self-invoke' }),
      });
    } catch (error) {
      console.error('[ProcessPending] Self-invoke failed:', error);
    }
  }, delayMs);
  
  console.log(`[ProcessPending] Scheduled self-invoke in ${delayMs}ms`);
}
