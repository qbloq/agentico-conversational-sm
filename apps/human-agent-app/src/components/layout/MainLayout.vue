<script setup lang="ts">
/**
 * MainLayout - Responsive layout wrapper
 * 
 * Mobile: Content + bottom tabs
 * Desktop: Sidebar + content (master-detail)
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BottomNav from './BottomNav.vue';
import SidebarNav from './SidebarNav.vue';
import { useNotificationStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { useEscalationsStore } from '@/stores/escalations';
import { useSessionsStore } from '@/stores/sessions';

const route = useRoute();
const router = useRouter();
const notificationStore = useNotificationStore();
const auth = useAuthStore();
const escalations = useEscalationsStore();
const sessions = useSessionsStore();

const mobileClientDropdownOpen = ref(false);

function handleMobileClientSwitch(clientId: string) {
  if (clientId === auth.activeClientId) {
    mobileClientDropdownOpen.value = false;
    return;
  }
  auth.switchClient(clientId);
  mobileClientDropdownOpen.value = false;
  escalations.fetchEscalations();
  sessions.fetchSessions();
  if (route.name === 'chat' || route.name === 'conversation') {
    router.push('/');
  }
}

// Routes that shouldn't show navigation (login, full-screen chat on mobile)
const hideNav = computed(() => {
  return route.name === 'login';
});

// Check if we're in a detail view (chat)
const isDetailView = computed(() => {
  return route.name === 'chat' || route.name === 'conversation' || route.name === 'client-editor';
});

// Show prompt if supported but not granted/subscribed
const showPrompt = computed(() => {
  return !hideNav.value && 
         notificationStore.isSupported && 
         notificationStore.permission !== 'granted' && 
         !notificationStore.isSubscribed;
});

onMounted(() => {
  if (notificationStore.isSupported) {
    notificationStore.checkSubscription();
  }
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Push Notification Prompt -->
    <div 
      v-if="showPrompt"
      class="bg-indigo-600 dark:bg-indigo-500 text-white px-4 py-2.5 flex items-center justify-between text-sm z-50 animate-in fade-in slide-in-from-top duration-500"
    >
      <div class="flex items-center gap-2 pr-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 opacity-90" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
        <span>
          <span class="font-medium">Get notified of new messages.</span>
          <span class="hidden sm:inline opacity-90 ml-1">Stay updated even when the app is closed.</span>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button 
          @click="notificationStore.subscribe()"
          class="whitespace-nowrap bg-white text-indigo-600 px-3 py-1.5 rounded font-medium text-xs hover:bg-slate-50 transition-colors shadow-sm active:scale-95"
          :disabled="notificationStore.loading"
        >
          {{ notificationStore.loading ? 'Enabling...' : 'Enable Notifications' }}
        </button>
      </div>
    </div>

    <!-- Mobile Client Switcher (hidden on desktop) -->
    <div 
      v-if="!hideNav && !isDetailView && auth.availableClients.length > 1"
      class="lg:hidden flex-shrink-0 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
    >
      <div class="relative px-3 py-2">
        <button
          @click="mobileClientDropdownOpen = !mobileClientDropdownOpen"
          class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-700 text-left"
        >
          <svg class="w-4 h-4 text-primary-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <span class="flex-1 text-sm font-medium text-surface-900 dark:text-white truncate">
            {{ auth.activeClient?.business_name || 'Select Client' }}
          </span>
          <svg 
            :class="['w-4 h-4 text-surface-400 transition-transform', mobileClientDropdownOpen ? 'rotate-180' : '']"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div 
          v-if="mobileClientDropdownOpen"
          class="absolute z-50 mt-1 left-3 right-3 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            v-for="client in auth.availableClients"
            :key="client.client_id"
            @click="handleMobileClientSwitch(client.client_id)"
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

    <div class="flex-1 flex overflow-hidden">
      <!-- Desktop Sidebar (hidden on mobile) -->
      <aside 
        v-if="!hideNav"
        class="hidden lg:flex lg:w-72 xl:w-80 flex-shrink-0 flex-col bg-white dark:bg-surface-900 border-r border-surface-200 dark:border-surface-700"
      >
        <SidebarNav />
      </aside>

      <!-- Main Content Area -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- Content -->
        <main 
          class="flex-1 overflow-hidden"
          :class="[!hideNav && !isDetailView ? 'pb-14 lg:pb-0' : '']"
        >
          <slot />
        </main>

        <!-- Mobile Bottom Nav (hidden on desktop, hidden in detail views on mobile) -->
        <BottomNav 
          v-if="!hideNav && !isDetailView" 
          class="lg:hidden"
        />
      </div>
    </div>
  </div>
</template>
