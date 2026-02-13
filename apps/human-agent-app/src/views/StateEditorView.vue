<script setup lang="ts">
/**
 * StateEditorView - Edit individual states within a state machine,
 * including follow-up sequence configuration.
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useStateMachinesStore } from '@/stores/stateMachines';
import { useFollowupsStore } from '@/stores/followups';
import { useRoute, useRouter } from 'vue-router';
import type { StateConfig } from '@/api/client';

const route = useRoute();
const router = useRouter();
const smStore = useStateMachinesStore();
const fuStore = useFollowupsStore();

// UI State
const selectedState = ref<string | null>(null);
const showStateEditor = ref(false);
const hasUnsavedChanges = ref(false);
const saveSuccess = ref(false);

// Editor form - deep copy of the selected state
const editorForm = ref<StateConfig>({
  state: '',
  objective: '',
  description: '',
  completionSignals: [],
  ragCategories: [],
  allowedTransitions: [],
  transitionGuidance: {},
  maxMessages: undefined,
  followupSequence: [],
});

// Temp inputs for array fields
const newSignal = ref('');
const newCategory = ref('');

// Track which followup steps are newly added (not yet saved)
const newStepIndices = ref<Set<number>>(new Set());
const savingSequence = ref(false);

// Computed
const machineId = computed(() => route.params.id as string);
const machine = computed(() => smStore.currentMachine);
const stateNames = computed(() =>
  machine.value ? Object.keys(machine.value.states).sort() : []
);
const availableTransitions = computed(() =>
  stateNames.value.filter(s => s !== selectedState.value)
);
const followupConfigNames = computed(() =>
  fuStore.configs.map(c => c.name)
);

// Watchers
watch(selectedState, (name) => {
  if (name && machine.value) {
    loadStateIntoEditor(name);
    showStateEditor.value = true;
  }
});

// Actions
function loadStateIntoEditor(stateName: string) {
  if (!machine.value) return;
  const config = machine.value.states[stateName];
  if (!config) return;

  editorForm.value = {
    state: config.state || stateName,
    objective: config.objective || '',
    description: config.description || '',
    completionSignals: [...(config.completionSignals || [])],
    ragCategories: [...(config.ragCategories || [])],
    allowedTransitions: [...(config.allowedTransitions || [])],
    transitionGuidance: { ...(config.transitionGuidance || {}) },
    maxMessages: config.maxMessages,
    followupSequence: (config.followupSequence || []).map(f => ({ ...f })),
  };
  hasUnsavedChanges.value = false;
  newStepIndices.value.clear();
}

function markDirty() {
  hasUnsavedChanges.value = true;
  saveSuccess.value = false;
}

// Array field helpers
function addSignal() {
  if (newSignal.value.trim()) {
    editorForm.value.completionSignals.push(newSignal.value.trim());
    newSignal.value = '';
    markDirty();
  }
}
function removeSignal(idx: number) {
  editorForm.value.completionSignals.splice(idx, 1);
  markDirty();
}

function addCategory() {
  if (newCategory.value.trim()) {
    editorForm.value.ragCategories.push(newCategory.value.trim());
    newCategory.value = '';
    markDirty();
  }
}
function removeCategory(idx: number) {
  editorForm.value.ragCategories.splice(idx, 1);
  markDirty();
}

function toggleTransition(state: string) {
  const idx = editorForm.value.allowedTransitions.indexOf(state);
  if (idx >= 0) {
    editorForm.value.allowedTransitions.splice(idx, 1);
    delete editorForm.value.transitionGuidance[state];
  } else {
    editorForm.value.allowedTransitions.push(state);
    editorForm.value.transitionGuidance[state] = '';
  }
  markDirty();
}

function updateGuidance(state: string, value: string) {
  editorForm.value.transitionGuidance[state] = value;
  markDirty();
}

// Follow-up sequence helpers

/** Parse interval string (e.g. '15m', '2h', '1d', '1w') to milliseconds for sorting */
function intervalToMs(interval: string): number {
  const match = interval.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i);
  if (!match) return Infinity; // unparseable goes to end
  const val = parseFloat(match[1]);
  switch (match[2].toLowerCase()) {
    case 'm': return val * 60_000;
    case 'h': return val * 3_600_000;
    case 'd': return val * 86_400_000;
    case 'w': return val * 604_800_000;
    default: return Infinity;
  }
}

function addFollowupStep() {
  if (!editorForm.value.followupSequence) {
    editorForm.value.followupSequence = [];
  }
  const newIdx = editorForm.value.followupSequence.length;
  editorForm.value.followupSequence.push({ interval: '', configName: '' });
  newStepIndices.value.add(newIdx);
}

