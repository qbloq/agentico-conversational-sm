/**
 * Main Conversation Engine
 * 
 * This is the core of the sales bot - it processes incoming messages
 * and generates appropriate responses using the state machine, RAG, and LLM.
 */

import type {
  EngineInput,
  EngineOutput,
  BotResponse,
  Session,
  Contact,
  NormalizedMessage,
  EngineDependencies,
  EscalationResult,
  KnowledgeEntry,
} from './types.js';
import { StateMachine } from '../state/machine.js';
import { calculateCost } from '../llm/pricing.js';

/**
 * Conversation Engine interface
 */
export interface ConversationEngine {
  processMessage(input: EngineInput): Promise<EngineOutput>;
}

/**
 * Create a new conversation engine instance
 */
export function createConversationEngine(): ConversationEngine {
  return {
    async processMessage(input: EngineInput): Promise<EngineOutput> {
      const { sessionKey, message, deps } = input;
      const { 
        contactStore, 
        sessionStore, 
        messageStore, 
        llmProvider, 
        embeddingProvider, 
        knowledgeStore, 
        mediaService,
        notificationService,
        llmLogger,
        clientConfig 
      } = deps;
      
      // 0. Process Media (if applicable)
      if (message.type === 'audio' && message.mediaUrl && !message.transcription) {
        try {
          const transcription = await mediaService.transcribe(message.mediaUrl);
          message.transcription = transcription.text;
          // Use transcription as content for processing
          message.content = transcription.text;
        } catch (error) {
          console.error('Audio transcription failed:', error);
          message.content = '[Audio transcription failed]';
        }
      } else if (message.type === 'image' && message.mediaUrl && !message.imageAnalysis) {
        try {
          const analysis = await mediaService.analyzeImage(message.mediaUrl);
          message.imageAnalysis = analysis;
          // Append analysis to content for context
          message.content = message.content 
            ? `${message.content}\n\n[Image Content: ${analysis.description}]`
            : `[Image Content: ${analysis.description}]`;
        } catch (error) {
          console.error('Image analysis failed:', error);
          message.content = message.content || '[Image analysis failed]';
        }
      }

      // 1. Get or create contact
      const contact = await contactStore.findOrCreateByChannelUser(
        sessionKey.channelType,
        sessionKey.channelUserId
      );
      
      // 2. Get or create session
      let session = await sessionStore.findByKey(sessionKey);
      if (!session) {
        session = await sessionStore.create(sessionKey, contact.id);
      }
      
      let resumeUpdates: Partial<Session> = {};

      // 3. Check escalation status & Resume Logic
      if (session.isEscalated) {
        const now = new Date();
        const lastMessageTime = session.lastMessageAt ? new Date(session.lastMessageAt).getTime() : 0;
        const hoursSinceLastMessage = (now.getTime() - lastMessageTime) / (1000 * 60 * 60);
        
        // Resume if silent for more than 1 hour
        if (hoursSinceLastMessage >= 1) {
          session.isEscalated = false;
          session.status = 'active';
          resumeUpdates = { isEscalated: false, status: 'active' };
        } else {
          // Still escalated - don't process
          // But we SHOULD save the message so history is complete
          await messageStore.save(session.id, {
            direction: 'inbound',
            type: message.type,
            content: message.content,
            mediaUrl: message.mediaUrl,
            transcription: message.transcription,
            imageAnalysis: message.imageAnalysis,
            platformMessageId: message.id,
          });
          
          return {
            responses: [],
            sessionUpdates: { lastMessageAt: new Date() },
          };
        }
      }
      
      // 4. Save inbound message
      await messageStore.save(session.id, {
        direction: 'inbound',
        type: message.type,
        content: message.content,
        mediaUrl: message.mediaUrl,
        transcription: message.transcription,
        imageAnalysis: message.imageAnalysis,
        platformMessageId: message.id,
      });
      
      // 5. Get conversation history
      const recentMessages = await messageStore.getRecent(session.id, 10);
      
      // 6. Initialize state machine
      const stateMachine = StateMachine.fromSession(session);
      const stateConfig = stateMachine.getConfig();
      
      // 7. Check for escalation triggers
      const escalation = await checkEscalationTriggers(message, session, contact, clientConfig);
      if (escalation.shouldEscalate) {
        // Send notification if enabled
        if (clientConfig.escalation.enabled && clientConfig.escalation.notifyWhatsApp) {
          try {
            await notificationService.sendEscalationAlert(
              clientConfig.escalation.notifyWhatsApp,
              {
                reason: escalation.reason,
                userName: contact.fullName || contact.phone || 'Unknown User',
                userPhone: contact.phone || sessionKey.channelUserId,
                summary: (message.content || '').slice(0, 100), // Limit length
              }
            );
          } catch (error) {
            console.error('Failed to send escalation notification:', error);
            // Continue returning response to user even if notification fails
          }
        }

        return {
          responses: [createEscalationResponse(escalation, clientConfig)],
          sessionUpdates: {
            isEscalated: true,
            escalationReason: escalation.reason,
            lastMessageAt: new Date(),
          },
          escalation,
        };
      }
      
      // 8. Retrieve relevant knowledge (RAG)
      const messageText = message.content || message.transcription || '';
      
      // Generate embedding with logging
      const embeddingStartTime = Date.now();
      const embedding = await embeddingProvider.generateEmbedding(messageText);
      const embeddingLatency = Date.now() - embeddingStartTime;
      
      // Log embedding call (fire and forget)
      if (llmLogger) {
        const embeddingTokens = Math.ceil(messageText.length / 4); // Rough estimate
        llmLogger.log({
          clientId: clientConfig.clientId,
          sessionId: session.id,
          requestType: 'embedding',
          provider: 'gemini', // TODO: get from embeddingProvider.name if available
          model: 'text-embedding-004',
          promptTokens: embeddingTokens,
          completionTokens: 0,
          totalTokens: embeddingTokens,
          costUsd: calculateCost('text-embedding-004', embeddingTokens, 0),
          inputPreview: messageText.slice(0, 500),
          latencyMs: embeddingLatency,
          finishReason: 'stop',
        }).catch(err => console.error('[LLM Logger] Embedding log failed:', err));
      }
      
      const relevantKnowledge = await retrieveKnowledge(
        knowledgeStore,
        embedding,
        stateConfig.ragCategories
        
      );

      console.log('state', stateConfig.state);
      // console.log('relevantKnowledge', JSON.stringify(relevantKnowledge, null, 2));
      // 9. Build LLM prompt
      const systemPrompt = buildSystemPrompt(clientConfig, stateConfig, relevantKnowledge);
      const conversationHistory = formatConversationHistory(recentMessages);
      
      // 10. Generate response
      const llmStartTime = Date.now();
      const llmResponse = await llmProvider.generateResponse({
        systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: messageText },
        ],
        temperature: 0.7,
        maxTokens: 500,
      });
      const llmLatency = Date.now() - llmStartTime;
      
      // Log LLM chat call (fire and forget)
      if (llmLogger) {
        const fullInput = `${systemPrompt}\n\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\nuser: ${messageText}`;
        llmLogger.log({
          clientId: clientConfig.clientId,
          sessionId: session.id,
          requestType: 'chat',
          provider: llmProvider.name,
          model: clientConfig.llm.model,
          promptTokens: llmResponse.usage.promptTokens,
          completionTokens: llmResponse.usage.completionTokens,
          totalTokens: llmResponse.usage.totalTokens,
          costUsd: calculateCost(clientConfig.llm.model, llmResponse.usage.promptTokens, llmResponse.usage.completionTokens),
          inputPreview: fullInput.slice(0, 500),
          outputPreview: llmResponse.content.slice(0, 500),
          latencyMs: llmLatency,
          finishReason: llmResponse.finishReason,
        }).catch(err => console.error('[LLM Logger] Chat log failed:', err));
      }
      
      // 11. Evaluate state transition
      const suggestedState = stateMachine.suggestTransition(messageText);
      let sessionUpdates: Partial<Session> = {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      };
      
      if (suggestedState && stateMachine.canTransitionTo(suggestedState)) {
        stateMachine.transitionTo(suggestedState, 'Pattern match from user message');
        sessionUpdates = {
          ...sessionUpdates,
          previousState: session.currentState,
          currentState: suggestedState,
        };
      }
      
      // 12. Create bot response
      const botResponse: BotResponse = {
        type: 'text',
        content: llmResponse.content,
        metadata: {
          tokensUsed: llmResponse.usage.totalTokens,
          state: stateMachine.getState(),
        },
      };
      
      // 13. Save outbound message
      await messageStore.save(session.id, {
        direction: 'outbound',
        type: 'text',
        content: llmResponse.content,
      });
      
      return {
        responses: [botResponse],
        sessionUpdates: { ...sessionUpdates, ...resumeUpdates },
      };
    },
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

