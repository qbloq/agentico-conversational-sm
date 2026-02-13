<script setup lang="ts">
/**
 * AgentsView - Manage human agents and their client access
 */
import { ref, onMounted, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useClientsStore } from '@/stores/clients';
import {
  listAgents,
  updateAgentClients,
  type HumanAgent,
} from '@/api/client';

const auth = useAuthStore();
const clientsStore = useClientsStore();

const agents = ref<HumanAgent[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref<string | null>(null); // agentId being saved
const editingAgent = ref<string | null>(null); // agentId being edited
const editClientIds = ref<string[]>([]);

const schemaClients = computed(() =>
  clientsStore.clients.filter(c => c.schema_name === auth.clientSchema)
);

onMounted(async () => {
  loading.value = true;
  try {
    await clientsStore.fetchClients();
    agents.value = await listAgents(auth.clientSchema);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load agents';
  } finally {
    loading.value = false;
  }
});

function getAgentName(agent: HumanAgent): string {
  if (agent.first_name) {
    return `${agent.first_name}${agent.last_name ? ' ' + agent.last_name : ''}`;
  }
  return agent.phone;
}

function getClientNames(agent: HumanAgent): string {
  if (!agent.allowed_client_ids || agent.allowed_client_ids.length === 0) {
    return 'All clients';
  }
  return agent.allowed_client_ids
    .map(id => {
      const client = schemaClients.value.find(c => c.client_id === id);
      return client?.config?.business?.name || id;
    })
    .join(', ');
}

function startEditing(agent: HumanAgent) {
  editingAgent.value = agent.id;
  editClientIds.value = agent.allowed_client_ids ? [...agent.allowed_client_ids] : [];
}

function cancelEditing() {
  editingAgent.value = null;
  editClientIds.value = [];
}

function toggleClientId(clientId: string) {
  const idx = editClientIds.value.indexOf(clientId);
  if (idx >= 0) {
    editClientIds.value.splice(idx, 1);
  } else {
    editClientIds.value.push(clientId);
  }
}

async function saveAgentClients(agentId: string) {
  saving.value = agentId;
  error.value = null;

  try {
    // If all clients are selected or none, set to null (= all access)
    const ids = editClientIds.value.length === 0 || editClientIds.value.length === schemaClients.value.length
      ? null
      : editClientIds.value;

    await updateAgentClients(auth.clientSchema, agentId, ids);

    // Update local state
    const idx = agents.value.findIndex(a => a.id === agentId);
    if (idx >= 0) {
      agents.value[idx] = { ...agents.value[idx], allowed_client_ids: ids };
    }

    editingAgent.value = null;
    editClientIds.value = [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to update agent';
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-surface-900 dark:text-white">Agent Access</h1>
          <p class="text-sm text-surface-600 dark:text-surface-400">
            Manage which clients each agent can access
          </p>
        </div>
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center h-full">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="p-4">
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
          {{ error }}
        </div>
      </div>

      <!-- Agent List -->
      <div v-else class="p-4 sm:p-6 max-w-2xl mx-auto space-y-3">
        <div v-if="schemaClients.length <= 1" class="text-center py-8 text-surface-500 dark:text-surface-400">
          <p>Only one client exists in this schema.</p>
          <p class="text-sm mt-1">Add more clients to manage agent access.</p>
        </div>

        <div
          v-for="agent in agents"
          :key="agent.id"
          class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden"
        >
          <!-- Agent Header -->
          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
                :class="agent.is_active ? 'bg-primary-600' : 'bg-surface-400'"
              >
                {{ agent.first_name?.charAt(0) || agent.phone.charAt(0) }}
              </div>
              <div class="min-w-0">
                <p class="font-medium text-surface-900 dark:text-white truncate">
                  {{ getAgentName(agent) }}
                </p>
                <p class="text-xs text-surface-500 truncate">{{ agent.phone }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="!agent.is_active"
                class="text-xs px-2 py-0.5 bg-surface-200 dark:bg-surface-700 text-surface-500 rounded-full"
              >
                Inactive
              </span>
              <button
                v-if="editingAgent !== agent.id && schemaClients.length > 1"
                @click="startEditing(agent)"
                class="text-xs px-3 py-1.5 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-700 dark:text-surface-300 rounded-lg transition-colors"
              >
                Edit
              </button>
            </div>
          </div>

          <!-- Current Access (non-editing) -->
          <div v-if="editingAgent !== agent.id" class="px-4 pb-3">
            <p class="text-xs text-surface-500 mb-1">Client access:</p>
            <p class="text-sm text-surface-700 dark:text-surface-300">
              {{ getClientNames(agent) }}
            </p>
          </div>

          <!-- Editing Mode -->
          <div v-else class="px-4 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3">
            <p class="text-xs text-surface-500 mb-2">Select clients this agent can access:</p>
            <div class="space-y-2 mb-3">
              <label
                v-for="client in schemaClients"
                :key="client.client_id"
                class="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="editClientIds.includes(client.client_id)"
                  @change="toggleClientId(client.client_id)"
                  class="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-accent-600 focus:ring-accent-500"
                />
                <span class="text-sm text-surface-700 dark:text-surface-300">
                  {{ client.config?.business?.name || client.client_id }}
                </span>
              </label>
            </div>
            <p class="text-xs text-surface-400 mb-3">
              Leave all unchecked to grant access to all clients.
            </p>
            <div class="flex items-center gap-2">
              <button
                @click="saveAgentClients(agent.id)"
                :disabled="saving === agent.id"
                class="px-4 py-1.5 bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {{ saving === agent.id ? 'Saving...' : 'Save' }}
              </button>
              <button
                @click="cancelEditing"
                class="px-4 py-1.5 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
