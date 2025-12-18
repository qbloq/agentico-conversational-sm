<script setup lang="ts">
/**
 * MainLayout - Responsive layout wrapper
 * 
 * Mobile: Content + bottom tabs
 * Desktop: Sidebar + content (master-detail)
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import BottomNav from './BottomNav.vue';
import SidebarNav from './SidebarNav.vue';

const route = useRoute();

// Routes that shouldn't show navigation (login, full-screen chat on mobile)
const hideNav = computed(() => {
  return route.name === 'login';
});

// Check if we're in a detail view (chat)
const isDetailView = computed(() => {
  return route.name === 'chat' || route.name === 'conversation';
});
</script>

<template>
  <div class="h-full flex">
    <!-- Desktop Sidebar (hidden on mobile) -->
    <aside 
      v-if="!hideNav"
      class="hidden lg:flex lg:w-72 xl:w-80 flex-shrink-0 flex-col bg-surface-900 border-r border-surface-700"
    >
      <SidebarNav />
    </aside>

    <!-- Main Content Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Content -->
      <main class="flex-1 overflow-hidden">
        <slot />
      </main>

      <!-- Mobile Bottom Nav (hidden on desktop, hidden in detail views on mobile) -->
      <BottomNav 
        v-if="!hideNav && !isDetailView" 
        class="lg:hidden"
      />
    </div>
  </div>
</template>
