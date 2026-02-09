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
    },

    async claim(followupId: string): Promise<boolean> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .update({ processing_started_at: new Date().toISOString() })
        .eq('id', followupId)
        .eq('status', 'pending')
        .is('processing_started_at', null)
        .select('id');

      if (error) {
        console.error(`[Follow-up] Failed to claim item ${followupId}:`, error);
        return false;
      }

      return (data?.length || 0) > 0;
    },

    async markFailed(followupId: string, error: string): Promise<void> {
      // In a real scenario, we might want to use an RPC for atomic increment,
      // but for now we'll do a simple update or just set it to failed if we don't have retry_count yet
      await supabase
        .schema(schemaName)
        .from(table)
        .update({
          status: 'failed',
          last_error: error,
          processing_started_at: null,
          // Note: we'll handle retry increment in the worker logic if needed,
          // or just mark as failed and let the worker decide based on retry_count
        })
        .eq('id', followupId);
    },

    async cleanupStaleLocks(): Promise<number> {
      const threshold = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes
      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .update({ processing_started_at: null })
        .not('processing_started_at', 'is', null)
        .lt('processing_started_at', threshold)
        .select('id');

      if (error) {
        console.error(`[Follow-up] Failed to cleanup stale locks:`, error);
        return 0;
      }

      return data?.length || 0;
    }
  };
}