async function checkEscalationTriggers(
  message: NormalizedMessage,
  _session: Session,
  _contact: Contact,
  _config: EngineDependencies['clientConfig']
): Promise<EscalationResult> {
  const content = (message.content || message.transcription || '').toLowerCase();
  
  // Explicit request patterns (Spanish)
  const explicitPatterns = [
    'hablar con humano',
    'hablar con un humano',
    'persona real',
    'agente',
    'representante',
    'quiero hablar con alguien',
    'necesito ayuda humana',
    'soporte humano',
  ];
  
  for (const pattern of explicitPatterns) {
    if (content.includes(pattern)) {
      return {
        shouldEscalate: true,
        reason: 'explicit_request',
        priority: 'immediate',
        confidence: 1.0,
      };
    }
  }
  
  // Frustration patterns
  const frustrationPatterns = ['estafa', 'scam', 'fraude', 'robo', 'mierda', 'basura'];
  for (const pattern of frustrationPatterns) {
    if (content.includes(pattern)) {
      return {
        shouldEscalate: true,
        reason: 'frustration',
        priority: 'immediate',
        confidence: 0.9,
      };
    }
  }
  
  // High value check (TODO: implement when we have deposit amount in context)
  // if (_config.escalation.highValueThreshold) { ... }
  
  return {
    shouldEscalate: false,
    reason: 'explicit_request',
    priority: 'medium',
    confidence: 0,
  };
}

