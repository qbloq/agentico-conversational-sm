<script setup lang="ts">
/**
 * BottomNav - Mobile bottom navigation tabs
 */
import { useRoute, useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';

const route = useRoute();
const router = useRouter();
const escalations = useEscalationsStore();

const tabs = [
  { name: 'Escalations', route: '/', icon: 'bell' },
  { name: 'All Chats', route: '/chats', icon: 'chat' },
  { name: 'Follow-ups', route: '/followups', icon: 'clock' },
  { name: 'States', route: '/state-machines', icon: 'cpu' },
  { name: 'Clients', route: '/clients', icon: 'clients' },
  { name: 'Profile', route: '/profile', icon: 'user' },
];

const isActive = (tabRoute: string) => {
  if (tabRoute === '/') {
    return route.path === '/' || route.path.startsWith('/chat/');
  }
  return route.path.startsWith(tabRoute);
};

function navigate(tabRoute: string) {
  router.push(tabRoute);
}
</script>

<template>
  <nav class="fixed bottom-0 left-0 right-0 z-50 flex-shrink-0 bg-white dark:bg-surface-800 border-t border-surface-200 dark:border-surface-700">
    <div class="flex items-center justify-around h-14">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        @click="navigate(tab.route)"
        :class="[
          'flex flex-col items-center justify-center flex-1 h-full px-2 transition-colors',
          isActive(tab.route) 
            ? 'text-accent-500' 
            : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
        ]"
      >
        <!-- Bell Icon (Escalations) -->
        <template v-if="tab.icon === 'bell'">
          <div class="relative">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <!-- Badge -->
            <span 
              v-if="escalations.openCount > 0"
              class="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-accent-600 text-white text-[10px] font-bold rounded-full"
            >
              {{ escalations.openCount > 9 ? '9+' : escalations.openCount }}
            </span>
          </div>
        </template>

        <!-- Chat Icon (All Chats) -->
        <template v-else-if="tab.icon === 'chat'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </template>

        <!-- Clock Icon (Follow-ups) -->
        <template v-else-if="tab.icon === 'clock'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </template>

        <!-- CPU Icon (State Machines) -->
        <template v-else-if="tab.icon === 'cpu'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </template>

        <!-- Building Icon (Clients) -->
        <template v-else-if="tab.icon === 'clients'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </template>

        <!-- User Icon (Profile) -->
        <template v-else-if="tab.icon === 'user'">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </template>

        <span class="text-[11px] mt-0.5 font-medium">{{ tab.name }}</span>
      </button>
    </div>
  </nav>
</template>
