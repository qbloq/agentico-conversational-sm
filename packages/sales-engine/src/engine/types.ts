/**
 * Core types for the conversation engine
 */

import type { 
  MediaService 
} from '../media/types.js';
import type { 
  NotificationService 
} from '../escalation/types.js';
import type { 
  LLMProvider, 
  LLMRequest, 
  LLMMessage, 
  LLMResponse,
  StructuredLLMResponse,
  EmbeddingProvider,
  FileSearchConfig,
  StructuredOutputConfig
} from '../llm/types.js';

export type { 
  MediaService, 
  NotificationService,
  LLMProvider,
  LLMRequest,
  LLMMessage,
  LLMResponse,
  StructuredLLMResponse,
  EmbeddingProvider,
  FileSearchConfig,
  StructuredOutputConfig
};

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
  // Flow A (12x)
  | 'pitching_12x'
  // Flow B (Downsell)
  | 'pitching_copy_trading'
  | 'pitching_academy'
  | 'prospect'
  // Flow C (Closing)
  | 'closing'
  | 'post_registration'
  // Flow D (Support)
  | 'returning_customer'
  | 'support_general'
  // Terminal States
  | 'follow_up'
  | 'escalated'
  | 'completed';

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
  
  // State machine reference
  stateMachineId: string;
  
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

export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'template' | 'interactive';
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
  replyToMessageId?: string;
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
  replyToMessageId?: string;
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
  /** The message text (fallback if template fails or not on WhatsApp) */
  content: string;
  /** Optional WhatsApp template name */
  templateName?: string;
  /** Parameters for the template (e.g., [{{1}}, {{2}}]) */
  templateParams?: string[];
  /** Parameters for template buttons (e.g., dynamic URL suffixes) */
  templateButtonParams?: string[];
  /** Optional header image for the template */
  templateHeaderImage?: string;
  metadata?: Record<string, unknown>;
  delayMs?: number;
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
  sessionId: string;
  responses: BotResponse[];
  sessionUpdates?: Partial<Session>;
  contactUpdates?: Partial<Contact>;
  escalation?: EscalationResult;
  followupSchedule?: FollowupSchedule;
  transitionReason?: string;
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
  | 'complex_issue'
  | 'legal_regulatory'
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
  stateMachineStore?: StateMachineStore;
  messageBufferStore?: MessageBufferStore;
  escalationStore?: EscalationStore;
  followupStore?: FollowupStore;
  depositStore?: DepositStore;
  
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
  delete(id: string): Promise<void>;
}

export interface SessionStore {
  findByKey(key: SessionKey): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  create(key: SessionKey, contactId: string, stateMachineId: string): Promise<Session>;
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

export interface StateMachineStore {
  findByName(name: string, version?: string): Promise<Record<ConversationState, any> | null>;
  findActive(name: string): Promise<Record<ConversationState, any> | null>;
  
  // Get the ID of a state machine by name
  getStateMachineId(name: string): Promise<string | null>;
  
  // Fetch state entry message configuration from database
  getStateEntryMessages(
    stateMachineId: string,
    state: ConversationState
  ): Promise<StateEntryMessageConfig | null>;
}

export interface StateEntryMessageConfig {
  id: string;
  state: ConversationState;
  responses: BotResponse[];
  sessionUpdates?: Partial<Session>;
  description?: string;
}

export interface FollowupStore {
  /**
   * Schedule the next follow-up in the sequence for a state
   * @param sessionId The session ID
   * @param state The current state (to lookup its sequence config)
   * @param currentIndex The index of the last SENT follow-up in the sequence. 
   *                     Pass -1 to schedule the first one (index 0).
   */
  scheduleNext(
    sessionId: string,
    state: ConversationState,
    currentIndex: number
  ): Promise<void>;

  /**
   * Cancel all pending follow-ups for a session
   */
  cancelPending(sessionId: string): Promise<void>;
}

export interface EscalationStore {
  create(data: {
    sessionId: string;
    reason: EscalationReason;
    aiSummary?: string;
    aiConfidence?: number;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }): Promise<{ id: string }>;
}

export interface DepositStore {
  create(data: {
    sessionId: string;
    contactId: string;
    amount: number;
    currency?: string;
    aiReasoning?: string;
  }): Promise<{ id: string }>;
}

/**
 * Pending message in the buffer (waiting for debounce)
 */
export interface PendingMessage {
  id: string;
  sessionKeyHash: string;
  sessionKey: SessionKey;
  message: NormalizedMessage;
  receivedAt: Date;
  scheduledProcessAt: Date;
  retryCount?: number;
  lastError?: string;
  processingStartedAt?: Date;
}

/**
 * Message buffer store for debouncing
 * Implementations: Supabase (Edge Functions), In-Memory (tests/Node.js)
 */
export interface MessageBufferStore {
  /**
   * Add a message to the buffer
   * Should update scheduledProcessAt for all pending messages in this session
   */
  add(sessionKey: SessionKey, message: NormalizedMessage, debounceMs: number): Promise<void>;
  
  /**
   * Get all sessions that have matured (scheduledProcessAt <= now)
   * Returns sessionKeyHashes, excludes already-processing and max-retry messages
   */
  getMatureSessions(): Promise<string[]>;
  
  /**
   * Claim messages for processing (sets processingStartedAt lock)
   * Returns false if already claimed by another worker
   */
  claimSession(sessionKeyHash: string): Promise<boolean>;
  
  /**
   * Get all pending messages for a session, ordered by receivedAt
   */
  getBySession(sessionKeyHash: string): Promise<PendingMessage[]>;
  
  /**
   * Delete processed messages
   */
  deleteByIds(ids: string[]): Promise<void>;
  
  /**
   * Mark messages for retry (clears lock, increments retry count)
   */
  markForRetry(sessionKeyHash: string, error: string): Promise<void>;
  
  /**
   * Check if there are any pending messages (for self-invoke decision)
   */
  hasPendingMessages(): Promise<boolean>;
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

// LLM Types are now imported from ../llm/types.js

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
  
  // State machine configuration
  stateMachineName: string;
  
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
  
  // Knowledge Base settings (native File Search)
  knowledgeBase?: {
    storeIds: string[];
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
  
  // Debounce settings (optional)
  debounce?: {
    enabled: boolean;
    delayMs: number;  // Default: 3000
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
