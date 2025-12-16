import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
  },
  {
    path: '/',
    name: 'queue',
    component: () => import('./views/QueueView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat/:escalationId',
    name: 'chat',
    component: () => import('./views/ChatView.vue'),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard
router.beforeEach((to, from, next) => {
  const auth = useAuthStore();
  
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next({ name: 'login' });
  } else if (to.name === 'login' && auth.isAuthenticated) {
    next({ name: 'queue' });
  } else {
    next();
  }
});

export default router;
