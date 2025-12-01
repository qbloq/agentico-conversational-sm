/**
 * CLI Chat Interface for Conversational Sales Engine
 * 
 * Allows interacting with the bot via terminal.
 * 
 * Usage:
 *   npx tsx scripts/cli-chat.ts
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

import { createConversationEngine, ChannelType } from '@parallelo/sales-engine';
import { createGeminiProvider, createGeminiEmbeddingProvider } from '@parallelo/sales-engine/llm';

import {
  createSupabaseContactStore,
  createSupabaseSessionStore,
  createSupabaseMessageStore,
  createSupabaseKnowledgeStore
} from './utils/adapters.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const SCHEMA_NAME = 'client_tag_markets';
const CONFIG_PATH = '../clients/tag_markets.json'; // Relative to scripts/

async function main() {
  console.log('🤖 Initializing Conversational Sales Engine CLI...');

  // 1. Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  
  if (!supabaseUrl || !supabaseKey || !googleKey) {
    console.error('❌ Missing environment variables. Check .env');
    process.exit(1);
  }

  // 2. Load Client Config
  const configPath = path.resolve(__dirname, CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }
  const clientConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`✅ Loaded config for: ${clientConfig.business.name}`);

  // 3. Initialize Supabase
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // 4. Initialize Adapters
  const contactStore = createSupabaseContactStore(supabase, SCHEMA_NAME);
  const sessionStore = createSupabaseSessionStore(supabase, SCHEMA_NAME);
  const messageStore = createSupabaseMessageStore(supabase, SCHEMA_NAME);
  const knowledgeStore = createSupabaseKnowledgeStore(supabase, SCHEMA_NAME);
  console.log('✅ Database adapters initialized');

  // 5. Initialize Providers
  const llmProvider = createGeminiProvider({
    apiKey: googleKey,
    model: 'gemini-2.5-flash', // Hardcoded for now or use config
  });
  
  const embeddingProvider = createGeminiEmbeddingProvider({
    apiKey: googleKey,
  });
  console.log('✅ AI providers initialized (Gemini)');

  // 6. Initialize Engine
  const engine = createConversationEngine();

  // 7. Setup Session
  const mockUserId = 'cli-user-' + Math.floor(Math.random() * 1000);
  const sessionKey = {
    channelType: 'whatsapp' as ChannelType, // Simulate WhatsApp
    channelId: 'cli-simulator',
    channelUserId: mockUserId,
  };
  
  console.log(`\n💬 Starting chat session as ${mockUserId}`);
  console.log('--------------------------------------------------');
  console.log('Type your message and press Enter. Type "exit" to quit.\n');

  // 8. Chat Loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You > '
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    
    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }
    
    if (!input) {
      rl.prompt();
      return;
    }

    try {
      // Process message
      const result = await engine.processMessage({
        sessionKey,
        message: {
          id: 'msg-' + Date.now(),
          type: 'text',
          content: input,
          timestamp: new Date(),
        },
        deps: {
          contactStore,
          sessionStore,
          messageStore,
          knowledgeStore,
          llmProvider,
          embeddingProvider,
          clientConfig,
        },
      });

      // Persist session updates (state transitions, context, etc.)
      if (result.sessionUpdates && Object.keys(result.sessionUpdates).length > 0) {
        // Get current session to get its ID
        const currentSession = await sessionStore.findByKey(sessionKey);
        if (currentSession) {
          await sessionStore.update(currentSession.id, result.sessionUpdates);
        }
      }

      // Output responses
      for (const response of result.responses) {
        console.log(`Bot > ${response.content}`);
      }

    } catch (error) {
      console.error('❌ Error:', error);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });
}

main().catch(console.error);
