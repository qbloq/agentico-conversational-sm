<script setup lang="ts">
/**
 * SidebarNav - Desktop sidebar navigation
 */

import { useRoute, useRouter } from 'vue-router';
import { useEscalationsStore } from '@/stores/escalations';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const escalations = useEscalationsStore();
const auth = useAuthStore();

const navItems = [
  { name: 'Escalations', route: '/', icon: 'bell' },
  { name: 'All Chats', route: '/chats', icon: 'chat' },
];

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
    <div class="flex-shrink-0 h-16 flex items-center px-6 border-b border-surface-200 dark:border-surface-700">
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

    <!-- Navigation Items -->
    <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      <button
        v-for="item in navItems"
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