function removeFollowupStep(idx: number) {
  editorForm.value.followupSequence?.splice(idx, 1);
  // Rebuild newStepIndices after splice
  const updated = new Set<number>();
  for (const i of newStepIndices.value) {
    if (i < idx) updated.add(i);
    else if (i > idx) updated.add(i - 1);
    // i === idx is removed
  }
  newStepIndices.value = updated;
  markDirty();
}

/** Save only the followupSequence for the current state, sorted by interval */
async function saveFollowupSequence() {
  if (!machine.value || !selectedState.value) return;
  savingSequence.value = true;

  // Sort by interval ascending
  const sorted = [...(editorForm.value.followupSequence || [])]
    .filter(s => s.interval && s.configName)
    .sort((a, b) => intervalToMs(a.interval) - intervalToMs(b.interval));

  // Update editor form with sorted sequence
  editorForm.value.followupSequence = sorted;

  // Apply only followupSequence to the machine state
  machine.value.states[selectedState.value] = {
    ...machine.value.states[selectedState.value],
    followupSequence: sorted,
  };

  const success = await smStore.saveMachine({
    id: machine.value.id,
    name: machine.value.name,
    version: machine.value.version,
    initial_state: machine.value.initial_state,
    states: machine.value.states,
    visualization: machine.value.visualization,
  });

  if (success) {
    newStepIndices.value.clear();
    saveSuccess.value = true;
    hasUnsavedChanges.value = false;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  }
  savingSequence.value = false;
}

// Apply state changes to the local machine object
function applyStateChanges() {
  if (!machine.value || !selectedState.value) return;
  // Always sort followupSequence by interval before applying
  if (editorForm.value.followupSequence?.length) {
    editorForm.value.followupSequence = editorForm.value.followupSequence
      .filter(s => s.interval && s.configName)
      .sort((a, b) => intervalToMs(a.interval) - intervalToMs(b.interval));
  }
  machine.value.states[selectedState.value] = { ...editorForm.value };
  hasUnsavedChanges.value = false;
}

// Save entire machine to backend
async function saveMachine() {
  if (!machine.value) return;

  // Apply current editor changes first
  if (hasUnsavedChanges.value && selectedState.value) {
    applyStateChanges();
  }

  const success = await smStore.saveMachine({
    id: machine.value.id,
    name: machine.value.name,
    version: machine.value.version,
    initial_state: machine.value.initial_state,
    states: machine.value.states,
    visualization: machine.value.visualization,
  });

  if (success) {
    saveSuccess.value = true;
    hasUnsavedChanges.value = false;
    setTimeout(() => { saveSuccess.value = false; }, 3000);
  }
}

