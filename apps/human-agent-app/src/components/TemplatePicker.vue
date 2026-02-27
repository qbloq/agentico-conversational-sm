<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useEscalationsStore } from '@/stores/escalations';
import { useAuthStore } from '@/stores/auth';
import type { WhatsAppTemplate } from '@/api/client';

const props = defineProps<{
  onSelect: (templateName: string) => void;
  onCancel: () => void;
}>();

const escalations = useEscalationsStore();
const auth = useAuthStore();
const searchQuery = ref('');

onMounted(async () => {
  await escalations.fetchTemplates();
});

watch(() => auth.activeClientId, async () => {
  await escalations.fetchTemplates();
});

const filteredTemplates = computed(() => {
  const prefix = import.meta.env.VITE_TEMPLATES_PREFIX || '';
  let baseList = escalations.templates;
  
  // Filter by prefix if provided
  if (prefix) {
    baseList = baseList.filter(t => t.name.startsWith(prefix));
  }
  
  if (!searchQuery.value) return baseList;
  
  const query = searchQuery.value.toLowerCase();
  return baseList.filter(t => 
    t.name.toLowerCase().includes(query) || 
    t.category.toLowerCase().includes(query)
  );
});

const formatTemplateName = (name: string) => {
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const getBodyText = (template: WhatsAppTemplate) => {
  const body = template.components.find(c => c.type === 'BODY');
  return body?.text || '';
};
</script>

<template>
  <div class="flex flex-col h-[70vh] max-h-[600px] bg-white dark:bg-surface-800 rounded-t-2xl border-x border-t border-surface-200 dark:border-surface-700">
    <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700 flex items-center justify-between">
      <h3 class="text-lg font-semibold text-surface-900 dark:text-white">WhatsApp Templates</h3>
      <button @click="onCancel" class="text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="p-3">
      <div class="relative">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search templates..."
          class="w-full pl-10 pr-4 py-2 bg-surface-50 dark:bg-surface-700 border border-surface-200 dark:border-surface-600 rounded-xl text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <svg class="w-5 h-5 absolute left-3 top-2.5 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-3">
      <div v-if="escalations.loadingTemplates" class="flex flex-col items-center justify-center py-12 space-y-3">
        <div class="animate-spin w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full"></div>
        <p class="text-surface-400 text-sm">Loading templates...</p>
      </div>

      <template v-else-if="filteredTemplates.length > 0">
        <button
          v-for="tpl in filteredTemplates"
          :key="tpl.name"
          @click="onSelect(tpl.name)"
          class="w-full p-3 bg-surface-50 dark:bg-surface-700 hover:bg-surface-100 dark:hover:bg-surface-600 border border-surface-200 dark:border-surface-600 rounded-xl text-left transition-colors group"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium text-surface-900 dark:text-white group-hover:text-accent-600 dark:group-hover:text-accent-400">{{ formatTemplateName(tpl.name) }}</span>
            <span class="text-[10px] px-1.5 py-0.5 bg-surface-200 dark:bg-surface-600 text-surface-600 dark:text-surface-400 rounded uppercase font-semibold">{{ tpl.category }}</span>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400 line-clamp-2 leading-relaxed">{{ getBodyText(tpl) }}</p>
        </button>
      </template>

      <div v-else class="flex flex-col items-center justify-center py-12 text-surface-400">
        <p>No templates found</p>
      </div>
    </div>
  </div>
</template>
