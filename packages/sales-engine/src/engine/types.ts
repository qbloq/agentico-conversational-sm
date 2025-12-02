/**
 * Core types for the conversation engine
 */

import type { MediaService } from '../media/types.js';
import type { NotificationService } from '../escalation/types.js';

export type { MediaService, NotificationService };

// =============================================================================
// Session & Contact Types
// =============================================================================

export type ChannelType = 'whatsapp' | 'instagram' | 'messenger';

/**
 * Unique key to identify a session
 * Used to lookup or create sessions from incoming messages
 */
export interface SessionKey {
  channelType: ChannelType;
  channelId: string;       // WhatsApp phone_number_id, Instagram page_id, etc.
  channelUserId: string;   // User's ID within that channel (wa_id, ig_id, psid)
}

/**
 * Conversation states (state machine)
 * 
 * Categories:
 * - Entry: initial, returning_customer, promotion_inquiry
 * - Qualification: qualifying, diagnosing
 * - Sales Flow: pitching, handling_objection, closing, post_registration
 * - Education Flow: education_redirect
 * - Support Flow: technical_support, deposit_support, platform_support, withdrawal_support
 * - Terminal: completed, escalated, follow_up, disqualified
 */
export type ConversationState =
  // Entry States
  | 'initial'
  | 'returning_customer'
  | 'promotion_inquiry'
  // Qualification States
  | 'qualifying'
  | 'diagnosing'
  // Sales Flow
  | 'pitching'
  | 'handling_objection'
  | 'closing'
  | 'post_registration'
  // Education Flow
  | 'education_redirect'
  // Support Flow
  | 'technical_support'
  | 'deposit_support'
  | 'platform_support'
  | 'withdrawal_support'
  // Terminal States
  | 'follow_up'
  | 'escalated'
  | 'completed'
  | 'disqualified';

/**
 * Session status
 */
export type SessionStatus = 'active' | 'paused' | 'closed' | 'archived';

/**
 * A conversation session
 */
export interface Session {
  id: string;
  contactId: string;
  
  // Channel info
  channelType: ChannelType;
  channelId: string;
  channelUserId: string;
  
  // State machine
  currentState: ConversationState;
  previousState?: ConversationState;
  
  // Context (flexible JSONB)
  context: Record<string, unknown>;
  
  // Status
  status: SessionStatus;
  
  // Escalation
  isEscalated: boolean;
  escalatedTo?: string;
  escalationReason?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}

/**
 * A contact (the actual human user)
 */
export interface Contact {
  id: string;
  
  // Identity
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  
  // Profile
  language: string;
  country?: string;
  timezone?: string;
  
  // Funnel status
  hasRegistered: boolean;
  depositConfirmed: boolean;
  lifetimeValue: number;
  
  // Attribution
  utmSource?: string;
  utmCampaign?: string;
  referralCode?: string;
  
  // Metadata
  metadata: Record<string, unknown>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Message Types
// =============================================================================

export type MessageType = 'text' | 'image' | 'audio' | 'template' | 'interactive';
export type MessageDirection = 'inbound' | 'outbound';

/**
 * Normalized message (channel-agnostic)
 */
export interface NormalizedMessage {
  id: string;
  timestamp: Date;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  transcription?: string;
  imageAnalysis?: ImageAnalysis;
  interactivePayload?: InteractivePayload;
}

export interface ImageAnalysis {
  description: string;
  extractedText?: string;
  isReceipt?: boolean;
  confidence?: number;
}

export interface InteractivePayload {
  type: 'button_reply' | 'list_reply';
  buttonId?: string;
  listId?: string;
  title: string;
}

/**
 * Stored message
 */
export interface Message {
  id: string;
  sessionId: string;
  direction: MessageDirection;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaStoragePath?: string;
  transcription?: string;
  imageAnalysis?: ImageAnalysis;
  platformMessageId?: string;
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
}

// =============================================================================
// Bot Response Types
// =============================================================================

export type BotResponseType = 'text' | 'image' | 'template' | 'interactive';

export interface BotResponse {
  type: BotResponseType;
  content: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Engine Input/Output
// =============================================================================

/**
 * Input to the conversation engine
 */
export interface EngineInput {
  sessionKey: SessionKey;
  message: NormalizedMessage;
  deps: EngineDependencies;
}

/**
 * Output from the conversation engine
 */
export interface EngineOutput {
  responses: BotResponse[];
  sessionUpdates?: Partial<Session>;
  contactUpdates?: Partial<Contact>;
  escalation?: EscalationResult;
  followupSchedule?: FollowupSchedule;
}

/**
 * Escalation result
 */
export interface EscalationResult {
  shouldEscalate: boolean;
  reason: EscalationReason;
  priority: 'immediate' | 'high' | 'medium';
  confidence: number;
}

export type EscalationReason =
  | 'explicit_request'
  | 'frustration'
  | 'high_value'
  | 'technical_issue'
  | 'repeated_confusion'
  | 'ai_uncertainty';

/**
 * Follow-up schedule
 */
export interface FollowupSchedule {
  type: 'short_term' | 'daily' | 'custom';
  delayMinutes?: number;
  scheduledAt?: Date;
}

// =============================================================================
// Dependency Interfaces (Ports)
// =============================================================================

/**
 * Dependencies injected by the application layer
 */
export interface EngineDependencies {
  // Persistence
  contactStore: ContactStore;
  sessionStore: SessionStore;
  messageStore: MessageStore;
  
