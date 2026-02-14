/**
 * Sessions Store - All conversations state management
 * 
 * Uses the manage-escalations Edge Function API for data access.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import {
  listSessions as apiListSessions,
  getSession as apiGetSession,
  escalateSession as apiEscalateSession,
  type SessionSummary,
  type SessionDetail,
  type Message,
} from '@/api/client';
import { useAuthStore } from './auth';

export type { SessionSummary, SessionDetail };

const PAGE_SIZE = 20;

export const useSessionsStore = defineStore('sessions', () => {
  // State
  const sessions = ref<SessionSummary[]>([]);
  const currentSession = ref<SessionDetail | null>(null);
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const hasMore = ref(false);
  const searchQuery = ref('');
  const error = ref<string | null>(null);
  const sending = ref(false);
  
  // Realtime
  let messageChannel: RealtimeChannel | null = null;
  const realtimeConnected = ref(false);

  // Computed
  const sortedSessions = computed(() => {
    return [...sessions.value].sort((a, b) => {
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
  });

  const activeSessions = computed(() => 
    sessions.value.filter(s => !s.is_escalated)
  );

  // Actions

  /**
   * Fetch first page of sessions (resets list).
   */
  async function fetchSessions(): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const auth = useAuthStore();
      const result = await apiListSessions({
        clientId: auth.activeClientId,
        limit: PAGE_SIZE,
        search: searchQuery.value || null,
      });
      sessions.value = result.sessions;
      hasMore.value = result.hasMore;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sessions';
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch next page and append to existing list.
   */
  async function fetchMoreSessions(): Promise<boolean> {
    if (loadingMore.value || !hasMore.value) return false;

    const lastSession = sortedSessions.value[sortedSessions.value.length - 1];
    if (!lastSession?.last_message_at) return false;

    loadingMore.value = true;

    try {
      const auth = useAuthStore();
      const result = await apiListSessions({
        clientId: auth.activeClientId,
        cursor: lastSession.last_message_at,
        limit: PAGE_SIZE,
        search: searchQuery.value || null,
      });
      sessions.value = [...sessions.value, ...result.sessions];
      hasMore.value = result.hasMore;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load more sessions';
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  /**
   * Update search query and re-fetch from first page.
   */
  function setSearchQuery(query: string) {
    searchQuery.value = query;
    fetchSessions();
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
          schema: useAuthStore().clientSchema,
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
    loadingMore,
    hasMore,
    searchQuery,
    error,
    sending,
    realtimeConnected,
    // Computed
    sortedSessions,
    activeSessions,
    // Actions
    fetchSessions,
    fetchMoreSessions,
    setSearchQuery,
    fetchSession,
    escalateSession,
    clearCurrent,
    subscribeToMessages,
    unsubscribeFromMessages,
  };
});
