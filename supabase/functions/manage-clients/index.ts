import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseClient } from '../_shared/supabase.ts';
import { verifyAgent, corsHeaders, hasRequiredLevel, type AgentLevel } from '../_shared/auth.ts';
import { WABAClient } from 'npm:whatsapp-business';

interface WabaPayload {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId: string;
}

function isValidAgentLevel(level: unknown): level is AgentLevel {
  return level === 'agent' || level === 'manager' || level === 'admin';
}

async function linkWaba(waba: WabaPayload): Promise<{ accessToken: string; name: string; phoneNumber: string }> {
  const url = "https://graph.facebook.com/v22.0/oauth/access_token";

  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      client_id: Deno.env.get('META_APP_CLIENT_ID'),
      client_secret: Deno.env.get('META_APP_SECRET'),
      code: waba.code,
      grant_type: "authorization_code",
    }),
    headers: { "Content-Type": "application/json" },
  });
  const data = await response.json();

  const { access_token: accessToken } = data;
  if (!accessToken) {
    throw new Error('Failed to exchange code for access token');
  }

  const wabaClient = new WABAClient({
    phoneId: waba.phoneNumberId,
    accountId: waba.wabaId,
    apiToken: accessToken,
  });

  const singlePhoneNumber = await wabaClient.getSingleBusinessPhoneNumber(waba.phoneNumberId);

  await wabaClient.registerPhone({ phoneNumberId: waba.phoneNumberId, pin: '450045' });

  const subsUrl = `https://graph.facebook.com/v22.0/${waba.wabaId}/subscribed_apps`;
  await fetch(subsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    accessToken,
    name: singlePhoneNumber.verified_name,
    phoneNumber: singlePhoneNumber.display_phone_number,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const agent = await verifyAgent(req);
    if (!agent) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasRequiredLevel(agent, 'admin')) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createSupabaseClient();
    const url = new URL(req.url);

    // =========================================================================
    // GET routes
    // =========================================================================
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      const id = url.searchParams.get('id');

      // GET ?action=buckets — list storage buckets
      if (action === 'buckets') {
        const { data, error } = await supabase.storage.listBuckets();
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // GET ?action=agents&schema={schemaName} — list human agents with their allowed_client_ids
      if (action === 'agents') {
        const schema = url.searchParams.get('schema');
        if (!schema) {
          return new Response(
            JSON.stringify({ error: 'Missing schema parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data, error } = await supabase
          .schema(schema)
          .from('human_agents')
          .select('id, phone, first_name, last_name, email, is_active, level, allowed_client_ids, created_at')
          .order('first_name', { ascending: true });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // GET ?action=state-machines&schema={schemaName} — list active state machines
      if (action === 'state-machines') {
        const schema = url.searchParams.get('schema');
        if (!schema) {
          return new Response(
            JSON.stringify({ error: 'Missing schema parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const schemaClient = createSupabaseClient(schema);
        const { data, error } = await schemaClient
          .schema(schema)
          .from('state_machines')
          .select('id, name, version, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // GET ?id={uuid} — get single client with details
      if (id) {
        const { data: config, error: configErr } = await supabase
          .from('client_configs')
          .select('*')
          .eq('id', id)
          .single();
        if (configErr) throw configErr;

        const { data: secrets } = await supabase
          .from('client_secrets')
          .select('channel_type, secrets')
          .eq('client_id', config.client_id);

        return new Response(JSON.stringify({
          ...config,
          secrets: (secrets || []).map((s: any) => ({
            channel_type: s.channel_type,
            has_secrets: !!s.secrets && Object.keys(s.secrets).length > 0,
            phoneNumberId: s.secrets?.phoneNumberId || null,
            wabaId: s.secrets?.wabaId || null,
          })),
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // GET (no params) — list all clients
      const { data, error } = await supabase
        .from('client_configs')
        .select('id, client_id, schema_name, channel_type, channel_id, state_machine_name, storage_bucket, is_active, created_at, updated_at, config')
        .order('created_at', { ascending: false });
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // POST routes
    // =========================================================================
    if (req.method === 'POST') {
      const body = await req.json();
      const { action } = body;

      // POST { action: 'create-bucket', name }
      if (action === 'create-bucket') {
        const { name } = body;
        if (!name) {
          return new Response(
            JSON.stringify({ error: 'Missing bucket name' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data, error } = await supabase.storage.createBucket(name, { public: true });
        if (error) throw error;
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // POST { action: 'update-agent-clients', schema, agentId, allowedClientIds }
      if (action === 'update-agent-clients') {
        const { schema, agentId, allowedClientIds } = body;
        if (!schema || !agentId) {
          return new Response(
            JSON.stringify({ error: 'Missing schema or agentId' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: updated, error: updateErr } = await supabase
          .schema(schema)
          .from('human_agents')
          .update({
            allowed_client_ids: allowedClientIds || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', agentId)
          .select('id, phone, first_name, last_name, level, allowed_client_ids')
          .single();
        if (updateErr) throw updateErr;
        return new Response(JSON.stringify({ success: true, agent: updated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // POST { action: 'update-agent-level', schema, agentId, level }
      if (action === 'update-agent-level') {
        const { schema, agentId, level } = body;
        if (!schema || !agentId || !isValidAgentLevel(level)) {
          return new Response(
            JSON.stringify({ error: 'Missing schema, agentId, or invalid level' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const { data: updated, error: updateErr } = await supabase
          .schema(schema)
          .from('human_agents')
          .update({
            level,
            updated_at: new Date().toISOString(),
          })
          .eq('id', agentId)
          .select('id, phone, first_name, last_name, level, allowed_client_ids')
          .single();
        if (updateErr) throw updateErr;
        return new Response(JSON.stringify({ success: true, agent: updated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // POST { action: 'toggle-active', id }
      if (action === 'toggle-active') {
        const { id } = body;
        // Get current state
        const { data: current, error: getErr } = await supabase
          .from('client_configs')
          .select('is_active')
          .eq('id', id)
          .single();
        if (getErr) throw getErr;

        const { error: updateErr } = await supabase
          .from('client_configs')
          .update({ is_active: !current.is_active, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (updateErr) throw updateErr;

        return new Response(JSON.stringify({ success: true, is_active: !current.is_active }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // POST { action: 'create', ... }
      if (action === 'create') {
        const { client_id, schema_name, channel_type, channel_id, state_machine_name, storage_bucket, is_active, config, waba } = body;

        if (!client_id || !schema_name || !channel_type || !state_machine_name) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: client_id, schema_name, channel_type, state_machine_name' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Handle WABA linking first if present
        let wabaResult: { accessToken: string; name: string; phoneNumber: string } | null = null;
        if (waba && channel_type === 'whatsapp') {
          wabaResult = await linkWaba(waba);
        }

        // Insert client config
        const { data: created, error: createErr } = await supabase
          .from('client_configs')
          .insert({
            client_id,
            schema_name,
            channel_type,
            channel_id: wabaResult ? waba.phoneNumberId : (channel_id || null),
            state_machine_name,
            storage_bucket: storage_bucket || null,
            is_active: is_active !== undefined ? is_active : true,
            config: config || {},
          })
          .select()
          .single();

        if (createErr) {
          if (createErr.code === '23505') {
            return new Response(
              JSON.stringify({ error: 'client_id already exists' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw createErr;
        }

        // Upsert secrets if WABA was linked
        if (wabaResult) {
          const { error: secretErr } = await supabase
            .from('client_secrets')
            .upsert({
              client_id,
              channel_type: 'whatsapp',
              secrets: {
                phoneNumberId: waba.phoneNumberId,
                accessToken: wabaResult.accessToken,
                appSecret: Deno.env.get('META_APP_SECRET'),
                wabaId: waba.wabaId,
              },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'client_id,channel_type' });
          if (secretErr) {
            console.error('Failed to upsert secrets:', secretErr);
          }
        }

        return new Response(JSON.stringify(created), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // POST { action: 'update', id, ... }
      if (action === 'update') {
        const { id, client_id, channel_type, channel_id, state_machine_name, storage_bucket, is_active, config, waba } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Missing id for update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Handle WABA linking if present
        let wabaResult: { accessToken: string; name: string; phoneNumber: string } | null = null;
        if (waba && channel_type === 'whatsapp') {
          wabaResult = await linkWaba(waba);
        }

        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (channel_type !== undefined) updatePayload.channel_type = channel_type;
        if (channel_id !== undefined) updatePayload.channel_id = wabaResult ? waba.phoneNumberId : channel_id;
        if (state_machine_name !== undefined) updatePayload.state_machine_name = state_machine_name;
        if (storage_bucket !== undefined) updatePayload.storage_bucket = storage_bucket;
        if (is_active !== undefined) updatePayload.is_active = is_active;
        if (config !== undefined) updatePayload.config = config;

        const { data: updated, error: updateErr } = await supabase
          .from('client_configs')
          .update(updatePayload)
          .eq('id', id)
          .select()
          .single();
        if (updateErr) throw updateErr;

        // Upsert secrets if WABA was linked
        if (wabaResult && client_id) {
          const { error: secretErr } = await supabase
            .from('client_secrets')
            .upsert({
              client_id,
              channel_type: 'whatsapp',
              secrets: {
                phoneNumberId: waba.phoneNumberId,
                accessToken: wabaResult.accessToken,
                appSecret: Deno.env.get('META_APP_SECRET'),
                wabaId: waba.wabaId,
              },
              updated_at: new Date().toISOString(),
            }, { onConflict: 'client_id,channel_type' });
          if (secretErr) {
            console.error('Failed to upsert secrets:', secretErr);
          }
        }

        return new Response(JSON.stringify(updated), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({ error: 'Unknown action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  } catch (error) {
    console.error('manage-clients error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
