/**
 * Supabase Escalation Store Adapter
 * 
 * Implements EscalationStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { EscalationStore, EscalationReason } from '@parallelo/sales-engine';

export function createSupabaseEscalationStore(
  supabase: SupabaseClient,
  schemaName: string
): EscalationStore {
  return {
    async create(data: {
      sessionId: string;
      reason: EscalationReason;
      aiSummary?: string;
      aiConfidence?: number;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
    }): Promise<{ id: string }> {
      const { data: escalation, error } = await supabase
        .schema(schemaName)
        .from('escalations')
        .insert({
          session_id: data.sessionId,
          reason: data.reason,
          ai_summary: data.aiSummary || null,
          ai_confidence: data.aiConfidence || null,
          priority: data.priority || 'medium',
          status: 'open',
        })
        .select('id')
        .single();

      if (error || !escalation) {
        throw new Error(`Failed to create escalation: ${error?.message}`);
      }

      return { id: escalation.id };
    },
  };
}
