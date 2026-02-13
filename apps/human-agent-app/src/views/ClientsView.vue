<script setup lang="ts">
/**
 * ClientsView - List and manage client configurations
 */
import { onMounted } from 'vue';
import { useClientsStore } from '@/stores/clients';
import { useRouter } from 'vue-router';

const router = useRouter();
const store = useClientsStore();

function openClient(id: string) {
  router.push(`/clients/${id}`);
}

function createNew() {
  router.push('/clients/new');
}

function goBack() {
  router.push('/');
}

function getBusinessName(config: Record<string, unknown>): string {
  const business = config?.business as Record<string, unknown> | undefined;
  return (business?.name as string) || 'Unnamed Client';
}

onMounted(() => {
  store.fetchClients();
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
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white">Clients</h1>
            <p class="text-xs text-surface-500 dark:text-surface-400">{{ store.clientCount }} configurations</p>
          </div>
        </div>
        <button
          @click="createNew"
          class="w-9 h-9 flex items-center justify-center rounded-lg bg-accent-600 hover:bg-accent-700 text-white transition-colors"
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
          <p class="text-sm text-surface-500">Loading clients...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="store.error && !store.clients.length" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">Failed to load</p>
          <p class="text-sm text-surface-500 mt-1">{{ store.error }}</p>
          <button @click="store.fetchClients()" class="mt-3 text-sm text-accent-500 hover:text-accent-400 font-medium">
            Try again
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="!store.clients.length && !store.loading" class="flex items-center justify-center py-20 px-4">
        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <p class="text-surface-900 dark:text-white font-medium">No clients configured</p>
          <p class="text-sm text-surface-500 mt-1">Create your first client to get started</p>
          <button @click="createNew" class="mt-4 px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium rounded-lg transition-colors">
            Create Client
          </button>
        </div>
      </div>

      <!-- Client List -->
      <div v-else class="p-4 space-y-3 max-w-3xl mx-auto">
        <button
          v-for="client in store.clients"
          :key="client.id"
          @click="openClient(client.id)"
          class="w-full text-left bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden hover:border-accent-300 dark:hover:border-accent-700 transition-colors group"
        >
          <div class="px-4 py-4 flex items-center justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-semibold text-sm text-surface-900 dark:text-white truncate">
                  {{ getBusinessName(client.config) }}
                </h3>
                <span
                  :class="[
                    'flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full',
                    client.is_active
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                  ]"
                >
                  {{ client.is_active ? 'Active' : 'Inactive' }}
                </span>
                <span v-if="client.channel_type" class="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 uppercase">
                  {{ client.channel_type }}
                </span>
              </div>
              <p class="mt-1 font-mono text-xs text-surface-500 dark:text-surface-400">
                {{ client.client_id }}
              </p>
              <div class="mt-1.5 flex items-center gap-3 text-xs text-surface-400 dark:text-surface-500">
                <span v-if="client.state_machine_name">{{ client.state_machine_name }}</span>
                <span class="text-surface-300 dark:text-surface-600">·</span>
                <span>{{ client.schema_name }}</span>
              </div>
            </div>
            <svg class="w-5 h-5 text-surface-300 dark:text-surface-600 group-hover:text-accent-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
