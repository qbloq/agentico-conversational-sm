/**
 * Annotate conversation examples with per-message state tags
 * 
 * Uses Gemini to analyze each conversation and assign the appropriate
 * conversation state to each message exchange.
 * 
 * Usage: npx tsx scripts/annotate-conversations.ts [--dry-run] [--limit=N]
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

// All valid conversation states
const VALID_STATES = [
  'initial',
  'returning_customer',
  'promotion_inquiry',
  'qualifying',
  'diagnosing',
  'pitching',
  'handling_objection',
  'closing',
  'post_registration',
  'education_redirect',
  'technical_support',
  'deposit_support',
  'platform_support',
  'withdrawal_support',
  'follow_up',
  'escalated',
  'completed',
  'disqualified',
] as const;

type ConversationState = typeof VALID_STATES[number];

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
    state: ConversationState;
  }>;
  state_flow: ConversationState[];
  primary_state: ConversationState;
}

const STATE_DESCRIPTIONS = `
## Conversation States

### Entry States
- **initial**: First contact, greeting, detecting user intent
- **returning_customer**: User indicates they already have an account
- **promotion_inquiry**: User asks about bonuses, free accounts, promotions

### Qualification States  
- **qualifying**: Assessing trading experience, understanding needs
- **diagnosing**: Deeper exploration of user's goals and pain points

### Sales Flow
- **pitching**: Presenting the x12 leveraged account offer
- **handling_objection**: Addressing concerns (safety, pricing, legitimacy)
- **closing**: Guiding to registration, providing signup link
- **post_registration**: User registered, guiding to deposit

### Education Flow
- **education_redirect**: Redirecting beginner to academy/education

### Support Flow
- **technical_support**: Login, registration, account access issues
- **deposit_support**: Help with deposits, payment issues
- **platform_support**: MT5 setup, trading platform issues
- **withdrawal_support**: Withdrawal process, pending withdrawals

### Terminal States
- **follow_up**: Re-engaging dormant conversation
- **escalated**: Handed off to human agent
- **completed**: Conversation successfully concluded
- **disqualified**: User not a fit (spam, wrong number, not interested)
`;

function buildAnnotationPrompt(conversation: ConversationExample): string {
  const messagesText = conversation.messages
    .map((m, i) => `${i + 1}. [${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n');

  return `
You are an expert conversation analyst. Your task is to annotate each message in a sales conversation with the appropriate conversation state.

${STATE_DESCRIPTIONS}

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
- Use ONLY these valid states: ${VALID_STATES.join(', ')}

Return ONLY valid JSON, no markdown.
`;
}

function validateAnnotation(result: any, original: ConversationExample): AnnotatedResult | null {
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
    if (!msg.state || !VALID_STATES.includes(msg.state)) {
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
  if (!result.primary_state || !VALID_STATES.includes(result.primary_state)) {
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

  console.log('🏷️  Conversation State Annotator');
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit) console.log(`   Limit: ${limit}`);

  // Fetch conversations without state annotations
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
      const prompt = buildAnnotationPrompt(conv);

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
      const validated = validateAnnotation(parsed, conv);

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
