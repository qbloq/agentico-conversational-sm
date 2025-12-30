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
      // 1. Proactive check for existing active escalation
      const { data: existingActive } = await supabase
        .schema(schemaName)
        .from('escalations')
        .select('id')
        .eq('session_id', data.sessionId)
        .in('status', ['open', 'assigned', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (existingActive) {
        return { id: existingActive.id };
      }

      // 2. Attempt to create new escalation
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

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error(`Session already has an active escalation`);
        }
        throw new Error(`Failed to create escalation: ${error.message}`);
      }

      if (!escalation) {
        throw new Error(`Failed to create escalation: No data returned`);
      }

      return { id: escalation.id };
    },
  };
}
