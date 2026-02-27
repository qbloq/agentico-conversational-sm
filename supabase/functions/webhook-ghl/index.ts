/**
 * GHL (GoHighLevel) Webhook Edge Function
 * 
 * Handles incoming webhook events from GoHighLevel workflows.
 * 
 * Actions:
 * 1. Creates/updates contact in client_tag_markets schema
 * 2. Creates session if not exists
 * 3. Sends WhatsApp template message to contact
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// =============================================================================
// Types
// =============================================================================

interface GHLLocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  fullAddress?: string;
}

/**
 * Resolve WhatsApp channel_id using workflow.name as client_id key
 */
async function resolveChannelIdByWorkflowName(
  supabase: ReturnType<typeof createSupabaseClient>,
  workflowName: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('client_configs')
    .select('channel_id')
    .eq('client_id', workflowName)
    .eq('channel_type', CHANNEL_TYPE)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[GHL Webhook] Error resolving channel_id from client_configs:', error);
    return null;
  }

  return data?.channel_id ?? null;
}

/**
 * Resolve WhatsApp access token from client secrets using workflow.name as client_id key
 */
async function resolveAccessTokenByWorkflowName(
  supabase: ReturnType<typeof createSupabaseClient>,
  workflowName: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('client_secrets')
    .select('secrets')
    .eq('client_id', workflowName)
    .eq('channel_type', CHANNEL_TYPE)
    .maybeSingle();

  if (error) {
    console.error('[GHL Webhook] Error resolving access token from client_secrets:', error);
    return null;
  }

  const accessToken = (data?.secrets as { accessToken?: unknown } | null)?.accessToken;
  return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
}

interface GHLWorkflow {
  id: string;
  name: string;
}

interface GHLAttribution {
  sessionSource?: string;
  url?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmContent?: string | null;
  utmCampaign?: string | null;
  medium?: string;
  mediumId?: string;
  ip?: string;
  userAgent?: string;
}

interface GHLWebhookPayload {
  // Contact info (at root level)
  contact_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  
  // Additional contact data
  country?: string;
  timezone?: string;
  tags?: string;
  contact_source?: string;
  contact_type?: string;
  date_created?: string;
  full_address?: string;
  
  // Location (GHL sub-account)
  location?: GHLLocation;
  
  // Workflow that triggered this
  workflow?: GHLWorkflow;
  
  // Assigned user in GHL
  user?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  
  // Attribution data
  contact?: {
    attributionSource?: GHLAttribution;
    lastAttributionSource?: GHLAttribution;
  };
  
  // Custom fields (dynamic keys)
  [key: string]: unknown;
}

// =============================================================================
// Constants
// =============================================================================

const SCHEMA_NAME = 'client_tag_markets';
const CHANNEL_TYPE = 'whatsapp';

