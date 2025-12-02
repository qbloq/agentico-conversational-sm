/**
 * Batch conversation generator with consolidation.
 * 
 * Processes conversations in batches, samples each batch multiple times,
 * consolidates per-batch results, then produces a final consolidated output.
 * 
 * Example: 500 conversations, batch size 100, 3 samples per batch, 20 generated per sample
 * - Creates 5 batches of 100 conversations each
 * - For each batch, runs generation 3 times (sampling different conversations)
 * - Consolidates each batch's 3 runs into one batch result
 * - Finally consolidates all 5 batch results into the final output
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

import {
  WATI_CACHE_DIR,
  GeneratedConversation,
  filterSubstantialFiles,
  shuffleArray,
  generateFromConversationFiles,
} from './generate-sample-conversations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const OUTPUT_DIR = path.join(__dirname, 'data/batch_output');
const FINAL_OUTPUT = path.join(__dirname, 'data/sample_conversations_consolidated.json');

interface BatchConfig {
  /** Total number of source conversations to use (0 = all) */
  totalConversations: number;
  /** Size of each batch */
  batchSize: number;
  /** Number of sampling iterations per batch */
  samplesPerBatch: number;
  /** Conversations to generate per sample iteration */
  generatePerSample: number;
}

function parseArgs(): BatchConfig {
  const args = process.argv.slice(2);
  const getArg = (name: string, defaultVal: number) => 
    parseInt(args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || String(defaultVal));

  return {
    totalConversations: getArg('total', 0),
    batchSize: getArg('batch-size', 100),
    samplesPerBatch: getArg('samples-per-batch', 3),
    generatePerSample: getArg('generate-per-sample', 20),
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Use Gemini to consolidate multiple conversation sets into one deduplicated set
 */
async function consolidateConversations(
  conversations: GeneratedConversation[],
  targetCount: number,
  idPrefix: string
): Promise<GeneratedConversation[]> {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_API_KEY) {
    throw new Error('Missing GOOGLE_API_KEY');
  }

  // If we have fewer than target, just return with renumbered IDs
  if (conversations.length <= targetCount) {
    return conversations.map((c, i) => ({
      ...c,
      id: `${idPrefix}_${String(i + 1).padStart(3, '0')}`,
    }));
  }

  const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

  const prompt = `
You are consolidating a dataset of sample conversations for training a GenAI sales bot.

INPUT: ${conversations.length} conversations (some may be similar or duplicates)

TASK:
1. Identify and merge similar conversations (keep the best version)
2. Remove low-quality or redundant entries
3. Ensure good distribution across categories (happy_path, deviation, edge_case, complex)
4. Ensure good distribution across outcomes (success, escalation, dropout, redirect)
5. Select the ${targetCount} best, most diverse conversations

INPUT CONVERSATIONS:
${JSON.stringify(conversations, null, 2)}

OUTPUT FORMAT:
Return a JSON array of exactly ${targetCount} conversations with this structure:
[
  {
    "id": "${idPrefix}_001",
    "scenario": "...",
    "category": "happy_path|deviation|edge_case|complex",
    "messages": [{ "role": "customer"|"agent", "content": "..." }],
    "outcome": "success|escalation|dropout|redirect",
    "notes": "..."
  }
]

Return ONLY valid JSON, no markdown.
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: { temperature: 0.3, maxOutputTokens: 64000 },
  });

  let jsonStr = (response.text ?? '').trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr) as GeneratedConversation[];
}

async function main() {
  const config = parseArgs();
  
  console.log('🚀 Batch Conversation Generator');
  console.log('================================');
  console.log(`   Total conversations: ${config.totalConversations || 'all'}`);
  console.log(`   Batch size: ${config.batchSize}`);
  console.log(`   Samples per batch: ${config.samplesPerBatch}`);
  console.log(`   Generate per sample: ${config.generatePerSample}`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load all conversation files
  const allFiles = fs.readdirSync(WATI_CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(WATI_CACHE_DIR, f));

  const substantialFiles = filterSubstantialFiles(allFiles);
  console.log(`\n📂 Found ${substantialFiles.length} substantial conversation files`);

  // Limit if specified
  const filesToProcess = config.totalConversations > 0
    ? shuffleArray(substantialFiles).slice(0, config.totalConversations)
    : substantialFiles;

  console.log(`   Using ${filesToProcess.length} files`);

  // Split into batches
  const batches = chunkArray(filesToProcess, config.batchSize);
  console.log(`   Split into ${batches.length} batches\n`);

  const batchResults: GeneratedConversation[][] = [];

  // Process each batch
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`\n📦 Batch ${batchIdx + 1}/${batches.length} (${batch.length} files)`);
    console.log('─'.repeat(50));

    const batchConversations: GeneratedConversation[] = [];

    // Run multiple sampling iterations for this batch
    for (let sampleIdx = 0; sampleIdx < config.samplesPerBatch; sampleIdx++) {
      console.log(`   🔄 Sample ${sampleIdx + 1}/${config.samplesPerBatch}...`);

      // Shuffle batch files for each sample iteration
      const sampledFiles = shuffleArray(batch);

      try {
        const generated = await generateFromConversationFiles({
          conversationFiles: sampledFiles,
          generateCount: config.generatePerSample,
          idPrefix: `b${batchIdx + 1}s${sampleIdx + 1}`,
        });

        console.log(`      ✅ Generated ${generated.length} conversations`);
        batchConversations.push(...generated);

        // Save intermediate result
        const sampleFile = path.join(OUTPUT_DIR, `batch_${batchIdx + 1}_sample_${sampleIdx + 1}.json`);
        fs.writeFileSync(sampleFile, JSON.stringify(generated, null, 2));
      } catch (err) {
        console.error(`      ❌ Error: ${err}`);
      }
    }

    // Consolidate this batch's samples
    console.log(`   📊 Consolidating batch ${batchIdx + 1}...`);
    const targetPerBatch = config.generatePerSample * 2; // Keep 2x per sample worth
    
    try {
      const consolidated = await consolidateConversations(
        batchConversations,
        Math.min(targetPerBatch, batchConversations.length),
        `batch${batchIdx + 1}`
      );

      console.log(`      ✅ Consolidated to ${consolidated.length} conversations`);
      batchResults.push(consolidated);

      // Save batch consolidated result
      const batchFile = path.join(OUTPUT_DIR, `batch_${batchIdx + 1}_consolidated.json`);
      fs.writeFileSync(batchFile, JSON.stringify(consolidated, null, 2));
    } catch (err) {
      console.error(`      ❌ Consolidation error: ${err}`);
      // Fall back to just using raw results
      batchResults.push(batchConversations);
    }
  }

  // Final consolidation across all batches
  console.log('\n' + '═'.repeat(50));
  console.log('🎯 Final Consolidation');
  console.log('═'.repeat(50));

  const allConversations = batchResults.flat();
  console.log(`   Total from all batches: ${allConversations.length}`);

  // Target: roughly 2x generatePerSample per batch
  const finalTarget = Math.min(
    config.generatePerSample * batches.length * 2,
    allConversations.length
  );

  console.log(`   Target final count: ${finalTarget}`);
  console.log('   🤖 Running final consolidation...');

  try {
    const finalConsolidated = await consolidateConversations(
      allConversations,
      finalTarget,
      'conv'
    );

    fs.writeFileSync(FINAL_OUTPUT, JSON.stringify(finalConsolidated, null, 2));

    console.log(`\n✅ Final output: ${finalConsolidated.length} conversations`);
    console.log(`📁 Saved to: ${FINAL_OUTPUT}`);

    // Summary stats
    const categories = finalConsolidated.reduce((acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const outcomes = finalConsolidated.reduce((acc, c) => {
      acc[c.outcome] = (acc[c.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Final Distribution:');
    console.log('   Categories:', categories);
    console.log('   Outcomes:', outcomes);
  } catch (err) {
    console.error(`❌ Final consolidation failed: ${err}`);
    // Save raw merged as fallback
    fs.writeFileSync(FINAL_OUTPUT, JSON.stringify(allConversations, null, 2));
    console.log(`📁 Saved raw merged (${allConversations.length}) to: ${FINAL_OUTPUT}`);
  }
}

main().catch(console.error);