function goBack() {
  smStore.clearCurrent();
  router.push('/state-machines');
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

onMounted(() => {
  smStore.fetchMachine(machineId.value);
  fuStore.fetchConfigs();
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
            class="p-1 -ml-1 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div v-if="machine">
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white font-mono">{{ machine.name }}</h1>
            <p class="text-xs text-surface-500 dark:text-surface-400">
              v{{ machine.version }} · {{ Object.keys(machine.states).length }} states · Updated {{ formatDate(machine.updated_at) }}
            </p>
          </div>
          <div v-else>
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white">Loading...</h1>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="saveSuccess" class="text-xs text-emerald-500 font-medium">Saved!</span>
          <button
            @click="saveMachine"
            :disabled="smStore.saving"
            :class="[
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors active:scale-95',
              smStore.saving
                ? 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                : 'bg-accent-600 hover:bg-accent-700 text-white'
            ]"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            {{ smStore.saving ? 'Saving...' : 'Save All' }}
          </button>
        </div>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="smStore.loadingDetail" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        <p class="text-sm text-surface-500">Loading state machine...</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="smStore.error && !machine" class="flex-1 flex items-center justify-center px-4">
      <div class="text-center">
        <p class="text-surface-900 dark:text-white font-medium">Failed to load</p>
        <p class="text-sm text-surface-500 mt-1">{{ smStore.error }}</p>
        <button @click="smStore.fetchMachine(machineId)" class="mt-3 text-sm text-accent-500 font-medium">Try again</button>
      </div>
    </div>

    <!-- Main Content: Two-panel layout -->
    <div v-else-if="machine" class="flex-1 flex overflow-hidden">
      <!-- States List (Left Panel) -->
      <div class="w-64 lg:w-72 flex-shrink-0 border-r border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 overflow-y-auto"
           :class="{ 'hidden sm:block': showStateEditor }">
        <div class="p-3">
          <p class="text-[11px] font-medium text-surface-400 uppercase tracking-wider mb-2 px-1">States</p>
          <div class="space-y-1">
            <button
              v-for="name in stateNames"
              :key="name"
              @click="selectedState = name"
              :class="[
                'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                selectedState === name
                  ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-300 font-medium'
                  : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'
              ]"
            >
              <div class="flex items-center gap-2">
                <span
                  :class="[
                    'w-2 h-2 rounded-full flex-shrink-0',
                    name === machine.initial_state
                      ? 'bg-emerald-500'
                      : machine.states[name]?.followupSequence?.length
                        ? 'bg-amber-500'
                        : 'bg-surface-300 dark:bg-surface-600'
                  ]"
                />
                <span class="font-mono text-xs truncate">{{ name }}</span>
              </div>
            </button>
          </div>
          <div class="mt-3 px-1 space-y-1 text-[10px] text-surface-400">
            <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500" /> Initial state</div>
            <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500" /> Has follow-up sequence</div>
          </div>
        </div>
      </div>

      <!-- State Editor (Right Panel) -->
      <div class="flex-1 overflow-y-auto">
        <!-- No state selected -->
        <div v-if="!selectedState" class="flex items-center justify-center h-full px-4">
          <div class="text-center">
            <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
              <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <p class="text-surface-900 dark:text-white font-medium">Select a state to edit</p>
            <p class="text-sm text-surface-500 mt-1">Choose from the list on the left</p>
          </div>
        </div>

        <!-- State Editor Form -->
        <div v-else class="p-4 lg:p-6 max-w-3xl space-y-6">
          <!-- State Header -->
          <div class="flex items-center justify-between">
            <div>
              <div class="flex items-center gap-2">
                <!-- Mobile back button -->
                <button @click="showStateEditor = false; selectedState = null" class="sm:hidden p-1 -ml-1 text-surface-400">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 class="text-lg font-semibold font-mono text-surface-900 dark:text-white">{{ selectedState }}</h2>
                <span v-if="selectedState === machine.initial_state" class="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
                  Initial
                </span>
              </div>
            </div>
            <button
              v-if="hasUnsavedChanges"
              @click="applyStateChanges"
              class="text-xs text-accent-500 hover:text-accent-400 font-medium"
            >
              Apply Changes
            </button>
          </div>

          <!-- Objective -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Objective</label>
            <input
              v-model="editorForm.objective"
              @input="markDirty"
              type="text"
              class="w-full px-3 py-2.5 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            />
          </section>

          <!-- Description -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Description</label>
            <textarea
              v-model="editorForm.description"
              @input="markDirty"
              rows="6"
              class="w-full px-3 py-2.5 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-y"
            />
          </section>

          <!-- Max Messages -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Max Messages</label>
            <input
              v-model.number="editorForm.maxMessages"
              @input="markDirty"
              type="number"
              min="1"
              max="50"
              placeholder="No limit"
              class="w-32 px-3 py-2.5 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            />
          </section>

          <!-- Completion Signals -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Completion Signals</label>
            <div class="space-y-1.5 mb-2">
              <div v-for="(signal, idx) in editorForm.completionSignals" :key="idx" class="flex items-center gap-2">
                <span class="flex-1 px-3 py-1.5 bg-surface-100 dark:bg-surface-700 rounded-lg text-sm text-surface-700 dark:text-surface-300">{{ signal }}</span>
                <button @click="removeSignal(idx)" class="p-1 text-surface-400 hover:text-red-500 rounded">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            <div class="flex gap-2">
              <input v-model="newSignal" @keyup.enter="addSignal" type="text" placeholder="Add signal..." class="flex-1 px-3 py-2 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50" />
              <button @click="addSignal" class="px-3 py-2 text-sm font-medium text-accent-500 hover:text-accent-400">Add</button>
            </div>
          </section>

          <!-- RAG Categories -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">RAG Categories</label>
            <div class="flex flex-wrap gap-1.5 mb-2">
              <span v-for="(cat, idx) in editorForm.ragCategories" :key="idx" class="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
                {{ cat }}
                <button @click="removeCategory(idx)" class="ml-0.5 hover:text-red-500">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            </div>
            <div class="flex gap-2">
              <input v-model="newCategory" @keyup.enter="addCategory" type="text" placeholder="Add category..." class="flex-1 px-3 py-2 rounded-lg border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50" />
              <button @click="addCategory" class="px-3 py-2 text-sm font-medium text-accent-500 hover:text-accent-400">Add</button>
            </div>
          </section>

          <!-- Allowed Transitions & Guidance -->
          <section>
            <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Allowed Transitions</label>
            <div class="space-y-2">
              <div v-for="state in availableTransitions" :key="state" class="rounded-lg border border-surface-200 dark:border-surface-600 overflow-hidden">
                <div class="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    :checked="editorForm.allowedTransitions.includes(state)"
                    @change="toggleTransition(state)"
                    class="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-accent-600 focus:ring-accent-500"
                  />
                  <span class="font-mono text-xs text-surface-800 dark:text-surface-200">{{ state }}</span>
                </div>
                <div v-if="editorForm.allowedTransitions.includes(state)" class="px-3 pb-2">
                  <input
                    :value="editorForm.transitionGuidance[state] || ''"
                    @input="updateGuidance(state, ($event.target as HTMLInputElement).value)"
                    type="text"
                    placeholder="When to transition here..."
                    class="w-full px-2.5 py-1.5 rounded border bg-surface-50 dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs text-surface-700 dark:text-surface-300 placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- Follow-up Sequence -->
          <section class="pb-8">
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-medium text-surface-700 dark:text-surface-300">Follow-up Sequence</label>
              <button @click="addFollowupStep" class="flex items-center gap-1 text-xs text-accent-500 hover:text-accent-400 font-medium">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                Add Step
              </button>
            </div>

            <div v-if="!editorForm.followupSequence?.length" class="text-center py-4 text-sm text-surface-400 bg-surface-50 dark:bg-surface-700/50 rounded-lg border border-dashed border-surface-200 dark:border-surface-600">
              No follow-up sequence configured for this state
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="(step, idx) in editorForm.followupSequence"
                :key="idx"
                :class="[
                  'flex items-center gap-2 p-3 rounded-lg border transition-colors',
                  newStepIndices.has(idx)
                    ? 'bg-accent-50 dark:bg-accent-900/20 border-accent-300 dark:border-accent-700'
                    : 'bg-surface-50 dark:bg-surface-700/50 border-surface-200 dark:border-surface-600'
                ]"
              >
                <span class="text-xs font-medium text-surface-400 w-6 text-center">{{ idx + 1 }}</span>
                <div class="flex-1 flex items-center gap-2">
                  <div class="flex-shrink-0">
                    <label class="text-[10px] text-surface-400 uppercase">Interval</label>
                    <input
                      v-model="step.interval"
                      @input="markDirty"
                      type="text"
                      placeholder="e.g. 2h"
                      class="w-20 px-2 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs font-mono text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    />
                  </div>
                  <div class="flex-1">
                    <label class="text-[10px] text-surface-400 uppercase">Config Name</label>
                    <select
                      v-model="step.configName"
                      @change="markDirty"
                      class="w-full px-2 py-1.5 rounded border bg-white dark:bg-surface-700 border-surface-200 dark:border-surface-600 text-xs font-mono text-surface-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-accent-500/50"
                    >
                      <option value="">— Select config —</option>
                      <option v-for="name in followupConfigNames" :key="name" :value="name">{{ name }}</option>
                    </select>
                  </div>
                </div>
                <!-- Inline Save button for new steps once configName is filled -->
                <button
                  v-if="newStepIndices.has(idx) && step.configName && step.interval"
                  @click="saveFollowupSequence"
                  :disabled="savingSequence"
                  class="flex-shrink-0 px-2.5 py-1.5 text-xs font-medium text-white bg-accent-600 hover:bg-accent-700 rounded-lg transition-colors active:scale-95 disabled:opacity-50 self-end mb-0.5"
                >
                  {{ savingSequence ? 'Saving...' : 'Save' }}
                </button>
                <button @click="removeFollowupStep(idx)" class="p-1 text-surface-400 hover:text-red-500 rounded self-end mb-0.5">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <p class="text-[11px] text-surface-400 px-1">
                Intervals: <code class="bg-surface-200 dark:bg-surface-600 px-1 rounded">15m</code>
                <code class="bg-surface-200 dark:bg-surface-600 px-1 rounded">2h</code>
                <code class="bg-surface-200 dark:bg-surface-600 px-1 rounded">1d</code>
                <code class="bg-surface-200 dark:bg-surface-600 px-1 rounded">1w</code>
                — Saved sequences are automatically sorted by interval (shortest first).
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="smStore.error" class="flex-shrink-0 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
      <p class="text-xs text-red-600 dark:text-red-400">{{ smStore.error }}</p>
    </div>
  </div>
</template>
