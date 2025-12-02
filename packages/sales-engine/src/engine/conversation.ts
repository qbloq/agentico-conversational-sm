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
import { StateMachine } from '../state/machine.js';
import type { StructuredLLMResponse } from '../llm/types.js';
import { calculateCost } from '../llm/pricing.js';
import { formatExamples } from '../examples/formatter.js';

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

      // 8b. Retrieve relevant conversation examples (few-shot)
      let relevantExamples: ConversationExample[] = [];
      if (exampleStore) {
        relevantExamples = await retrieveExamples(
          exampleStore,
          stateConfig.state,
          embedding
        );
      }

      console.log('state', stateConfig.state);
      if (relevantExamples.length > 0) {
        console.log('examples', relevantExamples.map(e => e.exampleId).join(', '));
      }
      
      // 9. Build LLM prompt with state transition context
      const transitionContext = stateMachine.buildTransitionContext();
      const systemPrompt = buildSystemPrompt(clientConfig, relevantKnowledge, transitionContext, relevantExamples);
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
          inputPreview: fullInput.slice(0, 500),
          outputPreview: llmResponse.content.slice(0, 500),
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
      if (structuredResponse.transition) {
        const targetState = structuredResponse.transition.to as ConversationState;
        if (stateMachine.canTransitionTo(targetState) && structuredResponse.transition.confidence >= 0.6) {
          stateMachine.transitionTo(targetState, structuredResponse.transition.reason);
          sessionUpdates = {
            ...sessionUpdates,
            previousState: session.currentState,
            currentState: targetState,
          };
          console.log(`[State Transition] ${session.currentState} -> ${targetState}: ${structuredResponse.transition.reason}`);
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

function buildSystemPrompt(
  config: EngineDependencies['clientConfig'],
  knowledge: KnowledgeEntry[],
  transitionContext: string,
  examples: ConversationExample[] = []
): string {
  const knowledgeContext = knowledge
    .map(k => `Q: ${k.title}\nA: ${k.summary || k.answer.slice(0, 300)}`)
    .join('\n\n');
  
  // Format examples for injection (only if we have them)
  const examplesContext = examples.length > 0 
    ? formatExamples(examples, { maxMessages: 6, includeScenario: true })
    : '';
  
  return `# Role
You are a sales representative for ${config.business.name}. ${config.business.description}

# Language
Always respond in ${config.business.language}. Be friendly, professional, and helpful.

${transitionContext}

# Relevant Knowledge
${knowledgeContext || 'No specific knowledge retrieved for this query.'}

${examplesContext}

# Response Format
You MUST respond with a JSON object in a code block. The format is:
\`\`\`json
{
  "response": "Your conversational response to the user in ${config.business.language}",
  "transition": {
    "to": "state_name",
    "reason": "Brief explanation of why transitioning",
    "confidence": 0.8
  },
  "extractedData": {
    "userName": "if user mentioned their name",
    "email": "if user provided email",
    "hasExperience": true,
    "interestLevel": "high",
    "concerns": ["any concerns they raised"]
  },
  "isUncertain": false
}
\`\`\`

Rules for the JSON response:
- "response" is REQUIRED - this is what gets sent to the user
- "transition" is OPTIONAL - only include if you detect completion signals and recommend moving to a new state
- "extractedData" is OPTIONAL - only include fields where you extracted new information
- "isUncertain" should be true if you're not confident in your response and a human might help better

# Guidelines
- Be concise but warm (2-4 sentences typically)
- Use emojis sparingly (1-2 per message max)
- Ask clarifying questions when needed
- Never make up information - use the knowledge provided
- If you don't know something, set isUncertain to true
- Guide the conversation toward registration when appropriate
${examples.length > 0 ? '- Study the reference examples above and match their conversational style and approach' : ''}

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
