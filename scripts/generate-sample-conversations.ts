/**
 * Generate synthetic sample conversations based on real Wati conversation data.
 * Uses Gemini to create diverse, realistic training conversations.
 * 
 * Can be used as:
 * - Standalone: npx tsx generate-sample-conversations.ts --sample=20 --generate=30
 * - Module: import { generateFromConversationFiles } from './generate-sample-conversations'
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

export const WATI_CACHE_DIR = path.join(__dirname, 'data/wati');
export const CONSOLIDATED_REPORT = path.join(__dirname, 'data/consolidated_report.json');
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'data/sample_conversations.json');

export interface WatiMessage {
  id: string;
  text: string;
  type: string;
  created: string;
  owner: boolean; // true = agent, false = customer
}

export interface GeneratedConversation {
  id: string;
  scenario: string;
  category: string;
  messages: Array<{
    role: 'customer' | 'agent';
    content: string;
  }>;
  outcome: 'success' | 'escalation' | 'dropout' | 'redirect';
  notes?: string;
}

export interface GenerateOptions {
  /** List of conversation file paths (absolute) to use as samples */
  conversationFiles: string[];
  /** Number of conversations to generate */
  generateCount: number;
  /** Optional prefix for conversation IDs */
  idPrefix?: string;
  /** Optional path to consolidated report for context */
  reportPath?: string;
}

export function reconstructConversation(messages: WatiMessage[]): string {
  // Sort by created date
  const sorted = [...messages].sort((a, b) => 
    new Date(a.created).getTime() - new Date(b.created).getTime()
  );
  
  return sorted
    .filter(m => m.text && m.text.trim())
    .map(m => {
      const sender = m.owner ? 'AGENT' : 'CUSTOMER';
      return `[${sender}]: ${m.text}`;
    })
    .join('\n');
}

export function filterSubstantialFiles(files: string[], minSize = 10000): string[] {
  return files.filter(f => {
    try {
      const stats = fs.statSync(f);
      return stats.size > minSize;
    } catch {
      return false;
    }
  });
}

export function shuffleArray<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * Core generation function - can be called programmatically
 */
export async function generateFromConversationFiles(
  options: GenerateOptions
): Promise<GeneratedConversation[]> {
  const { conversationFiles, generateCount, idPrefix = 'conv', reportPath } = options;

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_API_KEY) {
    throw new Error('Missing GOOGLE_API_KEY environment variable');
  }

  // Load consolidated report for context
  let reportContext = '';
  const reportFile = reportPath || CONSOLIDATED_REPORT;
  if (fs.existsSync(reportFile)) {
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf-8'));
    reportContext = `
ANALYSIS CONTEXT:
- Happy Paths: ${report.happy_paths?.map((h: any) => h.name).join(', ')}
- Common Deviations: ${report.deviations?.map((d: any) => d.name).join(', ')}
- Top Enquiries: ${report.enquiries?.map((e: any) => e.intent).join(', ')}
`;
  }

  // Load and reconstruct conversations
  const sampleConvos: string[] = [];
  for (const file of conversationFiles) {
    try {
      const messages: WatiMessage[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const convo = reconstructConversation(messages);
      if (convo.length > 100) {
        sampleConvos.push(convo);
      }
    } catch {
      // Skip invalid files
    }
  }

  if (sampleConvos.length === 0) {
    throw new Error('No valid conversations found in provided files');
  }

  // Build prompt
  const prompt = `
You are an expert conversation designer creating training data for a GenAI sales bot.

CONTEXT:
You work for TAG Markets, a trading platform offering leveraged accounts (x12 leverage).
The bot will handle WhatsApp customer inquiries in Spanish (Latin American).

${reportContext}

REAL CONVERSATION SAMPLES (for style and tone reference):
${sampleConvos.map((c, i) => `--- Sample ${i + 1} ---\n${c}`).join('\n\n')}

TASK:
Generate ${generateCount} diverse, realistic sample conversations that cover:

1. **Happy Path Scenarios** (40%):
   - Product inquiry → full information → registration intent
   - Existing user asking about withdrawals
   - Quick questions about rules/minimums

2. **Deviation Scenarios** (30%):
   - Beginner user needing academy redirect
   - Deposit/technical issues requiring support
   - Confused about promotions/bonuses

3. **Edge Cases** (20%):
   - Off-topic/wrong number
   - Aggressive/impatient customer
   - Multi-turn clarification needed

4. **Complex Scenarios** (10%):
   - Copy trading questions
   - IB/referral program inquiries
   - Account type comparisons

REQUIREMENTS:
- Use natural Latin American Spanish (informal "tú" form)
- Include typical typos and informal language customers use
- Vary conversation lengths (3-15 turns)
- Include realistic agent responses based on the samples
- Each conversation should have a clear outcome
- Use "${idPrefix}_XXX" format for conversation IDs

OUTPUT FORMAT:
Return a JSON array with this structure:
[
  {
    "id": "${idPrefix}_001",
    "scenario": "Brief description of the scenario",
    "category": "happy_path|deviation|edge_case|complex",
    "messages": [
      { "role": "customer", "content": "..." },
      { "role": "agent", "content": "..." }
    ],
    "outcome": "success|escalation|dropout|redirect",
    "notes": "Optional notes about this conversation"
  }
]

Return ONLY valid JSON, no markdown code blocks.
`;

  const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: { 
      temperature: 0.8,
      maxOutputTokens: 64000,
    },
  });

  let jsonStr = (response.text ?? '').trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr) as GeneratedConversation[];
}

/**
 * Standalone CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const sampleCount = parseInt(args.find(a => a.startsWith('--sample='))?.split('=')[1] || '20');
  const generateCount = parseInt(args.find(a => a.startsWith('--generate='))?.split('=')[1] || '30');
  const outputFile = args.find(a => a.startsWith('--output='))?.split('=')[1] || DEFAULT_OUTPUT_FILE;

  console.log('🚀 Sample Conversation Generator');
  console.log(`   Input samples: ${sampleCount}`);
  console.log(`   Output conversations: ${generateCount}`);

  // Get all conversation files
  const allFiles = fs.readdirSync(WATI_CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(WATI_CACHE_DIR, f));
  
  // Filter and sample
  const substantialFiles = filterSubstantialFiles(allFiles);
  const sampledFiles = shuffleArray(shuffleArray(substantialFiles)).slice(0, sampleCount);
  
  console.log(`\n📂 Sampled ${sampledFiles.length} conversations from ${substantialFiles.length} available`);

  console.log('\n🤖 Calling Gemini to generate conversations...');
  
  const generated = await generateFromConversationFiles({
    conversationFiles: sampledFiles,
    generateCount,
  });

  // Save output
  fs.writeFileSync(outputFile, JSON.stringify(generated, null, 2));

  console.log(`\n✅ Generated ${generated.length} conversations`);
  console.log(`📁 Saved to: ${outputFile}`);

  // Summary
  const categories = generated.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const outcomes = generated.reduce((acc, c) => {
    acc[c.outcome] = (acc[c.outcome] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n📊 Distribution:');
  console.log('  Categories:', categories);
  console.log('  Outcomes:', outcomes);
}

// Run standalone if executed directly
const isMain = process.argv[1]?.includes('generate-sample-conversations');
if (isMain) {
  main().catch(console.error);
}
