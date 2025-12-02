/**
 * Supabase Example Store Adapter
 * 
 * Provides access to conversation examples for few-shot prompting.
 * Examples are stored in the public schema (shared across clients).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Minimal types to avoid importing from bundle
interface ConversationExample {
  id: string;
  exampleId: string;
  scenario: string;
  category: string;
  outcome: string;
  primaryState: string | null;
  stateFlow: string[];
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
    state: string;
  }>;
  notes?: string;
  similarity?: number;
}

interface ExampleStore {
  findByState(
    state: string,
    options?: { limit?: number; category?: string }
  ): Promise<ConversationExample[]>;
  findSimilar(
    embedding: number[],
    options?: { state?: string; limit?: number }
  ): Promise<ConversationExample[]>;
}

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

function rowToExample(row: ExampleRow): ConversationExample {
  return {
    id: row.id,
    exampleId: row.example_id,
    scenario: row.scenario,
    category: row.category,
    outcome: row.outcome,
    primaryState: row.primary_state,
    stateFlow: (row.state_flow || []),
    messages: row.messages.map(m => ({
      role: m.role as 'customer' | 'agent',
      content: m.content,
      state: m.state || 'initial',
    })),
    notes: row.notes || undefined,
    similarity: row.similarity,
  };
}

export function createSupabaseExampleStore(
  supabase: SupabaseClient
): ExampleStore {
  return {
    async findByState(
      state: string,
      options: { limit?: number; category?: string } = {}
    ): Promise<ConversationExample[]> {
      const { limit = 5, category } = options;

      let query = supabase
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
    },

    async findSimilar(
      embedding: number[],
      options: { state?: string; limit?: number } = {}
    ): Promise<ConversationExample[]> {
      const { state, limit = 5 } = options;

      // Use the RPC function from the migration
      const { data, error } = await supabase.rpc('search_conversation_examples', {
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
    },
  };
}