function createEscalationResponse(
  escalation: EscalationResult,
  _config: EngineDependencies['clientConfig']
): BotResponse {
  const messages: Record<string, string> = {
    explicit_request: '¡Por supuesto! Te conecto con uno de nuestros asesores. Un momento por favor. 🙋‍♂️',
    frustration: 'Entiendo tu frustración y quiero ayudarte. Te conecto con un asesor que podrá asistirte mejor. Un momento.',
    high_value: 'Para brindarte la mejor atención personalizada, te conecto con uno de nuestros asesores senior.',
    technical_issue: 'Veo que tienes un problema técnico. Te conecto con soporte especializado.',
    repeated_confusion: 'Parece que no estoy siendo claro. Déjame conectarte con un asesor que pueda ayudarte mejor.',
    ai_uncertainty: 'Para darte la mejor respuesta, te conecto con uno de nuestros expertos.',
  };
  
  return {
    type: 'text',
    content: messages[escalation.reason] || messages.explicit_request,
    metadata: { escalation: true },
  };
}

async function retrieveKnowledge(
  store: EngineDependencies['knowledgeStore'],
  embedding: number[],
  categories: string[]
): Promise<KnowledgeEntry[]> {
  // Get similar by embedding
  const similarEntries = await store.findSimilar(embedding, 3);
  
  // Also get by category if specified
  let categoryEntries: KnowledgeEntry[] = [];
  if (categories.length > 0) {
    for (const category of categories.slice(0, 2)) {
      const entries = await store.findByCategory(category, 2);
      categoryEntries = [...categoryEntries, ...entries];
    }
  }
  
  // Deduplicate and limit
  const allEntries = [...similarEntries, ...categoryEntries];
  const uniqueEntries = allEntries.filter(
    (entry, index, self) => self.findIndex(e => e.id === entry.id) === index
  );
  
  return uniqueEntries.slice(0, 5);
}

function buildSystemPrompt(
  config: EngineDependencies['clientConfig'],
  stateConfig: { objective: string; ragCategories: string[] },
  knowledge: KnowledgeEntry[]
): string {
  const knowledgeContext = knowledge
    .map(k => `Q: ${k.title}\nA: ${k.summary || k.answer.slice(0, 300)}`)
    .join('\n\n');
  
  return `# Role
You are a sales representative for ${config.business.name}. ${config.business.description}

# Language
Always respond in ${config.business.language}. Be friendly, professional, and helpful.

# Current Objective
${stateConfig.objective}

# Relevant Knowledge
${knowledgeContext || 'No specific knowledge retrieved for this query.'}

# Guidelines
- Be concise but warm
- Use emojis sparingly (1-2 per message max)
- Ask clarifying questions when needed
- Never make up information - use the knowledge provided
- If you don't know something, say so and offer to connect with a human
- Guide the conversation toward registration when appropriate

# Prohibited
- Never discuss competitors negatively
- Never guarantee profits or returns
- Never share internal processes or pricing structures not in the knowledge base
- Never pretend to be human if directly asked`;
}

function formatConversationHistory(
  messages: EngineDependencies['messageStore'] extends { getRecent: (id: string, limit: number) => Promise<infer M> } ? M : never
): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(messages)) return [];
  
  return messages
    .filter(m => m.content)
    .map(m => ({
      role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: m.content!,
    }));
}
