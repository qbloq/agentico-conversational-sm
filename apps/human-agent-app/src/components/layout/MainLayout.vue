<script setup lang="ts">
/**
 * MainLayout - Responsive layout wrapper
 * 
 * Mobile: Content + bottom tabs
 * Desktop: Sidebar + content (master-detail)
 */
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import BottomNav from './BottomNav.vue';
import SidebarNav from './SidebarNav.vue';
import { useNotificationStore } from '@/stores/notifications';

const route = useRoute();
const notificationStore = useNotificationStore();

// Routes that shouldn't show navigation (login, full-screen chat on mobile)
const hideNav = computed(() => {
  return route.name === 'login';
});

// Check if we're in a detail view (chat)
const isDetailView = computed(() => {
  return route.name === 'chat' || route.name === 'conversation';
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