// =============================================================================
// Main Handler
// =============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload: GHLWebhookPayload = await req.json();
    console.log('[GHL Webhook] Received:', JSON.stringify(payload, null, 2));

    // Validate required fields
    if (!payload.phone) {
      console.error('[GHL Webhook] Missing phone number');
      return new Response('OK', { status: 200 }); // Still return 200 to prevent retries
    }

    // Normalize phone number (ensure E.164 format)
    const phone = normalizePhone(payload.phone);
    if (!phone) {
      console.error('[GHL Webhook] Invalid phone number:', payload.phone);
      return new Response('OK', { status: 200 });
    }

    // Get contact name
    const contactName = payload.first_name || payload.full_name?.split(' ')[0] || 'Cliente';

    // Initialize Supabase client
    const supabase = createSupabaseClient();

    const workflowName = payload.workflow?.name?.trim();
    if (!workflowName) {
      console.error('[GHL Webhook] Missing workflow.name in payload');
      return new Response('OK', { status: 200 });
    }

    const channelId = await resolveChannelIdByWorkflowName(supabase, workflowName);
    if (!channelId) {
      console.error(`[GHL Webhook] No channel_id found for workflow/client: ${workflowName}`);
      return new Response('OK', { status: 200 });
    }

    const accessToken = await resolveAccessTokenByWorkflowName(supabase, workflowName);
    if (!accessToken) {
      console.error(`[GHL Webhook] No WhatsApp access token found for workflow/client: ${workflowName}`);
      return new Response('OK', { status: 200 });
    }

    // Extract attribution data
    const attribution = payload.contact?.attributionSource || payload.contact?.lastAttributionSource;

    // 1. Find or create contact
    const contactRecord = await findOrCreateContact(supabase, {
      phone,
      firstName: payload.first_name,
      lastName: payload.last_name,
      fullName: payload.full_name,
      email: payload.email,
      country: payload.country,
      timezone: payload.timezone,
      utmSource: attribution?.utmSource || undefined,
      utmCampaign: attribution?.utmCampaign || undefined,
      metadata: {
        ghl_contact_id: payload.contact_id,
        ghl_location_id: payload.location?.id,
        ghl_location_name: payload.location?.name,
        ghl_workflow_id: payload.workflow?.id,
        ghl_workflow_name: payload.workflow?.name,
        ghl_tags: payload.tags,
        ghl_contact_source: payload.contact_source,
        ghl_contact_type: payload.contact_type,
        ghl_date_created: payload.date_created,
        attribution_source: attribution?.sessionSource,
        attribution_medium: attribution?.medium,
        attribution_url: attribution?.url,
        attribution_ip: attribution?.ip,
      },
    });

    console.log(`[GHL Webhook] Contact: ${contactRecord.id} (${phone})`);

    // 2. Find or create session
    const session = await findOrCreateSession(supabase, contactRecord.id, phone, channelId, {
      ghl_contact_id: payload.contact_id,
      ghl_workflow: payload.workflow?.name,
      tags: payload.tags,
    });
    console.log(`[GHL Webhook] Session: ${session.id}`);

    // 3. Send WhatsApp template message
    const templateSent = await sendWhatsAppTemplate(phone, contactName, channelId, accessToken);
    console.log(`[GHL Webhook] Template sent: ${templateSent}`);

    // 4. Log the outbound message if sent successfully
    if (templateSent) {
      await logTemplateMessage(supabase, session.id, contactName);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      contactId: contactRecord.id,
      sessionId: session.id,
      templateSent,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[GHL Webhook] Error:', error);
    // Return 200 to prevent GHL from retrying
    return new Response('OK', { status: 200 });
  }
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Normalize phone number to digits only (E.164 without +)
 */
function normalizePhone(phone: string): string | null {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Basic validation: should have at least 10 digits
  if (cleaned.length < 10) {
    return null;
  }
  
  return cleaned;
}

/**
 * Find or create contact by phone number
 */
