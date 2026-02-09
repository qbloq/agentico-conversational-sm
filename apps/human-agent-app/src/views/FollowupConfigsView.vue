<script setup lang="ts">
/**
 * FollowupConfigsView - CRUD UI for managing follow-up configurations
 * 
 * Allows agents to create, edit, and delete follow-up config entries
 * from the followup_configs registry table.
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useFollowupsStore } from '@/stores/followups';
import { useRouter } from 'vue-router';
import type { FollowupConfig, FollowupVariableConfig, FollowupQueueItem } from '@/api/client';

const router = useRouter();
const store = useFollowupsStore();

// UI State
const activeTab = ref<'configs' | 'queue'>('configs');
const showEditor = ref(false);
const showDeleteConfirm = ref(false);
const deleteTarget = ref<string | null>(null);
const filter = ref<'all' | 'text' | 'template'>('all');
const searchQuery = ref('');

// Queue UI State
const queueStatusFilter = ref<string>('pending');
const showCancelConfirm = ref(false);
const cancelTarget = ref<FollowupQueueItem | null>(null);

// Editor State
const isEditing = ref(false);
const editorForm = ref<{
  name: string;
  type: 'text' | 'template';
  content: string;
  variables_config: FollowupVariableConfig[];
}>({
  name: '',
  type: 'text',
  content: '',
  variables_config: [],
});

// Computed
const filteredConfigs = computed(() => {
  let list = store.configs;
  if (filter.value !== 'all') {
    list = list.filter(c => c.type === filter.value);
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.content.toLowerCase().includes(q)
    );
  }
  return list;
});

// Actions
function openCreate() {
  isEditing.value = false;
  editorForm.value = {
    name: '',
    type: 'text',
    content: '',
    variables_config: [],
  };
  showEditor.value = true;
}

function openEdit(config: FollowupConfig) {
  isEditing.value = true;
  editorForm.value = {
    name: config.name,
    type: config.type,
    content: config.content,
    variables_config: config.variables_config.map(v => ({ ...v })),
  };
  showEditor.value = true;
}

function closeEditor() {
  showEditor.value = false;
}

async function saveEditor() {
  const success = await store.saveConfig(editorForm.value);
  if (success) {
    showEditor.value = false;
  }
}

function confirmDelete(name: string) {
  deleteTarget.value = name;
  showDeleteConfirm.value = true;
}

async function executeDelete() {
  if (deleteTarget.value) {
    await store.removeConfig(deleteTarget.value);
  }
  showDeleteConfirm.value = false;
  deleteTarget.value = null;
}

// Variable management
function addVariable() {
  editorForm.value.variables_config.push({
    key: '',
    type: 'literal',
    value: '',
  });
}

function removeVariable(index: number) {
  editorForm.value.variables_config.splice(index, 1);
}

function goBack() {
  router.push('/');
}

// Helpers
function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Queue actions
function openCancelConfirm(item: FollowupQueueItem) {
  cancelTarget.value = item;
  showCancelConfirm.value = true;
}

async function executeCancel() {
  if (cancelTarget.value) {
    await store.cancelQueueItem(cancelTarget.value.id);
  }
  showCancelConfirm.value = false;
  cancelTarget.value = null;
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = date.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);
  const isPast = diffMs < 0;

  if (absDiff < 60000) return isPast ? 'just now' : 'in < 1m';
  if (absDiff < 3600000) {
    const mins = Math.floor(absDiff / 60000);
    return isPast ? `${mins}m ago` : `in ${mins}m`;
  }
  if (absDiff < 86400000) {
    const hrs = Math.floor(absDiff / 3600000);
    return isPast ? `${hrs}h ago` : `in ${hrs}h`;
  }
  const days = Math.floor(absDiff / 86400000);
  return isPast ? `${days}d ago` : `in ${days}d`;
}

function contactDisplay(item: FollowupQueueItem): string {
  const c = item.sessions?.contacts;
  if (!c) return 'Unknown';
  return c.full_name || c.phone || 'Unknown';
}

watch(activeTab, (tab) => {
  if (tab === 'queue') {
    store.fetchQueue(queueStatusFilter.value || undefined);
  }
});

watch(queueStatusFilter, (status) => {
  if (activeTab.value === 'queue') {
    store.fetchQueue(status || undefined);
  }
});

onMounted(() => {
  store.fetchConfigs();
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button 
            @click="goBack" 
            class="lg:hidden p-1 -ml-1 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white">Follow-ups</h1>
            <p class="text-xs text-surface-500 dark:text-surface-400">
              {{ activeTab === 'configs' ? `${store.configCount} configurations` : `${store.queue.length} queued` }}
            </p>
          </div>
        </div>
        <button
          v-if="activeTab === 'configs'"
          @click="openCreate"
          class="flex items-center gap-1.5 px-3 py-2 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition-colors active:scale-95"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span class="hidden sm:inline">New Config</span>
        </button>
        <button
          v-else
          @click="store.fetchQueue(queueStatusFilter || undefined)"
          class="flex items-center gap-1.5 px-3 py-2 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden sm:inline">Refresh</span>
        </button>
      </div>

      <!-- Tabs -->
      <div class="px-4 flex gap-0">
        <button
          @click="activeTab = 'configs'"
          :class="[
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'configs'
              ? 'border-accent-500 text-accent-600 dark:text-accent-400'
              : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
          ]"
        >
          Configs
        </button>
        <button
          @click="activeTab = 'queue'"
          :class="[
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
            activeTab === 'queue'
              ? 'border-accent-500 text-accent-600 dark:text-accent-400'
              : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
          ]"
        >
          Queue
          <span v-if="store.pendingCount > 0" class="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
            {{ store.pendingCount }}
          </span>
        </button>
      </div>

      <!-- Configs Filters (only when configs tab active) -->
      <div v-if="activeTab === 'configs'" class="px-4 pb-3 pt-2 flex items-center gap-2">
        <div class="flex-1 relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search configs..."
            class="w-full pl-9 pr-3 py-2 bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-lg text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
          />
        </div>
        <div class="flex bg-surface-100 dark:bg-surface-700 rounded-lg p-0.5">
          <button
            v-for="f in (['all', 'text', 'template'] as const)"
            :key="f"
            @click="filter = f"
            :class="[
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
              filter === f
                ? 'bg-white dark:bg-surface-600 text-surface-900 dark:text-white shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            ]"
          >
            {{ f }}
          </button>
        </div>
      </div>

      <!-- Queue Filters (only when queue tab active) -->
      <div v-if="activeTab === 'queue'" class="px-4 pb-3 pt-2">
        <div class="flex bg-surface-100 dark:bg-surface-700 rounded-lg p-0.5">
          <button
            v-for="s in ['pending', 'sent', 'cancelled', 'failed']"
            :key="s"
            @click="queueStatusFilter = s"
            :class="[
              'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
              queueStatusFilter === s
                ? 'bg-white dark:bg-surface-600 text-surface-900 dark:text-white shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
            ]"
          >
            {{ s }}
          </button>
        </div>
      </div>
    </header>

    <!-- ================================================================= -->
    <!-- CONFIGS TAB CONTENT -->
    <!-- ================================================================= -->
    <div v-if="activeTab === 'configs'" class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="store.loading" class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p class="text-sm text-surface-500">Loading configs...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="store.error && !store.configs.length" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">Failed to load</p>
          <p class="text-sm text-surface-500 mt-1">{{ store.error }}</p>
          <button @click="store.fetchConfigs()" class="mt-3 text-sm text-accent-500 hover:text-accent-400 font-medium">
            Try again
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="!filteredConfigs.length && !store.loading" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">
            {{ searchQuery ? 'No matching configs' : 'No follow-up configs yet' }}
          </p>
          <p class="text-sm text-surface-500 mt-1">
            {{ searchQuery ? 'Try a different search term' : 'Create your first follow-up configuration' }}
          </p>
          <button
            v-if="!searchQuery"
            @click="openCreate"
            class="mt-4 px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Create Config
          </button>
        </div>
      </div>

      <!-- Config List -->
      <div v-else class="p-4 space-y-3 max-w-3xl mx-auto">
        <div
          v-for="config in filteredConfigs"
          :key="config.name"
          class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden hover:border-surface-300 dark:hover:border-surface-600 transition-colors"
        >
          <!-- Card Header -->
          <div class="px-4 py-3 flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="font-mono text-sm font-semibold text-surface-900 dark:text-white truncate">
                  {{ config.name }}
                </h3>
                <span
                  :class="[
                    'flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full',
                    config.type === 'text'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                  ]"
                >
                  {{ config.type }}
                </span>
              </div>
              <p class="mt-1 text-sm text-surface-600 dark:text-surface-400 line-clamp-2">
                {{ config.content }}
              </p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                @click="openEdit(config)"
                class="p-2 text-surface-400 hover:text-accent-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg transition-colors"
                title="Edit"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                @click="confirmDelete(config.name)"
                class="p-2 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                title="Delete"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Variables Preview -->
          <div v-if="config.variables_config.length > 0" class="px-4 pb-3">
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="v in config.variables_config"
                :key="v.key"
                :class="[
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium',
                  v.type === 'literal' ? 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300' :
                  v.type === 'llm' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
                  'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                ]"
              >
                <span class="opacity-60" v-text="'{{'"></span>{{ v.key }}<span class="opacity-60" v-text="'}}'"></span>
                <span class="opacity-50 text-[9px] uppercase">{{ v.type }}</span>
              </span>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-4 py-2 bg-surface-50 dark:bg-surface-800/50 border-t border-surface-100 dark:border-surface-700/50 text-[11px] text-surface-400">
            Updated {{ formatDate(config.updated_at) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- QUEUE TAB CONTENT -->
    <!-- ================================================================= -->
    <div v-if="activeTab === 'queue'" class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="store.queueLoading" class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p class="text-sm text-surface-500">Loading queue...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="store.error && !store.queue.length" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">Failed to load queue</p>
          <p class="text-sm text-surface-500 mt-1">{{ store.error }}</p>
          <button @click="store.fetchQueue(queueStatusFilter || undefined)" class="mt-3 text-sm text-accent-500 hover:text-accent-400 font-medium">
            Try again
          </button>
        </div>
      </div>

      <!-- Empty Queue -->
      <div v-else-if="!store.queue.length && !store.queueLoading" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">No {{ queueStatusFilter }} follow-ups</p>
          <p class="text-sm text-surface-500 mt-1">Try a different status filter</p>
        </div>
      </div>

      <!-- Queue List -->
      <div v-else class="p-4 space-y-2 max-w-3xl mx-auto">
        <div
          v-for="item in store.queue"
          :key="item.id"
          :class="[
            'bg-white dark:bg-surface-800 rounded-xl border overflow-hidden transition-colors',
            item.status === 'pending'
              ? 'border-amber-200 dark:border-amber-800/50'
              : item.status === 'sent'
                ? 'border-emerald-200 dark:border-emerald-800/50'
                : item.status === 'cancelled'
                  ? 'border-surface-200 dark:border-surface-700 opacity-60'
                  : 'border-red-200 dark:border-red-800/50'
          ]"
        >
          <div class="px-4 py-3 flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <!-- Contact name -->
                <span class="text-sm font-medium text-surface-900 dark:text-white truncate">
                  {{ contactDisplay(item) }}
                </span>
                <!-- Status badge -->
                <span
                  :class="[
                    'flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full',
                    item.status === 'pending' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' :
                    item.status === 'sent' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                    item.status === 'cancelled' ? 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400' :
                    'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  ]"
                >
                  {{ item.status }}
                </span>
                <!-- Template/type badge -->
                <span v-if="item.template_name" class="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-mono">
                  {{ item.template_name }}
                </span>
              </div>
              <div class="mt-1 flex items-center gap-3 text-xs text-surface-500 dark:text-surface-400">
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {{ relativeTime(item.scheduled_at) }}
                </span>
                <span v-if="item.sessions?.current_state" class="font-mono text-[11px]">
                  {{ item.sessions.current_state }}
                </span>
                <span v-if="item.sessions?.contacts?.phone" class="text-[11px]">
                  {{ item.sessions.contacts.phone }}
                </span>
              </div>
              <p v-if="item.error_message" class="mt-1 text-xs text-red-500 truncate">
                {{ item.error_message }}
              </p>
            </div>
            <!-- Cancel button (only for pending) -->
            <button
              v-if="item.status === 'pending'"
              @click="openCancelConfirm(item)"
              :disabled="store.cancelling.has(item.id)"
              :class="[
                'flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                store.cancelling.has(item.id)
                  ? 'bg-surface-100 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                  : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-95'
              ]"
            >
              {{ store.cancelling.has(item.id) ? 'Cancelling...' : 'Cancel' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Editor Modal -->
    <Teleport to="body">
      <div
        v-if="showEditor"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="closeEditor" />

        <!-- Panel -->
        <div class="relative w-full sm:max-w-lg max-h-[90vh] bg-white dark:bg-surface-800 sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
          <!-- Editor Header -->
          <div class="flex-shrink-0 px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-surface-900 dark:text-white">
              {{ isEditing ? 'Edit Config' : 'New Follow-up Config' }}
            </h2>
            <button @click="closeEditor" class="p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 rounded-lg">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Editor Body -->
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <!-- Name -->
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Name</label>
              <input
                v-model="editorForm.name"
                type="text"
                placeholder="e.g. friendly_nudge"
                :disabled="isEditing"
                :class="[
                  'w-full px-3 py-2.5 rounded-lg border text-sm font-mono',
                  'bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600',
                  'text-surface-900 dark:text-white placeholder-surface-400',
                  'focus:outline-none focus:ring-2 focus:ring-accent-500/50',
                  isEditing ? 'opacity-60 cursor-not-allowed' : ''
                ]"
              />
              <p class="mt-1 text-[11px] text-surface-400">Unique identifier (snake_case). Cannot be changed after creation.</p>
            </div>

            <!-- Type -->
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Type</label>
              <div class="flex gap-2">
                <button
                  @click="editorForm.type = 'text'"
                  :class="[
                    'flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors',
                    editorForm.type === 'text'
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-surface-300'
                  ]"
                >
                  <div class="flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Text
                  </div>
                </button>
                <button
                  @click="editorForm.type = 'template'"
                  :class="[
                    'flex-1 py-2.5 px-4 rounded-lg border text-sm font-medium transition-colors',
                    editorForm.type === 'template'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                      : 'bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-surface-300'
                  ]"
                >
                  <div class="flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                    </svg>
                    Template
                  </div>
                </button>
              </div>
            </div>

            <!-- Content -->
            <div>
              <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                {{ editorForm.type === 'text' ? 'Message Body' : 'Template Name' }}
              </label>
              <textarea
                v-if="editorForm.type === 'text'"
                v-model="editorForm.content"
                rows="3"
                placeholder="Hola {{name}}! Sigues por ahí?"
                class="w-full px-3 py-2.5 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-none"
              />
              <input
                v-else
                v-model="editorForm.content"
                type="text"
                placeholder="e.g. sales_reengagement_v1"
                class="w-full px-3 py-2.5 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm font-mono text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
              <p v-if="editorForm.type === 'text'" class="mt-1 text-[11px] text-surface-400">
                Use <code class="bg-surface-200 dark:bg-surface-600 px-1 rounded" v-text="'{{variableName}}'"></code> for dynamic values.
              </p>
              <p v-else class="mt-1 text-[11px] text-surface-400">
                The approved WhatsApp template name.
              </p>
            </div>

            <!-- Variables -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Variables</label>
                <button
                  @click="addVariable"
                  class="flex items-center gap-1 text-xs text-accent-500 hover:text-accent-400 font-medium"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Variable
                </button>
              </div>

              <div v-if="editorForm.variables_config.length === 0" class="text-center py-4 text-sm text-surface-400 bg-surface-50 dark:bg-surface-700/50 rounded-lg border border-dashed border-surface-200 dark:border-surface-600">
                No variables configured
              </div>

              <div v-else class="space-y-3">
                <div
                  v-for="(variable, idx) in editorForm.variables_config"
                  :key="idx"
                  class="p-3 bg-surface-50 dark:bg-surface-700/50 rounded-lg border border-surface-200 dark:border-surface-600 space-y-2"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-surface-500 uppercase">Variable #{{ idx + 1 }}</span>
                    <button
                      @click="removeVariable(idx)"
                      class="p-1 text-surface-400 hover:text-red-500 rounded"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <!-- Key + Type row -->
                  <div class="flex gap-2">
                    <input
                      v-model="variable.key"
                      type="text"
                      placeholder="key"
                      class="flex-1 px-2.5 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs font-mono text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    />
                    <select
                      v-model="variable.type"
                      class="px-2.5 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs text-surface-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    >
                      <option value="literal">Literal</option>
                      <option value="context">Context</option>
                      <option value="llm">LLM</option>
                    </select>
                  </div>

                  <!-- Type-specific field -->
                  <div v-if="variable.type === 'literal'">
                    <input
                      v-model="variable.value"
                      type="text"
                      placeholder="Static value"
                      class="w-full px-2.5 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    />
                  </div>
                  <div v-else-if="variable.type === 'context'">
                    <input
                      v-model="variable.field"
                      type="text"
                      placeholder="e.g. firstName or context.service_name"
                      class="w-full px-2.5 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs font-mono text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    />
                    <p class="mt-0.5 text-[10px] text-surface-400">Field path from session context or contact metadata.</p>
                  </div>
                  <div v-else-if="variable.type === 'llm'">
                    <textarea
                      v-model="variable.prompt"
                      rows="2"
                      placeholder="Generate a warm greeting for a lead who hasn't responded..."
                      class="w-full px-2.5 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50 resize-none"
                    />
                    <p class="mt-0.5 text-[10px] text-surface-400">Prompt sent to the LLM to generate this variable's value at runtime.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Editor Footer -->
          <div class="flex-shrink-0 px-5 py-3 border-t border-surface-200 dark:border-surface-700 flex items-center justify-between gap-3">
            <p v-if="store.error" class="text-xs text-red-500 truncate flex-1">{{ store.error }}</p>
            <div v-else class="flex-1" />
            <div class="flex items-center gap-2">
              <button
                @click="closeEditor"
                class="px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                @click="saveEditor"
                :disabled="store.saving || !editorForm.name || !editorForm.content"
                :class="[
                  'px-5 py-2 text-sm font-medium rounded-lg transition-colors',
                  store.saving || !editorForm.name || !editorForm.content
                    ? 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                    : 'bg-accent-600 hover:bg-accent-700 text-white active:scale-95'
                ]"
              >
                {{ store.saving ? 'Saving...' : (isEditing ? 'Update' : 'Create') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete Confirmation Modal -->
    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div class="absolute inset-0 bg-black/50" @click="showDeleteConfirm = false" />
        <div class="relative bg-white dark:bg-surface-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full animate-in zoom-in-95 duration-200">
          <div class="text-center">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-surface-900 dark:text-white">Delete Config</h3>
            <p class="mt-2 text-sm text-surface-600 dark:text-surface-400">
              Are you sure you want to delete <code class="font-mono bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-xs">{{ deleteTarget }}</code>? This action cannot be undone.
            </p>
          </div>
          <div class="mt-5 flex gap-3">
            <button
              @click="showDeleteConfirm = false"
              class="flex-1 py-2.5 text-sm font-medium text-surface-600 dark:text-surface-400 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              @click="executeDelete"
              :disabled="store.saving"
              class="flex-1 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors active:scale-95 disabled:opacity-50"
            >
              {{ store.saving ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Cancel Queue Item Confirmation Modal -->
    <Teleport to="body">
      <div
        v-if="showCancelConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div class="absolute inset-0 bg-black/50" @click="showCancelConfirm = false" />
        <div class="relative bg-white dark:bg-surface-800 rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full animate-in zoom-in-95 duration-200">
          <div class="text-center">
            <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-surface-900 dark:text-white">Cancel Follow-up</h3>
            <p class="mt-2 text-sm text-surface-600 dark:text-surface-400">
              Cancel the scheduled follow-up for <span class="font-medium text-surface-900 dark:text-white">{{ cancelTarget ? contactDisplay(cancelTarget) : '' }}</span>?
            </p>
            <p v-if="cancelTarget" class="mt-1 text-xs text-surface-400">
              Scheduled {{ relativeTime(cancelTarget.scheduled_at) }}
              <span v-if="cancelTarget.template_name"> · {{ cancelTarget.template_name }}</span>
            </p>
          </div>
          <div class="mt-5 flex gap-3">
            <button
              @click="showCancelConfirm = false"
              class="flex-1 py-2.5 text-sm font-medium text-surface-600 dark:text-surface-400 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 rounded-lg transition-colors"
            >
              Keep
            </button>
            <button
              @click="executeCancel"
              :disabled="store.saving"
              class="flex-1 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors active:scale-95 disabled:opacity-50"
            >
              {{ store.saving ? 'Cancelling...' : 'Cancel It' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
