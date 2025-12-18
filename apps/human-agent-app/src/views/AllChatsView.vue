<script setup lang="ts">
/**
 * AllChatsView - List all conversation sessions
 */
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';

const router = useRouter();
const sessions = useSessionsStore();

onMounted(() => {
  sessions.fetchSessions();
});

const getTimeSince = (date: string | null) => {
  if (!date) return '';
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

function openChat(sessionId: string) {
  router.push(`/chats/${sessionId}`);
}

function getStatusColor(session: { is_escalated: boolean; current_state: string }) {
  if (session.is_escalated) return 'bg-accent-500';
  if (session.current_state === 'completed') return 'bg-green-500';
  return 'bg-primary-500';
}

function getStatusLabel(session: { is_escalated: boolean; current_state: string }) {
  if (session.is_escalated) return 'Escalated';
  return session.current_state.replace(/_/g, ' ');
}
</script>

<template>
  <div class="h-full flex flex-col bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700 safe-top">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-white">All Conversations</h1>
          <p class="text-sm text-surface-400">
            {{ sessions.sessions.length }} total
          </p>
        </div>
        <button
          @click="sessions.fetchSessions()"
          :disabled="sessions.loading"
          class="p-2 text-surface-400 hover:text-white transition-colors"
        >
          <svg 
            :class="['w-5 h-5', sessions.loading && 'animate-spin']" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </header>

    <!-- List -->
    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="sessions.loading && !sessions.sessions.length" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <!-- Empty -->
      <div v-else-if="!sessions.sessions.length" class="flex flex-col items-center justify-center h-full text-surface-400">
        <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" 
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p>No conversations yet</p>
      </div>

      <!-- Session List -->
      <div v-else class="divide-y divide-surface-700">
        <button
          v-for="session in sessions.sortedSessions"
          :key="session.id"
          @click="openChat(session.id)"
          class="w-full p-4 text-left hover:bg-surface-800 transition-colors"
        >
          <div class="flex items-start gap-3">
            <!-- Avatar -->
            <div class="w-10 h-10 rounded-full bg-surface-700 flex items-center justify-center text-white font-medium flex-shrink-0">
              {{ session.contact?.full_name?.charAt(0) || session.channel_user_id?.charAt(0) || '?' }}
            </div>
            
            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1">
                <span class="font-medium text-white truncate">
                  {{ session.contact?.full_name || session.contact?.phone || session.channel_user_id || 'Unknown' }}
                </span>
                <span class="text-xs text-surface-500 flex-shrink-0 ml-2">
                  {{ getTimeSince(session.last_message_at) }}
                </span>
              </div>
              
              <div class="flex items-center gap-2 mb-1.5">
                <span 
                  :class="['w-2 h-2 rounded-full', getStatusColor(session)]"
                ></span>
                <span class="text-xs text-surface-400 capitalize">
                  {{ getStatusLabel(session) }}
                </span>
              </div>
              
              <p 
                v-if="session.last_message?.content" 
                class="text-sm text-surface-400 truncate"
              >
                <span v-if="session.last_message.direction === 'outbound'" class="text-surface-500">You: </span>
                {{ session.last_message.content }}
              </p>
            </div>

            <!-- Arrow -->
            <svg class="w-5 h-5 text-surface-500 mt-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
