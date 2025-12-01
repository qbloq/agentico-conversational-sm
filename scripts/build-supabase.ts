#!/usr/bin/env npx tsx
/**
 * Build script for Supabase Edge Functions
 * 
 * Bundles the sales-engine library into a single file that can be
 * imported by Supabase Edge Functions (Deno runtime).
 * 
 * Usage:
 *   pnpm build:supabase          # One-time build
 *   pnpm build:supabase --watch  # Watch mode for development
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SALES_ENGINE_SRC = path.join(ROOT_DIR, 'packages/sales-engine/src');
const OUTPUT_DIR = path.join(ROOT_DIR, 'supabase/functions/_shared');

const isWatch = process.argv.includes('--watch');

// Entry points to bundle
const entryPoints = {
  'sales-engine': path.join(SALES_ENGINE_SRC, 'index.ts'),
  'sales-engine-llm': path.join(SALES_ENGINE_SRC, 'llm/index.ts'),
  'sales-engine-media': path.join(SALES_ENGINE_SRC, 'media/index.ts'),
  'sales-engine-escalation': path.join(SALES_ENGINE_SRC, 'escalation/index.ts'),
};

// Deno-compatible banner
const banner = `
// Auto-generated bundle for Supabase Edge Functions
// Do not edit directly - modify packages/sales-engine/src instead
// Generated at: ${new Date().toISOString()}
`.trim();

async function build() {
  console.log('🔨 Building sales-engine for Supabase Edge Functions...');
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const buildOptions: esbuild.BuildOptions = {
    entryPoints: Object.entries(entryPoints).map(([name, path]) => ({
      in: path,
      out: name,
    })),
    bundle: true,
    format: 'esm',
    platform: 'neutral', // Works for both Node and Deno
    target: 'es2022',
    outdir: OUTPUT_DIR,
    outExtension: { '.js': '.bundle.ts' }, // .ts extension for Deno
    banner: { js: banner },
    sourcemap: true,
    minify: false, // Keep readable for debugging
    treeShaking: true,
    
    // Mark external dependencies that Deno will resolve
    external: [
      'https://*',
      'npm:*',
    ],
    
    // Resolve .js imports to .ts files
    resolveExtensions: ['.ts', '.js'],
  };

  if (isWatch) {
    console.log('👀 Watching for changes...');
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('✅ Initial build complete. Watching for changes...');
    console.log('   Press Ctrl+C to stop.\n');
  } else {
    const result = await esbuild.build(buildOptions);
    console.log('✅ Build complete!');
    console.log(`   Output: ${OUTPUT_DIR}/`);
    
    // Show bundle sizes
    for (const name of Object.keys(entryPoints)) {
      const bundlePath = path.join(OUTPUT_DIR, `${name}.bundle.ts`);
      if (fs.existsSync(bundlePath)) {
        const stats = fs.statSync(bundlePath);
        const sizeKB = (stats.size / 1024).toFixed(1);
        console.log(`   - ${name}.bundle.ts (${sizeKB} KB)`);
      }
    }
  }
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
