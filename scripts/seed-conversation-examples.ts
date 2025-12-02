/**
 * Seed conversation examples into Supabase
 * 
 * Loads conversations from sample_conversations_consolidated.json
 * and inserts them into the conversation_examples table.
 * 
 * Usage: npx tsx scripts/seed-conversation-examples.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const CONSOLIDATED_FILE = path.join(__dirname, 'data/sample_conversations_consolidated.json');

interface SourceConversation {
  id: string;
  scenario: string;
  category: 'happy_path' | 'deviation' | 'edge_case' | 'complex';
  outcome: 'success' | 'escalation' | 'dropout' | 'redirect';
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
    state?: string;
  }>;
  notes?: string;
}

interface ConversationExample {
  example_id: string;
  scenario: string;
  category: string;
  outcome: string;
  primary_state: string | null;
  state_flow: string[] | null;
  messages: object;
  notes: string | null;
  source: string;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load source conversations
  if (!fs.existsSync(CONSOLIDATED_FILE)) {
    console.error(`❌ File not found: ${CONSOLIDATED_FILE}`);
    process.exit(1);
  }

  const sourceData: SourceConversation[] = JSON.parse(
    fs.readFileSync(CONSOLIDATED_FILE, 'utf-8')
  );

  console.log(`📂 Loaded ${sourceData.length} conversations from file`);

  // Transform to database format
  const examples: ConversationExample[] = sourceData.map(conv => {
    // Extract state flow if messages have state annotations
    const stateFlow = conv.messages
      .filter(m => m.state)
      .map(m => m.state!)
      .filter((state, idx, arr) => idx === 0 || state !== arr[idx - 1]); // Dedupe consecutive

    // Determine primary state (most common or first non-initial)
    const stateCounts = stateFlow.reduce((acc, state) => {
      if (state !== 'initial') {
        acc[state] = (acc[state] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    const primaryState = Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || stateFlow[0] || null;

    return {
      example_id: conv.id,
      scenario: conv.scenario,
      category: conv.category,
      outcome: conv.outcome,
      primary_state: primaryState,
      state_flow: stateFlow.length > 0 ? stateFlow : null,
      messages: conv.messages,
      notes: conv.notes || null,
      source: 'synthetic',
    };
  });

  console.log(`\n🔄 Inserting ${examples.length} examples into database...`);

  // Check for existing examples
  const { data: existing, error: checkError } = await supabase
    .from('conversation_examples')
    .select('example_id');

  if (checkError) {
    console.error('❌ Error checking existing examples:', checkError.message);
    process.exit(1);
  }

  const existingIds = new Set(existing?.map(e => e.example_id) || []);
  const newExamples = examples.filter(e => !existingIds.has(e.example_id));
  const updateExamples = examples.filter(e => existingIds.has(e.example_id));

  console.log(`   New: ${newExamples.length}, Updates: ${updateExamples.length}`);

  // Insert new examples
  if (newExamples.length > 0) {
    const { error: insertError } = await supabase
      .from('conversation_examples')
      .insert(newExamples);

    if (insertError) {
      console.error('❌ Error inserting examples:', insertError.message);
      process.exit(1);
    }
    console.log(`   ✅ Inserted ${newExamples.length} new examples`);
  }

  // Update existing examples
  for (const example of updateExamples) {
    const { error: updateError } = await supabase
      .from('conversation_examples')
      .update({
        scenario: example.scenario,
        category: example.category,
        outcome: example.outcome,
        primary_state: example.primary_state,
        state_flow: example.state_flow,
        messages: example.messages,
        notes: example.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('example_id', example.example_id);

    if (updateError) {
      console.error(`❌ Error updating ${example.example_id}:`, updateError.message);
    }
  }

  if (updateExamples.length > 0) {
    console.log(`   ✅ Updated ${updateExamples.length} existing examples`);
  }

  // Summary
  const { data: summary, error: summaryError } = await supabase
    .from('conversation_examples')
    .select('category, outcome, primary_state')
    .eq('is_active', true);

  if (!summaryError && summary) {
    const categories = summary.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const outcomes = summary.reduce((acc, e) => {
      acc[e.outcome] = (acc[e.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const states = summary.reduce((acc, e) => {
      if (e.primary_state) {
        acc[e.primary_state] = (acc[e.primary_state] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Summary:');
    console.log('   Categories:', categories);
    console.log('   Outcomes:', outcomes);
    console.log('   Primary States:', states);
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);
