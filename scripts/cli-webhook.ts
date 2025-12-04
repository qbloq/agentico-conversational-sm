/**
 * CLI Webhook Simulator
 * 
 * Simulates the WhatsApp Webhook flow:
 * 1. Acts as a client sending messages to the Supabase Edge Function.
 * 2. Acts as the WhatsApp Cloud API server receiving messages from the bot.
 * 
 * Usage:
 *   npx tsx scripts/cli-webhook.ts
 */

import * as http from 'http';
import * as readline from 'readline';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const WEBHOOK_URL = 'http://127.0.0.1:54321/functions/v1/webhook-whatsapp';
const MOCK_SERVER_PORT = 3000;
const MOCK_PHONE_ID = '123456789';
const MOCK_APP_SECRET = 'mock_app_secret'; // Must match clients/tag_markets.json or config used
const USER_PHONE = '5215555555555';

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
  startChat();
});

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
  console.log('Type a message and press Enter. Type "exit" to quit.\n');
  
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
    
    await sendWebhook(input);
    // prompt is called after we receive the bot response ideally, but async flow makes it tricky.
    // We'll prompt immediately for now.
    // rl.prompt(); // Moved inside sendWebhook to simulate delay/flow
  });
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
