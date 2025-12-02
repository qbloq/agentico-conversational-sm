/**
 * Conversation Examples Module
 * 
 * Provides access to sample conversations for few-shot prompting.
 * Examples are annotated with per-message state tags to enable
 * state-aware retrieval.
 */

// Types
export type {
  ExampleMessage,
  ExampleCategory,
  ExampleOutcome,
  ConversationExample,
  ExampleRetrievalOptions,
  ExampleStore,
} from './types.js';

// Store implementations
export {
  SupabaseExampleStore,
  InMemoryExampleStore,
} from './store.js';
export type { SupabaseClient } from './store.js';

// Formatting utilities
export {
  formatExample,
  formatExamples,
  extractAgentResponses,
  summarizeExample,
} from './formatter.js';
export type { FormatOptions, FormattableExample } from './formatter.js';
