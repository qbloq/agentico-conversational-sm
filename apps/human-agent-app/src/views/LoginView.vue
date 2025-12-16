<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const step = ref<'phone' | 'otp' | 'profile'>('phone');
const phone = ref('');
const otp = ref('');
const firstName = ref('');
const lastName = ref('');
const email = ref('');

async function handleSendOtp() {
  const success = await auth.sendOtp(phone.value);
  if (success) {
    step.value = 'otp';
  }
}

async function handleVerifyOtp() {
  const success = await auth.verify(phone.value, otp.value);
  if (success) {
    if (auth.isFirstLogin) {
      step.value = 'profile';
    } else {
      router.push('/');
    }
  }
}

async function handleCompleteProfile() {
  const success = await auth.updateProfile(firstName.value, lastName.value, email.value);
  if (success) {
    router.push('/');
  }
}
</script>

<template>
  <div class="min-h-full flex items-center justify-center p-4 bg-gradient-to-b from-surface-900 to-surface-950">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="w-16 h-16 mx-auto bg-primary-600 rounded-2xl flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-white">Agent Hub</h1>
        <p class="text-surface-400 mt-1">Manage customer escalations</p>
      </div>

      <!-- Phone Step -->
      <div v-if="step === 'phone'" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-surface-300 mb-2">
            Phone Number
          </label>
          <input
            v-model="phone"
            type="tel"
            placeholder="+1234567890"
            class="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <button
          @click="handleSendOtp"
          :disabled="auth.loading || !phone"
          class="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
        >
          {{ auth.loading ? 'Sending...' : 'Send OTP' }}
        </button>

        <p v-if="auth.error" class="text-red-400 text-sm text-center">
          {{ auth.error }}
        </p>
      </div>

      <!-- OTP Step -->
      <div v-else-if="step === 'otp'" class="space-y-4">
        <div class="text-center mb-4">
          <p class="text-surface-400">
            Enter the 6-digit code sent to
          </p>
          <p class="text-white font-medium">{{ phone }}</p>
        </div>

        <div>
          <input
            v-model="otp"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            placeholder="000000"
            class="w-full px-4 py-4 bg-surface-800 border border-surface-700 rounded-xl text-white text-center text-2xl tracking-widest font-mono placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <button
          @click="handleVerifyOtp"
          :disabled="auth.loading || otp.length !== 6"
          class="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
        >
          {{ auth.loading ? 'Verifying...' : 'Verify' }}
        </button>

        <button
          @click="step = 'phone'"
          class="w-full py-3 text-surface-400 hover:text-white transition-colors"
        >
          ← Use different number
        </button>

        <p v-if="auth.error" class="text-red-400 text-sm text-center">
          {{ auth.error }}
        </p>
      </div>

      <!-- Profile Step -->
      <div v-else-if="step === 'profile'" class="space-y-4">
        <div class="text-center mb-4">
          <p class="text-surface-400">
            Complete your profile
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-surface-300 mb-2">
            First Name *
          </label>
          <input
            v-model="firstName"
            type="text"
            class="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-surface-300 mb-2">
            Last Name
          </label>
          <input
            v-model="lastName"
            type="text"
            class="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-surface-300 mb-2">
            Email
          </label>
          <input
            v-model="email"
            type="email"
            class="w-full px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <button
          @click="handleCompleteProfile"
          :disabled="auth.loading || !firstName"
          class="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
        >
          {{ auth.loading ? 'Saving...' : 'Continue' }}
        </button>

        <p v-if="auth.error" class="text-red-400 text-sm text-center">
          {{ auth.error }}
        </p>
      </div>
    </div>
  </div>
</template>
