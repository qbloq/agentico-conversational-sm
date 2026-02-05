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
  ConversationState,
  ConversationExample,
  SessionKey,
  MessageType,
} from './types.js';

import { substituteTemplateVariables } from './template-utils.js';
import { StateMachine } from '../state/machine.js';
import type { StructuredLLMResponse, LLMResponse } from '../llm/types.js';
import { calculateCost } from '../llm/pricing.js';

import { buildSystemPromptWithoutKB, buildFollowupPrompt } from '../prompts/templates.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ConversationResponseSchema } from '../llm/schemas.js';

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

  /**
   * Generate a follow-up message when user hasn't responded
   */
  generateFollowup(
    sessionId: string,
    deps: EngineDependencies
  ): Promise<BotResponse[]>;
}

/**
 * Create a new conversation engine instance
 */
export function createConversationEngine(): ConversationEngine {
  return {
    async processMessage(input: EngineInput): Promise<EngineOutput> {
      const { sessionKey, message, deps } = input;
      console.log(`[DEBUG] processMessage: sessionKey=${JSON.stringify(sessionKey)}, type=${message.type}`);
      console.log(`[DEBUG] processMessage: channel=${sessionKey.channelType}, userId=${sessionKey.channelUserId}, type=${message.type}`);
      const { 
        contactStore, 
        sessionStore, 
        messageStore, 
        llmProvider, 
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
          // Also set content to transcription for searchability and LLM processing
          message.content = transcription.text;
        } catch (error) {
          console.error('Audio transcription failed:', error);
          message.content = '[Audio transcription failed]';
        }
      } else if (message.type === 'image' && message.mediaUrl && !message.imageAnalysis) {
        try {
          const analysis = await mediaService.analyzeImage(message.mediaUrl);
          message.imageAnalysis = analysis;
          // Clean content stays as is (caption or empty)
        } catch (error) {
          console.error('Image analysis failed:', error);
          message.content = message.content || '[Image analysis failed]';
        }
      } else if (message.type === 'video' && message.mediaUrl) {
        // Videos are stored but not analyzed (can add video analysis later if needed)
        console.log(`[Media] Video message received: ${message.mediaUrl}`);
        message.content = message.content || '[Video message]';
      } else if (message.type === 'sticker' && message.mediaUrl) {
        // Stickers are stored but not analyzed
        console.log(`[Media] Sticker message received: ${message.mediaUrl}`);
        message.content = '[Sticker]';
      }

      // 1. Get or create contact
      const contact = await contactStore.findOrCreateByChannelUser(
        sessionKey.channelType,
        sessionKey.channelUserId
      );
      
      // 2. Get or create session
      console.log(`[DEBUG] Getting session for key: ${JSON.stringify(sessionKey)}`);  
      let session = await sessionStore.findByKey(sessionKey);
      console.log(`[DEBUG] Found session: ${JSON.stringify(session)}`);  
      if (!session) {
        // Fetch state machine ID before creating session
        console.log(`[DEBUG] State machine name: ${clientConfig.stateMachineName}`);  
        const stateMachineId = await deps.stateMachineStore?.getStateMachineId(
          clientConfig.stateMachineName
        );
        console.log(`[DEBUG] State machine ID: ${stateMachineId}`);  
        
        if (!stateMachineId) {
          throw new Error(`State machine '${clientConfig.stateMachineName}' not found`);
        }
        
        session = await sessionStore.create(sessionKey, contact.id, stateMachineId);
      }

      // 3. Check for System Commands (Hidden)
      const inputForSystem = message.content || message.transcription || '';
      if (inputForSystem.toLowerCase() === '/reset') {
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
      
      // 4. Save incoming message
      console.log(`[DEBUG] Saving incoming message: ${message.content?.slice(0, 50)}...`);
      await messageStore.save(session.id, {
        direction: 'inbound',
        type: message.type,
        content: message.content,
        mediaUrl: message.mediaUrl,
        transcription: message.transcription,
        imageAnalysis: message.imageAnalysis,
        platformMessageId: message.id,
      });
      console.log(`[DEBUG] Incoming message saved successfully`);
      
      // 5. Get conversation history
      const recentMessages = await messageStore.getRecent(session.id, 20);
      
      // 6. Initialize state machine
      let smConfig = undefined;
      if (deps.stateMachineStore) {
        try {
          const loadedConfig = await deps.stateMachineStore.findActive(clientConfig.stateMachineName);
          if (loadedConfig) {
            smConfig = loadedConfig;
          }
        } catch (err) {
          console.error('Failed to load state machine config:', err);
        }
      }

      const stateMachine = StateMachine.fromSession(session, smConfig);
      const stateConfig = stateMachine.getConfig();
      
      // 7. Get relevant conversation examples (few-shot)
      // For now, we use a simple state-based retrieval or empty if not available
      let relevantExamples: ConversationExample[] = [];
      if (exampleStore) {
        relevantExamples = await retrieveExamples(exampleStore, session.currentState, []);
      }

      // 8. Build LLM prompt with state transition context
      const transitionContext = stateMachine.buildTransitionContext();
      const currentFormattedContent = formatMessageForLLM(message);

      const systemPrompt = buildSystemPromptWithoutKB({
        config: clientConfig,
        transitionContext,
        examples: relevantExamples,
        sessionContext: session.context,
      });

      const conversationHistory = formatConversationHistory(recentMessages);
      
      // 9. Generate response with structured output (with Retry Logic)
      let structuredResponse: StructuredLLMResponse | null = null;
      let llmResponse: LLMResponse | null = null;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts && !structuredResponse) {
        if (attempts > 0) {
          const delayMs = attempts * 2000;
          console.warn(`[LLM Retry] Waiting ${delayMs}ms before attempt ${attempts + 1}/${maxAttempts} for session ${session.id}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        attempts++;

        const llmStartTime = Date.now();
        
        // Use generateResponseWithFileSearch if knowledge base is configured
        if (clientConfig.knowledgeBase?.storeIds?.length) {
          console.log('Using knowledge base for session', session.id, 'with stores:', clientConfig.knowledgeBase.storeIds);
          try {
            llmResponse = await llmProvider.generateResponseWithFileSearch({
              systemPrompt,
              messages: [
                ...conversationHistory,
                { role: 'user', content: currentFormattedContent }
              ],
              fileSearch: {
                fileSearchStoreNames: clientConfig.knowledgeBase.storeIds
              },
              structuredOutput: {
                responseMimeType: 'application/json',
                responseJsonSchema: zodToJsonSchema(ConversationResponseSchema)
              },
              temperature: attempts > 1 ? 0.8 : (stateConfig as any).temperature,
              maxTokens: 65536,
            });
          } catch (err) {
            console.error('[LLM Error] File Search failed, falling back to regular chat:', err);
            // Fallback will happen in next attempt or via regular generateResponse if retry logic handles it
          }
        } 
        
        if (!llmResponse) {
          console.log('Using regular chat for session', session.id);
          llmResponse = await llmProvider.generateResponse({
            systemPrompt,
            messages: [
              ...conversationHistory,
              { role: 'user', content: currentFormattedContent }
            ],
            temperature: attempts > 1 ? 0.8 : (stateConfig as any).temperature,
          });
        }

        const llmLatency = Date.now() - llmStartTime;
console.log(llmResponse.usage)
        // Log LLM chat call (fire and forget)
        if (llmLogger) {
          const fullInput = `${systemPrompt}\n\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\nuser: ${currentFormattedContent}`;
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

        // 10. Parse structured response
        if (llmResponse) {
          structuredResponse = parseStructuredResponse(llmResponse.content);
          if (structuredResponse) {
            structuredResponse.usage = llmResponse.usage;
            structuredResponse.finishReason = llmResponse.finishReason;
          }
        }
      }

      if (!structuredResponse || !llmResponse) {
        console.error(`[LLM Error] Failed to get valid JSON response after ${maxAttempts} attempts.`);
        return {
          sessionId: session.id,
          responses: [{
            type: 'text',
            content: 'Dame un momento por favor ...',
          }],
          sessionUpdates: { lastMessageAt: new Date() },
        };
      }
      
      // 11. Check for LLM-recommended escalation
      if (structuredResponse.escalation?.shouldEscalate) {
        console.log(`[Escalation] LLM detected escalation: ${structuredResponse.escalation.reason}`);
        
        // Send notification if enabled
        if (clientConfig.escalation.enabled && clientConfig.escalation.notifyWhatsApp) {
          try {
            await notificationService.sendEscalationAlert(
              clientConfig.escalation.notifyWhatsApp,
              {
                reason: structuredResponse.escalation.reason,
                userName: contact.fullName || contact.phone || 'Unknown User',
                userPhone: contact.phone || sessionKey.channelUserId,
                summary: structuredResponse.escalation.summary || currentFormattedContent.slice(0, 100),
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
        
        const escalationResponse = createEscalationResponse(structuredResponse.escalation, clientConfig);
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: 'text',
          content: escalationResponse.content,
        });
        
        const { escalationStore } = deps;
        if (escalationStore) {
          try {
            await escalationStore.create({
              sessionId: session.id,
              reason: structuredResponse.escalation.reason,
              aiSummary: structuredResponse.escalation.summary,
              aiConfidence: structuredResponse.escalation.confidence,
              priority: 'high',
            });
          } catch (error) {
            console.error('[Escalation] Failed to create escalation record:', error);
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
      
      // 12. Evaluate state transition
      let sessionUpdates: Partial<Session> = {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      };
      
      if (structuredResponse.transition && structuredResponse.transition.to) {
        const targetState = structuredResponse.transition.to as ConversationState;
        if (stateMachine.canTransitionTo(targetState) && structuredResponse.transition.confidence >= 0.6) {
          console.log(`[State Transition] ${session.currentState} -> ${targetState}`);
          
          stateMachine.transitionTo(targetState, structuredResponse.transition.reason);
          sessionUpdates = {
            ...sessionUpdates,
            previousState: session.currentState,
            currentState: targetState,
          };

          const entryResponse = await getStateEntryResponse(
            targetState, 
            {
              ...session,
              currentState: targetState,
              context: { ...session.context, ...sessionUpdates.context }
            },
            messageStore,
            session.id,
            deps,
            contact
          );

          if (entryResponse) {
            await sessionStore.update(session.id, sessionUpdates);
            return {
              ...entryResponse,
              transitionReason: structuredResponse.transition.reason,
              sessionUpdates: {
                ...entryResponse.sessionUpdates,
                ...sessionUpdates,
              }
            };
          }
        }
      }
      
      // 13. Update session context with extracted data
      const contactUpdates: Partial<Contact> = {};
      if (structuredResponse.extractedData) {
        sessionUpdates.context = {
          ...session.context,
          ...structuredResponse.extractedData,
        };
        
        // Persist email/name to Contact if provided
        if (structuredResponse.extractedData.email) contactUpdates.email = structuredResponse.extractedData.email;
        if (structuredResponse.extractedData.userName) contactUpdates.fullName = structuredResponse.extractedData.userName;
        
        if (Object.keys(contactUpdates).length > 0) {
          await contactStore.update(contact.id, contactUpdates);
        }

        // Handle Deposit Detection
        if (structuredResponse.extractedData.deposit) {
          console.log(`[Deposit] Detected deposit from contact ${contact.id} in session ${session.id}`);
          
          const amount = typeof structuredResponse.extractedData.depositAmount === 'number' 
            ? structuredResponse.extractedData.depositAmount 
            : parseFloat(String(structuredResponse.extractedData.depositAmount || '0'));

          if (deps.depositStore) {
            try {
              await deps.depositStore.create({
                sessionId: session.id,
                contactId: contact.id,
                amount: amount,
                currency: 'USD', // Default or extracted if we add it to schema
                aiReasoning: structuredResponse.transition?.reason || 'Extracted from conversation',
              });
              console.log(`[Deposit] Event recorded successfully`);
            } catch (err) {
              console.error('[Deposit] Failed to record deposit event:', err);
            }
          }

          // Update contact status
          const depositContactUpdates: Partial<Contact> = {
            depositConfirmed: true,
            hasRegistered: true, // If they deposited, they must have registered
            lifetimeValue: (contact.lifetimeValue || 0) + amount,
          };
          
          await contactStore.update(contact.id, depositContactUpdates);
          
          // Merge with session updates so they are returned in engine output
          sessionUpdates.context = {
            ...sessionUpdates.context,
            depositConfirmed: true,
          };
        }
      }
      
      // 14. Create bot responses
      const responseTexts = structuredResponse.responses || [structuredResponse.response];
      const botResponses: BotResponse[] = responseTexts.map((text, index) => ({
        type: 'text' as const,
        content: text,
        delayMs: index > 0 ? 800 : 0,
        metadata: index === 0 ? {
          tokensUsed: structuredResponse!.usage.totalTokens,
          state: stateMachine.getState(),
          transition: structuredResponse!.transition,
        } : undefined,
      }));
      
      for (const response of botResponses) {
        await messageStore.save(session.id, {
          direction: 'outbound',
          type: 'text',
          content: response.content,
        });
      }
      
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
      console.log(`[DEBUG] processPendingMessages: sessionKeyHash=${sessionKeyHash}`);
      
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
      
      // 3. Sort by receivedAt
      const sorted = pending.sort((a, b) => 
        a.receivedAt.getTime() - b.receivedAt.getTime()
      );
      
      // 4. Check if any message contains media
      const hasMediaMessages = sorted.some(p => p.message.mediaUrl);
      
      try {
        if (hasMediaMessages) {
          // Process media messages individually to preserve image analysis
          console.log(`[Debounce] Found media in buffered messages, processing individually`);
          
          const allResponses: BotResponse[] = [];
          let lastResult: EngineOutput | null = null;
          
          for (const pendingMsg of sorted) {
            const result = await this.processMessage({
              sessionKey: pendingMsg.sessionKey,
              message: pendingMsg.message,
              deps,
            });
            
            allResponses.push(...result.responses);
            lastResult = result;
          }
          
          // Success! Delete processed messages from buffer
          await messageBufferStore.deleteByIds(pending.map(p => p.id));
          
          console.log(`[Debounce] Successfully processed ${sorted.length} messages (with media) individually`);
          
          return {
            ...lastResult!,
            responses: allResponses,
          };
        } else {
          // Text-only messages: merge content as before
          console.log(`[Debounce] Text-only messages, merging content`);
          
          const mergedContent = sorted
            .map(p => p.message.content || p.message.transcription || '')
            .filter(Boolean)
            .join('\n');
          
          const latestMessage = sorted[sorted.length - 1];
          const mergedMessage: NormalizedMessage = {
            ...latestMessage.message,
            content: mergedContent,
          };
          
          // Process the merged message through existing engine logic
          const result = await this.processMessage({
            sessionKey: sorted[0].sessionKey,
            message: mergedMessage,
            deps,
          });
          
          // Success! Delete processed messages from buffer
          await messageBufferStore.deleteByIds(pending.map(p => p.id));
          
          console.log(`[Debounce] Successfully processed and cleaned up ${pending.length} merged messages`);
          
          return result;
        }
        
      } catch (error) {
        // Processing failed - mark for retry, don't delete
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Debounce] Processing failed for ${sessionKeyHash.slice(0, 8)}...:`, errorMsg);
        
        await messageBufferStore.markForRetry(sessionKeyHash, errorMsg);
        
        // Re-throw so caller knows it failed
        throw error;
      }
    },

    async generateFollowup(
      sessionId: string,
      deps: EngineDependencies
    ): Promise<BotResponse[]> {
      const { 
        sessionStore, 
        messageStore, 
        llmProvider, 
        clientConfig 
      } = deps;

      console.log(`[Follow-up] Generating follow-up for session ${sessionId}...`);

      // 1. Get Session
      const session = await sessionStore.findById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // 2. Get Recent Messages (for history context)
      const history = await messageStore.getRecent(sessionId, 10);
      const formattedHistory = formatConversationHistory(history);

      // 3. Setup State Machine
      const machine = StateMachine.fromSession(session);
      const transitionContext = machine.buildTransitionContext();

      // 4. Build Prompt
      const prompt = buildFollowupPrompt({
        config: clientConfig,
        transitionContext,
        sessionContext: session.context as Record<string, unknown>,
        examples: [] // Not used in mockup/followup prompt yet
      });

      // 5. Call LLM
      try {
        const response = await llmProvider.generateResponse({
          systemPrompt: prompt,
          messages: formattedHistory,
          temperature: 0.7,
        });

        const structuredResponse = parseStructuredResponse(response.content);
        if (!structuredResponse || !structuredResponse.responses) {
          throw new Error('Invalid LLM response for follow-up');
        }

        return structuredResponse.responses.map((content: string) => ({
          type: 'text',
          content
        }));
      } catch (error) {
        console.error('[Follow-up] LLM generation failed:', error);
        // Fallback
        const fallbackMsg = clientConfig.business.language === 'es' 
          ? '¡Hola! 👋 Seguimos aquí para ayudarte. ¿Tienes alguna duda?'
          : 'Hi! 👋 We are still here to help. Any questions?';
        
        return [{
          type: 'text',
          content: fallbackMsg
        }];
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
 * The LLM is instructed to return JSON. If not valid, returns null.
 */
function parseStructuredResponse(content: string): StructuredLLMResponse | null {
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
        return null; // Return null instead of fallback
      }
    } catch (err) {
      // JSON parsing failed - log for debugging
      console.warn('[parseStructuredResponse] JSON parse failed:', err, 'Content:', content.slice(0, 200));
      return null; // Return null on JSON parse error
    }
  }
  
  console.warn('[parseStructuredResponse] No JSON found in content. Original content:', content.slice(0, 200));
  return null;
}

function formatMessageForLLM(m: { 
  content?: string | null; 
  type?: string; 
  transcription?: string; 
  imageAnalysis?: any;
  mediaUrl?: string;
}): string {
  let text = m.content || '';
  
  if (m.type === 'audio' && m.transcription) {
    const meta = `\n[SISTEMA: El usuario envió un audio. Transcripción: ${m.transcription}]`;
    text = text ? `${text}${meta}` : meta;
  } else if (m.type === 'image' && m.imageAnalysis?.description) {
    const meta = `\n[SISTEMA: El usuario envió una imagen. Descripción: ${m.imageAnalysis.description}]`;
    text = text ? `${text}${meta}` : meta;
  } else if (m.type === 'video' && m.mediaUrl) {
    const meta = `\n[SISTEMA: El usuario envió un video.]`;
    text = text ? `${text}${meta}` : meta;
  } else if (m.type === 'sticker' && m.mediaUrl) {
    const meta = `\n[SISTEMA: El usuario envió un sticker.]`;
    text = text ? `${text}${meta}` : meta;
  }
  
  return text || '[Contenido vacío]';
}

function formatConversationHistory(
  messages: EngineDependencies['messageStore'] extends { getRecent: (id: string, limit: number) => Promise<infer M> } ? M : never
): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(messages)) return [];
  
  return messages.map(m => ({
    role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
    content: formatMessageForLLM(m),
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
  sessionId: string,
  deps: EngineDependencies,
  contact?: Contact
): Promise<EngineOutput | null> {
  // Try to fetch from database first
  if (deps.stateMachineStore) {
    try {
      const stateMachineId = await deps.stateMachineStore.getStateMachineId(
        deps.clientConfig.stateMachineName
      );
      
      if (stateMachineId) {
        const entry = await deps.stateMachineStore.getStateEntryMessages(
          stateMachineId,
          state
        );
        
        if (entry) {
          console.log(`[State Entry] Using database responses for state: ${state}`);
          
          // Substitute template variables in all responses
          const responses = entry.responses.map(r => ({
            ...r,
            content: substituteTemplateVariables(r.content, session, contact),
            templateButtonParams: r.templateButtonParams?.map(p => 
              substituteTemplateVariables(p, session, contact)
            )
          }));
          
          // Save all outbound messages
          for (const response of responses) {
            await messageStore.save(sessionId, {
              direction: 'outbound',
              type: response.type as MessageType,
              content: response.content,
            });
          }
          
          return {
            sessionId: session.id,
            responses,
            sessionUpdates: {
              lastMessageAt: new Date(),
              ...entry.sessionUpdates
            }
          };
        }
      }
    } catch (error) {
      console.error('[State Entry] Database fetch failed, falling back to hardcoded:', error);
    }
  }
  
  // No database entry found
  return null;
}


