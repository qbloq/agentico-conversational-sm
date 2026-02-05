/**
 * Supabase Message Buffer Store Adapter
 * 
 * Implements MessageBufferStore interface for debouncing.
 * Uses pending_messages table with concurrency control.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { 
  MessageBufferStore, 
  SessionKey, 
  NormalizedMessage, 
  PendingMessage,
  ChannelType
} from '@parallelo/sales-engine';

const MAX_RETRIES = 3;

interface PendingMessageRow {
  id: string;
  session_key_hash: string;
  channel_type: string;
  channel_id: string;
  channel_user_id: string;
  message_content: string | null;
  message_type: string;
  media_url: string | null;
  transcription: string | null;
  platform_message_id: string | null;
  received_at: string;
  scheduled_process_at: string;
  processing_started_at: string | null;
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

function rowToPendingMessage(row: PendingMessageRow): PendingMessage {
  return {
    id: row.id,
    sessionKeyHash: row.session_key_hash,
    sessionKey: {
      channelType: row.channel_type as ChannelType,
      channelId: row.channel_id,
      channelUserId: row.channel_user_id,
    },
    message: {
      id: row.platform_message_id || row.id,
      type: row.message_type as NormalizedMessage['type'],
      content: row.message_content || undefined,
      mediaUrl: row.media_url || undefined,
      transcription: row.transcription || undefined,
      timestamp: new Date(row.received_at),
    },
    receivedAt: new Date(row.received_at),
    scheduledProcessAt: new Date(row.scheduled_process_at),
    retryCount: row.retry_count,
    lastError: row.last_error || undefined,
    processingStartedAt: row.processing_started_at ? new Date(row.processing_started_at) : undefined,
  };
}

/**
 * Hash a session key for use as a unique identifier
 * Uses simple djb2 hash for Deno compatibility
 */
function hashSessionKey(key: SessionKey): string {
  const str = `${key.channelType}:${key.channelId}:${key.channelUserId}`;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function createSupabaseMessageBufferStore(
  supabase: SupabaseClient,
  schemaName: string,
  channelId?: string
): MessageBufferStore {
  const table = () => supabase.schema(schemaName).from('pending_messages');
  
  return {
    async add(sessionKey: SessionKey, message: NormalizedMessage, debounceMs: number): Promise<void> {
      const sessionKeyHash = hashSessionKey(sessionKey);
      const scheduledProcessAt = new Date(Date.now() + debounceMs);
      
      // Insert new message
      const { error: insertError } = await table().insert({
        session_key_hash: sessionKeyHash,
        channel_type: sessionKey.channelType,
        channel_id: sessionKey.channelId,
        channel_user_id: sessionKey.channelUserId,
        message_content: message.content || null,
        message_type: message.type,
        media_url: message.mediaUrl || null,
        transcription: message.transcription || null,
        platform_message_id: message.id,
        scheduled_process_at: scheduledProcessAt.toISOString(),
      });
      
      if (insertError) {
        throw new Error(`Failed to buffer message: ${insertError.message}`);
      }
      
      // Update all pending messages for this session to use the new schedule time
      // This effectively "resets the debounce timer"
      const { error: updateError } = await table()
        .update({ scheduled_process_at: scheduledProcessAt.toISOString() })
        .eq('session_key_hash', sessionKeyHash)
        .is('processing_started_at', null); // Only update non-processing messages
      
      if (updateError) {
        console.warn(`[MessageBuffer] Failed to update schedule times: ${updateError.message}`);
      }
    },
    
    async getMatureSessions(): Promise<string[]> {
      let query = table()
        .select('session_key_hash')
        .lte('scheduled_process_at', new Date().toISOString())
        .is('processing_started_at', null) // Not already being processed
        .lt('retry_count', MAX_RETRIES);    // Not exceeded max retries
      
      // Filter by channel_id if provided (for multi-tenancy)
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      
      const { data, error } = await query.order('scheduled_process_at');
      
      if (error) {
        console.error(`[MessageBuffer] Failed to get mature sessions: ${error.message}`);
        return [];
      }
      
      // Deduplicate session hashes
      const hashes = (data || []).map((d: { session_key_hash: string }) => d.session_key_hash);
      return [...new Set(hashes)];
    },
    
    async claimSession(sessionKeyHash: string): Promise<boolean> {
      // Try to claim by setting processing_started_at
      // Only succeeds if not already claimed
      let query = table()
        .update({ processing_started_at: new Date().toISOString() })
        .eq('session_key_hash', sessionKeyHash)
        .is('processing_started_at', null);
      
      // Filter by channel_id if provided (for multi-tenancy)
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      
      const { data, error } = await query.select('id');
      
      if (error) {
        console.error(`[MessageBuffer] Failed to claim session: ${error.message}`);
        return false;
      }
      
      // If no rows updated, someone else claimed it
      return (data?.length || 0) > 0;
    },
    
    async getBySession(sessionKeyHash: string): Promise<PendingMessage[]> {
      let query = table()
        .select('*')
        .eq('session_key_hash', sessionKeyHash);
      
      // Filter by channel_id if provided (for multi-tenancy)
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      
      const { data, error } = await query.order('received_at', { ascending: true });
      
      if (error) {
        console.error(`[MessageBuffer] Failed to get messages: ${error.message}`);
        return [];
      }
      
      return (data || []).map((row: PendingMessageRow) => rowToPendingMessage(row));
    },
    
    async deleteByIds(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      
      const { error } = await table().delete().in('id', ids);
      
      if (error) {
        console.error(`[MessageBuffer] Failed to delete messages: ${error.message}`);
      }
    },
    
    async markForRetry(sessionKeyHash: string, errorMessage: string): Promise<void> {
      // Clear the processing lock, increment retry count, store error
      let query = table()
        .update({ 
          processing_started_at: null,
          retry_count: supabase.rpc('increment_retry_count'), // If RPC exists
          last_error: errorMessage,
        })
        .eq('session_key_hash', sessionKeyHash);
      
      // Filter by channel_id if provided (for multi-tenancy)
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      
      const { error } = await query;
      
      // Fallback if RPC doesn't exist: manual increment
      if (error) {
        // Get current retry count and increment manually
        let selectQuery = table()
          .select('id, retry_count')
          .eq('session_key_hash', sessionKeyHash)
          .limit(1);
        
        if (channelId) {
          selectQuery = selectQuery.eq('channel_id', channelId);
        }
        
        const { data } = await selectQuery.single();
        
        if (data) {
          let updateQuery = table()
            .update({ 
              processing_started_at: null,
              retry_count: (data.retry_count || 0) + 1,
              last_error: errorMessage,
            })
            .eq('session_key_hash', sessionKeyHash);
          
          if (channelId) {
            updateQuery = updateQuery.eq('channel_id', channelId);
          }
          
          await updateQuery;
        }
      }
    },
    
    async hasPendingMessages(): Promise<boolean> {
      let query = table()
        .select('*', { count: 'exact', head: true })
        .lt('retry_count', MAX_RETRIES);
      
      // Filter by channel_id if provided (for multi-tenancy)
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      
      const { count, error } = await query;
      
      if (error) {
        console.error(`[MessageBuffer] Failed to check pending: ${error.message}`);
        return false;
      }
      
      return (count || 0) > 0;
    },
  };
}
