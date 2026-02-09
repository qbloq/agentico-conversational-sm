#!/usr/bin/env npx tsx
/**
 * Setup function imports
 * 
 * Creates a deno.json in each function directory to ensure
 * proper dependency resolution and avoid Supabase warnings.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const FUNCTIONS_DIR = path.join(ROOT_DIR, 'supabase/functions');

const denoConfig = {
  "imports": {
    "@parallelo/sales-engine": "../_shared/sales-engine.bundle.ts"
  }
};

async function setup() {
  console.log('🤖 Organizing Supabase Function imports...');
  
  const entries = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true });
  const functions = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map(e => e.name);

  console.log(`🔍 Found ${functions.length} functions.`);

  for (const func of functions) {
    const funcDir = path.join(FUNCTIONS_DIR, func);
    const configPath = path.join(funcDir, 'deno.json');
    
    fs.writeFileSync(configPath, JSON.stringify(denoConfig, null, 2));
    console.log(`✅ Created deno.json for ${func}`);
  }

  // Remove root level deno.json if it exists
  const rootConfig = path.join(FUNCTIONS_DIR, 'deno.json');
  if (fs.existsSync(rootConfig)) {
    fs.unlinkSync(rootConfig);
    console.log('🧹 Removed root-level deno.json from functions directory.');
  }

  console.log('\n✨ Done! All functions are now using per-function configuration.');
}

setup().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
