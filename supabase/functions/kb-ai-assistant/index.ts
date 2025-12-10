/**
 * KB AI Assistant Edge Function
 * 
 * Uses AI to generate high-quality knowledge base entries from user instructions.
 * Generates title, answer, summary, semantic tags, key concepts, and related entities.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createGeminiProvider } from '../_shared/sales-engine-llm.bundle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerationRequest {
  instructions: string;
  category?: string;
  existingTitle?: string;
  existingAnswer?: string;
  context?: string;
}

interface GeneratedContent {
  title: string;
  answer: string;
  summary: string;
  semanticTags: string[];
  keyConcepts: string[];
  relatedEntities: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const body: GenerationRequest = await req.json();

    if (!body.instructions) {
      throw new Error('Missing required field: instructions');
    }

    const provider = createGeminiProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
      model: 'gemini-2.5-flash',
    });

    const systemPrompt = buildSystemPrompt(body);

    const response = await provider.generateResponse({
      messages: [{ role: 'user', content: body.instructions }],
      systemPrompt: systemPrompt,
      jsonMode: true,
    });

    let result: GeneratedContent;
    try {
      result = JSON.parse(response.content || '{}');
      
      // Validate required fields
      if (!result.title || !result.answer) {
        throw new Error('Invalid response structure');
      }

      // Ensure arrays are properly formatted
      result.semanticTags = result.semanticTags || [];
      result.keyConcepts = result.keyConcepts || [];
      result.relatedEntities = result.relatedEntities || [];
      result.summary = result.summary || result.answer.slice(0, 200);

    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Fallback: try to extract content from plain text response
      result = {
        title: body.existingTitle || 'New KB Entry',
        answer: response.content || body.instructions,
        summary: (response.content || body.instructions).slice(0, 200),
        semanticTags: [],
        keyConcepts: [],
        relatedEntities: [],
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('AI Assistant Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * Build the system prompt for KB content generation
 */
function buildSystemPrompt(request: GenerationRequest): string {
  const categoryContext = request.category 
    ? `The entry belongs to the category: "${request.category}".`
    : '';
  
  const editContext = request.existingTitle
    ? `You are editing/improving an existing entry titled: "${request.existingTitle}".`
    : 'You are creating a new knowledge base entry.';

  const additionalContext = request.context
    ? `Additional context: ${request.context}`
    : '';

  return `You are an expert content writer for a Knowledge Base (FAQ) system used by a financial trading platform's customer support AI.

${editContext}
${categoryContext}
${additionalContext}

Your task is to generate a high-quality KB entry based on the user's instructions.

GUIDELINES:
1. **Title**: Write as a clear question that users might ask (e.g., "¿Cómo funciona el copy trading?")
2. **Answer**: Provide a comprehensive, well-structured answer in Spanish. Use markdown formatting for readability (headers, lists, bold text). Be informative but concise.
3. **Summary**: Write a 2-3 sentence summary of the answer. This is used for quick context.
4. **Semantic Tags**: Generate 3-6 relevant tags that describe the topic (e.g., "copy_trading", "inversión", "principiantes")
5. **Key Concepts**: List 2-4 main concepts covered (e.g., "Copy Trading", "Gestión de Riesgo")
6. **Related Entities**: List mentioned products, features, or services (e.g., "TAG Markets", "Academia de Trading")

OUTPUT FORMAT (JSON):
{
  "title": "The FAQ question title",
  "answer": "The full detailed answer in markdown format",
  "summary": "A 2-3 sentence summary",
  "semanticTags": ["tag1", "tag2", "tag3"],
  "keyConcepts": ["Concept 1", "Concept 2"],
  "relatedEntities": ["Entity 1", "Entity 2"]
}

IMPORTANT:
- Write in Spanish (Latin American style)
- Be professional but approachable
- Focus on being helpful and accurate
- Use the platform's tone: friendly, expert, trustworthy
- Return ONLY the JSON object, no additional text`;
}
