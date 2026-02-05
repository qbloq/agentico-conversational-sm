/**
 * Supabase Deposit Store Adapter
 * 
 * Implements DepositStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { DepositStore } from '@parallelo/sales-engine';

export function createSupabaseDepositStore(
  supabase: SupabaseClient,
  schemaName: string
): DepositStore {
  return {
    async create(data: {
      sessionId: string;
      contactId: string;
      amount: number;
      currency?: string;
      aiReasoning?: string;
    }): Promise<{ id: string }> {
      const { data: event, error } = await supabase
        .schema(schemaName)
        .from('deposit_events')
        .insert({
          session_id: data.sessionId,
          contact_id: data.contactId,
          amount: data.amount,
          currency: data.currency || 'USD',
          ai_reasoning: data.aiReasoning || null,
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(`Failed to record deposit event: ${error.message}`);
      }

      if (!event) {
        throw new Error(`Failed to record deposit event: No data returned`);
      }

      return { id: event.id };
    },
  };
}
