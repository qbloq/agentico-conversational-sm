<script setup lang="ts">
/**
 * StateMachinesView - List and manage state machine configurations
 */
import { onMounted, ref, computed } from 'vue';
import { useStateMachinesStore } from '@/stores/stateMachines';
import { useRouter } from 'vue-router';

const router = useRouter();
const store = useStateMachinesStore();

const showCreateModal = ref(false);
const creating = ref(false);
const createError = ref<string | null>(null);
const newMachineName = ref('');
const newMachineVersion = ref('1.0.0');
const sourceMachineId = ref<string>('');

const sourceOptions = computed(() => [
  { id: '', label: 'Blank state machine' },
  ...store.machines.map(machine => ({ id: machine.id, label: `${machine.name} (v${machine.version})` })),
]);

function openMachine(id: string) {
  router.push(`/state-machines/${id}`);
}

function openCreateModal() {
  showCreateModal.value = true;
  createError.value = null;
  newMachineName.value = '';
  newMachineVersion.value = '1.0.0';
  sourceMachineId.value = '';
}

function closeCreateModal() {
  if (creating.value) return;
  showCreateModal.value = false;
}

async function createMachine() {
  const trimmedName = newMachineName.value.trim();
  if (!trimmedName) {
    createError.value = 'Name is required';
    return;
  }

  creating.value = true;
  createError.value = null;

  try {
    let states: Record<string, unknown> = {};
    let initialState = 'start';
    let visualization: string | undefined;

    if (sourceMachineId.value) {
      await store.fetchMachine(sourceMachineId.value);
      if (!store.currentMachine) {
        throw new Error('Could not load source state machine');
      }

      states = JSON.parse(JSON.stringify(store.currentMachine.states || {}));
      initialState = store.currentMachine.initial_state;
      visualization = store.currentMachine.visualization;
      if (!newMachineVersion.value.trim()) {
        newMachineVersion.value = store.currentMachine.version || '1.0.0';
      }
    } else {
      states = {
        start: {
          state: 'start',
          objective: '',
          description: '',
          completionSignals: [],
          ragCategories: [],
          allowedTransitions: [],
          transitionGuidance: {},
        },
      };
    }

    const success = await store.saveMachine({
      name: trimmedName,
      version: newMachineVersion.value.trim() || '1.0.0',
      initial_state: initialState,
      states: states as any,
      visualization,
    });

    if (!success || !store.currentMachine?.id) {
      throw new Error(store.error || 'Failed to create state machine');
    }

    showCreateModal.value = false;
    openMachine(store.currentMachine.id);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create state machine';
  } finally {
    creating.value = false;
  }
}

function goBack() {
  router.push('/');
}

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

onMounted(() => {
  store.fetchMachines();
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="flex items-center justify-between">
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
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white">State Machines</h1>
            <p class="text-xs text-surface-500 dark:text-surface-400">{{ store.machineCount }} configurations</p>
          </div>
        </div>
        <button
          @click="openCreateModal"
          class="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-600 hover:bg-accent-700 text-white transition-colors"
          aria-label="Create state machine"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="store.loading" class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
          <p class="text-sm text-surface-500">Loading state machines...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="store.error && !store.machines.length" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">Failed to load</p>
          <p class="text-sm text-surface-500 mt-1">{{ store.error }}</p>
          <button @click="store.fetchMachines()" class="mt-3 text-sm text-accent-500 hover:text-accent-400 font-medium">
            Try again
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="!store.machines.length && !store.loading" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">No state machines found</p>
          <p class="text-sm text-surface-500 mt-1">State machines are configured in the database</p>
        </div>
      </div>

      <!-- Machine List -->
      <div v-else class="p-4 space-y-3 max-w-3xl mx-auto">
        <button
          v-for="machine in store.machines"
          :key="machine.id"
          @click="openMachine(machine.id)"
          class="w-full text-left bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden hover:border-accent-300 dark:hover:border-accent-700 transition-colors group"
        >
          <div class="px-4 py-4 flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="font-mono text-sm font-semibold text-surface-900 dark:text-white truncate">
                  {{ machine.name }}
                </h3>
                <span
                  :class="[
                    'flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full',
                    machine.is_active
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                  ]"
                >
                  {{ machine.is_active ? 'Active' : 'Inactive' }}
                </span>
                <span class="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
                  v{{ machine.version }}
                </span>
              </div>
              <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
                Updated {{ formatDate(machine.updated_at) }}
              </p>
            </div>
            <svg class="w-5 h-5 text-surface-300 dark:text-surface-600 group-hover:text-accent-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>

    <!-- Create Modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      @click.self="closeCreateModal"
    >
      <div class="w-full max-w-lg rounded-2xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-xl overflow-hidden">
        <div class="px-5 py-4 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <h2 class="text-base font-semibold text-surface-900 dark:text-white">New State Machine</h2>
          <button
            @click="closeCreateModal"
            class="p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Name *</label>
            <input
              v-model="newMachineName"
              type="text"
              placeholder="e.g. sales_qualification_v2"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Version</label>
            <input
              v-model="newMachineVersion"
              type="text"
              placeholder="1.0.0"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Create from</label>
            <select
              v-model="sourceMachineId"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            >
              <option v-for="option in sourceOptions" :key="option.id || 'blank'" :value="option.id">
                {{ option.label }}
              </option>
            </select>
            <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
              Pick an existing state machine to clone its states, transitions, and visualization.
            </p>
          </div>

          <div
            v-if="createError"
            class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-300"
          >
            {{ createError }}
          </div>
        </div>

        <div class="px-5 py-4 border-t border-surface-200 dark:border-surface-700 flex items-center justify-end gap-2">
          <button
            @click="closeCreateModal"
            class="px-3 py-2 text-sm text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            @click="createMachine"
            :disabled="creating"
            class="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
