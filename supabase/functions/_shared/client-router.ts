/**
 * Client Router
 * 
 * Routes incoming webhook requests to the correct client schema
 * based on channel_id lookup in public.client_configs.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ClientConfig, ChannelType } from '@parallelo/sales-engine';

export interface ClientRouteResult {
  clientId: string;
  schemaName: string;
  config: ClientConfig;
}

/**
 * Look up client by channel ID
 */
export async function routeByChannelId(
  supabase: SupabaseClient,
  channelType: ChannelType,
  channelId: string
): Promise<ClientRouteResult | null> {
  // 1. Look up in client_configs (which now includes channel mapping)
  const { data: clientConfig, error } = await supabase
    .from('client_configs')
    .select('*')
    .eq('channel_type', channelType)
    .eq('channel_id', channelId)
    .eq('is_active', true)
    .single();
  
  if (error || !clientConfig) {
    console.error(`[DEBUG] No client config found for ${channelType}:${channelId}`, error);
    return null;
  }
  
  console.log(`[DEBUG] Found config: client=${clientConfig.client_id}, schema=${clientConfig.schema_name}`);
  
  // 2. Load secrets and build complete config
  const config = await loadClientConfig(supabase, clientConfig.client_id);
  
  if (!config) {
    console.error(`Failed to load complete config for client: ${clientConfig.client_id}`);
    return null;
  }
  
  return {
    clientId: clientConfig.client_id,
    schemaName: clientConfig.schema_name,
    config,
  };
}

/**
 * Load client configuration from database
 * 
 * Queries client_configs and client_secrets tables to build complete ClientConfig.
 * Falls back to environment variables for secrets if not in database.
 */
async function loadClientConfig(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientConfig | null> {
  // 1. Load client config from database
  const { data: clientConfig, error: configError } = await supabase
    .from('client_configs')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .single();
  
  if (configError || !clientConfig) {
    console.error(`[loadClientConfig] No config found for client: ${clientId}`, configError);
    return null;
  }
  
  // 2. Load secrets from database
  const { data: secrets, error: secretsError } = await supabase
    .from('client_secrets')
    .select('*')
    .eq('client_id', clientId);
  
  if (secretsError) {
    console.error(`[loadClientConfig] Error loading secrets for ${clientId}:`, secretsError);
  }
  
  // 3. Build channels object from secrets
  const channels: Record<string, any> = {};
  
  if (secrets && secrets.length > 0) {
    for (const secret of secrets) {
      channels[secret.channel_type] = secret.secrets;
    }
  }
  
  // 4. Build complete ClientConfig object
  const config: ClientConfig = {
    clientId: clientConfig.client_id,
    schemaName: clientConfig.schema_name,
    storageBucket: clientConfig.storage_bucket,
    stateMachineName: clientConfig.state_machine_name,
    channels,
    ...clientConfig.config, // Spread JSONB config (business, llm, debounce, escalation, knowledgeBase)
  };
  
  console.log(`[loadClientConfig] Loaded config for ${clientId}`);
  return config;
}

/**
 * Get all client configurations from database
 * Used by process-pending worker to iterate over all clients
 */
export async function getAllClientConfigs(
  supabase: SupabaseClient
): Promise<Array<{ clientId: string; schemaName: string; channelId: string; config: ClientConfig }>> {
  // 1. Load all active client configs
  const { data: clientConfigs, error: configError } = await supabase
    .from('client_configs')
    .select('*')
    .eq('is_active', true);
  
  if (configError || !clientConfigs) {
    console.error('[getAllClientConfigs] Error loading client configs:', configError);
    return [];
  }
  
  // 2. Load all secrets
  const { data: allSecrets, error: secretsError } = await supabase
    .from('client_secrets')
    .select('*');
  
  if (secretsError) {
    console.error('[getAllClientConfigs] Error loading secrets:', secretsError);
  }
  
  // 3. Build result array
  const results: Array<{ clientId: string; schemaName: string; channelId: string; config: ClientConfig }> = [];
  
  for (const clientConfig of clientConfigs) {
    // Build channels object from secrets for this client
    const channels: Record<string, any> = {};
    
    if (allSecrets) {
      const clientSecrets = allSecrets.filter(s => s.client_id === clientConfig.client_id);
      for (const secret of clientSecrets) {
        channels[secret.channel_type] = secret.secrets;
      }
    }
    
    // Build complete ClientConfig
    const config: ClientConfig = {
      clientId: clientConfig.client_id,
      schemaName: clientConfig.schema_name,
      storageBucket: clientConfig.storage_bucket,
      stateMachineName: clientConfig.state_machine_name,
      channels,
      ...clientConfig.config, // Spread JSONB config
    };
    
    results.push({
      clientId: clientConfig.client_id,
      schemaName: clientConfig.schema_name,
      channelId: clientConfig.channel_id,
      config,
    });
  }
  console.log("[getAllClientConfigs] Results: ", JSON.stringify(results));
  console.log(`[getAllClientConfigs] Loaded ${results.length} client(s)`);
  return results;
}

/**
 * Verify webhook signature (WhatsApp)
 */
export function verifyWhatsAppSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  // WhatsApp uses HMAC-SHA256
  const crypto = globalThis.crypto;
  
  // In Deno, we need to use the Web Crypto API
  // This is a simplified version - in production, use proper HMAC verification
  const expectedSignature = signature.replace('sha256=', '');
  
  // TODO: Implement proper HMAC-SHA256 verification
  // For now, return true in development
  if (Deno.env.get('ENVIRONMENT') === 'development') {
    return true;
  }
  
  console.warn('Signature verification not fully implemented');
  return true;
}
