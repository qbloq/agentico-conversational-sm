/**
 * Supabase Followup Store Adapter
 * 
 * Implements FollowupStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { 
  FollowupStore, 
  ConversationState,
} from '@parallelo/sales-engine';
import { calculateScheduledTime } from '@parallelo/sales-engine';


export function createSupabaseFollowupStore(
  supabase: SupabaseClient,
  schemaName: string
): FollowupStore {
  const table = 'followup_queue';

  return {
    async scheduleNext(
      sessionId: string,
      state: ConversationState,
      currentIndex: number,
      followupSequence?: Array<{ interval: string; configName: string }>
    ): Promise<void> {
      if (!followupSequence) {
        console.log(`[Follow-up] No sequence provided for session ${sessionId} in state ${state}`);
        return;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= followupSequence.length) {
        console.log(`[Follow-up] Sequence complete for session ${sessionId} in state ${state}`);
        return;
      }

      const { interval, configName } = followupSequence[nextIndex];
      const scheduledAt = calculateScheduledTime(interval);

      console.log(`[Follow-up] Scheduling follow-up #${nextIndex} for session ${sessionId} in ${interval} (${scheduledAt.toISOString()})`);

      const { error } = await supabase
        .schema(schemaName)
        .from(table)
        .insert({
          session_id: sessionId,
          scheduled_at: scheduledAt.toISOString(),
          followup_type: 'short_term',
          followup_config_name: configName,
          sequence_index: nextIndex,
          status: 'pending'
        });

      if (error) {
        console.error(`[Follow-up] Failed to schedule follow-up:`, error);
        throw error;
      }
    },

    async cancelPending(sessionId: string): Promise<void> {
      console.log(`[Follow-up] Cancelling pending follow-ups for session ${sessionId}`);
      
      const { error } = await supabase
        .schema(schemaName)
        .from(table)
        .update({ status: 'cancelled' })
        .eq('session_id', sessionId)
        .eq('status', 'pending');

      if (error) {
        console.error(`[Follow-up] Failed to cancel follow-ups:`, error);
        // Don't throw here to avoid blocking inbound message processing
      }
    }
  };
}
