/**
 * Client Router
 * 
 * Routes incoming webhook requests to the correct client schema
 * based on channel_id lookup in public.channel_mappings.
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
  // 1. Look up in channel_mappings
  const { data: mapping, error } = await supabase
    .from('channel_mappings')
    .select('client_id, schema_name')
    .eq('channel_type', channelType)
    .eq('channel_id', channelId)
    .eq('is_active', true)
    .single();
  
  if (error || !mapping) {
    console.error(`No client mapping found for ${channelType}:${channelId}`, error);
    return null;
  }
  
  // 2. Load client configuration from Vault or config file
  const config = await loadClientConfig(supabase, mapping.client_id);
  
  if (!config) {
    console.error(`No config found for client: ${mapping.client_id}`);
    return null;
  }
  
  return {
    clientId: mapping.client_id,
    schemaName: mapping.schema_name,
    config,
  };
}

/**
 * Load client configuration
 * 
 * In production, this would load from Supabase Vault for secrets
 * and a config table or file for non-sensitive settings.
 */
async function loadClientConfig(
  supabase: SupabaseClient,
  clientId: string
): Promise<ClientConfig | null> {
  // For now, we'll use environment variables and a simple mapping
  // In production, this would query a config table or Vault
  
  const configs: Record<string, ClientConfig> = {
    tag_markets: {
      clientId: 'tag_markets',
      schemaName: 'client_tag_markets',
      storageBucket: 'media-tag-markets',
      channels: {
        whatsapp: {
          phoneNumberId: Deno.env.get('TAG_WHATSAPP_PHONE_NUMBER_ID') || '',
          accessToken: Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN') || '',
          appSecret: Deno.env.get('TAG_WHATSAPP_APP_SECRET') || '',
        },
      },
      debounce: {
        enabled: true,
        delayMs: 3000,
      },
      llm: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        fallbackProvider: 'anthropic',
        fallbackModel: 'claude-sonnet-4-20250514',
      },
      escalation: {
        enabled: true,
        notifyWhatsApp: Deno.env.get('TAG_ESCALATION_WHATSAPP'),
      },
      business: {
        name: 'TAG Markets',
        description: 'Broker de trading con cuentas amplificadas 12x.',
        language: 'es',
        timezone: 'America/Bogota',
      },
    },
  };
  
  return configs[clientId] || null;
}

/**
 * Get all client configurations
 * Used by process-pending worker to iterate over all clients
 */
export function getAllClientConfigs(): Array<{ clientId: string; schemaName: string; config: ClientConfig }> {
  // Same hardcoded configs as loadClientConfig
  // In production, this would query from database
  const configs: ClientConfig[] = [
    {
      clientId: 'tag_markets',
      schemaName: 'client_tag_markets',
      storageBucket: 'media-tag-markets',
      channels: {
        whatsapp: {
          phoneNumberId: Deno.env.get('TAG_WHATSAPP_PHONE_NUMBER_ID') || '',
          accessToken: Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN') || '',
          appSecret: Deno.env.get('TAG_WHATSAPP_APP_SECRET') || '',
        },
      },
      debounce: {
        enabled: true,
        delayMs: 3000,
      },
      llm: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        fallbackProvider: 'anthropic',
        fallbackModel: 'claude-sonnet-4-20250514',
      },
      escalation: {
        enabled: true,
        notifyWhatsApp: Deno.env.get('TAG_ESCALATION_WHATSAPP'),
      },
      business: {
        name: 'TAG Markets',
        description: 'Broker de trading con cuentas amplificadas 12x.',
        language: 'es',
        timezone: 'America/Bogota',
      },
    },
  ];
  
  return configs.map(c => ({
    clientId: c.clientId,
    schemaName: c.schemaName,
    config: c,
  }));
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
