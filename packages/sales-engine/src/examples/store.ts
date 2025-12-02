/**
 * Example Store implementations
 * 
 * Provides access to conversation examples for few-shot prompting.
 */

import type { ConversationState } from '../engine/types.js';
import type {
  ExampleStore,
  ConversationExample,
  ExampleRetrievalOptions,
  ExampleCategory,
} from './types.js';

/**
 * Database row shape from Supabase
 */
interface ExampleRow {
  id: string;
  example_id: string;
  scenario: string;
  category: string;
  outcome: string;
  primary_state: string | null;
  state_flow: string[] | null;
  messages: Array<{ role: string; content: string; state?: string }>;
  notes: string | null;
  similarity?: number;
}

/**
 * Transform database row to domain object
 */
function rowToExample(row: ExampleRow): ConversationExample {
  return {
    id: row.id,
    exampleId: row.example_id,
    scenario: row.scenario,
    category: row.category as ExampleCategory,
    outcome: row.outcome as ConversationExample['outcome'],
    primaryState: row.primary_state as ConversationState | null,
    stateFlow: (row.state_flow || []) as ConversationState[],
    messages: row.messages.map(m => ({
      role: m.role as 'customer' | 'agent',
      content: m.content,
      state: (m.state || 'initial') as ConversationState,
    })),
    notes: row.notes || undefined,
    similarity: row.similarity,
  };
}

/**
 * Supabase client interface (minimal subset we need)
 */
export interface SupabaseClient {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: unknown): any;
      is(column: string, value: null): any;
      not(column: string, operator: string, value: unknown): any;
      order(column: string, options?: { ascending?: boolean }): any;
      limit(count: number): any;
    };
    rpc(fn: string, params: Record<string, unknown>): Promise<{ data: any; error: any }>;
  };
  rpc(fn: string, params: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

/**
 * Supabase-backed example store
 */
export class SupabaseExampleStore implements ExampleStore {
  constructor(private supabase: SupabaseClient) {}

  async findByState(
    state: ConversationState,
    options: { limit?: number; category?: ExampleCategory } = {}
  ): Promise<ConversationExample[]> {
    const { limit = 5, category } = options;

    let query = this.supabase
      .from('conversation_examples')
      .select('id, example_id, scenario, category, outcome, primary_state, state_flow, messages, notes')
      .eq('primary_state', state)
      .eq('is_active', true);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.error('Error fetching examples by state:', error);
      return [];
    }

    return (data || []).map(rowToExample);
  }

  async findSimilar(
    embedding: number[],
    options: { state?: ConversationState; limit?: number } = {}
  ): Promise<ConversationExample[]> {
    const { state, limit = 5 } = options;

    // Use the RPC function we created in the migration
    const { data, error } = await this.supabase.rpc('search_conversation_examples', {
      p_state: state || null,
      p_category: null,
      p_embedding: embedding,
      p_limit: limit,
    });

    if (error) {
      console.error('Error fetching similar examples:', error);
      return [];
    }

    return (data || []).map(rowToExample);
  }

  async find(options: ExampleRetrievalOptions): Promise<ConversationExample[]> {
    const { state, category, outcome, limit = 5, embedding } = options;

    // If embedding provided, use semantic search
    if (embedding) {
      return this.findSimilar(embedding, { state, limit });
    }

    // Otherwise, use filter-based query
    let query = this.supabase
      .from('conversation_examples')
      .select('id, example_id, scenario, category, outcome, primary_state, state_flow, messages, notes')
      .eq('is_active', true);

    if (state) {
      query = query.eq('primary_state', state);
    }
    if (category) {
      query = query.eq('category', category);
    }
    if (outcome) {
      query = query.eq('outcome', outcome);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.error('Error fetching examples:', error);
      return [];
    }

    return (data || []).map(rowToExample);
  }

  async getById(exampleId: string): Promise<ConversationExample | null> {
    const { data, error } = await this.supabase
      .from('conversation_examples')
      .select('id, example_id, scenario, category, outcome, primary_state, state_flow, messages, notes')
      .eq('example_id', exampleId)
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    return rowToExample(data[0]);
  }

  async getStateDistribution(): Promise<Record<ConversationState, number>> {
    const { data, error } = await this.supabase
      .from('conversation_examples')
      .select('primary_state')
      .eq('is_active', true)
      .not('primary_state', 'is', null);

    if (error || !data) {
      return {} as Record<ConversationState, number>;
    }

    return data.reduce((acc: Record<ConversationState, number>, row: { primary_state: string }) => {
      const state = row.primary_state as ConversationState;
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {} as Record<ConversationState, number>);
  }
}

/**
 * In-memory example store for testing
 */
export class InMemoryExampleStore implements ExampleStore {
  private examples: ConversationExample[] = [];

  constructor(examples: ConversationExample[] = []) {
    this.examples = examples;
  }

  addExample(example: ConversationExample): void {
    this.examples.push(example);
  }

  async findByState(
    state: ConversationState,
    options: { limit?: number; category?: ExampleCategory } = {}
  ): Promise<ConversationExample[]> {
    const { limit = 5, category } = options;

    let filtered = this.examples.filter(e => e.primaryState === state);

    if (category) {
      filtered = filtered.filter(e => e.category === category);
    }

    return filtered.slice(0, limit);
  }

  async findSimilar(
    _embedding: number[],
    options: { state?: ConversationState; limit?: number } = {}
  ): Promise<ConversationExample[]> {
    // In-memory store doesn't support semantic search
    // Fall back to state-based filtering
    const { state, limit = 5 } = options;

    if (state) {
      return this.findByState(state, { limit });
    }

    return this.examples.slice(0, limit);
  }

  async find(options: ExampleRetrievalOptions): Promise<ConversationExample[]> {
    const { state, category, outcome, limit = 5 } = options;

    let filtered = [...this.examples];

    if (state) {
      filtered = filtered.filter(e => e.primaryState === state);
    }
    if (category) {
      filtered = filtered.filter(e => e.category === category);
    }
    if (outcome) {
      filtered = filtered.filter(e => e.outcome === outcome);
    }

    return filtered.slice(0, limit);
  }

  async getById(exampleId: string): Promise<ConversationExample | null> {
    return this.examples.find(e => e.exampleId === exampleId) || null;
  }

  async getStateDistribution(): Promise<Record<ConversationState, number>> {
    return this.examples.reduce((acc, e) => {
      if (e.primaryState) {
        acc[e.primaryState] = (acc[e.primaryState] || 0) + 1;
      }
      return acc;
    }, {} as Record<ConversationState, number>);
  }
}
