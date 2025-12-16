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
  KnowledgeEntry,
  ConversationState,
  ConversationExample,
  SessionKey,
} from './types.js';

import { generatePitch12xResponses } from '../flows/pitch-12x.js';
import { StateMachine } from '../state/machine.js';
import type { StructuredLLMResponse } from '../llm/types.js';
import { calculateCost } from '../llm/pricing.js';

import { buildSystemPrompt } from '../prompts/templates.js';

/**
 * Result of ingesting a message (debounce)
 */
export interface IngestResult {
  /** Whether the message was buffered (true) or processed immediately (false) */
  buffered: boolean;
  /** Hash of the session key (for tracking) */
  sessionKeyHash: string;
  /** When the message is scheduled to be processed */
  scheduledProcessAt: Date;
}

/**
 * Conversation Engine interface
 */
export interface ConversationEngine {
  /**
   * Ingest a message (buffered if debounce enabled)
   * Returns immediately - no LLM call unless debounce is disabled
   */
  ingestMessage(input: EngineInput): Promise<IngestResult>;
  
  /**
   * Process buffered messages for a session (called by worker)
   * This is where the LLM call happens
   */
  processPendingMessages(
    sessionKeyHash: string,
    deps: EngineDependencies
  ): Promise<EngineOutput>;
  
  /**
   * Direct message processing (skips debounce)
   * Kept for backwards compatibility, simulation, and testing
   */
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
          session.escalationReason = undefined;
          session.escalatedTo = undefined;
          resumeUpdates = { isEscalated: false, status: 'active', escalationReason: undefined, escalatedTo: undefined };
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
          
          await sessionStore.update(session.id, { lastMessageAt: new Date() });
          