  // AI services
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  knowledgeStore: KnowledgeStore;
  mediaService: MediaService;
  notificationService: NotificationService;
  
  // Few-shot examples (optional)
  exampleStore?: ExampleStore;
  
  // Logging (optional)
  llmLogger?: LLMLogger;
  
  // Client configuration
  clientConfig: ClientConfig;
}

/**
 * Conversation example store interface (for few-shot prompting)
 */
export interface ExampleStore {
  findByState(
    state: ConversationState,
    options?: { limit?: number; category?: string }
  ): Promise<ConversationExample[]>;
  findSimilar(
    embedding: number[],
    options?: { state?: ConversationState; limit?: number }
  ): Promise<ConversationExample[]>;
}

/**
 * A conversation example with state annotations
 */
export interface ConversationExample {
  id: string;
  exampleId: string;
  scenario: string;
  category: string;
  outcome: string;
  primaryState: ConversationState | null;
  stateFlow: ConversationState[];
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
    state: ConversationState;
  }>;
  notes?: string;
  similarity?: number;
}

// =============================================================================
// Store Interfaces (Ports)
// =============================================================================

export interface ContactStore {
  findOrCreateByChannelUser(channelType: ChannelType, channelUserId: string): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;
  update(id: string, updates: Partial<Contact>): Promise<Contact>;
}

export interface SessionStore {
  findByKey(key: SessionKey): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  create(key: SessionKey, contactId: string): Promise<Session>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
}

export interface MessageStore {
  getRecent(sessionId: string, limit: number): Promise<Message[]>;
  save(sessionId: string, message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>): Promise<Message>;
}

export interface KnowledgeStore {
  findSimilar(embedding: number[], limit: number): Promise<KnowledgeEntry[]>;
  findByCategory(category: string, limit: number): Promise<KnowledgeEntry[]>;
  findByTags(tags: string[], limit: number): Promise<KnowledgeEntry[]>;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  answer: string;
  category: string;
  semanticTags: string[];
  summary: string;
  relatedArticles?: { title: string; url: string }[];
}

// =============================================================================
// LLM Interfaces
// =============================================================================

export interface LLMProvider {
  readonly name: string;
  generateResponse(request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'content_filter' | 'error';
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  readonly dimensions: number;
}

// =============================================================================
// LLM Logging
// =============================================================================

/**
 * Log entry for an LLM call (for cost tracking)
 */
export interface LLMLogEntry {
  clientId: string;
  sessionId?: string;
  requestType: 'chat' | 'embedding' | 'vision' | 'transcription';
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  inputPreview?: string;
  outputPreview?: string;
  inputHash?: string;
  latencyMs?: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  isError?: boolean;
  errorMessage?: string;
}

/**
 * Interface for LLM usage logging
 */
export interface LLMLogger {
  log(entry: LLMLogEntry): Promise<void>;
}

// =============================================================================
// Client Configuration
// =============================================================================

export interface ClientConfig {
  clientId: string;
  schemaName: string;
  storageBucket: string;
  
  // Channel credentials
  channels: {
    whatsapp?: WhatsAppConfig;
    instagram?: InstagramConfig;
    messenger?: MessengerConfig;
  };
  
  // LLM settings
  llm: {
    provider: 'gemini' | 'anthropic' | 'openai';
    model: string;
    fallbackProvider?: 'gemini' | 'anthropic' | 'openai';
    fallbackModel?: string;
  };
  
  // Escalation settings
  escalation: {
    enabled: boolean;
    notifyWhatsApp?: string;
    notifySlack?: string;
    highValueThreshold?: number;
  };
  
  // Business info (for prompts)
  business: {
    name: string;
    description: string;
    language: string;
    timezone: string;
  };
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;  // Reference to Vault secret
  appSecret: string;    // Reference to Vault secret
}

export interface InstagramConfig {
  pageId: string;
  accessToken: string;
}

export interface MessengerConfig {
  pageId: string;
  accessToken: string;
}
