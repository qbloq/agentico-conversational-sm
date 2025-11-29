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
  KnowledgeStore,
  KnowledgeEntry,
  
  // LLM Interfaces
  LLMProvider,
  LLMRequest,
  LLMMessage,
  LLMResponse,
  EmbeddingProvider,
  
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
export type { ConversationEngine } from './engine/conversation.js';

// =============================================================================
// State Machine
// =============================================================================

export { StateMachine, STATE_CONFIGS } from './state/machine.js';
export type { StateConfig, StateTransition } from './state/machine.js';

// =============================================================================
// LLM Providers (re-exported from llm submodule)
// =============================================================================

// These are available via '@parallelo/sales-engine/llm'
// import { createGeminiProvider } from '@parallelo/sales-engine/llm';
