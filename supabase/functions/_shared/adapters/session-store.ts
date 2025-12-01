/**
 * Supabase Session Store Adapter
 * 
 * Implements SessionStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Session, SessionStore, SessionKey, ConversationState } from '@parallelo/sales-engine';

interface SessionRow {
  id: string;
  contact_id: string;
  channel_type: string;
  channel_id: string;
  channel_user_id: string;
  current_state: string;
  previous_state: string | null;
  context: Record<string, unknown>;
  status: string;
  is_escalated: boolean;
  escalated_to: string | null;
  escalation_reason: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelType: row.channel_type as Session['channelType'],
    channelId: row.channel_id,
    channelUserId: row.channel_user_id,
    currentState: row.current_state as ConversationState,
    previousState: row.previous_state as ConversationState | undefined,
    context: row.context,
    status: row.status as Session['status'],
    isEscalated: row.is_escalated,
    escalatedTo: row.escalated_to ?? undefined,
    escalationReason: row.escalation_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
  };
}

export function createSupabaseSessionStore(
  supabase: SupabaseClient,
  schemaName: string
): SessionStore {
  const sessionsTable = `sessions`;
  
  return {
    async findByKey(key: SessionKey): Promise<Session | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(sessionsTable)
        .select('*')
        .eq('channel_type', key.channelType)
        .eq('channel_id', key.channelId)
        .eq('channel_user_id', key.channelUserId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async findById(id: string): Promise<Session | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(sessionsTable)
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async create(key: SessionKey, contactId: string): Promise<Session> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(sessionsTable)
        .insert({
          contact_id: contactId,
          channel_type: key.channelType,
          channel_id: key.channelId,
          channel_user_id: key.channelUserId,
          current_state: 'initial',
          context: {},
          status: 'active',
          is_escalated: false,
        })
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to create session: ${error?.message}`);
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async update(id: string, updates: Partial<Session>): Promise<Session> {
      const dbUpdates: Record<string, unknown> = {};
      
      if (updates.currentState !== undefined) dbUpdates.current_state = updates.currentState;
      if (updates.previousState !== undefined) dbUpdates.previous_state = updates.previousState;
      if (updates.context !== undefined) dbUpdates.context = updates.context;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.isEscalated !== undefined) dbUpdates.is_escalated = updates.isEscalated;
      if (updates.escalatedTo !== undefined) dbUpdates.escalated_to = updates.escalatedTo;
      if (updates.escalationReason !== undefined) dbUpdates.escalation_reason = updates.escalationReason;
      if (updates.lastMessageAt !== undefined) dbUpdates.last_message_at = updates.lastMessageAt.toISOString();
      
      const { data, error } = await supabase
        .schema(schemaName)
        .from(sessionsTable)
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to update session: ${error?.message}`);
      }
      
      return rowToSession(data as SessionRow);
    },
  };
}
