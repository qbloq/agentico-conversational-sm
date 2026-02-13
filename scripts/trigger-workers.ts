/**
 * Trigger Background Workers Manually
 * 
 * Invokes process-followups or process-pending Edge Functions on demand.
 * Works against both local and production Supabase.
 * 
 * Usage:
 *   npx tsx scripts/trigger-workers.ts followups          # local
 *   npx tsx scripts/trigger-workers.ts pending             # local
 *   npx tsx scripts/trigger-workers.ts followups --prod    # production
 *   npx tsx scripts/trigger-workers.ts pending --prod      # production
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const WORKERS: Record<string, string> = {
  followups: 'process-followups',
  pending: 'process-pending',
};

const LOCAL_URL = 'http://127.0.0.1:54321';

async function main() {
  const args = process.argv.slice(2);
  const workerAlias = args.find(a => !a.startsWith('--'));
  const isProd = args.includes('--prod');

  if (!workerAlias || !WORKERS[workerAlias]) {
    console.error(`Usage: npx tsx scripts/trigger-workers.ts <${Object.keys(WORKERS).join('|')}> [--prod]`);
    process.exit(1);
  }

  const functionName = WORKERS[workerAlias];
  const supabaseUrl = isProd
    ? process.env.SUPABASE_URL
    : (process.env.SUPABASE_URL_LOCAL || LOCAL_URL);
  const supabaseKey = isProd
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : (process.env.SUPABASE_SERVICE_ROLE_KEY_LOCAL || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const env = isProd ? 'PRODUCTION' : 'LOCAL';

  console.log(`\n[${env}] Triggering ${functionName}...`);
  console.log(`  URL: ${url}`);
  console.log(`  Key: ${supabaseKey.slice(0, 20)}...\n`);

  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source: 'manual-trigger' }),
    });

    const elapsed = Date.now() - start;
    const body = await response.text();

    if (!response.ok) {
      console.error(`[FAIL] ${response.status} ${response.statusText} (${elapsed}ms)`);
      console.error(body);
      process.exit(1);
    }

    // Try to pretty-print JSON response
    try {
      const json = JSON.parse(body);
      console.log(`[OK] ${response.status} (${elapsed}ms)`);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(`[OK] ${response.status} (${elapsed}ms)`);
      console.log(body);
    }
  } catch (error: any) {
    console.error(`[ERROR] ${error.message}`);
    if (!isProd) {
      console.error('\nIs Supabase running locally? Try: pnpm supabase:dev');
    }
    process.exit(1);
  }
}

main();
