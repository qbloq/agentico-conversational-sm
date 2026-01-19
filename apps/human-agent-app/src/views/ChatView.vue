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

// Image upload
const selectedImage = ref<File | null>(null);
const imagePreviewUrl = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// Long-press and Context Menu
const showContextMenu = ref(false);
const selectedMessage = ref<any>(null);
const menuStyle = ref({ top: '0px', left: '0px' });
let longPressTimer: number | null = null;

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
  // Send image if selected
  if (selectedImage.value) {
    const caption = messageInput.value.trim() || undefined;
    messageInput.value = '';
    
    await escalations.sendImage(selectedImage.value, caption);
    removeImage();
    scrollToBottom();
    return;
  }
  
  // Send text message
  if (!messageInput.value.trim()) return;
  
  const message = messageInput.value;
  messageInput.value = '';
  
  await escalations.send(message);
  scrollToBottom();
}

function handleImageSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (file && file.type.startsWith('image/')) {
    selectedImage.value = file;
    imagePreviewUrl.value = URL.createObjectURL(file);
  }
  
  // Reset input so same file can be selected again
  if (target) target.value = '';
}

function removeImage() {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value);
  }
  selectedImage.value = null;
  imagePreviewUrl.value = null;
}

function openFileSelector() {
  fileInput.value?.click();
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

// Long-press handlers
function handleTouchStart(msg: any, event: TouchEvent) {
  selectedMessage.value = msg;
  longPressTimer = window.setTimeout(() => {
    openContextMenu(event.touches[0].clientX, event.touches[0].clientY);
  }, 500);
}

function handleTouchEnd() {
  if (longPressTimer) clearTimeout(longPressTimer);
}

function handleMouseDown(msg: any, event: MouseEvent) {
  if (event.button !== 0) return; // Only left click
  selectedMessage.value = msg;
  longPressTimer = window.setTimeout(() => {
    openContextMenu(event.clientX, event.clientY);
  }, 500);
}

function handleMouseUp() {
  if (longPressTimer) clearTimeout(longPressTimer);
}

function openContextMenu(x: number, y: number) {
  showContextMenu.value = true;
  // Position menu near the click but keep it within bounds
  const menuWidth = 160;
  const menuHeight = 100;
  
  let top = y;
  let left = x;
  
  if (x + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 20;
  if (y + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 20;
  
  menuStyle.value = {
    top: `${top}px`,
    left: `${left}px`
  };
  
  // Vibrate if available
  if ('vibrate' in navigator) {
    navigator.vibrate(50);
  }
}

function closeContextMenu() {
  showContextMenu.value = false;
}

function handleReplyAction() {
  if (selectedMessage.value) {
    escalations.setReplyingTo(selectedMessage.value);
  }
  closeContextMenu();
}

function handleCopyAction() {
  if (selectedMessage.value?.content) {
    navigator.clipboard.writeText(selectedMessage.value.content);
  }
  closeContextMenu();
}

function getRepliedMessageSender(id: string) {
  const msg = escalations.messages.find(m => m.id === id);
  if (!msg) return 'Mensaje';
  return msg.direction === 'outbound' ? 'Tú' : (escalations.currentEscalation?.session.contact?.full_name || 'Cliente');
}

function getRepliedMessageText(id: string) {
  const msg = escalations.messages.find(m => m.id === id);
  if (!msg) return 'Mensaje original';
  if (msg.type === 'image') return '🖼️ Imagen';
  return msg.content || 'Mensaje';
}

function scrollToMessage(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight-message');
    setTimeout(() => {
      el.classList.remove('highlight-message');
    }, 2000);
  }
}

// Group messages by date for daily separators
const messagesGroupedByDate = computed(() => {
  const groups: Array<{ date: string, dateLabel: string, messages: any[] }> = [];
  
  escalations.messages.forEach((msg) => {
    const msgDate = new Date(msg.created_at);
    const dateKey = msgDate.toDateString();
    
    let group = groups.find(g => g.date === dateKey);
    if (!group) {
      group = {
        date: dateKey,
        dateLabel: formatDateLabel(msgDate),
        messages: []
      };
      groups.push(group);
    }
    group.messages.push(msg);
  });
  
  return groups;
});

const formatDateLabel = (date: Date) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const dateStr = date.toDateString();
  const todayStr = today.toDateString();
  const yesterdayStr = yesterday.toDateString();
  
  if (dateStr === todayStr) return 'Hoy';
  if (dateStr === yesterdayStr) return 'Ayer';
  
  // Format as "Lun, 12 de ene de 2026"
  return date.toLocaleDateString('es-ES', { 
    weekday: 'short', 
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
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
        <template v-for="group in messagesGroupedByDate" :key="group.date">
          <!-- Date Separator -->
          <div class="flex items-center justify-center my-4">
            <div class="px-3 py-1 bg-surface-200/80 dark:bg-surface-700/80 backdrop-blur-sm rounded-full text-xs font-medium text-surface-600 dark:text-surface-300 shadow-sm">
              {{ group.dateLabel }}
            </div>
          </div>

          <!-- Messages for this date -->
          <div
            v-for="msg in group.messages"
            :key="msg.id"
            :id="`msg-${msg.id}`"
            :class="[
              'max-w-[85%] rounded-xl px-2.5 py-1 message-bubble transition-all duration-300',
              msg.direction === 'inbound' 
                ? 'bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 shadow-sm mr-auto rounded-bl-md' 
                : isHumanMessage(msg)
                  ? 'bg-accent-600 ml-auto rounded-br-md text-white'
                  : 'bg-primary-600 ml-auto rounded-br-md text-white'
            ]"
            @touchstart="handleTouchStart(msg, $event)"
            @touchend="handleTouchEnd"
            @mousedown="handleMouseDown(msg, $event)"
            @mouseup="handleMouseUp"
            @contextmenu.prevent
          >
            <!-- Reply Context -->
            <div v-if="msg.reply_to_message_id" class="reply-context-bubble mb-1" @click="scrollToMessage(msg.reply_to_message_id)">
              <div class="reply-bar"></div>
              <div class="reply-content">
                <div class="reply-sender text-[11px] font-bold">{{ getRepliedMessageSender(msg.reply_to_message_id) }}</div>
                <div class="reply-text text-xs opacity-80 truncate">{{ getRepliedMessageText(msg.reply_to_message_id) }}</div>
              </div>
            </div>

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
              <span v-if="isHumanMessage(msg)" class="text-[10px] opacity-70">You</span>
              <span 
                class="text-[10px]"
                :class="msg.direction === 'inbound' ? 'text-surface-400 dark:text-white/40' : 'text-white/60'"
              >
                {{ formatTime(msg.created_at) }}
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- Compose Area -->
    <div class="flex-shrink-0 bg-white dark:bg-surface-800 border-t border-surface-100 dark:border-surface-700 safe-bottom">
      
      <!-- Reply Preview Bar -->
      <div v-if="escalations.replyingTo" class="px-4 py-2 bg-surface-50 dark:bg-surface-900 border-b border-surface-100 dark:border-surface-700 flex items-center gap-3 animate-slide-up">
        <div class="reply-bar w-1 self-stretch bg-accent-500 rounded-full"></div>
        <div class="flex-1 min-w-0">
          <div class="text-[11px] font-bold text-accent-500">
            Replying to {{ getRepliedMessageSender(escalations.replyingTo.id) }}
          </div>
          <div class="text-xs text-surface-500 dark:text-surface-400 truncate">
            {{ getRepliedMessageText(escalations.replyingTo.id) }}
          </div>
        </div>
        <button @click="escalations.clearReplyingTo()" class="text-surface-400 hover:text-red-500">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="px-3 py-2">
        <div v-if="escalations.isWindowOpen" class="flex flex-col gap-2">
          <!-- Image Preview -->
          <div v-if="imagePreviewUrl" class="relative inline-block">
            <img 
              :src="imagePreviewUrl" 
              class="max-h-32 rounded-lg border border-surface-200 dark:border-surface-600"
              alt="Preview"
            />
            <button
              @click="removeImage"
              class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Input Row -->
          <div class="flex gap-2">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              @change="handleImageSelect"
              class="hidden"
            />
            
            <button
              @click="openFileSelector"
              :disabled="escalations.sending"
              class="px-3 py-2 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-50 text-surface-600 dark:text-surface-300 rounded-xl transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            <input
              v-model="messageInput"
              @keyup.enter="handleSend"
              type="text"
              :placeholder="selectedImage ? 'Add a caption (optional)...' : 'Type a message...'"
              class="flex-1 px-3 py-2 bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-xl text-[15px] text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
            />
            
            <button
              @click="handleSend"
              :disabled="escalations.sending || (!messageInput.trim() && !selectedImage)"
              class="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-100 dark:disabled:bg-surface-700 disabled:text-surface-400 dark:disabled:text-surface-500 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <button
            @click="showTemplatePicker = true"
            class="w-full py-2.5 bg-white dark:bg-surface-800 border-2 border-accent-600 text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-900/10 font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Send Template to Resume
          </button>
        </div>
      </div>
    </div>

    <!-- Context Menu Overlay -->
    <Teleport to="body">
      <div v-if="showContextMenu" class="fixed inset-0 z-[100] bg-black/5" @click="closeContextMenu">
        <div 
          class="absolute bg-white dark:bg-surface-800 border border-surface-100 dark:border-surface-700 shadow-xl rounded-xl py-1 min-w-[140px] animate-scale-in"
          :style="menuStyle"
        >
          <button 
            @click="handleReplyAction"
            class="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
          >
            <svg class="w-4 h-4 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l5 5m-5-5l5-5" />
            </svg>
            Responder
          </button>
          <button 
            @click="handleCopyAction"
            class="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors border-t border-surface-50 dark:border-surface-700/50"
          >
            <svg class="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            Copiar
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Resolve Modal -->
    <Teleport to="body">
      <div 
        v-if="showResolveModal"
        class="fixed inset-0 bg-black/60 flex items-end justify-center z-50 p-4"
        @click.self="showResolveModal = false"
      >
        <div class="w-full max-w-lg bg-white dark:bg-surface-800 rounded-2xl p-6 space-y-4 animate-slide-up">
          <h2 class="text-xl font-semibold text-surface-900 dark:text-white">Resolve Escalation</h2>
          <textarea
            v-model="resolveNotes"
            rows="3"
            placeholder="Resolution notes..."
            class="w-full px-4 py-3 bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-xl text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 shrink-0"
          ></textarea>
          <div class="flex gap-3">
            <button @click="showResolveModal = false" class="flex-1 py-3 bg-surface-100 dark:bg-surface-700 text-surface-900 dark:text-white font-medium rounded-xl">Cancel</button>
            <button @click="handleResolve" class="flex-1 py-3 bg-green-600 text-white font-medium rounded-xl border-none">Confirm</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Template Picker Modal -->
    <Teleport to="body">
      <div 
        v-if="showTemplatePicker"
        class="fixed inset-0 bg-black/60 flex items-end justify-center z-[80]"
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
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes scale-in {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes flash {
  0% { background-color: transparent; }
  50% { background-color: rgba(var(--color-primary-500), 0.2); }
  100% { background-color: transparent; }
}

.animate-slide-up { animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
.animate-scale-in { animation: scale-in 0.15s cubic-bezier(0.34, 1.56, 0.64, 1); transform-origin: top left; }

.highlight-message {
  animation: flash 1s ease-in-out 2;
  border-color: rgba(var(--color-primary-500), 0.5) !important;
}

.message-bubble {
  user-select: none;
  -webkit-touch-callout: none;
}

.reply-context-bubble {
  background: rgba(0,0,0,0.05);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  cursor: pointer;
}

.dark .reply-context-bubble { background: rgba(255,255,255,0.05); }

.reply-bar {
  width: 3px;
  background: #25d366; /* WhatsApp Green */
}

.reply-content {
  padding: 4px 8px;
  flex: 1;
  min-width: 0;
}

.sent .reply-context-bubble { background: rgba(255,255,255,0.15); }
.sent .reply-bar { background: #fff; }
</style>
