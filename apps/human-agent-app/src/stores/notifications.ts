import { defineStore } from 'pinia';
import { ref } from 'vue';
import { savePushSubscription, deletePushSubscription } from '@/api/client';

const VAPID_PUBLIC_KEY = 'BKToPbp_iiwIlmnTvjQWUX7VaJ3OeB5f6LlPAwx5tDD2HGjg2D_YYPqfjXlqkihy7fzbvzA-so0S6VERs432yms';

export const useNotificationStore = defineStore('notifications', () => {
  const isSupported = ref('serviceWorker' in navigator && 'PushManager' in window);
  const permission = ref<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default');
  const isSubscribed = ref(false);
  const loading = ref(false);

  /**
   * Check current subscription status
   */
  async function checkSubscription() {
    if (!isSupported.value) return;
    
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      isSubscribed.value = !!subscription;
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  }

  /**
   * Request notification permission
   */
  async function requestPermission() {
    if (!isSupported.value) return false;
    
    const result = await Notification.requestPermission();
    permission.value = result;
    return result === 'granted';
  }

  /**
   * Subscribe to push notifications
   */
  async function subscribe() {
    if (!isSupported.value) {
      console.warn('Push notifications not supported in this browser.');
      return;
    }
    
    loading.value = true;

    try {
      // 1. Check current permission first
      const currentPermission = Notification.permission;
      console.log('Current notification permission:', currentPermission);

      if (currentPermission === 'denied') {
        throw new Error('Notifications are blocked by your browser settings. Please reset permissions in the address bar.');
      }

      // 2. Request permission if not already granted
      if (currentPermission !== 'granted') {
        const result = await Notification.requestPermission();
        permission.value = result;
        console.log('Permission request result:', result);
        if (result !== 'granted') {
          throw new Error('Permission was not granted.');
        }
      }

      // 3. Register for push
      console.log('Registering for push...');
      const registration = await navigator.serviceWorker.ready;
      console.log('Service Worker ready:', registration);
      
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      console.log('Push subscription successful');

      await savePushSubscription(subscription, navigator.userAgent);
      isSubscribed.value = true;
      return true;
    } catch (error: any) {
      console.error('Failed to subscribe:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async function unsubscribe() {
    if (!isSupported.value) return;
    loading.value = true;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        await deletePushSubscription(subscription);
      }
      
      isSubscribed.value = false;
      return true;
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Helper to convert VAPID key
   */
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    checkSubscription,
    requestPermission,
    subscribe,
    unsubscribe,
  };
});
