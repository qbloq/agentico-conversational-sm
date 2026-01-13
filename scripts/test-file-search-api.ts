import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('Missing GOOGLE_API_KEY');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

async function testAPI() {
  console.log('Testing File Search Store API...\n');
  
  // Test 1: List stores
  console.log('1. Testing list()...');
  try {
    const listResponse = await ai.fileSearchStores.list();
    console.log('List response type:', typeof listResponse);
    console.log('List response keys:', Object.keys(listResponse));
    console.log('Full response:', JSON.stringify(listResponse, null, 2));
  } catch (e: any) {
    console.error('List error:', e.message);
  }
  
  console.log('\n---\n');
  
  // Test 2: Create store with different parameter structures
  console.log('2. Testing create() with different parameters...');
  
  const testCases = [
    { name: 'Empty object', params: {} },
    { name: 'Just displayName', params: { displayName: 'test-store-1' } },
    { name: 'Nested fileSearchStore', params: { fileSearchStore: { displayName: 'test-store-2' } } },
  ];
  
  for (const testCase of testCases) {
    console.log(`\nTrying: ${testCase.name}`);
    console.log('Params:', JSON.stringify(testCase.params));
    try {
      const result = await ai.fileSearchStores.create(testCase.params as any);
      console.log('✅ Success!');
      console.log('Result:', JSON.stringify(result, null, 2));
      
      // Clean up - delete the test store
      if (result && (result as any).name) {
        console.log(`Cleaning up: ${(result as any).name}`);
        await ai.fileSearchStores.delete({ name: (result as any).name });
      }
      break; // Stop after first success
    } catch (e: any) {
      console.log('❌ Failed:', e.message);
    }
  }
}

testAPI().catch(console.error);
