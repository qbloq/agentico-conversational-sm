/**
 * Followup Configs Store - Manage follow-up configuration registry
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listFollowupConfigs,
  upsertFollowupConfig,
  deleteFollowupConfig,
  listFollowupQueue,
  cancelFollowupQueueItem,
  cancelSessionFollowups,
  type FollowupConfig,
  type FollowupQueueItem,
} from '@/api/client';

export const useFollowupsStore = defineStore('followups', () => {
  // State - Configs
  const configs = ref<FollowupConfig[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  // State - Queue
  const queue = ref<FollowupQueueItem[]>([]);
  const queueLoading = ref(false);
  const queueFilter = ref<string>('pending');
  const cancelling = ref<Set<string>>(new Set());

  // Computed - Configs
  const textConfigs = computed(() => configs.value.filter(c => c.type === 'text'));
  const templateConfigs = computed(() => configs.value.filter(c => c.type === 'template'));
  const configCount = computed(() => configs.value.length);

  // Computed - Queue
  const pendingCount = computed(() => queue.value.filter(q => q.status === 'pending').length);

  // Actions
  async function fetchConfigs(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const data = await listFollowupConfigs();
      configs.value = Array.isArray(data) ? data : [];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load follow-up configs';
      console.error('[FollowupsStore] fetchConfigs error:', e);
    } finally {
      loading.value = false;
    }
  }

  async function saveConfig(config: Omit<FollowupConfig, 'created_at' | 'updated_at'>): Promise<boolean> {
    saving.value = true;
    error.value = null;

    try {
      const saved = await upsertFollowupConfig(config);
      // Update local state
      const idx = configs.value.findIndex(c => c.name === saved.name);
      if (idx >= 0) {
        configs.value[idx] = saved;
      } else {
        configs.value.push(saved);
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save config';
      console.error('[FollowupsStore] saveConfig error:', e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function removeConfig(name: string): Promise<boolean> {
    saving.value = true;
    error.value = null;

    try {
      await deleteFollowupConfig(name);
      configs.value = configs.value.filter(c => c.name !== name);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete config';
      console.error('[FollowupsStore] removeConfig error:', e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  // Actions - Queue
  async function fetchQueue(status?: string): Promise<void> {
    queueLoading.value = true;
    error.value = null;

    try {
      const data = await listFollowupQueue({ status });
      queue.value = Array.isArray(data) ? data : [];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load follow-up queue';
      console.error('[FollowupsStore] fetchQueue error:', e);
    } finally {
      queueLoading.value = false;
    }
  }

  async function cancelQueueItem(id: string): Promise<boolean> {
    cancelling.value.add(id);
    error.value = null;

    try {
      await cancelFollowupQueueItem(id);
      // Update local state
      const idx = queue.value.findIndex(q => q.id === id);
      if (idx >= 0) {
        queue.value[idx] = { ...queue.value[idx], status: 'cancelled' };
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to cancel follow-up';
      console.error('[FollowupsStore] cancelQueueItem error:', e);
      return false;
    } finally {
      cancelling.value.delete(id);
    }
  }

  async function cancelAllForSession(sessionId: string): Promise<boolean> {
    saving.value = true;
    error.value = null;

    try {
      await cancelSessionFollowups(sessionId);
      // Update local state
      queue.value = queue.value.map(q =>
        q.session_id === sessionId && q.status === 'pending'
          ? { ...q, status: 'cancelled' as const }
          : q
      );
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to cancel session follow-ups';
      console.error('[FollowupsStore] cancelAllForSession error:', e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    // State - Configs
    configs,
    loading,
    saving,
    error,
    // State - Queue
    queue,
    queueLoading,
    queueFilter,
    cancelling,
    // Computed
    textConfigs,
    templateConfigs,
    configCount,
    pendingCount,
    // Actions - Configs
    fetchConfigs,
    saveConfig,
    removeConfig,
    // Actions - Queue
    fetchQueue,
    cancelQueueItem,
    cancelAllForSession,
  };
});
