/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// The build tools will find this injection point and replace it with the manifest
precacheAndRoute(self.__WB_MANIFEST || []);

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  if (!event.data) {
    console.warn('[Service Worker] Push event received but no data.');
    return;
  }

  try {
    const payload = event.data.json();
    console.log('[Service Worker] Push Payload:', payload);
    const { title, body, data } = payload;

    const options = {
      body: body || '',
      icon: '/pwa-192x192.png',
      badge: '/favicon.ico',
      tag: data?.escalationId || data?.sessionId || 'agent-notification',
      renotify: true,
      data: data,
      vibrate: [200, 100, 200],
    };

    event.waitUntil(
      self.registration.showNotification(title || 'New Notification', options)
        .then(() => console.log('[Service Worker] Notification shown.'))
        .catch(err => console.error('[Service Worker] showNotification error:', err))
    );
  } catch (error) {
    console.error('[Service Worker] Error parsing push data:', error);
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;

  const targetUrl = data?.escalationId 
    ? `/chat/${data.escalationId}` 
    : (data?.sessionId ? `/chats/${data.sessionId}` : '/');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If a window is already open at the correct URL, focus it
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      
      // 2. If any window is open, navigate it and focus
      if (clientList.length > 0) {
        const client = clientList[0];
        return client.navigate(targetUrl).then(c => c?.focus());
      }
      
      // 3. If no window is open, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
