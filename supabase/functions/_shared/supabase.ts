/**
 * Supabase Client Factory
 * 
 * Creates Supabase clients for Edge Functions.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Create a Supabase client with service role (full access)
 */
export function createSupabaseClient(schema?: string): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
  // console.log('Supabase client created', supabaseUrl, supabaseKey);
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: schema || 'public',
    },
  });
}

export type { SupabaseClient };
