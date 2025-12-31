<script setup lang="ts">
/**
 * ProfileView - Agent profile and settings
 */
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';

const router = useRouter();
const auth = useAuthStore();
const themeStore = useThemeStore();

function logout() {
  auth.logout();
  router.push('/login');
}

function goBack() {
  router.push('/');
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="flex items-center gap-3">
        <!-- Back button (mobile only) -->
        <button 
          @click="goBack" 
          class="lg:hidden p-1 -ml-1 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-white">Profile</h1>
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4 sm:p-6">
      <div class="max-w-md mx-auto space-y-6">
        
        <!-- Avatar & Name -->
        <div class="flex flex-col items-center text-center">
          <div class="w-20 h-20 rounded-full bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-accent-500/20">
            {{ auth.agent?.firstName?.charAt(0) || 'A' }}
          </div>
          <h2 class="mt-4 text-xl font-semibold text-surface-900 dark:text-white">
            {{ auth.agent?.firstName || 'Agent' }} {{ auth.agent?.lastName || '' }}
          </h2>
          <p class="text-surface-600 dark:text-surface-400">Agente de Ventas</p>
        </div>

        <!-- Info Card -->
        <div class="bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 divide-y divide-surface-200 dark:divide-surface-700">
          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-surface-600 dark:text-surface-400">Phone</p>
                <p class="text-surface-900 dark:text-white">{{ auth.agent?.phone || 'Not set' }}</p>
              </div>
            </div>
          </div>

          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-surface-600 dark:text-surface-400">Email</p>
                <p class="text-surface-900 dark:text-white">{{ auth.agent?.email || 'Not set' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Theme Toggle -->
        <div class="bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700">
          <div class="px-4 py-3 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-accent-600/20 flex items-center justify-center">
                <svg v-if="themeStore.theme === 'light'" class="w-5 h-5 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <svg v-else class="w-5 h-5 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              </div>
              <div>
                <p class="text-sm text-surface-600 dark:text-surface-400">Appearance</p>
                <p class="text-surface-900 dark:text-white">{{ themeStore.theme === 'light' ? 'Light Mode' : 'Dark Mode' }}</p>
              </div>
            </div>
            <button
              @click="themeStore.toggleTheme()"
              class="px-4 py-2 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-900 dark:text-white text-sm font-medium rounded-lg transition-colors"
            >
              Switch
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="space-y-3">
          <button
            @click="logout"
            class="w-full py-3.5 bg-white dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 border border-surface-200 dark:border-surface-700 text-surface-900 dark:text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>

        <!-- Version -->
        <p class="text-center text-xs text-surface-500 dark:text-surface-500">
          Agent Hub v1.0.8
        </p>
      </div>
    </div>
  </div>
</template>
