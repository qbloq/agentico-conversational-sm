/**
 * Export Conversations to Files
 * 
 * Fetches all sessions where current_state != 'initial',
 * retrieves their messages, and saves each conversation to a JSON file.
 * 
 * Usage: npx tsx scripts/export-conversations.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from project root or current dir
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const OUTPUT_DIR = path.join(__dirname, 'data/chats');
const SCHEMA = 'client_tag_markets';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`🔍 Fetching sessions from ${SCHEMA}.sessions (excluding 'initial' state)...`);

  const { data: sessions, error: sessionError } = await supabase
    .schema(SCHEMA)
    .from('sessions')
    .select('id, current_state')
    .neq('current_state', 'initial');

  if (sessionError) {
    console.error('❌ Error fetching sessions:', sessionError.message);
    process.exit(1);
  }

  if (!sessions || sessions.length === 0) {
    console.log('ℹ️ No sessions found with state other than "initial".');
    return;
  }

  console.log(`✅ Found ${sessions.length} sessions.`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.log(`📁 Creating directory: ${OUTPUT_DIR}`);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const sessionIds = sessions.map(s => s.id);

  console.log(`💬 Fetching messages for ${sessionIds.length} sessions...`);

  // To avoid the 1000-row limit and handle many messages correctly,
  // we'll fetch messages for each session individually.
  const groupedMessages: Record<string, any[]> = {};
  let totalMessages = 0;

  for (let i = 0; i < sessionIds.length; i++) {
    const sessionId = sessionIds[i];
    process.stdout.write(`\r   Progress: ${i + 1}/${sessionIds.length}`);

    const { data: sessionMessages, error: messageError } = await supabase
      .schema(SCHEMA)
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (messageError) {
      console.error(`\n❌ Error fetching messages for session ${sessionId}:`, messageError.message);
      continue;
    }

    groupedMessages[sessionId] = sessionMessages || [];
    totalMessages += (sessionMessages?.length || 0);
  }

  console.log(`\n✅ Retrieved ${totalMessages} messages.`);

  // Write files
  console.log(`💾 Writing files to ${OUTPUT_DIR}...`);
  let count = 0;
  for (const sessionId of sessionIds) {
    const sessionMessages = groupedMessages[sessionId] || [];
    const filePath = path.join(OUTPUT_DIR, `${sessionId}.txt`);
    
    const content = sessionMessages.map((msg: any) => {
      const label = msg.direction === 'inbound' ? 'user' : 'agent';
      return `${label}: ${msg.content || ''}`;
    }).join('\n');

    fs.writeFileSync(filePath, content);
    count++;
  }

  console.log(`\n✅ Done! Exported ${count} conversations.`);
}

main().catch(console.error);
