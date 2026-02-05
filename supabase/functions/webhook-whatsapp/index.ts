/**
 * WhatsApp Webhook Edge Function
 * 
 * Handles incoming WhatsApp messages via Meta's Cloud API.
 * Routes to correct client schema based on phone_number_id.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { routeByChannelId, verifyWhatsAppSignature } from '../_shared/client-router.ts';
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
  createSupabaseFollowupStore,
  createSupabaseDepositStore,
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
import type { NormalizedMessage, ChannelType } from '../_shared/sales-engine.bundle.ts';

// WhatsApp message types
interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

interface WhatsAppChange {
  value: {
    messaging_product: string;
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
  };
  field: string;
}

interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'interactive' | 'button';
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  sticker?: { id: string; mime_type: string; sha256: string; animated?: boolean };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  context?: {
    from: string;
    id: string; // The platform_message_id being replied to
  };
}

interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  // Handle webhook verification (GET request from Meta)
  if (req.method === 'GET') {
    return handleVerification(url);
  }
  
  // Handle incoming messages (POST request)
  if (req.method === 'POST') {
    return handleIncomingMessage(req);
  }
  
  return new Response('Method not allowed', { status: 405 });
});

/**
 * Handle Meta webhook verification
 */
function handleVerification(url: URL): Response {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
  
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Webhook verified successfully');
    return new Response(challenge, { status: 200 });
  }
  
  console.error('Webhook verification failed');
  return new Response('Forbidden', { status: 403 });
}

/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(req: Request): Promise<Response> {
  try {
    // Verify signature
    const signature = req.headers.get('x-hub-signature-256') || '';
    const body = await req.text();
    console.log(`[DEBUG] Received webhook body: ${JSON.stringify(body, null, 2)}`);
    
    // Parse payload
    const payload: WhatsAppWebhookPayload = JSON.parse(body);
    // console.log(`[DEBUG] Payload object: ${payload.object}`);
    
    // Validate it's a WhatsApp message
    if (payload.object !== 'whatsapp_business_account') {
      return new Response('Not a WhatsApp event', { status: 200 });
    }
    
    // Process each entry
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        
        const { metadata, messages, contacts } = change.value;
        if (!messages || messages.length === 0) continue;
        
        // Get phone_number_id (this identifies the client)
        const phoneNumberId = metadata.phone_number_id;
        
        // Route to client
        const supabase = createSupabaseClient();
        // console.log(`[DEBUG] Routing for phone_number_id: ${phoneNumberId}`);
        const route = await routeByChannelId(supabase, 'whatsapp', phoneNumberId);
        // console.log(`[DEBUG] Route result: ${route ? `Found (${route.clientId})` : 'NOT FOUND'}`);
        
        if (!route) {
          console.error(`No client found for phone_number_id: ${phoneNumberId}. Dispatching to Premium Academy...`);
          await dispatchToPremiumAcademy(req.headers, body);
          continue;
        }
        
        // Verify signature with client's app secret
        if (!verifyWhatsAppSignature(body, signature, route.config.channels.whatsapp?.appSecret || '')) {
          console.error('Invalid webhook signature');
          continue;
        }
        
        // Process each message (use public supabase client, adapters use .schema())
        for (const message of messages) {
          const contact = contacts?.find(c => c.wa_id === message.from);
          
          await processMessage(
            supabase,
            route.schemaName,
            route.config,
            phoneNumberId,
            message,
            contact
          );
        }
      }
    }
    
    // Always return 200 to acknowledge receipt
    return new Response('OK', { status: 200 });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 to prevent Meta from retrying
    return new Response('OK', { status: 200 });
  }
}

/**
 * Process a single WhatsApp message
 */
