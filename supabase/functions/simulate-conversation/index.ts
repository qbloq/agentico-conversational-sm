
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { 
  createSupabaseContactStore,
  createSupabaseSessionStore,
  createSupabaseMessageStore,
  createSupabaseKnowledgeStore,
  createSupabaseExampleStore,
  createSupabaseStateMachineStore,
  createSupabaseLLMLogger
} from '../_shared/adapters/index.ts';
import { createConversationEngine } from '../_shared/sales-engine.bundle.ts';
import { createGeminiProvider, createGeminiEmbeddingProvider } from '../_shared/sales-engine-llm.bundle.ts';

// Type definitions (inline because esbuild strips type-only exports from bundles)
type SessionKey = {
  channelType: 'whatsapp' | 'instagram' | 'messenger';
  channelId: string;
  channelUserId: string;
};

type NormalizedMessage = {
  id: string;
  timestamp: Date;
  type: 'text' | 'image' | 'audio' | 'template' | 'interactive';
  content?: string;
  mediaUrl?: string;
  transcription?: string;
  imageAnalysis?: { description: string; extractedText?: string; isReceipt?: boolean; confidence?: number };
  interactivePayload?: { type: 'button_reply' | 'list_reply'; buttonId?: string; listId?: string; title: string };
};

// Mock Notification Service (No-op)
const mockNotificationService = {
  sendEscalationAlert: async () => {},
  sendStatusUpdate: async () => {},
};

// Mock Media Service (No-op for now, or could use dummy URLs)
const mockMediaService = {
  transcribe: async () => ({ text: '[Audio Transcription Mock]' }),
  analyzeImage: async () => ({ description: '[Image Analysis Mock]' }),
  upload: async () => ({ url: 'https://mock.url/file.jpg' }),
  download: async () => new Uint8Array(),
};

// Mock LLM Logger (No-op)
const mockLLMLogger = {
  log: async () => {},
};

serve(async (req: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      message, 
      stateMachineConfig, 
      context = {}, 
      currentState = 'initial',
      history = [] // Optional history injection
    } = await req.json();

    if (!message) {
      throw new Error('Message is required');
    }

    // Initialize dependencies
    const supabase = createSupabaseClient();
    // Use a test schema or the real one? Let's use real one but simulate session
    // Actually for simulation we might want ephemeral storage?
    // For now let's use the DB but with a special 'simulation' channel type to avoid polluting real WhatsApp metrics
    const schemaName = 'client_tag_markets'; // TODO: Make dynamic
    
    // Create adapters
    const contactStore = createSupabaseContactStore(supabase, schemaName);
    const sessionStore = createSupabaseSessionStore(supabase, schemaName);
    const messageStore = createSupabaseMessageStore(supabase, schemaName);
    const knowledgeStore = createSupabaseKnowledgeStore(supabase, schemaName);
    const exampleStore = createSupabaseExampleStore(supabase);
    
    // Create LLM provider
    const llmProvider = createGeminiProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
      model: 'gemini-3-flash-preview', // Fast model for simulation
    });
    
    const embeddingProvider = createGeminiEmbeddingProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
    });

    // Client Config Mock
    const clientConfig = {
      clientId: 'simulation',
      schemaName,
      storageBucket: 'simulation',
      channels: {},
      llm: { provider: 'gemini', model: 'gemini-3-flash-preview' },
      escalation: { enabled: false },
      business: {
        name: 'Premium Academy',
        description: 'Academia de trading y crecimiento y desarrollo personal.',
        language: 'es',
        timezone: 'America/New_York',
      },
      knowledgeBase: {
        storeIds: ['fileSearchStores/e3j36960jgde-ggrguvwvpndf'],
      },
    };

    const llmLogger = createSupabaseLLMLogger(supabase);

    // Initialize Engine
    const engine = createConversationEngine();

    // Create a simulation session key
    // We use a fixed ID for the "simulator user" or generate one per browser session if passed
    const simulationId = context._simulationId || 'sim_user_001';
    
    const sessionKey: SessionKey = {
      channelType: 'whatsapp', // Pretend to be WhatsApp to reuse logic
      channelId: 'simulation_channel',
      channelUserId: simulationId,
    };

    // 1. Manually inject the DRAFT state machine config into the engine
    // The engine usually loads this from DB, but we want to override it
    // We need to modify the engine or the adapter to accept this override.
    // Hack: We can create a "MemoryStateMachineStore" that returns our config
    const memoryStateMachineStore = {
      findByName: async () => stateMachineConfig,
      findActive: async () => stateMachineConfig,
    };

    // 2. Prepare message
    const normalizedMessage: NormalizedMessage = {
      id: `sim_msg_${Date.now()}`,
      timestamp: new Date(),
      type: 'text',
      content: message,
    };

    // 3. Process
    const result = await engine.processMessage({
      sessionKey,
      message: normalizedMessage,
      deps: {
        contactStore,
        sessionStore,
        messageStore,
        knowledgeStore,
        exampleStore,
        stateMachineStore: memoryStateMachineStore, // Inject draft config!
        llmProvider,
        embeddingProvider,
        mediaService: mockMediaService,
        notificationService: mockNotificationService,
        llmLogger: llmLogger,
        clientConfig: clientConfig as any,
      },
    });

    console.log

    // 4. Return result
    return new Response(JSON.stringify({
      responses: result.responses,
      nextState: result.sessionUpdates?.currentState || result.sessionUpdates?.previousState || currentState, // Fallback
      transitionReason: result.transitionReason || result.sessionUpdates?.escalationReason || 'No transition', // Get explicit reason
      updates: result.sessionUpdates,
      debug: {
        sessionId: result.sessionId
      }
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('Simulation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
