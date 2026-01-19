/**
 * Supabase Followup Store Adapter
 * 
 * Implements FollowupStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { 
  FollowupStore, 
  ConversationState 
} from '@parallelo/sales-engine';
import { STATE_CONFIGS } from '@parallelo/sales-engine';

/**
 * Parses interval string (e.g., '15m', '2h', '1d', '1w') into minutes
 */
function parseIntervalToMinutes(interval: string): number {
  const val = parseInt(interval);
  const unit = interval.toLowerCase().replace(/[0-9]/g, '');

  switch (unit) {
    case 'm': return val;
    case 'h': return val * 60;
    case 'd': return val * 60 * 24;
    case 'w': return val * 60 * 24 * 7;
    default: return 0;
  }
}

export function createSupabaseFollowupStore(
  supabase: SupabaseClient,
  schemaName: string
): FollowupStore {
  const table = 'followup_queue';

  return {
    async scheduleNext(
      sessionId: string,
      state: ConversationState,
      currentIndex: number
    ): Promise<void> {
      const config = STATE_CONFIGS[state];
      if (!config || !config.followupSequence) {
        console.log(`[Follow-up] No sequence configured for state ${state}`);
        return;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= config.followupSequence.length) {
        console.log(`[Follow-up] Sequence complete for session ${sessionId} in state ${state}`);
        return;
      }

      const interval = config.followupSequence[nextIndex];
      const minutes = parseIntervalToMinutes(interval);
      
      if (minutes <= 0) {
        console.warn(`[Follow-up] Invalid interval '${interval}' for state ${state}`);
        return;
      }

      const scheduledAt = new Date();
      scheduledAt.setMinutes(scheduledAt.getMinutes() + minutes);

      console.log(`[Follow-up] Scheduling follow-up #${nextIndex} for session ${sessionId} in ${interval} (${scheduledAt.toISOString()})`);

      const { error } = await supabase
        .schema(schemaName)
        .from(table)
        .insert({
          session_id: sessionId,
          scheduled_at: scheduledAt.toISOString(),
          followup_type: 'short_term',
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
