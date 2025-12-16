/**
 * Escalations Store - Escalation queue state with Realtime support
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  listEscalations,
  getEscalation,
  assignEscalation,
  resolveEscalation,
  sendMessage,
  type Escalation,
  type EscalationDetail,
  type Message,
} from '@/api/client';
import { supabase, CLIENT_SCHEMA } from '@/api/supabase';

export const useEscalationsStore = defineStore('escalations', () => {
  // State
  const escalations = ref<Escalation[]>([]);
  const currentEscalation = ref<EscalationDetail | null>(null);
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sending = ref(false);
  
  // Realtime
  let messageChannel: RealtimeChannel | null = null;
  const realtimeConnected = ref(false);

  // Computed
  const openCount = computed(() => 
    escalations.value.filter(e => e.status === 'open').length
  );

  const sortedEscalations = computed(() => {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...escalations.value].sort((a, b) => {
      // First by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // Then by date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  });

  // Actions
  async function fetchEscalations(): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await listEscalations();
      escalations.value = result.escalations;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load escalations';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function fetchEscalation(id: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await getEscalation(id);
      currentEscalation.value = result.escalation;
      messages.value = result.messages;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load escalation';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function assign(id: string): Promise<boolean> {
    try {
      await assignEscalation(id);
      // Update local state
      const esc = escalations.value.find(e => e.id === id);
      if (esc) {
        esc.status = 'assigned';
      }
      if (currentEscalation.value?.id === id) {
        currentEscalation.value.status = 'assigned';
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to assign';
      return false;
    }
  }

  async function resolve(id: string, notes?: string): Promise<boolean> {
    try {
      await resolveEscalation(id, notes);
      // Remove from list
      escalations.value = escalations.value.filter(e => e.id !== id);
      currentEscalation.value = null;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to resolve';
      return false;
    }
  }

  async function send(message: string): Promise<boolean> {
    if (!currentEscalation.value) return false;

    sending.value = true;
    error.value = null;

    try {
      const result = await sendMessage(currentEscalation.value.id, message);
      
      // Add to local messages (optimistic update)
      messages.value.push({
        id: result.messageId,
        session_id: currentEscalation.value.session.id,
        direction: 'outbound',
        type: 'text',
        content: message,
        created_at: new Date().toISOString(),
        sent_by_agent_id: 'current-agent',
      });

      // Update status
      if (currentEscalation.value.status === 'assigned') {
        currentEscalation.value.status = 'in_progress';
      }

      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to send';
      return false;
    } finally {
      sending.value = false;
    }
  }

  /**
   * Subscribe to Realtime updates for messages in the current session
   */
  function subscribeToMessages(sessionId: string) {
    // Unsubscribe from previous channel if any
    unsubscribeFromMessages();
    
    console.log(`[Realtime] Subscribing to messages for session: ${sessionId}`);
    
    messageChannel = supabase
      .channel(`messages:${sessionId}`)
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
          
          // Skip outbound messages - we add those optimistically in send()
          if (newMsg.direction === 'outbound') {
            console.log(`[Realtime] Skipping outbound message (handled optimistically)`);
            return;
          }
          
          // Avoid duplicates
          const exists = messages.value.some(m => m.id === newMsg.id);
          if (!exists) {
            console.log(`[Realtime] New inbound message:`, newMsg.content?.slice(0, 50));
            messages.value.push({
              id: newMsg.id,
              session_id: newMsg.session_id,
              direction: newMsg.direction,
              type: newMsg.type,
              content: newMsg.content,
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

  /**
   * Unsubscribe from Realtime message updates
   */
  function unsubscribeFromMessages() {
    if (messageChannel) {
      console.log('[Realtime] Unsubscribing from messages');
      supabase.removeChannel(messageChannel);
      messageChannel = null;
      realtimeConnected.value = false;
    }
  }

  function clearCurrent() {
    unsubscribeFromMessages();
    currentEscalation.value = null;
    messages.value = [];
  }

  return {
    // State
    escalations,
    currentEscalation,
    messages,
    loading,
    error,
    sending,
    realtimeConnected,
    // Computed
    openCount,
    sortedEscalations,
    // Actions
    fetchEscalations,
    fetchEscalation,
    assign,
    resolve,
    send,
    clearCurrent,
    subscribeToMessages,
    unsubscribeFromMessages,
  };
});

