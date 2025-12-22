<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';

const route = useRoute();
const router = useRouter();
const escalations = useEscalationsStore();

const messageInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const showResolveModal = ref(false);
const resolveNotes = ref('');

const escalationId = computed(() => route.params.escalationId as string);

onMounted(async () => {
  await escalations.fetchEscalation(escalationId.value);
  scrollToBottom();
  
  // Subscribe to Realtime for new messages
  if (escalations.currentEscalation?.session?.id) {
    escalations.subscribeToMessages(escalations.currentEscalation.session.id);
  }
});

onUnmounted(() => {
  // Clean up Realtime subscription
  escalations.unsubscribeFromMessages();
});

// Auto-scroll when new messages arrive
watch(
  () => escalations.messages.length,
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

async function handleSend() {
  if (!messageInput.value.trim()) return;
  
  const message = messageInput.value;
  messageInput.value = '';
  
  await escalations.send(message);
  scrollToBottom();
}

async function handleResolve() {
  const success = await escalations.resolve(escalationId.value, resolveNotes.value);
  if (success) {
    router.push('/');
  }
}

function goBack() {
  escalations.clearCurrent();
  router.push('/');
}

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isHumanMessage = (msg: { sent_by_agent_id?: string | null }) => {
  return !!msg.sent_by_agent_id;
};
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-surface-800 border-b border-surface-700 safe-top">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1 -ml-1 text-surface-400 hover:text-white">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div class="flex-1 min-w-0" v-if="escalations.currentEscalation">
          <h1 class="font-semibold text-white truncate">
            {{ escalations.currentEscalation.session?.contact?.full_name || 'Customer' }}
          </h1>
          <p class="text-sm text-surface-400 truncate">
            {{ escalations.currentEscalation.session?.contact?.phone }}
          </p>
        </div>
        
        <button
          @click="showResolveModal = true"
          class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Resolve
        </button>
      </div>
    </header>

    <!-- Messages -->
    <div 
      ref="messagesContainer"
      class="flex-1 overflow-y-auto p-4 space-y-4"
    >
      <div v-if="escalations.loading" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <template v-else>
        <div
          v-for="msg in escalations.messages"
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
          <div v-if="msg.type === 'image' && msg.media_url" class="mb-2 -mx-2">
            <a :href="msg.media_url" target="_blank">
              <img 
                :src="msg.media_url" 
                class="w-full h-auto rounded-lg shadow-sm border border-white/10"
                alt="Message image"
              />
            </a>
          </div>
          <p v-if="msg.content" class="text-white whitespace-pre-wrap break-words">{{ msg.content }}</p>
          <div class="flex items-center justify-end gap-1 mt-1">
            <span v-if="isHumanMessage(msg)" class="text-xs text-white/60">You</span>
            <span class="text-xs text-white/50">{{ formatTime(msg.created_at) }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Compose -->
    <div class="flex-shrink-0 p-4 bg-surface-800 border-t border-surface-700 safe-bottom">
      <div class="flex gap-2">
        <input
          v-model="messageInput"
          @keyup.enter="handleSend"
          type="text"
          placeholder="Type a message..."
          class="flex-1 px-4 py-3 bg-surface-700 border border-surface-600 rounded-xl text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
        />
        <button
          @click="handleSend"
          :disabled="escalations.sending || !messageInput.trim()"
          class="px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Resolve Modal -->
    <Teleport to="body">
      <div 
        v-if="showResolveModal"
        class="fixed inset-0 bg-black/60 flex items-end justify-center z-50"
        @click.self="showResolveModal = false"
      >
        <div class="w-full max-w-lg bg-surface-800 rounded-t-2xl p-6 space-y-4 animate-slide-up">
          <h2 class="text-xl font-semibold text-white">Resolve Escalation</h2>
          
          <div>
            <label class="block text-sm font-medium text-surface-300 mb-2">
              Resolution Notes (optional)
            </label>
            <textarea
              v-model="resolveNotes"
              rows="3"
              placeholder="What was the resolution?"
              class="w-full px-4 py-3 bg-surface-700 border border-surface-600 rounded-xl text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            ></textarea>
          </div>
          
          <div class="flex gap-3">
            <button
              @click="showResolveModal = false"
              class="flex-1 py-3 bg-surface-700 hover:bg-surface-600 text-white font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              @click="handleResolve"
              class="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@keyframes slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}
</style>
