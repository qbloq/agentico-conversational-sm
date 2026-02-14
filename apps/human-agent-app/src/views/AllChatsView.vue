<script setup lang="ts">
/**
 * AllChatsView - List all conversation sessions
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';

const router = useRouter();
const sessions = useSessionsStore();

const searchInput = ref(sessions.searchQuery);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  searchInput.value = value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    sessions.setSearchQuery(value);
  }, 300);
}

function clearSearch() {
  searchInput.value = '';
  if (debounceTimer) clearTimeout(debounceTimer);
  sessions.setSearchQuery('');
}

// Infinite scroll
const scrollContainer = ref<HTMLElement | null>(null);

function onScroll() {
  const el = scrollContainer.value;
  if (!el || sessions.loadingMore || !sessions.hasMore) return;
  const threshold = 200;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
    sessions.fetchMoreSessions();
  }
}

onMounted(() => {
  sessions.fetchSessions();
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
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
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="flex items-center justify-between px-4 py-3">
        <div>
          <h1 class="text-lg font-semibold text-surface-900 dark:text-white">All Conversations</h1>
          <p class="text-sm text-surface-600 dark:text-surface-400">
            {{ sessions.sessions.length }}{{ sessions.hasMore ? '+' : '' }} loaded
          </p>
        </div>
        <button
          @click="sessions.fetchSessions()"
          :disabled="sessions.loading"
          class="p-2 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors"
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

      <!-- Search Bar -->
      <div class="px-4 pb-3">
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            :value="searchInput"
            @input="onSearchInput"
            placeholder="Search by name or phone..."
            class="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500"
          />
          <button
            v-if="searchInput"
            @click="clearSearch"
            class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- List -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto" @scroll="onScroll">
      <!-- Loading -->
      <div v-if="sessions.loading && !sessions.sessions.length" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <!-- Empty -->
      <div v-else-if="!sessions.sessions.length && !sessions.loading" class="flex flex-col items-center justify-center h-full text-surface-500 dark:text-surface-400">
        <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" 
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p v-if="sessions.searchQuery">No results for "{{ sessions.searchQuery }}"</p>
        <p v-else>No conversations yet</p>
      </div>

      <!-- Session List -->
      <div v-else>
        <div class="divide-y divide-surface-200 dark:divide-surface-700">
          <button
            v-for="session in sessions.sortedSessions"
            :key="session.id"
            @click="openChat(session.id)"
            class="w-full p-4 text-left hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <div class="flex items-start gap-3">
              <!-- Avatar -->
              <div class="w-10 h-10 rounded-full bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-surface-900 dark:text-white font-medium flex-shrink-0">
                {{ session.contact?.full_name?.charAt(0) || session.channel_user_id?.charAt(0) || '?' }}
              </div>
              
              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="font-medium text-surface-900 dark:text-white truncate">
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
                  <span class="text-xs text-surface-600 dark:text-surface-400 capitalize">
                    {{ getStatusLabel(session) }}
                  </span>
                </div>
                
                <p 
                  v-if="session.last_message" 
                  class="text-sm text-surface-600 dark:text-surface-400 truncate"
                >
                  <span v-if="session.last_message.direction === 'outbound'" class="text-surface-500">You: </span>
                  <span v-if="session.last_message.type === 'image' && !session.last_message.content">📷 Image</span>
                  <span v-else-if="session.last_message.type === 'video' && !session.last_message.content">🎥 Video</span>
                  <span v-else-if="session.last_message.type === 'sticker'">🎨 Sticker</span>
                  <span v-else>{{ session.last_message.content || 'No content' }}</span>
                </p>
              </div>

              <!-- Arrow -->
              <svg class="w-5 h-5 text-surface-500 mt-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        <!-- Loading More Spinner -->
        <div v-if="sessions.loadingMore" class="flex justify-center py-4">
          <div class="animate-spin w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full"></div>
        </div>

        <!-- End of list indicator -->
        <div v-else-if="!sessions.hasMore && sessions.sessions.length > 0" class="text-center py-4 text-xs text-surface-400">
          All conversations loaded
        </div>
      </div>
    </div>
  </div>
</template>
