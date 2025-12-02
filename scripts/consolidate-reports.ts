/**
 * Consolidate multiple Wati conversation analysis reports into a single unified report.
 * Merges happy paths, deviations, and enquiries while aggregating frequencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const REPORTS_DIR = path.join(__dirname, 'data/wati_messages_report');
const OUTPUT_FILE = path.join(__dirname, 'data/consolidated_report.json');

interface HappyPath {
  name: string;
  steps: string[];
  frequency: number;
}

interface Deviation {
  name: string;
  description: string;
  trigger: string;
  frequency: number;
}

interface Enquiry {
  intent: string;
  example_phrases: string[];
  frequency: number;
  category: string;
}

interface Report {
  happy_paths: HappyPath[];
  deviations: Deviation[];
  enquiries: Enquiry[];
}

async function main() {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_API_KEY) {
    console.error('❌ Missing GOOGLE_API_KEY');
    process.exit(1);
  }

  // Load all reports
  const reportFiles = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`📂 Found ${reportFiles.length} reports to consolidate`);

  const reports: Report[] = reportFiles.map(f => {
    const content = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
    return JSON.parse(content);
  });

  // Aggregate all items
  const allHappyPaths: HappyPath[] = reports.flatMap(r => r.happy_paths || []);
  const allDeviations: Deviation[] = reports.flatMap(r => r.deviations || []);
  const allEnquiries: Enquiry[] = reports.flatMap(r => r.enquiries || []);

  console.log(`\n📊 Raw totals:`);
  console.log(`  - Happy Paths: ${allHappyPaths.length}`);
  console.log(`  - Deviations: ${allDeviations.length}`);
  console.log(`  - Enquiries: ${allEnquiries.length}`);

  // Use Gemini to consolidate and deduplicate
  const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

  const prompt = `
You are a data analyst consolidating multiple conversation analysis reports into a single unified report.

I have ${reportFiles.length} separate analysis reports from different samples of customer conversations.
Your task is to merge them into ONE consolidated report by:

1. **Happy Paths**: Merge similar flows, keep the most comprehensive step descriptions, sum frequencies
2. **Deviations**: Merge similar issues, combine triggers and descriptions, sum frequencies  
3. **Enquiries**: Merge similar intents (even if named differently), combine example phrases (keep best 4-5), sum frequencies, standardize category names

Use these standardized categories for enquiries:
- "Product Information" (how it works, rules, assets, account types)
- "Pricing & Deposits" (minimum deposit, fees, commissions, deposit methods)
- "Withdrawals" (withdrawal process, timing, methods)
- "Technical Support" (login issues, trading platform issues, deposit/withdrawal problems)
- "Promotions" (bonuses, free accounts, referral programs)
- "Onboarding" (registration, MT5 setup, beginner questions)
- "General" (greetings, request agent, off-topic)

INPUT DATA:

HAPPY PATHS:
${JSON.stringify(allHappyPaths, null, 2)}

DEVIATIONS:
${JSON.stringify(allDeviations, null, 2)}

ENQUIRIES:
${JSON.stringify(allEnquiries, null, 2)}

OUTPUT FORMAT:
Return a valid JSON object with this exact structure:
{
  "happy_paths": [
    { "name": "...", "steps": ["...", "..."], "frequency": number }
  ],
  "deviations": [
    { "name": "...", "description": "...", "trigger": "...", "frequency": number }
  ],
  "enquiries": [
    { "intent": "...", "example_phrases": ["...", "..."], "frequency": number, "category": "..." }
  ]
}

Sort each array by frequency (highest first). Return ONLY the JSON, no markdown.
`;

  console.log('\n🤖 Calling Gemini to consolidate...');
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: prompt,
    config: { temperature: 0.1 },
  });

  let jsonStr = (response.text ?? '').trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }

  const consolidated: Report = JSON.parse(jsonStr);

  // Save consolidated report
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(consolidated, null, 2));

  console.log(`\n✅ Consolidated report saved to: ${OUTPUT_FILE}`);
  console.log('----------------------------------------');
  console.log(`Happy Paths: ${consolidated.happy_paths?.length || 0}`);
  console.log(`Deviations: ${consolidated.deviations?.length || 0}`);
  console.log(`Enquiries: ${consolidated.enquiries?.length || 0}`);
  
  // Print summary
  console.log('\n📋 Top Enquiries:');
  consolidated.enquiries?.slice(0, 10).forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.intent} (${e.frequency}) - ${e.category}`);
  });
}

main().catch(console.error);
