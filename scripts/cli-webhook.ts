/**
 * CLI Webhook Simulator
 * 
 * Simulates the WhatsApp Webhook flow:
 * 1. Acts as a client sending messages to the Supabase Edge Function.
 * 2. Acts as the WhatsApp Cloud API server receiving messages from the bot.
 * 3. Subscribes to Supabase Realtime for human agent messages.
 * 
 * Usage:
 *   npx tsx scripts/cli-webhook.ts
 */

import * as http from 'http';
import * as readline from 'readline';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Configuration
const WEBHOOK_URL = 'http://127.0.0.1:54321/functions/v1/webhook-whatsapp';
const MOCK_SERVER_PORT = 3000;
const MOCK_PHONE_ID = '123456789';
const MOCK_APP_SECRET = 'mock_app_secret'; // Must match clients/tag_markets.json or config used
const USER_PHONE = '5215555555555';
const CLIENT_SCHEMA = 'client_tag_markets';

// Supabase Client for database queries
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log(`[Supabase] URL: ${supabaseUrl}`);
console.log(`[Supabase] Key: ${supabaseKey ? supabaseKey.slice(0, 25) + '...' : 'NOT SET'}`);

const supabase = createClient(supabaseUrl, supabaseKey);

// Track current session for Realtime filtering
let currentSessionId: string | null = null;

// Start Mock WhatsApp Server
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Expected format: { messaging_product: 'whatsapp', to: '...', text: { body: '...' } }
        
        if (data.text && data.text.body) {
          console.log(`\n🤖 Bot > ${data.text.body}`);
          
          // Display Debug Metadata if present
          if (data._debug_metadata) {
            const meta = data._debug_metadata;
            if (meta.state) {
              console.log(`\x1b[33m[State] ${meta.state}\x1b[0m`);
            }
            if (meta.transition) {
               console.log(`\x1b[36m[Transition] ${meta.transition.from} -> ${meta.transition.to}\x1b[0m`);
               console.log(`\x1b[90m[Reason] ${meta.transition.reason}\x1b[0m`);
            }
            if (meta.tokensUsed) {
               console.log(`\x1b[90m[Tokens] ${JSON.stringify(meta.tokensUsed)}\x1b[0m`);
            }
            // Track session ID for Realtime
            if (meta.sessionId && meta.sessionId !== currentSessionId) {
              currentSessionId = meta.sessionId;
              console.log(`\x1b[90m[Session] Tracking: ${currentSessionId}\x1b[0m`);
            }
          }
        } else {
          console.log('\n🤖 Bot sent non-text message:', data);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [{ id: 'wamid.mock' }] }));
        
        rl.prompt();
      } catch (e) {
        console.error('Error parsing webhook request', e);
        res.writeHead(400);
        res.end();
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(MOCK_SERVER_PORT, () => {
  console.log(`✅ Mock WhatsApp API Server listening on port ${MOCK_SERVER_PORT}`);
  console.log(`   Configure Supabase Function with: WHATSAPP_API_BASE_URL=http://host.docker.internal:${MOCK_SERVER_PORT}`);
  console.log(`   (Or use your local IP if host.docker.internal doesn't work)`);
  startPollingForAgentMessages();
  startChat();
});

// Poll for human agent messages (fallback since Realtime isn't connecting locally)
let lastMessageCheck = new Date().toISOString();
let pollingActive = false;

async function startPollingForAgentMessages() {
  if (pollingActive) return;
  pollingActive = true;
  
  console.log('🔄 Starting polling for human agent messages (every 2s)...');
  console.log(`   Checking messages newer than: ${lastMessageCheck}`);
  
  // First poll immediately to test connection
  const testResult = await supabase
    .schema(CLIENT_SCHEMA)
    .from('messages')
    .select('count')
    .limit(1);
  
  if (testResult.error) {
    console.error('❌ Polling test failed:', testResult.error.message);
    console.error('   Make sure you have the service role key for schema access');
  } else {
    console.log('✅ Polling connection test passed');
  }
  
  setInterval(async () => {
    try {
      // Query for new outbound messages with sent_by_agent_id since last check
      const { data: messages, error } = await supabase
        .schema(CLIENT_SCHEMA) // Query the client schema
        .from('messages')
        .select('id, content, sent_by_agent_id, created_at')
        .eq('direction', 'outbound')
        .not('sent_by_agent_id', 'is', null)
        .gt('created_at', lastMessageCheck)
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error(`[Polling] Error: ${error.message}`);
        return;
      }
      
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          console.log(`\n👤 Agent > ${msg.content}`);
          console.log(`\x1b[35m[Human Agent Message]\x1b[0m`);
          rl.prompt();
        }
        // Update last check to latest message
        lastMessageCheck = messages[messages.length - 1].created_at;
      }
    } catch (e) {
      console.error('[Polling] Exception:', e);
    }
  }, 2000);
}

