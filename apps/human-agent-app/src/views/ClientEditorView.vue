<script setup lang="ts">
/**
 * ClientEditorView - Create/Edit client configuration
 * Multi-section form with WhatsApp Embedded Signup
 */
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useClientsStore } from '@/stores/clients';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const store = useClientsStore();
const authStore = useAuthStore();

const isNew = computed(() => route.params.id === 'new');
const pageTitle = computed(() => isNew.value ? 'New Client' : `Edit ${form.value.client_id || 'Client'}`);

// Form state
const form = ref({
  client_id: '',
  schema_name: '',
  channel_type: 'whatsapp' as string,
  channel_id: '',
  state_machine_name: '',
  storage_bucket: '',
  is_active: true,
  config: {
    business: {
      name: '',
      description: '',
      language: 'es',
      timezone: 'America/Bogota',
    },
    llm: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      fallbackProvider: '',
      fallbackModel: '',
    },
    debounce: {
      enabled: true,
      delayMs: 3000,
    },
    escalation: {
      enabled: true,
      notifyWhatsApp: '',
    },
    knowledgeBase: {
      storeIds: '' as string,
    },
  },
});

// WABA state
const wabaData = ref<{
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId: string;
  displayPhone?: string;
  displayName?: string;
} | null>(null);

const wabaConnected = computed(() => {
  if (wabaData.value) return true;
  if (!isNew.value && store.currentClient?.secrets?.length) {
    return store.currentClient.secrets.some(s => s.channel_type === 'whatsapp' && s.has_secrets);
  }
  return false;
});

const wabaLoading = ref(false);
const wabaError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saveSuccess = ref(false);

// New bucket creation
const newBucketName = ref('');
const creatingBucket = ref(false);

// Validation
const requiredFields = computed(() => ({
  client_id: !!form.value.client_id.trim(),
  schema_name: !!form.value.schema_name.trim(),
  channel_type: !!form.value.channel_type,
  state_machine_name: !!form.value.state_machine_name,
  business_name: !!form.value.config.business.name.trim(),
}));

const isValid = computed(() => Object.values(requiredFields.value).every(Boolean));

