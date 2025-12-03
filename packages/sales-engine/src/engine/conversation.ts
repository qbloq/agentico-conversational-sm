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
  ConversationState,
  ConversationExample,
} from './types.js';

import { generatePitch12xResponses } from '../flows/pitch-12x.js';
import { StateMachine } from '../state/machine.js';
import type { StructuredLLMResponse } from '../llm/types.js';
import { calculateCost } from '../llm/pricing.js';

import { buildSystemPrompt } from '../prompts/templates.js';

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
        exampleStore,
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
            sessionId: session.id,
            responses: [],
            sessionUpdates: { lastMessageAt: new Date() },
          };
        }
      }
      
      // 3b. Check for Flow A Locking (Time-based)
      // If we are in pitching_12x and recently sent the burst, ignore input
      if (session.currentState === 'pitching_12x' && session.context?.pitchComplete) {
        const lastMessageTime = session.lastMessageAt ? new Date(session.lastMessageAt).getTime() : 0;
        const timeSinceLast = new Date().getTime() - lastMessageTime;
        // Lock for 12 seconds after burst starts (8s burst + 4s buffer)
        if (timeSinceLast < 12000) {
          console.log(`[Flow A] Input ignored during active burst sequence (${Math.round((12000 - timeSinceLast)/1000)}s remaining)`);
          return {
            sessionId: session.id,
            responses: [],
            // No updates, just ignore
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
      
      // 3. Check for System Commands (Hidden)
      const messageText = message.content || message.transcription || '';
      if (messageText.toLowerCase() === '/reset') {
        console.log(`[System Command] Resetting data for contact: ${session.contactId}`);
        await contactStore.delete(session.contactId);
        return {
          sessionId: session.id,
          responses: [{
            type: 'text',
            content: '🔄 [SYSTEM] User data reset successfully. All history cleared.',
          }],
          // No session updates needed as session is deleted
        };
      }

      // 3a. Check for Escalation Triggers
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
          sessionId: session.id,
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
      // messageText is already defined above
      
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
          inputPreview: messageText,
          latencyMs: embeddingLatency,
          finishReason: 'stop',
        }).catch(err => console.error('[LLM Logger] Embedding log failed:', err));
      }
      
      const relevantKnowledge = await retrieveKnowledge(
        knowledgeStore,
        embedding,
        stateConfig.ragCategories
      );

      // 8b. Retrieve relevant conversation examples (few-shot)
      let relevantExamples: ConversationExample[] = [];
      if (exampleStore) {
        relevantExamples = await retrieveExamples(
          exampleStore,
          stateConfig.state,
          embedding
        );
        
        // Filter out examples that use obsolete states (like 'qualifying')
        // to prevent LLM from hallucinating invalid transitions
        relevantExamples = relevantExamples.filter(ex => {
          const hasObsoleteState = ex.stateFlow.includes('qualifying' as any) || 
                                  ex.messages.some(m => m.state === 'qualifying' as any);
          return !hasObsoleteState;
        });
      }

      console.log(`[State] Current: ${stateConfig.state}`);
      if (relevantExamples.length > 0) {
        console.log(`[Examples Selected] ${relevantExamples.map(e => e.exampleId).join(', ')}`);
      } else {
        console.log('[Examples Selected] None');
      }
      
      // 9. Build LLM prompt with state transition context
      const transitionContext = stateMachine.buildTransitionContext();
      
      // Flow A: Burst Sequence Logic
      // if (stateConfig.state === 'pitching_12x' && !session.context?.pitchComplete) {
      //   console.log('[Flow A] Triggering 12x Pitch Burst');
      //   return generatePitch12xResponses(session);
      // }

      const systemPrompt = buildSystemPrompt({ config: clientConfig, knowledge: relevantKnowledge, transitionContext, examples: relevantExamples });
      const conversationHistory = formatConversationHistory(recentMessages);
      
      // 10. Generate response with structured output
      const llmStartTime = Date.now();
      const llmResponse = await llmProvider.generateResponse({
        systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: messageText },
        ],
        temperature: 0.7,
        maxTokens: 1500, // Increased to accommodate JSON structure + longer responses
      });
      const llmLatency = Date.now() - llmStartTime;
      
      // 11. Parse structured response
      const structuredResponse = parseStructuredResponse(llmResponse.content);
      
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
          inputPreview: fullInput,
          outputPreview: llmResponse.content,
          latencyMs: llmLatency,
          finishReason: llmResponse.finishReason,
        }).catch(err => console.error('[LLM Logger] Chat log failed:', err));
      }
      
      // 12. Evaluate state transition from LLM recommendation
      let sessionUpdates: Partial<Session> = {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Apply LLM-recommended transition if valid
      if (structuredResponse.transition && structuredResponse.transition.to) {
        const targetState = structuredResponse.transition.to as ConversationState;
        if (stateMachine.canTransitionTo(targetState) && structuredResponse.transition.confidence >= 0.6) {
          console.log(`[State Transition] ${session.currentState} -> ${targetState}`);
          console.log(`[Transition Reason] ${structuredResponse.transition.reason}`);
          
          stateMachine.transitionTo(targetState, structuredResponse.transition.reason);
          sessionUpdates = {
            ...sessionUpdates,
            previousState: session.currentState,
            currentState: targetState,
          };

          // Check for special entry response for the new state
          const entryResponse = getStateEntryResponse(targetState, {
            ...session,
            currentState: targetState,
            context: { ...session.context, ...sessionUpdates.context }
          });

          if (entryResponse) {
            console.log(`[State Entry] Triggering special response for ${targetState}`);
            
            // We must save the session state update first
            await sessionStore.update(session.id, sessionUpdates);
            
            return entryResponse;
          }
        } else {
            console.log(`[State Transition] Rejected: ${targetState} (Allowed: ${stateMachine.canTransitionTo(targetState)}, Confidence: ${structuredResponse.transition.confidence})`);
        }
      }
      
      // Update session context with extracted data
      if (structuredResponse.extractedData) {
        sessionUpdates.context = {
          ...session.context,
          ...structuredResponse.extractedData,
        };
      }
      
      // Check for AI uncertainty escalation
      if (structuredResponse.isUncertain) {
        console.log('[AI Uncertainty] LLM flagged uncertainty, consider escalation');
        // Could trigger soft escalation here in future
      }
      
      // 13. Create bot response
      const botResponse: BotResponse = {
        type: 'text',
        content: structuredResponse.response,
        metadata: {
          tokensUsed: llmResponse.usage.totalTokens,
          state: stateMachine.getState(),
          transition: structuredResponse.transition,
        },
      };
      
      // 14. Save outbound message
      await messageStore.save(session.id, {
        direction: 'outbound',
        type: 'text',
        content: structuredResponse.response,
      });
      
      return {
        sessionId: session.id,
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

/**
 * Retrieve relevant conversation examples for few-shot prompting
 * Prioritizes state-based matching, falls back to semantic similarity
 */
async function retrieveExamples(
  store: NonNullable<EngineDependencies['exampleStore']>,
  currentState: ConversationState,
  _embedding: number[]
): Promise<ConversationExample[]> {
  // Primary: Get examples for current state
  const stateExamples = await store.findByState(currentState, { 
    limit: 2,
    category: 'happy_path' // Prefer successful examples
  });
  
  if (stateExamples.length >= 1) {
    return stateExamples.slice(0, 2);
  }
  
  // Fallback: Get any examples for this state (any category)
  const anyStateExamples = await store.findByState(currentState, { limit: 2 });
  if (anyStateExamples.length > 0) {
    return anyStateExamples;
  }
  
  // Last resort: Could use semantic search here in future
  // For now, return empty - better to have no examples than irrelevant ones
  return [];
}

/**
 * Parse LLM response to extract structured data
 * The LLM is instructed to return JSON, but we handle graceful fallback
 */
function parseStructuredResponse(content: string): StructuredLLMResponse {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                    content.match(/\{[\s\S]*"response"[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Validate that response exists and is not empty
      const response = parsed.response;
      if (typeof response === 'string' && response.trim().length > 0) {
        return {
          content: content,
          response: response,
          transition: parsed.transition,
          extractedData: parsed.extractedData,
          isUncertain: parsed.isUncertain,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        };
      } else {
        // JSON parsed but response is empty - log warning
        console.warn('[parseStructuredResponse] LLM returned empty response field. Raw content:', content.slice(0, 200));
      }
    } catch (err) {
      // JSON parsing failed - log for debugging
      console.warn('[parseStructuredResponse] JSON parse failed:', err, 'Content:', content.slice(0, 200));
    }
  }
  
  // Fallback: try to extract the response text from truncated/malformed JSON
  let fallbackResponse = content;
  
  // Try to extract the "response" field value even from truncated JSON
  const responseMatch = content.match(/"response"\s*:\s*"([\s\S]*?)(?:"|$)/);
  if (responseMatch && responseMatch[1]) {
    // Unescape JSON string escapes
    fallbackResponse = responseMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
    
    // If it ends abruptly, add ellipsis
    if (!fallbackResponse.endsWith('.') && !fallbackResponse.endsWith('!') && !fallbackResponse.endsWith('?')) {
      fallbackResponse += '...';
    }
  } else if (content.includes('```json') || content.includes('"response"')) {
    // Remove JSON code blocks entirely
    fallbackResponse = content.replace(/```json[\s\S]*?```/g, '').trim();
    if (!fallbackResponse) {
      fallbackResponse = content;
    }
  }
  
  console.warn('[parseStructuredResponse] Using fallback response. Original content:', content.slice(0, 200));
  
  return {
    content: content,
    response: fallbackResponse,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: 'stop',
  };
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

/**
 * Get special entry response for a state (if any)
 * This allows specific states to trigger hardcoded flows/bursts immediately upon entry
 */
function getStateEntryResponse(
  state: ConversationState, 
  session: Session
): EngineOutput | null {
  switch (state) {
    case 'pitching_12x':
      return generatePitch12xResponses(session);
      
    case 'closing':
      return generateClosingResponse(session);
      
    // Add other state entry handlers here
    // case 'closing': return generateClosingResponse(session);
    
    default:
      return null;
  }
}

function generateClosingResponse(session: Session): EngineOutput {
  return {
    sessionId: session.id,
    responses: [{
      type: 'text',
      content: `¡Excelente decisión! 🚀\n\nPuedes registrarte ahora mismo en este enlace:\nhttps://app.parallelo.ai/register\n\nEstare aquí contigo durante todo el proceso. Si tienes alguna duda al llenar el formulario o realizar el depósito, solo pregúntame.`,
      delayMs: 1000
    }],
    sessionUpdates: {
      lastMessageAt: new Date()
    }
  };
}