async function findOrCreateContact(
  supabase: ReturnType<typeof createSupabaseClient>,
  data: {
    phone: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    country?: string;
    timezone?: string;
    utmSource?: string;
    utmCampaign?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  // Try to find existing contact by phone
  const { data: existing, error: findError } = await supabase
    .schema(SCHEMA_NAME)
    .from('contacts')
    .select('id, metadata')
    .eq('phone', data.phone)
    .maybeSingle();

  if (findError) {
    console.error('[GHL Webhook] Error finding contact:', findError);
  }

  if (existing) {
    // Update existing contact with any new info
    const updates: Record<string, unknown> = {};
    if (data.firstName) updates.first_name = data.firstName;
    if (data.lastName) updates.last_name = data.lastName;
    if (data.fullName) updates.full_name = data.fullName;
    if (data.email) updates.email = data.email;
    if (data.country) updates.country = data.country;
    if (data.timezone) updates.timezone = data.timezone;
    if (data.utmSource) updates.utm_source = data.utmSource;
    if (data.utmCampaign) updates.utm_campaign = data.utmCampaign;
    
    // Merge metadata
    if (data.metadata) {
      const existingMetadata = (existing.metadata as Record<string, unknown>) || {};
      updates.metadata = { ...existingMetadata, ...data.metadata };
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .schema(SCHEMA_NAME)
        .from('contacts')
        .update(updates)
        .eq('id', existing.id);
    }

    return { id: existing.id };
  }

  // Create new contact
  const { data: newContact, error: createError } = await supabase
    .schema(SCHEMA_NAME)
    .from('contacts')
    .insert({
      phone: data.phone,
      first_name: data.firstName || null,
      last_name: data.lastName || null,
      full_name: data.fullName || null,
      email: data.email || null,
      country: data.country || null,
      timezone: data.timezone || null,
      utm_source: data.utmSource || null,
      utm_campaign: data.utmCampaign || null,
      metadata: data.metadata || {},
    })
    .select('id')
    .single();

  if (createError || !newContact) {
    throw new Error(`Failed to create contact: ${createError?.message}`);
  }

  // Create contact identity for WhatsApp channel
  await supabase
    .schema(SCHEMA_NAME)
    .from('contact_identities')
    .insert({
      contact_id: newContact.id,
      channel_type: CHANNEL_TYPE,
      channel_user_id: data.phone,
    });

  return { id: newContact.id };
}

/**
 * Find or create session for contact
 */
async function findOrCreateSession(
  supabase: ReturnType<typeof createSupabaseClient>,
  contactId: string,
  phone: string,
  channelId: string,
  context: Record<string, unknown>
): Promise<{ id: string }> {
  // Try to find existing session
  const { data: existing } = await supabase
    .schema(SCHEMA_NAME)
    .from('sessions')
    .select('id')
    .eq('channel_type', CHANNEL_TYPE)
    .eq('channel_id', channelId)
    .eq('channel_user_id', phone)
    .maybeSingle();

  if (existing) {
    // Update session context with new GHL data
    const { data: currentSession } = await supabase
      .schema(SCHEMA_NAME)
      .from('sessions')
      .select('context')
      .eq('id', existing.id)
      .single();
    
    const existingContext = (currentSession?.context as Record<string, unknown>) || {};
    await supabase
      .schema(SCHEMA_NAME)
      .from('sessions')
      .update({ 
        context: { ...existingContext, ...context, source: 'ghl_opportunity' },
        last_message_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    
    return { id: existing.id };
  }

  // Create new session
  const { data: newSession, error: createError } = await supabase
    .schema(SCHEMA_NAME)
    .from('sessions')
    .insert({
      contact_id: contactId,
      channel_type: CHANNEL_TYPE,
      channel_id: channelId,
      channel_user_id: phone,
      current_state: 'initial',
      context: { ...context, source: 'ghl_opportunity' },
      status: 'active',
      state_machine_id: '3a580494-3ebe-47f6-acb7-6904354dbf57',
      is_escalated: false,
    })
    .select('id')
    .single();

  if (createError || !newSession) {
    throw new Error(`Failed to create session: ${createError?.message}`);
  }

  return { id: newSession.id };
}

/**
 * Send WhatsApp template message
 */
async function sendWhatsAppTemplate(
  phone: string,
  contactName: string,
  phoneNumberId: string,
  accessToken: string
): Promise<boolean> {
  const templateName = Deno.env.get('WHATSAPP_TPL_GHL_OPPORTUNITY') || 'hola';

  try {
    const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'es_CO' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: contactName },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GHL Webhook] WhatsApp API error:', error);
      return false;
    }

    const result = await response.json();
    console.log('[GHL Webhook] WhatsApp template sent:', result);
    return true;

  } catch (error) {
    console.error('[GHL Webhook] Failed to send template:', error);
    return false;
  }
}

/**
 * Log the template message to the messages table
 */
async function logTemplateMessage(
  supabase: ReturnType<typeof createSupabaseClient>,
  sessionId: string,
  contactName: string
): Promise<void> {
  const templateName = Deno.env.get('WHATSAPP_TPL_GHL_OPPORTUNITY') || 'hola';
  
  await supabase
    .schema(SCHEMA_NAME)
    .from('messages')
    .insert({
      session_id: sessionId,
      direction: 'outbound',
      type: 'template',
      content: `[Template: ${templateName}] Hola ${contactName}`,
      delivery_status: 'sent',
    });
}