async function processMessage(
  supabase: ReturnType<typeof createSupabaseClient>,
  schemaName: string,
  clientConfig: any, // ClientConfig from sales-engine
  phoneNumberId: string,
  message: WhatsAppMessage,
  contact?: WhatsAppContact
): Promise<void> {
  // console.log(`Processing message from ${message.from}: ${message.type}`);
  // console.log('[DEBUG] Raw WhatsApp message:', JSON.stringify(message, null, 2));
  // console.log(clientConfig);
  // Create conversation engine
  const engine = createConversationEngine();

  // Create adapters
  const contactStore = createSupabaseContactStore(supabase, schemaName);
  const sessionStore = createSupabaseSessionStore(supabase, schemaName);
  const messageStore = createSupabaseMessageStore(supabase, schemaName);
  const knowledgeStore = createSupabaseKnowledgeStore(supabase, schemaName);
  const exampleStore = createSupabaseExampleStore(supabase);
  const stateMachineStore = createSupabaseStateMachineStore(supabase, schemaName);
  const escalationStore = createSupabaseEscalationStore(supabase, schemaName);
  const followupStore = createSupabaseFollowupStore(supabase, schemaName);
  const depositStore = createSupabaseDepositStore(supabase, schemaName);
  
  // Create LLM provider
  const llmProvider = createGeminiProvider({
    apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
    model: clientConfig.llm.model,
  });
  
  // Create embedding provider
  const embeddingProvider = createGeminiEmbeddingProvider({
    apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
  });

  // Create Media Services
  const storageProvider = new SupabaseStorageProvider(supabase);
  const transcriber = new AssemblyAITranscriber(Deno.env.get('ASSEMBLYAI_API_KEY') || '');
  const vision = new GeminiVisionAnalyzer(Deno.env.get('GOOGLE_API_KEY') || '');
  
  const mediaService = new MediaServiceImpl(
    storageProvider,
    transcriber,
    vision,
    clientConfig.storageBucket
  );

  // Create Notification Service
  const notificationService = new WhatsAppNotificationService({
    phoneNumberId,
    accessToken: clientConfig.channels.whatsapp?.accessToken || '',
    templateName: Deno.env.get('WHATSAPP_TPL_ESCALATION_01') || 'escalation_alert',
  });

  // Create LLM Logger
  const llmLogger = createSupabaseLLMLogger(supabase);
  
  // Normalize message and handle media upload
  const normalizedMessage = await normalizeAndUploadMedia(
    message, 
    mediaService, 
    clientConfig.channels.whatsapp?.accessToken || ''
  );
  
  // Check if debounce is enabled for this client
  const debounceEnabled = clientConfig.debounce?.enabled && clientConfig.debounce?.delayMs > 0;
  
  // Command messages (starting with /) bypass debounce and are processed immediately
  const messageContent = normalizedMessage.content || '';
  const isCommandMessage = messageContent.startsWith('/');
  
  if (debounceEnabled && !isCommandMessage) {
    // Debounce flow: buffer the message, worker will process later
    const messageBufferStore = createSupabaseMessageBufferStore(supabase, schemaName, phoneNumberId);
    
    const ingestResult = await engine.ingestMessage({
      sessionKey: {
        channelType: 'whatsapp' as ChannelType,
        channelId: phoneNumberId,
        channelUserId: message.from,
      },
      message: normalizedMessage,
      deps: {
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
      },
    });
    
    if (ingestResult.buffered) {
      console.log(`[Debounce] Message buffered for ${message.from}, will process at ${ingestResult.scheduledProcessAt.toISOString()}`);
      return;
    }
    // If buffering failed (graceful degradation), fall through to immediate processing
    console.log(`[Debounce] Buffering failed, processing immediately for ${message.from}`);
  }

  
  /********************
   * Non-debounce flow (or fallback): process immediately and send response
   ********************/
  const result = await engine.processMessage({
    sessionKey: {
      channelType: 'whatsapp' as ChannelType,
      channelId: phoneNumberId,
      channelUserId: message.from,
    },
    message: normalizedMessage,
    deps: {
      contactStore,
      sessionStore,
      messageStore,
      knowledgeStore,
      exampleStore,
      stateMachineStore,
      escalationStore,
      depositStore,
      llmProvider,
      embeddingProvider,
      mediaService,
      llmLogger,
      clientConfig,
      followupStore,
    },
  });

  // After processing, if we have a sessionId, we can manage follow-ups
  if (result.sessionId) {
    // 1. Cancel any pending follow-ups because user just responded
    await followupStore.cancelPending(result.sessionId);

    // 2. Schedule the FIRST follow-up in the sequence for the NEW current state
    // We pass -1 as currentIndex to indicate we want to start from the beginning (index 0)
    const nextState = result.sessionUpdates?.currentState || result.responses[0]?.metadata?.state || 'initial';
    await followupStore.scheduleNext(result.sessionId, nextState as any, -1);
  }
  
  // Send responses
  for (const response of result.responses) {
    // Handle delay if specified
    if ('delayMs' in response && typeof (response as any).delayMs === 'number') {
      const delay = (response as any).delayMs;
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    if (response.type === 'template' && (response as any).templateName) {
      await sendWhatsAppTemplate(
        phoneNumberId,
        message.from,
        response as any,
        clientConfig.channels.whatsapp?.accessToken || ''
      );
    } else {
      await sendWhatsAppMessage(
        phoneNumberId,
        message.from,
        response.content,
        clientConfig.channels.whatsapp?.accessToken || '',
        'metadata' in response ? (response as any).metadata : undefined
      );
    }
  }
}

/**
 * Normalize WhatsApp message and upload media if present
 */
async function normalizeAndUploadMedia(
  message: WhatsAppMessage,
  mediaService: MediaServiceImpl,
  accessToken: string
): Promise<NormalizedMessage> {
  if (message.context?.id) {
    // We need to find our internal message ID that corresponds to this platform_message_id
    // But for now, we'll store the platform_message_id and let the store/engine handle it
    // Actually, the database column reply_to_message_id is a UUID referencing our internal table.
    // So we need to resolve it.
  }

  const base = {
    id: message.id,
    timestamp: new Date(parseInt(message.timestamp) * 1000),
    replyToMessageId: message.context?.id, // Passing the platform_message_id as a hint
  };
  
  let mediaUrl: string | undefined;
  let mediaId: string | undefined;

  if (message.type === 'image') mediaId = message.image?.id;
  if (message.type === 'audio') mediaId = message.audio?.id;
  if (message.type === 'video') mediaId = message.video?.id;
  if (message.type === 'sticker') mediaId = message.sticker?.id;

  if (mediaId) {
    try {
      // 1. Get download URL from Meta
      const metaUrlResponse = await fetch(
        `https://graph.facebook.com/v24.0/${mediaId}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      const { url: downloadUrl } = await metaUrlResponse.json();

      if (downloadUrl) {
        // 2. Download content
        const fileBuffer = await mediaService.download(downloadUrl, {
          'Authorization': `Bearer ${accessToken}`
        });

        // 3. Upload to Supabase (public bucket)
        // Path: year/month/day/message_id.ext
        const date = new Date();
        const ext = message.type === 'audio' ? 'ogg' 
          : message.type === 'video' ? 'mp4'
          : message.type === 'sticker' ? 'webp'
          : 'jpg'; // Simplified extension logic
        const path = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}/${message.id}.${ext}`;
        const mimeType = message.type === 'audio' ? (message.audio?.mime_type || 'audio/ogg')
          : message.type === 'video' ? (message.video?.mime_type || 'video/mp4')
          : message.type === 'sticker' ? (message.sticker?.mime_type || 'image/webp')
          : (message.image?.mime_type || 'image/jpeg');

        const uploaded = await mediaService.upload(fileBuffer, path, mimeType);
        mediaUrl = uploaded.url;
        console.log(`Media uploaded to: ${mediaUrl}`);
      }
    } catch (error) {
      console.error('Failed to process media:', error);
    }
  }

  switch (message.type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        content: message.text?.body || '',
      };
    
    case 'image':
      return {
        ...base,
        type: 'image',
        content: message.image?.caption,
        mediaUrl,
      };
    
    case 'audio':
      return {
        ...base,
        type: 'audio',
        mediaUrl,
      };
    
    case 'video':
      return {
        ...base,
        type: 'video',
        content: message.video?.caption,
        mediaUrl,
      };
    
    case 'sticker':
      return {
        ...base,
        type: 'sticker',
        mediaUrl,
      };
    
    case 'interactive':
      return {
        ...base,
        type: 'interactive',
        content: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title,
        interactivePayload: {
          type: message.interactive?.type === 'button_reply' ? 'button_reply' : 'list_reply',
          buttonId: message.interactive?.button_reply?.id,
          listId: message.interactive?.list_reply?.id,
          title: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '',
        },
      };
    
    default:
      return {
        ...base,
        type: 'text',
        content: '[Unsupported message type]',
      };
  }
}

