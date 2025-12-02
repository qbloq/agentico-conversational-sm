/**
 * Types for conversation example retrieval
 * 
 * Used for few-shot prompting - injecting relevant examples
 * into the LLM prompt to guide response style and approach.
 */

import type { ConversationState } from '../engine/types.js';

/**
 * A single message in a conversation example
 */
export interface ExampleMessage {
  role: 'customer' | 'agent';
  content: string;
  state: ConversationState;
}

/**
 * Category of conversation example
 */
export type ExampleCategory = 'happy_path' | 'deviation' | 'edge_case' | 'complex';

/**
 * Outcome of the conversation
 */
export type ExampleOutcome = 'success' | 'escalation' | 'dropout' | 'redirect';

/**
 * A conversation example with state annotations
 */
export interface ConversationExample {
  id: string;
  exampleId: string;
  scenario: string;
  category: ExampleCategory;
  outcome: ExampleOutcome;
  primaryState: ConversationState | null;
  stateFlow: ConversationState[];
  messages: ExampleMessage[];
  notes?: string;
  similarity?: number; // Set when retrieved via semantic search
}

/**
 * Options for retrieving examples
 */
export interface ExampleRetrievalOptions {
  /** Filter by primary state */
  state?: ConversationState;
  /** Filter by category */
  category?: ExampleCategory;
  /** Filter by outcome */
  outcome?: ExampleOutcome;
  /** Maximum number of examples to return */
  limit?: number;
  /** Embedding vector for semantic similarity search */
  embedding?: number[];
}

/**
 * Interface for conversation example storage
 * 
 * Implementations:
 * - SupabaseExampleStore: Production store using Supabase
 * - InMemoryExampleStore: For testing
 */
export interface ExampleStore {
  /**
   * Find examples by state
   */
  findByState(
    state: ConversationState,
    options?: { limit?: number; category?: ExampleCategory }
  ): Promise<ConversationExample[]>;

  /**
   * Find examples by semantic similarity
   * Requires embedding vector
   */
  findSimilar(
    embedding: number[],
    options?: { state?: ConversationState; limit?: number }
  ): Promise<ConversationExample[]>;

  /**
   * Find examples with flexible filtering
   */
  find(options: ExampleRetrievalOptions): Promise<ConversationExample[]>;

  /**
   * Get a specific example by ID
   */
  getById(exampleId: string): Promise<ConversationExample | null>;

  /**
   * Get all available states with example counts
   */
  getStateDistribution(): Promise<Record<ConversationState, number>>;
}
