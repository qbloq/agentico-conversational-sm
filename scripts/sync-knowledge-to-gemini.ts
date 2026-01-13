import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const STORE_NAME = 'tag-markets-knowledge-base';
const CLIENT_SCHEMA = 'public';
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_API_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

async function syncKnowledge() {
  console.log('🚀 Starting Knowledge Base sync to Gemini File Search...');
  
  // 1. Fetch data from Supabase
  console.log(`[1/4] Fetching active entries from ${CLIENT_SCHEMA}.knowledge_base...`);
  const { data: entries, error } = await supabase
    .schema(CLIENT_SCHEMA)
    .from('knowledge_base')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching knowledge base:', error);
    return;
  }

  console.log(`Found ${entries.length} active entries.`);

  // 2. Format into Markdown
  console.log('[2/4] Formatting entries into Markdown...');
  let markdown = `# TAG Markets Knowledge Base\n\nGenerated on: ${new Date().toISOString()}\n\n`;

  for (const entry of entries) {
    markdown += `## ${entry.title}\n`;
    markdown += `**Category**: ${entry.category}\n`;
    if (entry.semantic_tags && entry.semantic_tags.length > 0) {
      markdown += `**Tags**: ${entry.semantic_tags.join(', ')}\n`;
    }
    if (entry.summary) {
      markdown += `**Summary**: ${entry.summary}\n`;
    }
    markdown += `\n${entry.answer}\n\n`;
    markdown += `---\n\n`;
  }

  if (DRY_RUN) {
    console.log('--- DRY RUN MODE ---');
    console.log('Markdown preview (first 500 chars):');
    console.log(markdown.substring(0, 500) + '...');
    console.log('--- END DRY RUN ---');
    return;
  }

  // 3. Create or get FileSearchStore
  console.log(`[3/4] Ensuring FileSearchStore "${STORE_NAME}" exists...`);
  let store;
  try {
    // Create store - displayName is optional
    console.log('Attempting to create store...');
    store = await ai.fileSearchStores.create({
      displayName: STORE_NAME
    } as any);
    console.log(`✅ Created new store: ${store.name}`);
    console.log(`   Display Name: ${(store as any).displayName || 'None'}`);
    console.log(`   Created: ${(store as any).createTime}`);
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('Store already exists, using existing one.');
      // Ideally we would get the store by name here, but for simplicity in this script
      // we proceed with the name prefix if create failed due to conflict.
      // The upload API needs the resource name (e.g., 'fileSearchStores/...')
    } else {
      console.error('Error creating store:', e.message);
      console.error('Full error:', e);
      return;
    }
  }

  // 4. Upload to Store
  console.log('[4/4] Uploading Markdown file to File Search store...');
  // Since we are running in Node, we can upload the content as a buffer/file
  // The @google/genai SDK provides uploadToFileSearchStore
  
  // Create a temporary file name
  const fileName = `knowledge_base_${Date.now()}.md`;
  console.log(`Uploading file: ${fileName}`);

  try {
    const operation = await ai.fileSearchStores.uploadToFileSearchStore({
      file: new Blob([markdown], { type: 'text/markdown' }),
      fileSearchStoreName: store ? store.name : `fileSearchStores/${STORE_NAME}`, // Fallback if created failed
      config: {
        displayName: fileName,
        mimeType: 'text/markdown'
      }
    });

    console.log('Upload operation started. Waiting for completion...');
    let result = operation;
    while (!result.done) {
      process.stdout.write('.');
      await new Promise(resolve => setTimeout(resolve, 5000));
      result = await ai.operations.get({ operation: result });
    }
    console.log('\n✅ Sync complete!');
  } catch (e) {
    console.error('Error uploading to store:', e);
  }
}

syncKnowledge();
