/**
 * Supabase Adapters
 * 
 * Re-exports all adapter factories for use in Edge Functions.
 */

export { createSupabaseContactStore } from './contact-store.ts';
export { createSupabaseSessionStore } from './session-store.ts';
export { createSupabaseMessageStore } from './message-store.ts';
export { createSupabaseKnowledgeStore } from './knowledge-store.ts';
