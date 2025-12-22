<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router';
import { computed } from 'vue';
import MainLayout from '@/components/layout/MainLayout.vue';
import { useThemeStore } from '@/stores/theme';

const route = useRoute();
const useLayout = computed(() => route.meta?.requiresAuth === true);

// Initialize theme store
const themeStore = useThemeStore();
</script>

<template>
  <div class="h-full flex flex-col bg-surface-50 dark:bg-surface-900">
    <!-- Use layout for authenticated routes -->
    <MainLayout v-if="useLayout">
      <RouterView />
    </MainLayout>
    
    <!-- No layout for login -->
    <RouterView v-else />
  </div>
</template>