/**
 * Send WhatsApp message via Cloud API
 */
async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string,
  metadata?: any // Added metadata param
): Promise<void> {
  const baseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com';
  const url = `${baseUrl}/v24.0/${phoneNumberId}/messages`;

  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: true },
  };

  // If we have metadata and we are in a dev/mock environment (implied by custom base URL),
  // we can attach it to the payload. The real WhatsApp API might ignore or reject unknown fields,
  // but our mock server will read them.
  if (metadata && baseUrl.includes('localhost') || baseUrl.includes('host.docker.internal')) {
    body._debug_metadata = metadata;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send WhatsApp message: ${error}`);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }
  
  console.log(`Message sent to ${to}`);
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

  console.log(`Sending WhatsApp template: ${response.templateName}`);
  
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
        language: { code: 'es_CO' },
        components
      },
    }),
  });
  
  if (!res.ok) {
    const error = await res.text();
    console.error(`Failed to send WhatsApp template: ${error}`);
    // Fallback to text if template fails
    console.log(`Falling back to text for failed template`);
    await sendWhatsAppMessage(phoneNumberId, to, response.content, accessToken);
  } else {
    console.log(`Template sent successfully`);
  }
}

/**
 * Dispatch request to Premium Academy service
 */
async function dispatchToPremiumAcademy(headers: Headers, body: string): Promise<void> {
  const targetUrl = Deno.env.get('DISPATCH_TO_PREMIUM_ACADEMY_URL');
  
  if (!targetUrl) {
    console.warn('[Webhook WhatsApp] DISPATCH_TO_PREMIUM_ACADEMY_URL not configured, skipping dispatch');
    return;
  }

  try {
    console.log('[Webhook WhatsApp] Dispatching unmatched request to:', targetUrl);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': headers.get('Content-Type') || 'application/json',
        'x-hub-signature-256': headers.get('x-hub-signature-256') || '',
      },
      body: body,
    });

    console.log(`[Webhook WhatsApp] Dispatch target responded: ${response.status}`);
  } catch (error) {
    console.error('[Webhook WhatsApp] Error dispatching to Premium Academy:', error);
  }
}

