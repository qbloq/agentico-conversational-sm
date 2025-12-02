/**
 * Test the ExampleStore implementation
 * 
 * Usage: npx tsx scripts/test-example-store.ts
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Import from the package
import {
  SupabaseExampleStore,
  formatExample,
  formatExamples,
  summarizeExample,
} from '../packages/sales-engine/src/examples/index.js';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const store = new SupabaseExampleStore(supabase as any);

  console.log('🧪 Testing ExampleStore\n');

  // Test 1: Get state distribution
  console.log('📊 State Distribution:');
  const distribution = await store.getStateDistribution();
  Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log(`   ${state}: ${count}`);
    });

  // Test 2: Find by state
  console.log('\n🔍 Finding examples for "pitching" state:');
  const pitchingExamples = await store.findByState('pitching', { limit: 2 });
  pitchingExamples.forEach(ex => {
    console.log(`   ${summarizeExample(ex)}`);
  });

  // Test 3: Find by state + category
  console.log('\n🔍 Finding "happy_path" examples for "handling_objection":');
  const objectionExamples = await store.findByState('handling_objection', {
    limit: 2,
    category: 'happy_path',
  });
  objectionExamples.forEach(ex => {
    console.log(`   ${summarizeExample(ex)}`);
  });

  // Test 4: Format single example
  if (pitchingExamples.length > 0) {
    console.log('\n📝 Formatted Example:');
    console.log('─'.repeat(60));
    console.log(formatExample(pitchingExamples[0], { maxMessages: 6 }));
    console.log('─'.repeat(60));
  }

  // Test 5: Format multiple examples for prompt
  console.log('\n📝 Formatted Examples for Prompt Injection:');
  console.log('─'.repeat(60));
  const supportExamples = await store.findByState('deposit_support', { limit: 2 });
  console.log(formatExamples(supportExamples, { maxMessages: 4 }));
  console.log('─'.repeat(60));

  // Test 6: Get by ID
  console.log('\n🔍 Get by ID (conv_001):');
  const specific = await store.getById('conv_001');
  if (specific) {
    console.log(`   ${summarizeExample(specific)}`);
  }

  console.log('\n✅ All tests passed!');
}

main().catch(console.error);
