/**
 * Annotate conversation examples with per-message state tags
 * 
 * Uses Gemini to analyze each conversation and assign the appropriate
 * conversation state to each message exchange.
 * 
 * Dynmically fetches state definitions from the DB (client_tag_markets schema).
 * 
 * Usage: npx tsx scripts/annotate-conversations-db.ts [--dry-run] [--limit=N]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Types for DB
interface StateConfig {
  state: string;
  objective: string;
  description: string;
  [key: string]: any;
}

interface StateMachineRow {
  states: Record<string, StateConfig>;
}

// Types for Annotation
interface Message {
  role: 'customer' | 'agent';
  content: string;
  state?: string;
}

interface ConversationExample {
  id: string;
  example_id: string;
  scenario: string;
  category: string;
  outcome: string;
  messages: Message[];
  notes?: string;
}

interface AnnotatedResult {
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
    state: string;
  }>;
  state_flow: string[];
  primary_state: string;
}

function buildAnnotationPrompt(conversation: ConversationExample, validStates: string[], stateDescriptions: string): string {
  const messagesText = conversation.messages
    .map((m, i) => `${i + 1}. [${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  return `
You are an expert conversation analyst. Your task is to annotate each message in a sales conversation with the appropriate conversation state.

${stateDescriptions}

## Conversation to Annotate

**Scenario**: ${conversation.scenario}
**Category**: ${conversation.category}
**Outcome**: ${conversation.outcome}
${conversation.notes ? `**Notes**: ${conversation.notes}` : ''}

**Messages**:
${messagesText}

## Task

For each message, determine which state the agent is operating in (or transitioning to). Consider:
1. What objective is the agent pursuing?
2. What signals is the agent responding to?
3. Customer messages should have the state that the agent will respond in

## Output Format

Return a JSON object with this exact structure:
{
  "messages": [
    { "role": "customer", "content": "...", "state": "initial" },
    { "role": "agent", "content": "...", "state": "initial" },
    ...
  ],
  "state_flow": ["initial", "qualifying", "pitching", ...],
  "primary_state": "pitching"
}

Rules:
- "messages" must have the same content as input, just with "state" added
- "state_flow" is the unique sequence of states (no consecutive duplicates)
- "primary_state" is the most important/representative state (usually where most agent work happens)
- Use ONLY these valid states: ${validStates.join(', ')}

Return ONLY valid JSON, no markdown.
`;
}

function validateAnnotation(result: any, original: ConversationExample, validStates: string[]): AnnotatedResult | null {
  if (!result || !result.messages || !Array.isArray(result.messages)) {
    console.error('    Invalid structure: missing messages array');
    return null;
  }

  if (result.messages.length !== original.messages.length) {
    console.error(`    Message count mismatch: ${result.messages.length} vs ${original.messages.length}`);
    return null;
  }

  // Validate each message
  for (let i = 0; i < result.messages.length; i++) {
    const msg = result.messages[i];
    if (!msg.state || !validStates.includes(msg.state)) {
      console.error(`    Invalid state "${msg.state}" at message ${i + 1}`);
      return null;
    }
    // Preserve original content
    msg.content = original.messages[i].content;
    msg.role = original.messages[i].role;
  }

  // Validate state_flow
  if (!result.state_flow || !Array.isArray(result.state_flow)) {
    // Generate from messages if missing
    result.state_flow = result.messages
      .map((m: any) => m.state)
      .filter((s: string, i: number, arr: string[]) => i === 0 || s !== arr[i - 1]);
  }

  // Validate primary_state
  if (!result.primary_state || !validStates.includes(result.primary_state)) {
    // Use most common non-initial state
    const stateCounts = result.state_flow.reduce((acc: Record<string, number>, s: string) => {
      if (s !== 'initial') acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    result.primary_state = Object.entries(stateCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || result.state_flow[0];
  }

  return result as AnnotatedResult;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const googleApiKey = process.env.GOOGLE_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!googleApiKey) {
    console.error('❌ Missing GOOGLE_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const ai = new GoogleGenAI({ apiKey: googleApiKey });

  console.log('🏷️  Conversation State Annotator (DB Powered)');
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit) console.log(`   Limit: ${limit}`);

  // 1. Fetch State Machine Definitions from DB
  console.log('🔄 Fetching state machine definitions from client_tag_markets...');
  
  const { data: smData, error: smError } = await supabase
    .schema('client_tag_markets')
    .from('state_machines')
    .select('states')
    .eq('is_active', true)
    .single();

  if (smError || !smData) {
    console.error('❌ Error fetching active state machine:', smError?.message || 'No active state machine found');
    process.exit(1);
  }

  const stateConfigs = (smData as unknown as StateMachineRow).states;
  const validStates = Object.keys(stateConfigs);
  
  // Build dynamic descriptions
  let stateDescriptions = '## Conversation States\n\n';
  
  // Sort to keep initial first if possible, then others
  const sortedStates = validStates.sort((a, b) => {
    if (a === 'initial') return -1;
    if (b === 'initial') return 1;
    return a.localeCompare(b);
  });

  for (const state of sortedStates) {
    const config = stateConfigs[state];
    stateDescriptions += `- **${state}**: ${config.description}\n`;
    stateDescriptions += `  *Objective*: ${config.objective}\n`;
  }
  
  console.log(`✅ Loaded ${validStates.length} states from DB`);

  // 2. Fetch conversations without state annotations
  let query = supabase
    .from('conversation_examples')
    .select('id, example_id, scenario, category, outcome, messages, notes')
    .is('primary_state', null)
    .eq('is_active', true)
    .order('example_id');

  if (limit) {
    query = query.limit(limit);
  }

  const { data: conversations, error } = await query;

  if (error) {
    console.error('❌ Error fetching conversations:', error.message);
    process.exit(1);
  }

  if (!conversations || conversations.length === 0) {
    console.log('✅ All conversations already annotated!');
    return;
  }

  console.log(`\n📝 Found ${conversations.length} conversations to annotate\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const conv of conversations as ConversationExample[]) {
    process.stdout.write(`  ${conv.example_id}: `);

    try {
      // Pass dynamic validStates and descriptions
      const prompt = buildAnnotationPrompt(conv, validStates, stateDescriptions);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { temperature: 0.1 },
      });

      let jsonStr = (response.text ?? '').trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);
      // Pass dynamic validStates
      const validated = validateAnnotation(parsed, conv, validStates);

      if (!validated) {
        console.log('❌ Validation failed');
        errorCount++;
        continue;
      }

      console.log(`✅ ${validated.state_flow.join(' → ')} (primary: ${validated.primary_state})`);

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('conversation_examples')
          .update({
            messages: validated.messages,
            state_flow: validated.state_flow,
            primary_state: validated.primary_state,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conv.id);

        if (updateError) {
          console.error(`    ⚠️  Update failed: ${updateError.message}`);
          errorCount++;
          continue;
        }
      }

      successCount++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err) {
      console.log(`❌ Error: ${err}`);
      errorCount++;
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - no changes were saved');
  }

  // Show distribution
  if (!dryRun && successCount > 0) {
    const { data: stats } = await supabase
      .from('conversation_examples')
      .select('primary_state')
      .not('primary_state', 'is', null);

    if (stats) {
      const distribution = stats.reduce((acc, e) => {
        acc[e.primary_state] = (acc[e.primary_state] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n📊 State Distribution:');
      Object.entries(distribution)
        .sort((a, b) => b[1] - a[1])
        .forEach(([state, count]) => {
          console.log(`   ${state}: ${count}`);
        });
    }
  }
}

main().catch(console.error);
