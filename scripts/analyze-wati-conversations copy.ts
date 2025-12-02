
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createGeminiProvider } from '@parallelo/sales-engine/llm';
import type { LLMProvider } from '@parallelo/sales-engine/llm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Configuration
const WATI_API_URL = process.env.WATI_API_URL;
const WATI_ACCESS_TOKEN = process.env.WATI_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const DEFAULT_CONTACT_LIMIT = 10;
const OUTPUT_FILE = path.join(__dirname, 'data/analysis_report.json');
const API_DELAY_MS = 500; // Delay between API calls to avoid rate limits

// Helper for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Types based on samples
interface WatiContact {
  id: string;
  firstName: string;
  fullName: string;
  phone: string;
  waChannelPhone?: string;
  [key: string]: any;
}

interface WatiMessage {
  id: string;
  text: string;
  type: string;
  created: string;
  owner: boolean; // true = bot/agent, false = customer (usually, need to verify based on sample)
  operatorName?: string;
  eventType: string;
  [key: string]: any;
}

interface Conversation {
  contact: WatiContact;
  messages: WatiMessage[];
}

class WatiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async fetch(endpoint: string, params: Record<string, any> = {}) {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 429) {
          retries++;
          const waitTime = 2000 * Math.pow(2, retries); // Exponential backoff: 4s, 8s, 16s
          console.log(`    Rate limited. Retrying in ${waitTime}ms...`);
          await sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Wati API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        if (retries === maxRetries - 1) throw error;
        retries++;
        await sleep(1000);
      }
    }
  }

  async getContacts(limit: number): Promise<WatiContact[]> {
    let contacts: WatiContact[] = [];
    let pageNumber = 1;
    const pageSize = 100; // Max allowed usually

    console.log(`Fetching up to ${limit} contacts...`);

    while (contacts.length < limit) {
      try {
        const data = await this.fetch('/getContacts', {
          pageSize,
          pageNumber,
        });

        if (!data.contact_list || data.contact_list.length === 0) {
          break;
        }

        contacts = contacts.concat(data.contact_list);
        console.log(`  Fetched ${contacts.length} contacts so far...`);

        if (contacts.length >= data.link?.total || !data.link?.nextPage) {
          break;
        }
        
        pageNumber++;
      } catch (error) {
        console.error('  Error fetching contacts:', error);
        break;
      }
    }

    return contacts.slice(0, limit);
  }

  async getMessages(phone: string): Promise<WatiMessage[]> {
    let messages: WatiMessage[] = [];
    let pageNumber = 1;
    const pageSize = 100;
    
    // For getMessages, the API usually works by phone number
    // Sample doesn't show URL but assuming /getMessages/{phone} or query param
    // Based on prompt: "query the messages API by contact's phone"
    // Standard Wati API is usually /getMessages?whatsappNumber=...
    // But let's try assuming the endpoint style from the prompt description or standard.
    // The prompt implies: "query the messages API by contact's `phone`".
    // We'll use `/getMessages/${phone}` pattern if that's the instruction or `/getMessages` with query.
    // Let's assume `/getMessages/${phone}` is NOT standard Wati, usually it is `/getMessages?whatsappNumber=`.
    // However, I will try to handle it as a query param `whatsappNumber` which is standard Wati v1.
    
    while (true) {
      try {
        const data = await this.fetch(`/getMessages/${phone}`, {
          pageSize,
          pageNumber,
        });

        if (!data.messages || !data.messages.items || data.messages.items.length === 0) {
          break;
        }

        messages = messages.concat(data.messages.items);

        // Simple pagination check - if we got less than requested, we're likely done
        // Or check total if available. The sample shows data.messages.items but not total count in the sample provided.
        // Actually sample shows "messages": { "items": [...] }. It doesn't show a link object inside messages.
        // So we break if items < pageSize
        
        if (data.messages.items.length < pageSize) {
          break;
        }
        
        pageNumber++;
      } catch (error) {
        // Some contacts might fail or have no messages
        console.warn(`  Warning: Could not fetch messages for ${phone}:`, error instanceof Error ? error.message : error);
        break;
      }
    }
    
    // Sort messages by date (oldest first) for the LLM
    return messages.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
  }
}

