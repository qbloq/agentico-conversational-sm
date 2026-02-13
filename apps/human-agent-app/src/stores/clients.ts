/**
 * Clients Store - Manage client configurations
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  toggleClientActive,
  listBuckets,
  createBucket,
  listTenantStateMachines,
  type ClientConfigSummary,
  type ClientConfigDetail,
  type StorageBucket,
  type StateMachineOption,
} from '@/api/client';

export const useClientsStore = defineStore('clients', () => {
  // State
  const clients = ref<ClientConfigSummary[]>([]);
  const currentClient = ref<ClientConfigDetail | null>(null);
  const buckets = ref<StorageBucket[]>([]);
  const tenantStateMachines = ref<StateMachineOption[]>([]);
  const loading = ref(false);
  const loadingDetail = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const activeClients = computed(() => clients.value.filter(c => c.is_active));
  const clientCount = computed(() => clients.value.length);

  // Actions
  async function fetchClients(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const data = await listClients();
      clients.value = Array.isArray(data) ? data : [];
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load clients';
      console.error('[ClientsStore] fetchClients error:', e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchClient(id: string): Promise<void> {
    loadingDetail.value = true;
    error.value = null;

    try {
      currentClient.value = await getClient(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load client';
      console.error('[ClientsStore] fetchClient error:', e);
    } finally {
      loadingDetail.value = false;
    }
  }

  async function saveClient(data: Record<string, unknown>): Promise<boolean> {
    saving.value = true;
    error.value = null;

    try {
      const id = data.id as string | undefined;
      let saved: ClientConfigDetail;

      if (id) {
        saved = await updateClient(id, data);
      } else {
        saved = await createClient(data);
      }

      currentClient.value = saved;

      // Update list entry
      const idx = clients.value.findIndex(c => c.id === saved.id);
      if (idx >= 0) {
        clients.value[idx] = saved;
      }

      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save client';
      console.error('[ClientsStore] saveClient error:', e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function toggleActive(id: string): Promise<boolean> {
    error.value = null;

    try {
      const result = await toggleClientActive(id);
      // Update local state
      const idx = clients.value.findIndex(c => c.id === id);
      if (idx >= 0) {
        clients.value[idx] = { ...clients.value[idx], is_active: result.is_active };
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to toggle client status';
      console.error('[ClientsStore] toggleActive error:', e);
      return false;
    }
  }

  async function fetchBuckets(): Promise<void> {
    try {
      const data = await listBuckets();
      buckets.value = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('[ClientsStore] fetchBuckets error:', e);
    }
  }

  async function createNewBucket(name: string): Promise<boolean> {
    try {
      const bucket = await createBucket(name);
      buckets.value.push(bucket);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create bucket';
      console.error('[ClientsStore] createNewBucket error:', e);
      return false;
    }
  }

  async function fetchStateMachines(schema: string): Promise<void> {
    try {
      const data = await listTenantStateMachines(schema);
      tenantStateMachines.value = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('[ClientsStore] fetchStateMachines error:', e);
    }
  }

  function clearCurrent() {
    currentClient.value = null;
  }

  return {
    // State
    clients,
    currentClient,
    buckets,
    tenantStateMachines,
    loading,
    loadingDetail,
    saving,
    error,
    // Computed
    activeClients,
    clientCount,
    // Actions
    fetchClients,
    fetchClient,
    saveClient,
    toggleActive,
    fetchBuckets,
    createNewBucket,
    fetchStateMachines,
    clearCurrent,
  };
});
