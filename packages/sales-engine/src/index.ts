/**
 * @parallelo/sales-engine
 * 
 * Domain library for conversational AI sales engine.
 * This library is framework-agnostic and can be used with any runtime.
 */

// =============================================================================
// Core Types
// =============================================================================

export type {
  // Session & Contact
  ChannelType,
  SessionKey,
  ConversationState,
  SessionStatus,
  Session,
  Contact,
  
  // Messages
  MessageType,
  MessageDirection,
  NormalizedMessage,
  ImageAnalysis,
  InteractivePayload,
  Message,
  
  // Bot Response
  BotResponseType,
  BotResponse,
  
  // Engine I/O
  EngineInput,
  EngineOutput,
  EscalationResult,
  EscalationReason,
  FollowupSchedule,
  
  // Dependencies
  EngineDependencies,
  
  // Store Interfaces (Ports)
  ContactStore,
  SessionStore,
  MessageStore,
  StateMachineStore,
  StateEntryMessageConfig,
  MessageBufferStore,
  EscalationStore,
  FollowupStore,
  KnowledgeStore,
  KnowledgeEntry,
  PendingMessage,
  
  // LLM Interfaces
  LLMProvider,
  LLMRequest,
  LLMMessage,
  LLMResponse,
  EmbeddingProvider,
  
  // LLM Logging
  LLMLogger,
  LLMLogEntry,
  
  // Client Config
  ClientConfig,
  WhatsAppConfig,
  InstagramConfig,
  MessengerConfig,
} from './engine/types.js';

// =============================================================================
// Conversation Engine
// =============================================================================

export { createConversationEngine } from './engine/conversation.js';
export type { ConversationEngine, IngestResult } from './engine/conversation.js';

// =============================================================================
// State Machine
// =============================================================================

export { StateMachine, STATE_CONFIGS } from './state/machine.js';
export type { StateConfig, StateTransition } from './state/machine.js';

export { WhatsAppNotificationService } from './escalation/whatsapp-notification.js';

// =============================================================================
// LLM Providers (re-exported from llm submodule)
// =============================================================================

// These are available via '@parallelo/sales-engine/llm'
// import { createGeminiProvider } from '@parallelo/sales-engine/llm';

// =============================================================================
// LLM Cost Logging (helpers from llm submodule)
// =============================================================================

// Types are exported from ./engine/types.js above
export {
  noopLogger,
  consoleLogger,
  createChatLogEntry,
  createEmbeddingLogEntry,
  createVisionLogEntry,
  createTranscriptionLogEntry,
} from './llm/logger.js';
export { calculateCost, calculateTranscriptionCost, MODEL_PRICING } from './llm/pricing.js';

// =============================================================================
// Conversation Examples (Few-Shot Prompting)
// =============================================================================

export type {
  ExampleMessage,
  ExampleCategory,
  ExampleOutcome,
  ConversationExample,
  ExampleRetrievalOptions,
  ExampleStore,
  FormatOptions,
  FormattableExample,
} from './examples/index.js';

// Also export the engine's ExampleStore interface for dependency injection
export type {
  ExampleStore as EngineExampleStore,
  ConversationExample as EngineConversationExample,
} from './engine/types.js';


export {
  SupabaseExampleStore,
  InMemoryExampleStore,
  formatExample,
  formatExamples,
  extractAgentResponses,
  summarizeExample,
} from './examples/index.js';

export { buildEscalationResolutionPrompt } from './prompts/templates.js';

