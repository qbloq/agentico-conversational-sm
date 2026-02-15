<script setup lang="ts">
/**
 * SidebarNav - Desktop sidebar navigation
 */

import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';
import { useSessionsStore } from '@/stores/sessions';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const escalations = useEscalationsStore();
const sessions = useSessionsStore();
const auth = useAuthStore();

const clientDropdownOpen = ref(false);

function handleClientSwitch(clientId: string) {
  if (clientId === auth.activeClientId) {
    clientDropdownOpen.value = false;
    return;
  }
  auth.switchClient(clientId);
  clientDropdownOpen.value = false;
  // Reload data for the new client
  escalations.fetchEscalations();
  sessions.fetchSessions();
  // Navigate to home if in a detail view
  if (route.name === 'chat' || route.name === 'conversation') {
    router.push('/');
  }
}

const navItems = [
  { name: 'Escalations', route: '/', icon: 'bell' },
  { name: 'All Chats', route: '/chats', icon: 'chat' },
  { name: 'Follow-ups', route: '/followups', icon: 'clock', requiredLevel: 'admin' as const },
  { name: 'State Machines', route: '/state-machines', icon: 'cpu', requiredLevel: 'admin' as const },
  { name: 'Clients', route: '/clients', icon: 'clients', requiredLevel: 'admin' as const },
  { name: 'Agents', route: '/agents', icon: 'agents', requiredLevel: 'admin' as const },
];

const visibleNavItems = computed(() =>
  navItems.filter((item) => {
    if (!item.requiredLevel) return true;
    return auth.hasLevel(item.requiredLevel);
  })
);

const isActive = (itemRoute: string) => {
  if (itemRoute === '/') {
    return route.path === '/' || route.path.startsWith('/chat/');
  }
  return route.path.startsWith(itemRoute);
};

function navigate(itemRoute: string) {
  router.push(itemRoute);
}


</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header / Branding -->
    <div class="flex-shrink-0 flex items-center px-6 h-16 border-b border-surface-200 dark:border-surface-700">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <span class="font-semibold text-surface-900 dark:text-white text-lg">Agent Hub</span>
      </div>
    </div>

    <!-- Client Switcher -->
    <div v-if="auth.availableClients.length > 0" class="flex-shrink-0 px-3 py-2 border-b border-surface-200 dark:border-surface-700">
      <div class="relative">
        <button
          @click="clientDropdownOpen = !clientDropdownOpen"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-left"
        >
          <div class="w-6 h-6 rounded bg-primary-600/20 flex items-center justify-center flex-shrink-0">
            <svg class="w-3.5 h-3.5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-surface-900 dark:text-white truncate">
              {{ auth.activeClient?.business_name || 'Select Client' }}
            </p>
          </div>
          <svg 
            v-if="auth.hasMultipleClients"
            :class="['w-4 h-4 text-surface-400 transition-transform', clientDropdownOpen ? 'rotate-180' : '']"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Dropdown -->
        <div 
          v-if="clientDropdownOpen && auth.hasMultipleClients"
          class="absolute z-50 mt-1 left-0 right-0 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            v-for="client in auth.availableClients"
            :key="client.client_id"
            @click="handleClientSwitch(client.client_id)"
            :class="[
              'w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors',
              client.client_id === auth.activeClientId
                ? 'bg-accent-600/10 text-accent-500'
                : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'
            ]"
          >
            <svg 
              v-if="client.client_id === auth.activeClientId"
              class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <div v-else class="w-4 h-4 flex-shrink-0"></div>
            <span class="truncate">{{ client.business_name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Navigation Items -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <button
        v-for="item in visibleNavItems"
        :key="item.name"
        @click="navigate(item.route)"
        :class="[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
          isActive(item.route)
            ? 'bg-accent-600/20 text-accent-500 border border-accent-600/30'
            : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-white'
        ]"
      >
        <!-- Bell Icon -->
        <template v-if="item.icon === 'bell'">
          <div class="relative">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span 
              v-if="escalations.openCount > 0"
              class="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center bg-accent-600 text-white text-[10px] font-bold rounded-full"
            >
              {{ escalations.openCount > 9 ? '9+' : escalations.openCount }}
            </span>
          </div>
        </template>

        <!-- Chat Icon -->
        <template v-else-if="item.icon === 'chat'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </template>

        <!-- Clock Icon (Follow-ups) -->
        <template v-else-if="item.icon === 'clock'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </template>

        <!-- CPU Icon (State Machines) -->
        <template v-else-if="item.icon === 'cpu'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </template>

        <!-- Building Icon (Clients) -->
        <template v-else-if="item.icon === 'clients'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </template>

        <!-- Users Icon (Agents) -->
        <template v-else-if="item.icon === 'agents'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </template>

        <span class="font-medium">{{ item.name }}</span>

        <!-- Count badge for escalations -->
        <span 
          v-if="item.icon === 'bell' && escalations.openCount > 0 && !isActive(item.route)"
          class="ml-auto text-xs bg-surface-700 text-surface-300 px-2 py-0.5 rounded-full"
        >
          {{ escalations.openCount }}
        </span>
      </button>
    </nav>

    <!-- User Profile Footer -->
    <div class="flex-shrink-0 p-3 border-t border-surface-200 dark:border-surface-700">
      <button
        @click="navigate('/profile')"
        :class="[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
          isActive('/profile')
            ? 'bg-accent-600/20 text-accent-500 border border-accent-600/30'
            : 'text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-white'
        ]"
      >
        <div class="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-medium">
          {{ auth.agent?.firstName?.charAt(0) || 'A' }}
        </div>
        <div class="flex-1 min-w-0 text-left">
          <p class="text-sm font-medium truncate">
            {{ auth.agent?.firstName || 'Agent' }} {{ auth.agent?.lastName || '' }}
          </p>
          <p class="text-xs text-surface-500 truncate">{{ auth.agent?.phone }}</p>
        </div>
        <svg class="w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>
