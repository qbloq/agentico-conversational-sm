/**
 * Supabase Message Store Adapter
 * 
 * Implements MessageStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Message, MessageStore, ImageAnalysis } from '@parallelo/sales-engine';

interface MessageRow {
  id: string;
  session_id: string;
  direction: string;
  type: string;
  content: string | null;
  media_url: string | null;
  media_storage_path: string | null;
  transcription: string | null;
  image_analysis: ImageAnalysis | null;
  platform_message_id: string | null;
  delivery_status: string | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    direction: row.direction as Message['direction'],
    type: row.type as Message['type'],
    content: row.content ?? undefined,
    mediaUrl: row.media_url ?? undefined,
    mediaStoragePath: row.media_storage_path ?? undefined,
    transcription: row.transcription ?? undefined,
    imageAnalysis: row.image_analysis ?? undefined,
    platformMessageId: row.platform_message_id ?? undefined,
    deliveryStatus: row.delivery_status as Message['deliveryStatus'],
    createdAt: new Date(row.created_at),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
    readAt: row.read_at ? new Date(row.read_at) : undefined,
  };
}

export function createSupabaseMessageStore(
  supabase: SupabaseClient,
  schemaName: string
): MessageStore {
  const tableName = `messages`;
  
  return {
    async getRecent(sessionId: string, limit: number): Promise<Message[]> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(tableName)
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        throw new Error(`Failed to get messages: ${error.message}`);
      }
      
      // Return in chronological order (oldest first)
      return (data as MessageRow[]).reverse().map(rowToMessage);
    },
    
    async save(
      sessionId: string,
      message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>
    ): Promise<Message> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(tableName)
        .insert({
          session_id: sessionId,
          direction: message.direction,
          type: message.type,
          content: message.content,
          media_url: message.mediaUrl,
          media_storage_path: message.mediaStoragePath,
          transcription: message.transcription,
          image_analysis: message.imageAnalysis,
          platform_message_id: message.platformMessageId,
          delivery_status: message.deliveryStatus,
        })
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to save message: ${error?.message}`);
      }
      
      return rowToMessage(data as MessageRow);
    },
  };
}