// Chat Interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'You > '
});

function startChat() {
  console.log('\n💬 WhatsApp Simulator Started');
  console.log('---------------------------');
  console.log(`Sending to: ${WEBHOOK_URL}`);
  console.log('Commands:');
  console.log('  /reset  - Reset user data');
  console.log('  /flush  - Trigger process-pending worker (for debounce testing)');
  console.log('  exit    - Quit\n');
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const input = line.trim();
    if (input === 'exit') {
      console.log('👋 Goodbye!');
      process.exit(0);
    }
    
    if (!input) {
      rl.prompt();
      return;
    }
    
    // Handle /flush command - trigger the process-pending worker
    if (input === '/flush') {
      await triggerProcessPending();
      rl.prompt();
      return;
    }
    
    await sendWebhook(input);
    // prompt is called after we receive the bot response ideally, but async flow makes it tricky.
    // We'll prompt immediately for now.
    // rl.prompt(); // Moved inside sendWebhook to simulate delay/flow
  });
}

/**
 * Trigger the process-pending Edge Function to flush buffered messages
 */
async function triggerProcessPending() {
  const PROCESS_PENDING_URL = 'http://127.0.0.1:54321/functions/v1/process-pending';
  const authKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  console.log('⏳ Triggering process-pending worker...');
  
  try {
    const response = await fetch(PROCESS_PENDING_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authKey}`
      },
      body: JSON.stringify({ source: 'cli-flush' }),
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Worker completed: ${result.sessionsProcessed || 0} sessions, ${result.messagesProcessed || 0} messages`);
    } else {
      console.error(`❌ Worker Error: ${response.status} ${response.statusText}`);
      const errText = await response.text();
      console.error(errText);
    }
  } catch (error) {
    console.error('❌ Network Error:', error);
  }
}

async function sendWebhook(text: string) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'mock_entry_id',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '15555555555',
            phone_number_id: MOCK_PHONE_ID,
          },
          contacts: [{
            profile: { name: 'Simulator User' },
            wa_id: USER_PHONE,
          }],
          messages: [{
            from: USER_PHONE,
            id: 'wamid.mock.' + Date.now(),
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'text',
            text: { body: text },
          }],
        },
        field: 'messages',
      }]
    }]
  };
  
  const body = JSON.stringify(payload);
  
  // Calculate Signature
  const signature = crypto
    .createHmac('sha256', MOCK_APP_SECRET)
    .update(body)
    .digest('hex');
    
  const authKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  // console.log('Auth key:', authKey);
  // console.log('Webhook URL:', WEBHOOK_URL);
  // console.log('Signature:', signature);
  // console.log('Body:', body);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${signature}`,
        'Authorization': `Bearer ${authKey}`
      },
      body: body,
    });
    
    if (!response.ok) {
      console.error(`❌ Webhook Error: ${response.status} ${response.statusText}`);
      const errText = await response.text();
      console.error(errText);
    }
  } catch (error) {
    console.error('❌ Network Error:', error);
  }
}

