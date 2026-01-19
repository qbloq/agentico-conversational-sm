/**
 * Detect Deposits in Conversations
 * 
 * Uses Gemini (@google/genai) to analyze exported chat logs
 * and identify sessions where a deposit was made and the amount.
 * 
 * Usage: npx tsx scripts/detect-deposits.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const CHATS_DIR = path.join(__dirname, 'data/chats');
const OUTPUT_CSV = path.join(__dirname, 'data/deposits_detected.csv');

interface DetectionResult {
  session_id: string;
  deposited: boolean;
  amount: string;
  reasoning: string;
}

async function main() {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.error('❌ Missing GOOGLE_API_KEY in environment');
    process.exit(1);
  }

  const client = new GoogleGenAI({ apiKey });
  
  if (!fs.existsSync(CHATS_DIR)) {
    console.error(`❌ Chats directory not found: ${CHATS_DIR}`);
    process.exit(1);
  }

  const chatFiles = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.txt'));

  if (chatFiles.length === 0) {
    console.log('ℹ️ No chat files found to analyze.');
    return;
  }

  console.log(`🔍 Found ${chatFiles.length} chats to analyze...`);

  const results: DetectionResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < chatFiles.length; i++) {
    const file = chatFiles[i];
    const sessionId = path.basename(file, '.txt');
    const content = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8');

    process.stdout.write(`\r   Analyzing: ${i + 1}/${chatFiles.length} (${sessionId})`);

    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: `
Analyze the following conversation between a financial consultor (agent) and a user.
The goal of the agent is to help the user open a trading account and make their first deposit.

CONVERSATION:
---
${content}
---

Determine if the user explicitly stated or confirmed making a deposit.
If they did, extract the amount mentioned (including currency if available).

Respond ONLY with a JSON object in the following format:
{
  "deposited": boolean,
  "amount": "string or null",
  "reasoning": "short explanation of why you think they deposited or not"
}
` }]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        }
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      
      // Track tokens
      const usage = response.usageMetadata;
      if (usage) {
        totalInputTokens += usage.promptTokenCount || 0;
        totalOutputTokens += usage.candidatesTokenCount || 0;
      }

      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.deposited) {
          results.push({
            session_id: sessionId,
            deposited: parsed.deposited,
            amount: parsed.amount || 'Unknown',
            reasoning: parsed.reasoning || '',
          });
        }
      }
    } catch (error: any) {
      console.error(`\n❌ Error analyzing ${sessionId}:`, error.message);
    }
  }

  console.log('\n\n✅ Analysis complete.');
  console.log(`📊 Found ${results.length} deposits.`);
  console.log(`🪙  Token Usage: Input: ${totalInputTokens}, Output: ${totalOutputTokens}, Total: ${totalInputTokens + totalOutputTokens}`);

  if (results.length > 0) {
    console.log(`💾 Writing results to ${OUTPUT_CSV}...`);
    
    const csvHeader = 'session_id,deposited,amount,reasoning\n';
    const csvRows = results.map(r => {
      // Escape commas for CSV
      const escapedReasoning = `"${r.reasoning.replace(/"/g, '""')}"`;
      const escapedAmount = `"${r.amount.replace(/"/g, '""')}"`;
      return `${r.session_id},${r.deposited},${escapedAmount},${escapedReasoning}`;
    }).join('\n');

    fs.writeFileSync(OUTPUT_CSV, csvHeader + csvRows);
    console.log('✅ CSV generated successfully.');
  } else {
    console.log('ℹ️ No deposits detected. CSV not generated.');
  }
}

main().catch(console.error);
