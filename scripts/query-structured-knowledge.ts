import { GoogleGenAI } from '@google/genai';
import { createGeminiProvider } from '../packages/sales-engine/src/llm/gemini.js';
import * as dotenv from 'dotenv';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ConversationResponseSchema } from '../packages/sales-engine/src/llm/schemas.js';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const STORE_DISPLAY_NAME = 'tag-markets-knowledge-base';

if (!GOOGLE_API_KEY) {
  console.error('Missing required environment variable: GOOGLE_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
const provider = createGeminiProvider({ 
  apiKey: GOOGLE_API_KEY, 
  model: 'gemini-3-flash-preview' 
});

async function runTest(query: string) {
  console.log(`🚀 Starting Structured RAG Query...`);
  
  try {
    // 1. Discover the Store
    console.log(`🔍 Searching for FileSearchStore "${STORE_DISPLAY_NAME}"...`);
    let store;
    const stores = await ai.fileSearchStores.list();
    for await (const s of stores) {
      if (s.displayName === STORE_DISPLAY_NAME) {
        store = s;
        break;
      }
    }

    if (!store) {
      console.error(`❌ Could not find FileSearchStore "${STORE_DISPLAY_NAME}"`);
      return;
    }

    console.log(`✅ Found store: ${store.name}`);
    console.log(`🤔 User Query: "${query}"`);
    console.log('---');

    // 2. Execute Structured Query with Provider Abstraction
    console.log('📡 Calling Provider with File Search & Structured Output (Mandated JSON)...');
    
    // Mandated format from buildSystemPrompt
    const systemPrompt = `
# Role
You are a sales representative for Tag Markets.

# Response Format
You MUST respond with a JSON object in a code block. The format is:
\`\`\`json
{
  "responses": [
    "First short message",
    "Second message continuing the thought",
    "Optional third message if needed"
  ],
  "transition": {
    "to": "state_name",
    "reason": "Brief explanation of why transitioning",
    "confidence": 0.8
  },
  "escalation": {
    "shouldEscalate": false,
    "reason": "explicit_request",
    "confidence": 0.9,
    "summary": "Brief context for human agent"
  },
  "extractedData": {
    "userName": "if user mentioned their name",
    "email": "if user provided email",
    "hasExperience": true,
    "interestLevel": "high",
    "userInterest": "what the user is interested in (e.g., copy trading, academy, specific product)",
    "concerns": ["any concerns they raised"],
    "hasRegistered": true,
    "deposit": true,
    "depositAmount": 500
  },
  "isUncertain": false
}
\`\`\`

Rules for the JSON response:
- "responses" is REQUIRED - an array of 2-4 short messages that will be sent sequentially (like WhatsApp bubbles)
- "transition" is OPTIONAL - only include if you detect completion signals and recommend moving to a new state
- "escalation" is OPTIONAL - only include when user should be transferred to a human agent
- "extractedData" is OPTIONAL - only include fields where you extracted new information
- "isUncertain" should be true if you're not confident in your response
`;

    const result = await provider.generateContentWithFileSearch({
      systemPrompt,
      prompt: query,
      fileSearch: {
        fileSearchStoreNames: [store.name!]
      },
      structuredOutput: {
        responseMimeType: 'application/json',
        responseJsonSchema: zodToJsonSchema(ConversationResponseSchema)
      },
      temperature: 0.1
    });

    // DEBUG: Log the full response
    console.log('DEBUG: Full content:', result.content);

    // 3. Parse and Display Result
    try {
      const parsed = JSON.parse(result.content || '{}');
      console.log('🤖 Structured Response:');
      console.log(JSON.stringify(parsed, null, 2));
      
      // Validate
      ConversationResponseSchema.parse(parsed);
      console.log('\n✅ JSON schema validation passed!');
    } catch (parseError) {
      console.error('❌ Failed to parse or validate structured response:', parseError);
    }

  } catch (error: any) {
    console.error('❌ Integration Error:', error.message || error);
  }
}

const userQuery = process.argv.slice(2).join(' ') || '¿Cómo puedo cambiar la zona horaria en los gráficos?';
runTest(userQuery);