// Auto-fill schema_name from client_id
watch(() => form.value.client_id, (val) => {
  if (isNew.value && val) {
    form.value.schema_name = `client_${val.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  }
});

// Load data on mount
onMounted(async () => {
  // Fetch buckets and state machines in parallel
  store.fetchBuckets();
  store.fetchStateMachines(authStore.clientSchema);

  if (!isNew.value) {
    const id = route.params.id as string;
    await store.fetchClient(id);
    if (store.currentClient) {
      populateForm(store.currentClient);
    }
  } else {
    store.clearCurrent();
  }
});

function populateForm(client: NonNullable<typeof store.currentClient>) {
  form.value.client_id = client.client_id;
  form.value.schema_name = client.schema_name;
  form.value.channel_type = client.channel_type || 'whatsapp';
  form.value.channel_id = client.channel_id || '';
  form.value.state_machine_name = client.state_machine_name;
  form.value.storage_bucket = client.storage_bucket || '';
  form.value.is_active = client.is_active;

  const cfg = client.config || {};
  const biz = (cfg.business || {}) as Record<string, string>;
  const llm = (cfg.llm || {}) as Record<string, string>;
  const debounce = (cfg.debounce || {}) as Record<string, unknown>;
  const escalation = (cfg.escalation || {}) as Record<string, unknown>;
  const kb = (cfg.knowledgeBase || {}) as Record<string, unknown>;

  form.value.config.business.name = biz.name || '';
  form.value.config.business.description = biz.description || '';
  form.value.config.business.language = biz.language || 'es';
  form.value.config.business.timezone = biz.timezone || 'America/Bogota';

  form.value.config.llm.provider = llm.provider || 'gemini';
  form.value.config.llm.model = llm.model || '';
  form.value.config.llm.fallbackProvider = llm.fallbackProvider || '';
  form.value.config.llm.fallbackModel = llm.fallbackModel || '';

  form.value.config.debounce.enabled = debounce.enabled !== false;
  form.value.config.debounce.delayMs = (debounce.delayMs as number) || 3000;

  form.value.config.escalation.enabled = escalation.enabled !== false;
  form.value.config.escalation.notifyWhatsApp = (escalation.notifyWhatsApp as string) || '';

  const storeIds = (kb.storeIds as string[]) || [];
  form.value.config.knowledgeBase.storeIds = storeIds.join(', ');
}

function goBack() {
  router.push('/clients');
}

// =========================================================================
// WhatsApp Embedded Signup
// =========================================================================
function loadFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).FB) {
      resolve();
      return;
    }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: import.meta.env.VITE_META_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v22.0',
      });
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Facebook SDK'));
    document.head.appendChild(script);
  });
}

async function startWhatsAppSignup() {
  wabaLoading.value = true;
  wabaError.value = null;

  try {
    await loadFacebookSDK();

    // Listen for Embedded Signup message events
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.data?.phone_number_id && data.data?.waba_id) {
            wabaData.value = {
              ...wabaData.value!,
              phoneNumberId: data.data.phone_number_id,
              wabaId: data.data.waba_id,
            };
            form.value.channel_id = data.data.phone_number_id;
          }
          window.removeEventListener('message', messageHandler);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };
    window.addEventListener('message', messageHandler);

    (window as any).FB.login(
      (response: any) => {
        wabaLoading.value = false;
        if (response.authResponse?.code) {
          wabaData.value = {
            code: response.authResponse.code,
            phoneNumberId: wabaData.value?.phoneNumberId || '',
            wabaId: wabaData.value?.wabaId || '',
            businessId: '',
          };
        } else {
          wabaError.value = 'WhatsApp signup was cancelled or failed';
          window.removeEventListener('message', messageHandler);
        }
      },
      {
        config_id: import.meta.env.VITE_META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      }
    );
  } catch (e) {
    wabaLoading.value = false;
    wabaError.value = e instanceof Error ? e.message : 'Failed to start WhatsApp signup';
  }
}

// =========================================================================
// Bucket creation
// =========================================================================
async function handleCreateBucket() {
  if (!newBucketName.value.trim()) return;
  creatingBucket.value = true;
  const success = await store.createNewBucket(newBucketName.value.trim());
  if (success) {
    form.value.storage_bucket = newBucketName.value.trim();
    newBucketName.value = '';
  }
  creatingBucket.value = false;
}

// =========================================================================
// Save
// =========================================================================
async function handleSave() {
  if (!isValid.value) return;

  saveError.value = null;
  saveSuccess.value = false;

  // Build config JSONB
  const storeIdsStr = form.value.config.knowledgeBase.storeIds;
  const storeIdsArr = storeIdsStr
    ? storeIdsStr.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const config = {
    business: { ...form.value.config.business },
    llm: { ...form.value.config.llm },
    debounce: { ...form.value.config.debounce },
    escalation: { ...form.value.config.escalation },
    knowledgeBase: { storeIds: storeIdsArr },
  };

  const payload: Record<string, unknown> = {
    client_id: form.value.client_id,
    schema_name: form.value.schema_name,
    channel_type: form.value.channel_type,
    channel_id: form.value.channel_id || null,
    state_machine_name: form.value.state_machine_name,
    storage_bucket: form.value.storage_bucket || null,
    is_active: form.value.is_active,
    config,
  };

  // Include WABA data if present
  if (wabaData.value?.code) {
    payload.waba = wabaData.value;
  }

  if (!isNew.value) {
    payload.id = route.params.id;
  }

  const success = await store.saveClient(payload);

  if (success) {
    saveSuccess.value = true;
    setTimeout(() => {
      router.push('/clients');
    }, 800);
  } else {
    saveError.value = store.error || 'Failed to save client';
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
    <!-- Header -->
    <header class="flex-shrink-0 px-4 py-3 bg-white dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 safe-top">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            @click="goBack"
            class="p-1 -ml-1 text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 class="text-lg font-semibold text-surface-900 dark:text-white">{{ pageTitle }}</h1>
          </div>
        </div>
        <button
          @click="handleSave"
          :disabled="!isValid || store.saving"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            isValid && !store.saving
              ? 'bg-accent-600 hover:bg-accent-700 text-white'
              : 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
          ]"
        >
          <span v-if="store.saving" class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Saving...
          </span>
          <span v-else>Save</span>
        </button>
      </div>
    </header>

    <!-- Loading overlay for edit mode -->
    <div v-if="!isNew && store.loadingDetail" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
        <p class="text-sm text-surface-500">Loading client...</p>
      </div>
    </div>

    <!-- Form -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="max-w-2xl mx-auto p-4 space-y-6 pb-20">

        <!-- Success Banner -->
        <div v-if="saveSuccess" class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
          <p class="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Client saved successfully!</p>
        </div>

        <!-- Error Banner -->
        <div v-if="saveError" class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
          <p class="text-sm text-red-700 dark:text-red-400 font-medium">{{ saveError }}</p>
        </div>

        <!-- Section 1: Identity -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Identity</h2>
          </div>
          <div class="p-4 space-y-4">
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Client ID *</label>
              <input
                v-model="form.client_id"
                :disabled="!isNew"
                type="text"
                placeholder="e.g. tag_markets"
                :class="[
                  'w-full px-3 py-2 rounded-lg border text-sm font-mono',
                  !isNew ? 'bg-surface-50 dark:bg-surface-900 text-surface-500 cursor-not-allowed' : '',
                  !requiredFields.client_id && form.client_id !== undefined ? 'border-red-300 dark:border-red-700' : 'border-surface-200 dark:border-surface-600',
                  'bg-white dark:bg-surface-900 text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/50'
                ]"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Schema Name *</label>
              <input
                v-model="form.schema_name"
                :disabled="!isNew"
                type="text"
                placeholder="e.g. client_tag_markets"
                :class="[
                  'w-full px-3 py-2 rounded-lg border text-sm font-mono',
                  !isNew ? 'bg-surface-50 dark:bg-surface-900 text-surface-500 cursor-not-allowed' : '',
                  'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent-500/50'
                ]"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Channel Type *</label>
              <select
                v-model="form.channel_type"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
                <option value="messenger">Messenger</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Channel ID</label>
              <input
                v-model="form.channel_id"
                type="text"
                placeholder="Auto-filled for WhatsApp, manual for others"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-surface-600 dark:text-surface-400">Active</label>
              <button
                @click="form.is_active = !form.is_active"
                :class="[
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  form.is_active ? 'bg-accent-600' : 'bg-surface-300 dark:bg-surface-600'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    form.is_active ? 'translate-x-6' : 'translate-x-1'
                  ]"
                />
              </button>
            </div>
          </div>
        </section>

        <!-- Section 2: WhatsApp Onboarding -->
        <section v-if="form.channel_type === 'whatsapp'" class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">WhatsApp Onboarding</h2>
          </div>
          <div class="p-4 space-y-3">
            <div v-if="wabaConnected && !wabaData?.code" class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>WhatsApp Business Account connected</span>
            </div>
            <div v-if="wabaData?.code" class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Signup completed — credentials will be saved on Save</span>
            </div>
            <div v-if="wabaData?.phoneNumberId" class="text-xs text-surface-500 dark:text-surface-400 font-mono">
              Phone ID: {{ wabaData.phoneNumberId }} · WABA: {{ wabaData.wabaId }}
            </div>
            <div v-if="wabaError" class="text-sm text-red-500">{{ wabaError }}</div>
            <button
              @click="startWhatsAppSignup"
              :disabled="wabaLoading"
              class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <span v-if="wabaLoading" class="flex items-center gap-2">
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Loading...
              </span>
              <span v-else>{{ wabaConnected ? 'Re-connect WhatsApp' : 'Connect WhatsApp Business Account' }}</span>
            </button>
          </div>
        </section>

        <!-- Section 3: Storage -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Storage Bucket</h2>
          </div>
          <div class="p-4 space-y-3">
            <select
              v-model="form.storage_bucket"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            >
              <option value="">Select a bucket...</option>
              <option v-for="bucket in store.buckets" :key="bucket.id || bucket.name" :value="bucket.name">
                {{ bucket.name }}
              </option>
            </select>
            <div class="flex items-center gap-2">
              <input
                v-model="newBucketName"
                type="text"
                placeholder="New bucket name"
                class="flex-1 px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
              <button
                @click="handleCreateBucket"
                :disabled="!newBucketName.trim() || creatingBucket"
                class="px-3 py-2 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-700 dark:text-surface-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {{ creatingBucket ? '...' : 'Create' }}
              </button>
            </div>
          </div>
        </section>

        <!-- Section 4: State Machine -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">State Machine *</h2>
          </div>
          <div class="p-4">
            <select
              v-model="form.state_machine_name"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            >
              <option value="">Select a state machine...</option>
              <option v-for="sm in store.tenantStateMachines" :key="sm.id" :value="sm.name">
                {{ sm.name }} (v{{ sm.version }})
              </option>
            </select>
          </div>
        </section>

        <!-- Section 5: Business Config -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Business Config</h2>
          </div>
          <div class="p-4 space-y-4">
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Name *</label>
              <input
                v-model="form.config.business.name"
                type="text"
                placeholder="Business name"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Description</label>
              <textarea
                v-model="form.config.business.description"
                rows="3"
                placeholder="Business description"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50 resize-none"
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Language</label>
                <input
                  v-model="form.config.business.language"
                  type="text"
                  placeholder="es"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Timezone</label>
                <input
                  v-model="form.config.business.timezone"
                  type="text"
                  placeholder="America/Bogota"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Section 6: LLM Config -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">LLM Config</h2>
          </div>
          <div class="p-4 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Provider</label>
                <select
                  v-model="form.config.llm.provider"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                >
                  <option value="gemini">Gemini</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Model</label>
                <input
                  v-model="form.config.llm.model"
                  type="text"
                  placeholder="gemini-2.5-flash"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Fallback Provider</label>
                <select
                  v-model="form.config.llm.fallbackProvider"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                >
                  <option value="">None</option>
                  <option value="gemini">Gemini</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Fallback Model</label>
                <input
                  v-model="form.config.llm.fallbackModel"
                  type="text"
                  placeholder="Optional"
                  class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Section 7: Debounce -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Debounce</h2>
          </div>
          <div class="p-4 space-y-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-surface-600 dark:text-surface-400">Enabled</label>
              <button
                @click="form.config.debounce.enabled = !form.config.debounce.enabled"
                :class="[
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  form.config.debounce.enabled ? 'bg-accent-600' : 'bg-surface-300 dark:bg-surface-600'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    form.config.debounce.enabled ? 'translate-x-6' : 'translate-x-1'
                  ]"
                />
              </button>
            </div>
            <div v-if="form.config.debounce.enabled">
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Delay (ms)</label>
              <input
                v-model.number="form.config.debounce.delayMs"
                type="number"
                min="0"
                step="500"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>
          </div>
        </section>

        <!-- Section 8: Escalation -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Escalation</h2>
          </div>
          <div class="p-4 space-y-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-surface-600 dark:text-surface-400">Enabled</label>
              <button
                @click="form.config.escalation.enabled = !form.config.escalation.enabled"
                :class="[
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  form.config.escalation.enabled ? 'bg-accent-600' : 'bg-surface-300 dark:bg-surface-600'
                ]"
              >
                <span
                  :class="[
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    form.config.escalation.enabled ? 'translate-x-6' : 'translate-x-1'
                  ]"
                />
              </button>
            </div>
            <div v-if="form.config.escalation.enabled">
              <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Notify WhatsApp Number</label>
              <input
                v-model="form.config.escalation.notifyWhatsApp"
                type="text"
                placeholder="Optional phone number"
                class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>
          </div>
        </section>

        <!-- Section 9: Knowledge Base -->
        <section class="bg-white dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-surface-100 dark:border-surface-700">
            <h2 class="text-sm font-semibold text-surface-900 dark:text-white">Knowledge Base</h2>
          </div>
          <div class="p-4">
            <label class="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Store IDs (comma-separated)</label>
            <input
              v-model="form.config.knowledgeBase.storeIds"
              type="text"
              placeholder="e.g. fileSearchStores/store-id-1, fileSearchStores/store-id-2"
              class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
            />
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
