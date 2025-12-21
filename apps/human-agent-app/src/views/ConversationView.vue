<script setup lang="ts">
/**
 * ConversationView - Chat view for any session (not just escalations)
 */
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';

const route = useRoute();
const router = useRouter();
const sessions = useSessionsStore();

const messagesContainer = ref<HTMLElement | null>(null);

const sessionId = computed(() => route.params.sessionId as string);

onMounted(async () => {
  await sessions.fetchSession(sessionId.value);
  scrollToBottom();
  
  // Subscribe to Realtime for new messages
  if (sessions.currentSession?.id) {
    sessions.subscribeToMessages(sessions.currentSession.id);
  }
});

onUnmounted(() => {
  sessions.unsubscribeFromMessages();
});

// Auto-scroll when new messages arrive
watch(
  () => sessions.messages.length,
  () => {
    scrollToBottom();
  }
);

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function goBack() {
  sessions.clearCurrent();
  router.push('/chats');
}

async function handleTakeOver() {
  if (!sessions.currentSession) return;
  
  const escalationId = await sessions.escalateSession(sessions.currentSession.id);
  if (escalationId) {
    router.push(`/chat/${escalationId}`);
  }
}

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isHumanMessage = (msg: { sent_by_agent_id?: string | null }) => {
  return !!msg.sent_by_agent_id;
};

const getStateLabel = (state: string) => {
  return state.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};
</script>

<template>
  <div class="h-full flex flex-col bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700 safe-top">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1 -ml-1 text-surface-400 hover:text-white">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div class="flex-1 min-w-0" v-if="sessions.currentSession">
          <div class="flex items-center gap-2">
            <h1 class="font-semibold text-white truncate">
              {{ sessions.currentSession.contact?.full_name || 'Customer' }}
            </h1>
            <span 
              v-if="sessions.currentSession.is_escalated"
              class="text-xs px-2 py-0.5 bg-accent-600/20 text-accent-400 rounded-full"
            >
              Escalated
            </span>
          </div>
          <p class="text-sm text-surface-400 truncate flex items-center gap-2">
            <span>{{ sessions.currentSession.contact?.phone }}</span>
            <span class="text-surface-600">•</span>
            <span class="capitalize">{{ getStateLabel(sessions.currentSession.current_state) }}</span>
          </p>
        </div>

        <button
          v-if="sessions.currentSession && !sessions.currentSession.is_escalated"
          @click="handleTakeOver"
          :disabled="sessions.loading"
          class="px-3 py-1.5 bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {{ sessions.loading ? '...' : 'Take Over' }}
        </button>
      </div>
    </header>

    <!-- Messages -->
    <div 
      ref="messagesContainer"
      class="flex-1 overflow-y-auto p-4 space-y-3"
    >
      <div v-if="sessions.loading" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <template v-else>
        <!-- State info card -->
        <div 
          v-if="sessions.currentSession"
          class="mb-4 p-3 bg-surface-800 border border-surface-700 rounded-xl text-sm"
        >
          <div class="flex items-center gap-2 text-surface-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Conversation started {{ new Date(sessions.currentSession.created_at).toLocaleDateString() }}</span>
          </div>
        </div>

        <div
          v-for="msg in sessions.messages"
          :key="msg.id"
          :class="[
            'max-w-[85%] rounded-2xl px-4 py-2',
            msg.direction === 'inbound' 
              ? 'bg-surface-700 mr-auto rounded-bl-md' 
              : isHumanMessage(msg)
                ? 'bg-accent-600 ml-auto rounded-br-md'
                : 'bg-primary-600 ml-auto rounded-br-md'
          ]"
        >
          <p class="text-white whitespace-pre-wrap break-words">{{ msg.content }}</p>
          <div class="flex items-center justify-end gap-1 mt-1">
            <span v-if="isHumanMessage(msg)" class="text-xs text-white/60">Agent</span>
            <span v-else-if="msg.direction === 'outbound'" class="text-xs text-white/60">AI</span>
            <span class="text-xs text-white/50">{{ formatTime(msg.created_at) }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Read-only notice (no compose for non-escalated) -->
    <div class="flex-shrink-0 p-4 bg-surface-800 border-t border-surface-700 safe-bottom">
      <div class="flex items-center justify-center gap-2 text-surface-400 py-2">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span class="text-sm">View only • Use Escalations to respond</span>
      </div>
    </div>
  </div>
</template>
