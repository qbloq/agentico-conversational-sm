/**
 * State Machines Store - Manage state machine configurations
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listStateMachines,
  getStateMachine,
  saveStateMachine,
  type StateMachineSummary,
  type StateMachine,
} from '@/api/client';

export const useStateMachinesStore = defineStore('stateMachines', () => {
  // State
  const machines = ref<StateMachineSummary[]>([]);
  const currentMachine = ref<StateMachine | null>(null);
  const loading = ref(false);
  const loadingDetail = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const activeMachines = computed(() => machines.value.filter(m => m.is_active));
  const machineCount = computed(() => machines.value.length);
  const stateCount = computed(() =>
    currentMachine.value ? Object.keys(currentMachine.value.states).length : 0
  );

  // Actions
  async function fetchMachines(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const data = await listStateMachines();
      machines.value = Array.isArray(data) ? data : [];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load state machines';
      console.error('[StateMachinesStore] fetchMachines error:', e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchMachine(id: string): Promise<void> {
    loadingDetail.value = true;
    error.value = null;

    try {
      currentMachine.value = await getStateMachine(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load state machine';
      console.error('[StateMachinesStore] fetchMachine error:', e);
    } finally {
      loadingDetail.value = false;
    }
  }

  async function saveMachine(
    machine: Pick<StateMachine, 'name' | 'version' | 'initial_state' | 'states' | 'visualization'> & { id?: string }
  ): Promise<boolean> {
    saving.value = true;
    error.value = null;

    try {
      const saved = await saveStateMachine(machine);
      currentMachine.value = saved;
      // Update list entry
      const idx = machines.value.findIndex(m => m.id === saved.id);
      if (idx >= 0) {
        machines.value[idx] = {
          id: saved.id,
          name: saved.name,
          version: saved.version,
          is_active: saved.is_active,
          created_at: saved.created_at,
          updated_at: saved.updated_at,
        };
      } else {
        machines.value.unshift({
          id: saved.id,
          name: saved.name,
          version: saved.version,
          is_active: saved.is_active,
          created_at: saved.created_at,
          updated_at: saved.updated_at,
        });
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save state machine';
      console.error('[StateMachinesStore] saveMachine error:', e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  function clearCurrent() {
    currentMachine.value = null;
  }

  return {
    // State
    machines,
    currentMachine,
    loading,
    loadingDetail,
    saving,
    error,
    // Computed
    activeMachines,
    machineCount,
    stateCount,
    // Actions
    fetchMachines,
    fetchMachine,
    saveMachine,
    clearCurrent,
  };
});
