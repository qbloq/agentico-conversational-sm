/**
 * Follow-up Seeding Script
 * 
 * Seeds followup_configs and followup_queue for testing.
 * 
 * Usage:
 *   npx tsx scripts/seed-followups.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CLIENT_ID = 'tag_markets_oficial';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Resolve Schema and State Machine from public.client_configs
  console.log(`🔍 Resolving config for client: ${CLIENT_ID}...`);
  const { data: clientConfig, error: configError } = await supabase
    .from('client_configs')
    .select('schema_name, state_machine_name')
    .eq('client_id', CLIENT_ID)
    .single();

  if (configError || !clientConfig) {
    console.error(`❌ Could not resolve config for ${CLIENT_ID}. Make sure it exists in public.client_configs.`);
    process.exit(1);
  }

  const { schema_name: schemaName, state_machine_name: stateMachineName } = clientConfig;
  console.log(`✅ Resolved schema: ${schemaName}, state machine: ${stateMachineName}`);

  console.log('🤖 Seeding Follow-up data via Edge Functions...');

  const BASE_URL = 'http://127.0.0.1:54321/functions/v1';

  async function callFunction(name: string, body: any) {
    const url = `${BASE_URL}/${name}?clientId=${CLIENT_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Function ${name} failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  // 1. Create Follow-up Configs via manage-followup-configs
  const followupConfigs = [
    {
      name: 'short_term_recovery',
      type: 'text',
      content: 'Hola {{firstName}}, ¿sigues ahí? Me gustaría ayudarte a completar tu registro.',
      variables_config: [
        { key: 'firstName', type: 'context', field: 'firstName' }
      ]
    },
    {
      name: 'daily_educational',
      type: 'template',
      content: 'educational_tips_01',
      variables_config: [
        { key: '1', type: 'context', field: 'firstName' }
      ]
    },
    {
       name: 'human_escalation_needed',
       type: 'text',
       content: 'Parece que necesitas ayuda adicional. Un agente humano se pondrá en contacto contigo pronto.'
    }
  ];

  console.log('📝 Seeding followup_configs...');
  for (const config of followupConfigs) {
    try {
      await callFunction('manage-followup-configs', config);
      console.log(`✅ Seeded config: ${config.name}`);
    } catch (error: any) {
      console.error(`❌ Failed to seed config ${config.name}:`, error.message);
    }
  }

  // 2. Update State Machine via manage-state-machines
  console.log('⚙️ Updating state machine via manage-state-machines...');
  
  // First, get the current state machine to get its states
  const { data: sm, error: smError } = await supabase
    .schema(schemaName)
    .from('state_machines')
    .select('id, name, states, initial_state')
    .eq('name', stateMachineName)
    .eq('is_active', true)
    .single();

  if (smError || !sm) {
    console.error('❌ Could not find active state machine "default_sales_flow"');
  } else {
    const updatedStates = { ...sm.states } as any;
    
    // Add follow-up sequence to 'closing' state
    if (updatedStates['initial']) {
      updatedStates['initial'].followupSequence = [
        { interval: '30 seconds', configName: 'short_term_recovery' },
        { interval: '1 hour', configName: 'daily_educational' }
      ];
      console.log('✅ Added followupSequence to "initial" state');
    }

    // Add follow-up sequence to 'pitching_12x' state
    if (updatedStates['pitching_12x']) {
      updatedStates['pitching_12x'].followupSequence = [
        { interval: '2 minutes', configName: 'short_term_recovery' }
      ];
      console.log('✅ Added followupSequence to "pitching_12x" state');
    }

    try {
      await callFunction('manage-state-machines', {
        id: sm.id,
        name: sm.name,
        initial_state: sm.initial_state,
        states: updatedStates
      });
      console.log('✅ State machine updated successfully');
    } catch (error: any) {
      console.error('❌ Failed to update state machine:', error.message);
    }
  }

  // 3. Find a session to attach follow-ups to (Direct DB still preferred for test data injection)
  // We prefer an active session to test the follow-up flow
  const { data: session, error: sessionError } = await supabase
    .schema(schemaName)
    .from('sessions')
    .select('id, contact_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    console.error('❌ Error fetching session:', sessionError.message);
    return;
  }

  if (!session) {
    console.log(`⚠️ No session found in ${schemaName}.sessions.`);
    console.log('💡 Run the CLI and send a message first to create a session.');
    return;
  }

  console.log(`🔗 Using session: ${session.id}`);

  // 4. Clear existing pending follow-ups for this session to start fresh
  await supabase
    .schema(schemaName)
    .from('followup_queue')
    .delete()
    .eq('session_id', session.id)
    .eq('status', 'pending');

  // 5. Seed Follow-up Queue (Direct DB)
  const now = new Date();
  const queueItems = [
    {
      session_id: session.id,
      scheduled_at: new Date(now.getTime() - 1000 * 60 * 5).toISOString(), // 5 minutes ago (DUE)
      followup_type: 'short_term',
      followup_config_name: 'short_term_recovery',
      status: 'pending',
      sequence_index: 0
    },
    {
      session_id: session.id,
      scheduled_at: new Date(now.getTime() + 1000 * 60 * 60).toISOString(), // 1 hour from now (FUTURE)
      followup_type: 'daily',
      followup_config_name: 'daily_educational',
      status: 'pending',
      sequence_index: 1
    }
  ];

  console.log('⏳ Seeding followup_queue...');
  const { error: queueError } = await supabase
    .schema(schemaName)
    .from('followup_queue')
    .insert(queueItems);

  if (queueError) {
    console.error('❌ Failed to seed queue:', queueError.message);
  } else {
    console.log('✅ Seeded 2 follow-ups (1 due, 1 future).');
    console.log('\n🚀 Now run the CLI and use /cron or /followups to trigger them!');
  }
}

main().catch(console.error);
