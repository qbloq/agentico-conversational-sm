/**
 * Sessions Store - All conversations state management
 * 
 * Uses the manage-escalations Edge Function API for data access.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, CLIENT_SCHEMA } from '@/api/supabase';
import {
  listSessions as apiListSessions,
  getSession as apiGetSession,
  escalateSession as apiEscalateSession,
  type SessionSummary,
  type SessionDetail,
  type Message,
} from '@/api/client';

export type { SessionSummary, SessionDetail };

export const useSessionsStore = defineStore('sessions', () => {
  // State
  const sessions = ref<SessionSummary[]>([]);
  const currentSession = ref<SessionDetail | null>(null);
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sending = ref(false);
  
  // Realtime
  let messageChannel: RealtimeChannel | null = null;
  const realtimeConnected = ref(false);

  // Computed
  const sortedSessions = computed(() => {
    return [...sessions.value].sort((a, b) => {
      // Sort by last message time (most recent first)
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
  });

  const activeSessions = computed(() => 
    sessions.value.filter(s => !s.is_escalated)
  );

  // Actions
  async function fetchSessions(): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiListSessions();
      sessions.value = result.sessions;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sessions';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function fetchSession(id: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiGetSession(id);
      currentSession.value = result.session;
      messages.value = result.messages;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function escalateSession(id: string): Promise<string | null> {
    loading.value = true;
    error.value = null;

    try {
      const result = await apiEscalateSession(id);
      if (result.success) {
        return result.escalationId;
      }
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to escalate session';
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Subscribe to Realtime updates for messages in the current session
   */
  function subscribeToMessages(sessionId: string) {
    unsubscribeFromMessages();
    
    console.log(`[Realtime] Subscribing to session messages: ${sessionId}`);
    
    messageChannel = supabase
      .channel(`session-messages:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: CLIENT_SCHEMA,
          table: 'messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          
          // Skip outbound messages (we add those optimistically)
          if (newMsg.direction === 'outbound' && newMsg.sent_by_agent_id) {
            return;
          }
          
          // Avoid duplicates
          const exists = messages.value.some(m => m.id === newMsg.id);
          if (!exists) {
            console.log(`[Realtime] New message:`, newMsg.content?.slice(0, 50));
            messages.value.push({
              id: newMsg.id,
              session_id: newMsg.session_id,
              direction: newMsg.direction,
              type: newMsg.type,
              content: newMsg.content,
              media_url: newMsg.media_url,
              created_at: newMsg.created_at,
              sent_by_agent_id: newMsg.sent_by_agent_id,
            });
          }
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Subscription status: ${status}`);
        realtimeConnected.value = status === 'SUBSCRIBED';
      });
  }

  function unsubscribeFromMessages() {
    if (messageChannel) {
      console.log('[Realtime] Unsubscribing from session messages');
      supabase.removeChannel(messageChannel);
      messageChannel = null;
      realtimeConnected.value = false;
    }
  }

  function clearCurrent() {
    unsubscribeFromMessages();
    currentSession.value = null;
    messages.value = [];
  }

  return {
    // State
    sessions,
    currentSession,
    messages,
    loading,
    error,
    sending,
    realtimeConnected,
    // Computed
    sortedSessions,
    activeSessions,
    // Actions
    fetchSessions,
    fetchSession,
    escalateSession,
    clearCurrent,
    subscribeToMessages,
    unsubscribeFromMessages,
  };
});
