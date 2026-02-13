/**
 * Auth Store - Agent authentication state
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { requestOtp, verifyOtp, completeProfile, fetchAvailableClients as apiFetchAvailableClients, type AvailableClient } from '@/api/client';

export interface Agent {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const token = ref<string | null>(localStorage.getItem('agent_token'));
  const agent = ref<Agent | null>((() => {
    const stored = localStorage.getItem('agent_data');
    return stored ? JSON.parse(stored) : null;
  })());
  const clientSchema = ref<string>(localStorage.getItem('client_schema') || 'client_tag_markets');
  const availableClients = ref<AvailableClient[]>((() => {
    const stored = localStorage.getItem('available_clients');
    return stored ? JSON.parse(stored) : [];
  })());
  const activeClientId = ref<string | null>(localStorage.getItem('active_client_id'));
  const isFirstLogin = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const isAuthenticated = computed(() => !!token.value);
  const activeClient = computed(() =>
    availableClients.value.find(c => c.client_id === activeClientId.value) || availableClients.value[0] || null
  );
  const hasMultipleClients = computed(() => availableClients.value.length > 1);

  // Actions
  async function sendOtp(phone: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await requestOtp(phone, clientSchema.value);
      isFirstLogin.value = result.isFirstLogin;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to send OTP';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function verify(phone: string, otp: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const result = await verifyOtp(phone, otp, clientSchema.value);
      
      token.value = result.token;
      agent.value = result.agent;
      isFirstLogin.value = result.isFirstLogin;

      // Store available clients
      if (result.availableClients && result.availableClients.length > 0) {
        availableClients.value = result.availableClients;
        localStorage.setItem('available_clients', JSON.stringify(result.availableClients));
        // Auto-select first client if none selected
        if (!activeClientId.value || !result.availableClients.find((c: AvailableClient) => c.client_id === activeClientId.value)) {
          activeClientId.value = result.availableClients[0].client_id;
          localStorage.setItem('active_client_id', result.availableClients[0].client_id);
        }
      }
      
      localStorage.setItem('agent_token', result.token);
      localStorage.setItem('agent_data', JSON.stringify(result.agent));
      localStorage.setItem('client_schema', clientSchema.value);
      
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Invalid OTP';
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function updateProfile(
    firstName: string,
    lastName?: string,
    email?: string
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      await completeProfile(firstName, lastName, email);
      
      if (agent.value) {
        agent.value = {
          ...agent.value,
          firstName,
          lastName: lastName || null,
          email: email || null,
        };
        localStorage.setItem('agent_data', JSON.stringify(agent.value));
      }
      
      isFirstLogin.value = false;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update profile';
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout() {
    token.value = null;
    agent.value = null;
    availableClients.value = [];
    activeClientId.value = null;
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_data');
    localStorage.removeItem('available_clients');
    localStorage.removeItem('active_client_id');
  }

  function switchClient(clientId: string) {
    activeClientId.value = clientId;
    localStorage.setItem('active_client_id', clientId);
  }

  async function refreshAvailableClients(): Promise<void> {
    if (!token.value) return;
    try {
      const result = await apiFetchAvailableClients();
      if (result.availableClients && result.availableClients.length > 0) {
        availableClients.value = result.availableClients;
        localStorage.setItem('available_clients', JSON.stringify(result.availableClients));
        if (!activeClientId.value || !result.availableClients.find(c => c.client_id === activeClientId.value)) {
          activeClientId.value = result.availableClients[0].client_id;
          localStorage.setItem('active_client_id', result.availableClients[0].client_id);
        }
      }
    } catch (e) {
      console.error('Failed to refresh available clients:', e);
    }
  }

  function setClientSchema(schema: string) {
    clientSchema.value = schema;
    localStorage.setItem('client_schema', schema);
  }

  return {
    // State
    token,
    agent,
    clientSchema,
    availableClients,
    activeClientId,
    isFirstLogin,
    loading,
    error,
    // Computed
    isAuthenticated,
    activeClient,
    hasMultipleClients,
    // Actions
    sendOtp,
    verify,
    updateProfile,
    logout,
    setClientSchema,
    switchClient,
    refreshAvailableClients,
  };
});