          return {
            sessionId: session.id,
            responses: [],
            sessionUpdates: { lastMessageAt: new Date() },
          };
        }
      }
      
      // 3b. Check for Flow A Locking (Time-based)
      // If we are in pitching_12x and recently sent the burst, ignore input
      /*if (session.currentState === 'pitching_12x' && session.context?.pitchComplete) {
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
      }*/
      
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
      const recentMessages = await messageStore.getRecent(session.id, 20);
      
      // 6. Initialize state machine
      let smConfig = undefined;
      if (deps.stateMachineStore) {
        try {
          // Try to load active SM
          // TODO: Make SM name configurable in clientConfig
          const loadedConfig = await deps.stateMachineStore.findActive('default_sales_flow');
          if (loadedConfig) {
            smConfig = loadedConfig;
          }
        } catch (err) {
          console.error('Failed to load state machine config:', err);
        }
      }

      // console.log('State machine config:\n\n', smConfig);
      const stateMachine = StateMachine.fromSession(session, smConfig);
      const stateConfig = stateMachine.getConfig();
      
      // NOTE: Escalation detection is now handled post-LLM via structuredResponse.escalation
      // This allows the LLM to make nuanced decisions about when to escalate
      
      // 8. Retrieve relevant knowledge (RAG)
      // messageText is already defined above
      
      // Generate embedding with logging
      const embeddingStartTime = Date.now();
      const embedding = await embeddingProvider.generateEmbedding(messageText, { taskType: 'RETRIEVAL_QUERY' });

      const embeddingLatency = Date.now() - embeddingStartTime;
      
      // Log embedding call (fire and forget)
      if (llmLogger) {
        const embeddingTokens = Math.ceil(messageText.length / 4); // Rough estimate
        llmLogger.log({
          clientId: clientConfig.clientId,
          sessionId: session.id,
          requestType: 'embedding',
          provider: 'gemini', // TODO: get from embeddingProvider.name if available
          model: 'gemini-embedding-001',
          promptTokens: embeddingTokens,
          completionTokens: 0,
          totalTokens: embeddingTokens,
          costUsd: calculateCost('gemini-embedding-001', embeddingTokens, 0),
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

      const systemPrompt = buildSystemPrompt({ 
        config: clientConfig, 
        knowledge: relevantKnowledge, 
        transitionContext, 
        examples: relevantExamples,
        sessionContext: session.context, // Pass collected user data to prompt
      });
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
      
      // console.log(`[LLM] Response: ${llmResponse.content}`);

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
      
      // 12. Check for LLM-recommended escalation
      if (structuredResponse.escalation?.shouldEscalate) {
        console.log(`[Escalation] LLM detected escalation: ${structuredResponse.escalation.reason}`);
        console.log(`[Escalation] Summary: ${structuredResponse.escalation.summary || 'No summary'}`);
        
        // Send notification if enabled
        if (clientConfig.escalation.enabled && clientConfig.escalation.notifyWhatsApp) {
          try {
            await notificationService.sendEscalationAlert(
              clientConfig.escalation.notifyWhatsApp,
              {
                reason: structuredResponse.escalation.reason,
                userName: contact.fullName || contact.phone || 'Unknown User',
                userPhone: contact.phone || sessionKey.channelUserId,
                summary: structuredResponse.escalation.summary || messageText.slice(0, 100),
              }
            );
          } catch (error) {
            console.error('Failed to send escalation notification:', error);
          }
        }
        
        const escalationUpdates = {
          isEscalated: true,
          currentState: 'escalated' as ConversationState,
          escalationReason: structuredResponse.escalation.reason,
          lastMessageAt: new Date(),
        };
        
        // Save the escalation response before updating session
        const escalationResponse = createEscalationResponse(structuredResponse.escalation, clientConfig);
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: 'text',
          content: escalationResponse.content,
        });
        
        // Create escalation record if store is available
        const { escalationStore } = deps;
        if (escalationStore) {
          try {
            const { id: escalationId } = await escalationStore.create({
              sessionId: session.id,
              reason: structuredResponse.escalation.reason,
              aiSummary: structuredResponse.escalation.summary,
              aiConfidence: structuredResponse.escalation.confidence,
              priority: 'high', // LLM-detected escalations are high priority
            });
            console.log(`[Escalation] Created escalation record: ${escalationId}`);
          } catch (error) {
            console.error('[Escalation] Failed to create escalation record:', error);
            // Continue even if record creation fails - session is still escalated
          }
        }
        
        await sessionStore.update(session.id, escalationUpdates);
        
        return {
          sessionId: session.id,
          responses: [escalationResponse],
          sessionUpdates: escalationUpdates,
          escalation: {
            shouldEscalate: true,
            reason: structuredResponse.escalation.reason,
            priority: 'immediate',
            confidence: structuredResponse.escalation.confidence,
          },
        };
      }
      
      // 13. Evaluate state transition from LLM recommendation
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
          const entryResponse = await getStateEntryResponse(
            targetState, 
            {
              ...session,
              currentState: targetState,
              context: { ...session.context, ...sessionUpdates.context }
            },
            messageStore,
            session.id
          );

          if (entryResponse) {
            console.log(`[State Entry] Triggering special response for ${targetState}`);
            
            // We must save the session state update first
            await sessionStore.update(session.id, sessionUpdates);
            
            return {
              ...entryResponse,
              transitionReason: structuredResponse.transition.reason,
              sessionUpdates: {
                ...entryResponse.sessionUpdates,
                ...sessionUpdates, // Ensure state change is included in return
              }
            };
          }
        } else {
            console.log(`[State Transition] Rejected: ${targetState} (Allowed: ${stateMachine.canTransitionTo(targetState)}, Confidence: ${structuredResponse.transition.confidence})`);
        }
      }
      
      // Update session context with extracted data
      let contactUpdates: Partial<Contact> = {};
      if (structuredResponse.extractedData) {
        sessionUpdates.context = {
          ...session.context,
          ...structuredResponse.extractedData,
        };
        
        // Also persist email to Contact record if provided
        if (structuredResponse.extractedData.email) {
          contactUpdates.email = structuredResponse.extractedData.email;
          console.log(`[Contact Update] Email captured: ${structuredResponse.extractedData.email}`);
        }
        
        // Persist userName to Contact if provided
        if (structuredResponse.extractedData.userName) {
          contactUpdates.fullName = structuredResponse.extractedData.userName;
        }
      }
      
      // Check for AI uncertainty escalation
      if (structuredResponse.isUncertain) {
        console.log('[AI Uncertainty] LLM flagged uncertainty, consider escalation');
        // Could trigger soft escalation here in future
      }
      
      // 13. Create bot responses (multi-message support)
      const responseTexts = structuredResponse.responses || [structuredResponse.response];
      const botResponses: BotResponse[] = responseTexts.map((text, index) => ({
        type: 'text' as const,
        content: text,
        delayMs: index > 0 ? 800 : 0, // Small delay between messages for natural feel
        metadata: index === 0 ? {
          tokensUsed: llmResponse.usage.totalTokens,
          state: stateMachine.getState(),
          transition: structuredResponse.transition,
        } : undefined,
      }));
      
      // 14. Save outbound messages
      for (const response of botResponses) {
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: 'text',
          content: response.content,
        });
      }
      
      // 15. Consolidate and Save Session Updates
      // We must save the updates before returning so that the simulation/CLI/webhook
      // all have consistent state without needing to handle persistence themselves.
      const finalUpdates = { ...sessionUpdates, ...resumeUpdates };
      if (Object.keys(finalUpdates).length > 0) {
        await sessionStore.update(session.id, finalUpdates);
      }
      
      return {
        sessionId: session.id,
        responses: botResponses,
        sessionUpdates: finalUpdates,
        contactUpdates: Object.keys(contactUpdates).length > 0 ? contactUpdates : undefined,
        transitionReason: structuredResponse.transition?.reason,
      };
    },
    
    /**
     * Ingest a message with optional debounce buffering
     * If debounce is enabled, buffers the message and returns immediately
     * If debounce is disabled or fails, falls back to immediate processing
     */
    async ingestMessage(input: EngineInput): Promise<IngestResult> {
      const { sessionKey, message, deps } = input;
      const { messageBufferStore, clientConfig } = deps;
      
      // If debounce not enabled or no buffer store, process immediately
      if (!clientConfig.debounce?.enabled || !messageBufferStore) {
        console.log(`[Debounce] Defer disabled or no buffer store, processing immediately`);
        await this.processMessage(input);
        return { 
          buffered: false, 
          sessionKeyHash: '', 
          scheduledProcessAt: new Date() 
        };
      }
      
      // Try to buffer the message (with graceful degradation)
      try {
        const debounceMs = clientConfig.debounce.delayMs || 3000;
        const sessionKeyHash = hashSessionKey(sessionKey);
        
        await messageBufferStore.add(sessionKey, message, debounceMs);
        
        console.log(`[Debounce] Message buffered for ${sessionKey.channelUserId}, scheduled in ${debounceMs}ms`);
        
        return {
          buffered: true,
          sessionKeyHash,
          scheduledProcessAt: new Date(Date.now() + debounceMs),
        };
      } catch (error) {
        // Graceful degradation: if buffering fails, process immediately
        console.error('[Debounce] Buffer failed, processing immediately:', error);
        await this.processMessage(input);
        return { 
          buffered: false, 
          sessionKeyHash: '', 
          scheduledProcessAt: new Date() 
        };
      }
    },
    
    /**
     * Process all pending messages for a session (called by worker)
     * Merges buffered messages and makes a single LLM call
     */
    async processPendingMessages(
      sessionKeyHash: string,
      deps: EngineDependencies
    ): Promise<EngineOutput> {
      const { messageBufferStore } = deps;
      
      if (!messageBufferStore) {
        console.warn('[Debounce] processPendingMessages called without messageBufferStore');
        return { sessionId: '', responses: [] };
      }
      
      // 1. Try to claim the session (prevent double processing)
      const claimed = await messageBufferStore.claimSession(sessionKeyHash);
      if (!claimed) {
        console.log(`[Debounce] Session ${sessionKeyHash.slice(0, 8)}... already being processed`);
        return { sessionId: '', responses: [] };
      }
      
      // 2. Get all pending messages for this session
      const pending = await messageBufferStore.getBySession(sessionKeyHash);
      if (pending.length === 0) {
        console.log(`[Debounce] No pending messages for ${sessionKeyHash.slice(0, 8)}...`);
        return { sessionId: '', responses: [] };
      }
      
      console.log(`[Debounce] Processing ${pending.length} buffered messages for ${sessionKeyHash.slice(0, 8)}...`);
      
      // 3. Sort by receivedAt and merge content
      const sorted = pending.sort((a, b) => 
        a.receivedAt.getTime() - b.receivedAt.getTime()
      );
      
      const mergedContent = sorted
        .map(p => p.message.content || p.message.transcription || '')
        .filter(Boolean)
        .join('\n');
      
      // 4. Use the latest message for metadata, but merged content
      const latestMessage = sorted[sorted.length - 1];
      const mergedMessage: NormalizedMessage = {
        ...latestMessage.message,
        content: mergedContent,
      };
      
      try {
        // 5. Process the merged message through existing engine logic
        const result = await this.processMessage({
          sessionKey: sorted[0].sessionKey,
          message: mergedMessage,
          deps,
        });
        
        // 6. Success! Delete processed messages from buffer
        await messageBufferStore.deleteByIds(pending.map(p => p.id));
        
        console.log(`[Debounce] Successfully processed and cleaned up ${pending.length} messages`);
        
        return result;
        
      } catch (error) {
        // Processing failed - mark for retry, don't delete
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Debounce] Processing failed for ${sessionKeyHash.slice(0, 8)}...:`, errorMsg);
        
        await messageBufferStore.markForRetry(sessionKeyHash, errorMsg);
        
        // Re-throw so caller knows it failed
        throw error;
      }
    },
  };
}

/**
 * Hash a session key for use as a unique identifier
 */
function hashSessionKey(key: SessionKey): string {
  // Simple hash for Deno/browser compatibility (no crypto.createHash)
  const str = `${key.channelType}:${key.channelId}:${key.channelUserId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// =============================================================================
// Helper Functions
// =============================================================================

// NOTE: checkEscalationTriggers was removed - escalation is now LLM-driven
// See structuredResponse.escalation handling in processMessage

/**
 * Create escalation response message for user
 * Used by both LLM-driven and (legacy) keyword-driven escalation
 */
function createEscalationResponse(
  escalation: { reason: string; summary?: string },
  _config: EngineDependencies['clientConfig']
): BotResponse {
  const messages: Record<string, string> = {
    explicit_request: '¡Por supuesto! Te conecto con uno de nuestros asesores. Un momento por favor. 🙋‍♂️',
    frustration: 'Entiendo tu frustración y quiero ayudarte. Te conecto con un asesor que podrá asistirte mejor. Un momento.',
    high_value: 'Para brindarte la mejor atención personalizada, te conecto con uno de nuestros asesores senior.',
    technical_issue: 'Veo que tienes un problema técnico. Te conecto con soporte especializado.',
    complex_issue: 'Tu caso requiere atención especializada. Te conecto con uno de nuestros expertos.',
    ai_uncertainty: 'Para darte la mejor respuesta, te conecto con uno de nuestros expertos.',
    legal_regulatory: 'Este tema requiere atención de nuestro equipo especializado. Te conecto ahora mismo.',
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
                    content.match(/\{[\s\S]*"response[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      // Handle new format: responses array (2-4 short messages)
      if (Array.isArray(parsed.responses) && parsed.responses.length > 0) {
        // Filter out empty strings and validate
        const validResponses = parsed.responses.filter((r: any) => typeof r === 'string' && r.trim().length > 0);
        if (validResponses.length > 0) {
          return {
            content: content,
            response: validResponses.join('\n'), // Backwards compat: join for single response consumers
            responses: validResponses,           // New format: keep as array
            transition: parsed.transition,
            extractedData: parsed.extractedData,
            isUncertain: parsed.isUncertain,
            escalation: parsed.escalation,       // LLM-driven escalation signal
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: 'stop',
          };
        }
      }
      
      // Fallback: Handle old format with single response string
      const response = parsed.response;
      if (typeof response === 'string' && response.trim().length > 0) {
        return {
          content: content,
          response: response,
          responses: [response], // Convert to array for new consumers
          transition: parsed.transition,
          extractedData: parsed.extractedData,
          isUncertain: parsed.isUncertain,
          escalation: parsed.escalation,       // LLM-driven escalation signal
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
    responses: [fallbackResponse], // Wrap in array for new consumers
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
 * 
 * IMPORTANT: This function saves all outbound messages to the message store
 * before returning, ensuring burst sequences are persisted.
 */
async function getStateEntryResponse(
  state: ConversationState, 
  session: Session,
  messageStore: EngineDependencies['messageStore'],
  sessionId: string
): Promise<EngineOutput | null> {
  let output: EngineOutput | null = null;
  
  switch (state) {
    case 'pitching_12x':
      output = generatePitch12xResponses(session);
      break;
      
    case 'closing':
      output = generateClosingResponse(session);
      break;
      
    // Add other state entry handlers here
    
    default:
      return null;
  }
  
  // Save all outbound messages from the burst sequence
  if (output) {
    for (const response of output.responses) {
      await messageStore.save(sessionId, {
        direction: 'outbound',
        type: 'text',
        content: response.content,
      });
    }
  }
  
  return output;
}

function generateClosingResponse(session: Session): EngineOutput {
  const registrationLink = `https://h.parallelo.ai/register?sessionId=${session.id}`;
  
  return {
    sessionId: session.id,
    responses: [{
      type: 'text',
      content: `Excelente, lo primero es hacer el registro. 🚀\n\nEstaré aquí contigo durante todo el proceso. Si tienes alguna duda al llenar el formulario o realizar el depósito, solo pregúntame.\n\nUna vez que hayas completado el registro, pásame tu correo electrónico para verificar que todo esté en orden.`,
      delayMs: 1000
    },{
      type: 'text',
      content: registrationLink,
      delayMs: 1000
    }],
    sessionUpdates: {
      lastMessageAt: new Date(),
      context: {
        ...session.context,
        registrationStatus: 'pending',
      }
    }
  };
}
