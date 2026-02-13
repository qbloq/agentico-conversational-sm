<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router';
import { computed, onMounted } from 'vue';
import MainLayout from '@/components/layout/MainLayout.vue';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import { onUnauthorized } from '@/api/client';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const useLayout = computed(() => route.meta?.requiresAuth === true);

// Initialize theme store
const themeStore = useThemeStore();

// Handle unauthorized responses globally
onMounted(() => {
  onUnauthorized(() => {
    auth.logout();
    router.push({ name: 'login' });
  });

  // Refresh available clients on app load for existing sessions
  if (auth.isAuthenticated && auth.availableClients.length === 0) {
    auth.refreshAvailableClients();
  }
});
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Use layout for authenticated routes -->
    <MainLayout v-if="useLayout">
      <RouterView />
    </MainLayout>
    
    <!-- No layout for login -->
    <RouterView v-else />
  </div>
</template>