async function analyzeConversations(
  conversations: Conversation[],
  llmProvider: LLMProvider
) {
  console.log(`\nAnalyzing ${conversations.length} conversations with Gemini...`);

  // We process in batches or single huge prompt? 
  // Gemini has large context window. Let's try to fit summary of all conversations.
  // Or better: Summarize each first, then aggregate?
  // "Find happy paths and deviations... comprehensive list of enquiries with frequencies"
  // A single pass with all data might be best if it fits.
  // Format conversations for prompt.

  const conversationsText = conversations.map((c, i) => {
    const msgText = c.messages.map(m => {
      const sender = m.owner ? 'AGENT' : 'CUSTOMER'; // Verify 'owner' flag meaning. Usually owner=true is the account holder (Agent/Bot).
      return `[${sender}] (${m.created}): ${m.text}`;
    }).join('\n');
    return `CONVERSATION #${i + 1} (Contact: ${c.contact.fullName || c.contact.phone}):\n${msgText}\n`;
  }).join('\n---\n');

  const prompt = `
    You are an expert Data Analyst and Conversation Designer.
    Your goal is to analyze the following customer service conversations to help build a Decision Tree for a GenAI bot.
    
    INPUT DATA:
    ${conversationsText}

    TASK:
    1. Identify the "Happy Paths" (ideal, successful flows) and describe them efficiently.
    2. Identify the most important "Deviations" (where things go wrong, require escalation, or loop).
    3. Generate a COMPREHENSIVE list of customer enquiries (intents) with their observed frequencies (count).
    
    OUTPUT FORMAT:
    Return a valid JSON object with this structure:
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
    
    Do not include markdown code blocks in the response, just the raw JSON string if possible, or wrapped in JSON code block.
  `;

  const response = await llmProvider.generateResponse({
    systemPrompt: 'You are a helpful assistant that outputs strictly JSON.',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, // Low temp for consistent analysis
  });

  // Clean response content (remove markdown block markers if present)
  let jsonStr = response.content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
  }

  return JSON.parse(jsonStr);
}

async function main() {
  // Check Env
  if (!WATI_API_URL || !WATI_ACCESS_TOKEN || !GOOGLE_API_KEY) {
    console.error('❌ Missing environment variables: WATI_API_URL, WATI_ACCESS_TOKEN, or GOOGLE_API_KEY');
    process.exit(1);
  }

  // Parse Args
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : DEFAULT_CONTACT_LIMIT;

  console.log('🚀 Starting Wati Conversation Analysis');
  console.log(`Target: ${limit} contacts`);

  // Init Wati Client
  const wati = new WatiClient(WATI_API_URL, WATI_ACCESS_TOKEN);
  
  // Init Gemini
  const gemini = createGeminiProvider({
    apiKey: GOOGLE_API_KEY,
    model: 'gemini-3.0-pro-preview' // Using fast model with large context
  });

  // 1. Fetch Contacts
  const contacts = await wati.getContacts(limit);
  console.log(`✅ Fetched ${contacts.length} contacts.`);

  // 2. Fetch Messages for each contact
  const conversations: Conversation[] = [];
  console.log('📥 Fetching messages...');
  
  for (const contact of contacts) {
    if (!contact.phone) continue;
    process.stdout.write(`  - ${contact.phone}... `);
    
    // Throttle calls
    await sleep(API_DELAY_MS);
    
    const messages = await wati.getMessages(contact.phone);
    process.stdout.write(`${messages.length} msgs\n`);
    
    if (messages.length > 0) {
      conversations.push({ contact, messages });
    }
  }

  if (conversations.length === 0) {
    console.log('⚠️ No conversations found with messages.');
    return;
  }

  // 3. Analyze
  try {
    const report = await analyzeConversations(conversations, gemini);
    
    // 4. Save Report
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    
    console.log(`\n✅ Analysis complete! Report saved to: ${OUTPUT_FILE}`);
    console.log('----------------------------------------');
    console.log(`Happy Paths found: ${report.happy_paths?.length || 0}`);
    console.log(`Deviations found: ${report.deviations?.length || 0}`);
    console.log(`Enquiries types found: ${report.enquiries?.length || 0}`);

  } catch (error) {
    console.error('❌ Error during analysis:', error);
  }
}

main().catch(console.error);
