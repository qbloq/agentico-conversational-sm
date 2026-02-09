import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLIENT_SCHEMA = 'public';
const OUTPUT_FILE = 'knowledge_base_export.md';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function exportKnowledge() {
  console.log('🚀 Starting Knowledge Base export for Notion...');
  
  // 1. Fetch data from Supabase
  console.log(`[1/3] Fetching active entries from ${CLIENT_SCHEMA}.knowledge_base...`);
  const { data: entries, error } = await supabase
    .schema(CLIENT_SCHEMA)
    .from('knowledge_base')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    console.error('Error fetching knowledge base:', error);
    return;
  }

  if (!entries || entries.length === 0) {
    console.log('No active entries found.');
    return;
  }

  console.log(`Found ${entries.length} active entries.`);

  // 2. Format into Notion-optimized Markdown
  console.log('[2/3] Formatting entries into Markdown...');
  let markdown = `# Knowledge Base Export\n\n`;
  markdown += `*Exported on: ${new Date().toLocaleString()}*\n\n`;
  
  let currentCategory = '';

  for (const entry of entries) {
    // Add category header if it changes
    if (entry.category !== currentCategory) {
      currentCategory = entry.category || 'Uncategorized';
      markdown += `## 📁 ${currentCategory}\n\n`;
    }

    markdown += `### ${entry.title}\n\n`;

    // Metadata section (Bullet list for Notion parsing)
    markdown += `> **Metadata**\n`;
    markdown += `> - **Category**: ${entry.category || 'N/A'}\n`;
    if (entry.semantic_tags && entry.semantic_tags.length > 0) {
      markdown += `> - **Tags**: ${entry.semantic_tags.map((t: string) => `\`${t}\``).join(', ')}\n`;
    }
    if (entry.priority !== undefined) {
      markdown += `> - **Priority**: ${entry.priority}\n`;
    }
    markdown += `\n`;

    // Summary as a callout (Notion uses > [!INFO] or similar, but standard > works well)
    if (entry.summary) {
      markdown += `> 💡 **Summary**: ${entry.summary}\n\n`;
    }

    // Key Concepts if available
    if (entry.key_concepts && entry.key_concepts.length > 0) {
      markdown += `**Key Concepts**:\n`;
      entry.key_concepts.forEach((concept: string) => {
        markdown += `- ${concept}\n`;
      });
      markdown += `\n`;
    }

    // Main Answer/Content
    markdown += `#### Content\n\n`;
    markdown += `${entry.answer}\n\n`;

    // Related entities or articles if relevant
    if (entry.related_entities && entry.related_entities.length > 0) {
      markdown += `*Related Entities: ${entry.related_entities.join(', ')}*\n\n`;
    }

    markdown += `---\n\n`;
  }

  // 3. Write to file
  console.log(`[3/3] Saving to ${OUTPUT_FILE}...`);
  try {
    fs.writeFileSync(path.join(process.cwd(), OUTPUT_FILE), markdown);
    console.log(`✅ Export complete! File saved to: ${path.join(process.cwd(), OUTPUT_FILE)}`);
  } catch (err) {
    console.error('Error writing file:', err);
  }
}

exportKnowledge();
