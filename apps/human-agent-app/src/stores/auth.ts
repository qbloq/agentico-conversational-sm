/**
 * Auth Store - Agent authentication state
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { requestOtp, verifyOtp, completeProfile } from '@/api/client';

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
  const isFirstLogin = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const isAuthenticated = computed(() => !!token.value);

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
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_data');
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
    isFirstLogin,
    loading,
    error,
    // Computed
    isAuthenticated,
    // Actions
    sendOtp,
    verify,
    updateProfile,
    logout,
    setClientSchema,
  };
});
