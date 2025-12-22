import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark';

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>('dark');

  // Initialize from localStorage
  const savedTheme = localStorage.getItem('theme') as Theme | null;
  if (savedTheme === 'light' || savedTheme === 'dark') {
    theme.value = savedTheme;
  }

  // Watch for changes and persist to localStorage
  watch(theme, (newTheme) => {
    localStorage.setItem('theme', newTheme);
    updateDocumentTheme(newTheme);
  }, { immediate: true });

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  function updateDocumentTheme(newTheme: Theme) {
    if (newTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }

  return {
    theme,
    toggleTheme,
  };
});
