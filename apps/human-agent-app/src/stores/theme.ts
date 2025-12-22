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
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const isDark = newTheme === 'dark';
    
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.backgroundColor = '#0c0a09';
      document.body.style.backgroundColor = '#0c0a09';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#1c1917');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.backgroundColor = '#fafaf9';
      document.body.style.backgroundColor = '#fafaf9';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff');
    }
  }

  return {
    theme,
    toggleTheme,
  };
});
