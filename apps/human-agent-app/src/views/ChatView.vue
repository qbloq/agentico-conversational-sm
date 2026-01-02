<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';
import TemplatePicker from '@/components/TemplatePicker.vue';

const route = useRoute();
const router = useRouter();
const escalations = useEscalationsStore();

const messageInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const showResolveModal = ref(false);
const resolveNotes = ref('');
const showTemplatePicker = ref(false);
const currentTime = ref(Date.now());
let timer: number | null = null;

const escalationId = computed(() => route.params.escalationId as string);

onMounted(async () => {
  await escalations.fetchEscalation(escalationId.value);
  scrollToBottom();
  
  // Subscribe to Realtime for new messages
  if (escalations.currentEscalation?.session?.id) {
    escalations.subscribeToMessages(escalations.currentEscalation.session.id);
  }

  // Update countdown timer
  timer = window.setInterval(() => {
    currentTime.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  // Clean up Realtime subscription
  escalations.unsubscribeFromMessages();
  if (timer) clearInterval(timer);
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

async function handleTemplateSelect(templateName: string) {
  showTemplatePicker.value = false;
  await escalations.sendTemplate(templateName);
  scrollToBottom();
}

const formatRemainingTime = computed(() => {
  const remaining = escalations.windowTimeRemaining;
  if (remaining <= 0) return 'Expired';
  
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
  
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
});

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const isHumanMessage = (msg: { sent_by_agent_id?: string | null }) => {
  return !!msg.sent_by_agent_id;
};
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-white dark:bg-surface-800 border-b border-surface-100 dark:border-surface-700 safe-top">
      <div class="flex items-center gap-3">
        <button @click="goBack" class="p-1 -ml-1 text-surface-500 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div class="flex-1 min-w-0" v-if="escalations.currentEscalation">
          <div class="flex items-center gap-2">
            <h1 class="font-semibold text-surface-900 dark:text-white truncate">
              {{ escalations.currentEscalation.session?.contact?.full_name || 'Customer' }}
            </h1>
            <div 
              class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors"
              :class="escalations.isWindowOpen ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{{ formatRemainingTime }}</span>
            </div>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400 truncate">
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
      class="flex-1 overflow-y-auto p-3 space-y-2"
    >
      <div v-if="escalations.loading" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <template v-else>
        <div
          v-for="msg in escalations.messages"
          :key="msg.id"
          :class="[
            'max-w-[85%] rounded-xl px-2.5 py-1',
            msg.direction === 'inbound' 
              ? 'bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 shadow-sm mr-auto rounded-bl-md' 
              : isHumanMessage(msg)
                ? 'bg-accent-600 ml-auto rounded-br-md'
                : 'bg-primary-600 ml-auto rounded-br-md'
          ]"
        >
          <div v-if="msg.type === 'image' && msg.media_url" class="mb-2 -mx-2">
            <a :href="msg.media_url" target="_blank">
              <img 
                :src="msg.media_url" 
                class="max-w-full max-h-72 w-auto object-contain rounded-lg shadow-sm border border-surface-100 dark:border-white/10"
                alt="Message image"
              />
            </a>
          </div>
          <p v-if="msg.content" 
            :class="[
              'text-[15px] leading-snug whitespace-pre-wrap break-words',
              msg.direction === 'inbound' ? 'text-surface-900 dark:text-white' : 'text-white'
            ]"
          >
            {{ msg.content }}
          </p>
          <div class="flex items-center justify-end gap-1 mt-0.5">
            <span v-if="isHumanMessage(msg)" class="text-[10px] text-white/70">You</span>
            <span 
              class="text-[10px]"
              :class="msg.direction === 'inbound' ? 'text-surface-400 dark:text-white/40' : 'text-white/60'"
            >
              {{ formatTime(msg.created_at) }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- Compose -->
    <div class="flex-shrink-0 px-3 py-2 pb-[calc(8px+2px)] bg-white dark:bg-surface-800 border-t border-surface-100 dark:border-surface-700 safe-bottom">
      <div v-if="escalations.isWindowOpen" class="flex gap-2">
        <input
          v-model="messageInput"
          @keyup.enter="handleSend"
          type="text"
          placeholder="Type a message..."
          class="flex-1 px-3 py-2 bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-xl text-[15px] text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
        />
        <button
          @click="handleSend"
          :disabled="escalations.sending || !messageInput.trim()"
          class="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-100 dark:disabled:bg-surface-700 disabled:text-surface-400 dark:disabled:text-surface-500 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
      <div v-else class="flex flex-col gap-2">
        <button
          @click="showTemplatePicker = true"
          class="w-full py-2.5 bg-white dark:bg-surface-800 border-2 border-accent-600 text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-900/10 font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Send WhatsApp Template to Resume
        </button>
      </div>
    </div>

    <!-- Resolve Modal -->
    <Teleport to="body">
      <div 
        v-if="showResolveModal"
        class="fixed inset-0 bg-black/60 flex items-end justify-center z-50 p-4"
        @click.self="showResolveModal = false"
      >
        <div class="w-full max-w-lg bg-white dark:bg-surface-800 rounded-2xl p-6 space-y-4 animate-slide-up">
          <h2 class="text-xl font-semibold text-surface-900 dark:text-white">Resolve Escalation</h2>
          
          <div>
            <label class="block text-sm font-medium text-surface-600 dark:text-surface-300 mb-2">
              Resolution Notes (optional)
            </label>
            <textarea
              v-model="resolveNotes"
              rows="3"
              placeholder="What was the resolution?"
              class="w-full px-4 py-3 bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-xl text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            ></textarea>
          </div>
          
          <div class="flex gap-3">
            <button
              @click="showResolveModal = false"
              class="flex-1 py-3 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-900 dark:text-white font-medium rounded-xl transition-colors"
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

    <!-- Template Picker Modal -->
    <Teleport to="body">
      <div 
        v-if="showTemplatePicker"
        class="fixed inset-0 bg-black/60 flex items-end justify-center z-50"
        @click.self="showTemplatePicker = false"
      >
        <TemplatePicker 
          class="w-full max-w-lg animate-slide-up"
          @select="handleTemplateSelect"
          @cancel="showTemplatePicker = false"
        />
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
