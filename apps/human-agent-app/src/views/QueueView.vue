<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const escalations = useEscalationsStore();
const auth = useAuthStore();

onMounted(() => {
  escalations.fetchEscalations();
});

const getTimeSince = (date: string) => {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'urgent': return 'bg-red-500';
    case 'high': return 'bg-orange-500';
    case 'medium': return 'bg-yellow-500';
    default: return 'bg-green-500';
  }
};

const getReasonLabel = (reason: string) => {
  const labels: Record<string, string> = {
    explicit_request: 'Agent Requested',
    frustration: 'User Frustrated',
    ai_uncertainty: 'AI Uncertain',
    complex_issue: 'Complex Issue',
    legal_regulatory: 'Legal/Compliance',
  };
  return labels[reason] || reason;
};

function openChat(id: string) {
  router.push(`/chat/${id}`);
}

function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700 safe-top">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-white">Escalations</h1>
          <p class="text-sm text-surface-400">
            {{ escalations.openCount }} open
          </p>
        </div>
        <button
          @click="logout"
          class="p-2 text-surface-400 hover:text-white transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </header>

    <!-- List -->
    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="escalations.loading && !escalations.escalations.length" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <!-- Empty -->
      <div v-else-if="!escalations.escalations.length" class="flex flex-col items-center justify-center h-full text-surface-400">
        <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" 
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>No open escalations</p>
        <p class="text-sm mt-1">Great job! 🎉</p>
      </div>

      <!-- Escalation List -->
      <div v-else class="divide-y divide-surface-700">
        <button
          v-for="esc in escalations.sortedEscalations"
          :key="esc.id"
          @click="openChat(esc.id)"
          class="w-full p-4 text-left hover:bg-surface-800 transition-colors"
        >
          <div class="flex items-start gap-3">
            <!-- Priority indicator -->
            <div :class="['w-2 h-2 rounded-full mt-2', getPriorityColor(esc.priority)]"></div>
            
            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-1">
                <span class="font-medium text-white truncate">
                  {{ esc.session?.contact?.full_name || esc.session?.channel_user_id || 'Unknown' }}
                </span>
                <span class="text-xs text-surface-500">
                  {{ getTimeSince(esc.created_at) }}
                </span>
              </div>
              
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs px-2 py-0.5 bg-surface-700 rounded-full text-surface-300">
                  {{ getReasonLabel(esc.reason) }}
                </span>
                <span 
                  v-if="esc.status !== 'open'"
                  class="text-xs px-2 py-0.5 bg-accent-900 rounded-full text-accent-300"
                >
                  {{ esc.status }}
                </span>
              </div>
              
              <p v-if="esc.ai_summary" class="text-sm text-surface-400 line-clamp-2">
                {{ esc.ai_summary }}
              </p>
            </div>
            
            <!-- Arrow -->
            <svg class="w-5 h-5 text-surface-500 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>

    <!-- Refresh button -->
    <div class="flex-shrink-0 p-4 flex justify-center safe-bottom">
      <button
        @click="escalations.fetchEscalations()"
        :disabled="escalations.loading"
        class="p-3 text-orange-500 hover:text-orange-400 disabled:opacity-50 transition-colors"
        title="Refresh Escalations"
      >
        <svg 
          :class="['w-8 h-8', escalations.loading ? 'animate-spin' : '']" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
