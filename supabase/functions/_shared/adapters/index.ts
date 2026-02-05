/**
 * Supabase Adapters
 * 
 * Re-exports all adapter factories for use in Edge Functions.
 */

export { createSupabaseContactStore } from './contact-store.ts';
export { createSupabaseSessionStore } from './session-store.ts';
export { createSupabaseMessageStore } from './message-store.ts';
export { createSupabaseKnowledgeStore } from './knowledge-store.ts';
export { createSupabaseExampleStore } from './example-store.ts';
export { createSupabaseLLMLogger, createBatchLLMLogger } from './llm-logger.ts';
export { createSupabaseStateMachineStore } from './state-machine-store.ts';
export { createSupabaseMessageBufferStore } from './message-buffer-store.ts';
export { createSupabaseEscalationStore } from './escalation-store.ts';
export { createSupabaseFollowupStore } from './followup-store.ts';
export { createSupabaseDepositStore } from './deposit-store.ts';
export type { LLMLogger, LLMLogEntry } from './llm-logger.ts';
