/**
 * Knowledge Base Seeding Script
 * 
 * Loads FAQ articles from faq-enriched.json and inserts them into
 * the knowledge_base table with embeddings (using Gemini).
 * 
 * Usage:
 *   npx tsx scripts/seed-knowledge-base.ts
 * 
 * Environment variables required:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_API_KEY (for embeddings)
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Configuration
const SCHEMA_NAME = 'client_tag_markets';
const FAQ_FILE_PATH = './data/faq-enriched.json';
const BATCH_SIZE = 10;

interface FAQArticle {
  title: string;
  url: string;
  answer: string;
  related_questions: { title: string; url: string }[];
  enrichment: {
    key_concepts: string[];
    related_entities: string[];
    semantic_tags: string[];
    summary: string;
  };
}

interface FAQCategory {
  title: string;
  description: string;
  articles: FAQArticle[];
}

async function main() {
  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  if (!googleKey) {
    console.error('Missing GOOGLE_API_KEY (required for embeddings)');
    process.exit(1);
  }
  
  // Initialize clients
  const supabase = createClient(supabaseUrl, supabaseKey);
  const genAI = new GoogleGenAI({ apiKey: googleKey });
  
  // Load FAQ data
  const faqPath = path.resolve(__dirname, FAQ_FILE_PATH);
  console.log(`Loading FAQ from: ${faqPath}`);
  
  if (!fs.existsSync(faqPath)) {
    console.error(`FAQ file not found: ${faqPath}`);
    process.exit(1);
  }
  
  const faqData: FAQCategory[] = JSON.parse(fs.readFileSync(faqPath, 'utf-8'));
  
  // Count total articles
  const totalArticles = faqData.reduce((sum, cat) => sum + cat.articles.length, 0);
  console.log(`Found ${totalArticles} articles across ${faqData.length} categories`);
  
  // Clear existing data (optional - comment out to append)
  console.log('Clearing existing knowledge base...');
  await supabase.schema(SCHEMA_NAME).from('knowledge_base').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  // Process each category
  let processed = 0;
  let errors = 0;
  
  for (const category of faqData) {
    console.log(`\nProcessing category: ${category.title} (${category.articles.length} articles)`);
    
    // Process in batches
    for (let i = 0; i < category.articles.length; i += BATCH_SIZE) {
      const batch = category.articles.slice(i, i + BATCH_SIZE);
      
      // Generate embeddings for batch
      const embeddings = await Promise.all(
        batch.map(async (article) => {
          const textToEmbed = `${article.title} ${article.enrichment.summary}`;
          try {
            const result = await genAI.models.embedContent({
              model: 'gemini-embedding-001',
              contents: textToEmbed,
              config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' }
            });
            console.log('---->', result.embeddings?.[0]?.values?.length);
            return result.embeddings?.[0]?.values;
          } catch (err) {
            console.error(`Failed to generate embedding for: ${article.title}`, err);
            return null;
          }
        })
      );
      
      // Insert batch
      const rows = batch.map((article, idx) => ({
        title: article.title,
        answer: article.answer,
        url: article.url,
        category: category.title,
        semantic_tags: article.enrichment.semantic_tags,
        key_concepts: article.enrichment.key_concepts,
        related_entities: article.enrichment.related_entities,
        summary: article.enrichment.summary,
        related_articles: article.related_questions,
        embedding: embeddings[idx],
        is_active: true,
        priority: 0,
      })).filter((_, idx) => embeddings[idx] !== null);
      
      if (rows.length > 0) {
        const { error } = await supabase
          // .schema(SCHEMA_NAME)
          .from('knowledge_base')
          .insert(rows);
        
        if (error) {
          console.error(`Failed to insert batch: ${error.message}`);
          errors += batch.length;
        } else {
          processed += rows.length;
          console.log(`  Inserted ${rows.length} articles (${processed}/${totalArticles})`);
        }
      }
      
      // Rate limiting
      await sleep(100);
    }
  }
  
  console.log(`\n✅ Seeding complete!`);
  console.log(`   Processed: ${processed}/${totalArticles}`);
  console.log(`   Errors: ${errors}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
