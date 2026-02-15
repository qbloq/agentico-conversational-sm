import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from './stores/auth';
import type { AgentLevel } from './stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    requiredLevel?: AgentLevel;
  }
}

const routes: RouteRecordRaw[] = [
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
  {
    path: '/chats',
    name: 'chats',
    component: () => import('./views/AllChatsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chats/:sessionId',
    name: 'conversation',
    component: () => import('./views/ConversationView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/followups',
    name: 'followups',
    component: () => import('./views/FollowupConfigsView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/state-machines',
    name: 'state-machines',
    component: () => import('./views/StateMachinesView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/state-machines/:id',
    name: 'state-editor',
    component: () => import('./views/StateEditorView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/clients',
    name: 'clients',
    component: () => import('./views/ClientsView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/clients/:id',
    name: 'client-editor',
    component: () => import('./views/ClientEditorView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/agents',
    name: 'agents',
    component: () => import('./views/AgentsView.vue'),
    meta: { requiresAuth: true, requiredLevel: 'admin' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('./views/ProfileView.vue'),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard
router.beforeEach((to, _from, next) => {
  const auth = useAuthStore();
  
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next({ name: 'login' });
  } else if (to.meta.requiresAuth && to.meta.requiredLevel && !auth.hasLevel(to.meta.requiredLevel)) {
    next({ name: 'queue' });
  } else if (to.name === 'login' && auth.isAuthenticated) {
    next({ name: 'queue' });
  } else {
    next();
  }
});

export default router;
