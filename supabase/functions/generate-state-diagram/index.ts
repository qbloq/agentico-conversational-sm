
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createGeminiProvider } from '../_shared/sales-engine-llm.bundle.ts';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { states } = await req.json();

    if (!states) {
      throw new Error('Missing states in request body');
    }

    const provider = createGeminiProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
      model: 'gemini-2.5-flash', // Use a capable model
    });

    const systemPrompt = `You are an expert in creating Mermaid JS state diagrams.
      Analyze the following State Machine configuration and generate a Mermaid stateDiagram-v2 code to visualize it.
      
      Requirements:
      1. Use 'stateDiagram-v2'.
      2. Represent each state as a node.
      3. Represent 'allowedTransitions' as arrows (-->).
      4. Label the arrows with the 'transitionGuidance' text if available (keep it short, max 5 words).
      5. Style the nodes:
         - 'initial' state should be green.
         - 'completed' or 'closing' states should be red/dark.
         - others default.
      6. Return ONLY the mermaid code string. No markdown code blocks, no explanation. Start with 'stateDiagram-v2'.`;
      
    const userMessage = `State Machine Config (JSON):\n${JSON.stringify(states, null, 2)}`;
    console.log(userMessage);

    // Fix: generateResponse expects LLMRequest object, not string
    const result = await provider.generateResponse({
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt: systemPrompt
    });
    
    console.log("LLM Result:", JSON.stringify(result, null, 2));

    let mermaidCode = result.content?.trim() || "";
    
    // Check for empty content and finishReason
    if (!mermaidCode) {
        console.error(`Empty content generated. Finish Reason: ${result.finishReason}`);
        return new Response(JSON.stringify({ 
            error: "Generated content is empty", 
            details: { finishReason: result.finishReason, usage: result.usage }
        }), {
             status: 400, // Bad Request style error or 422
             headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Clean up response if it contains markdown code blocks
    if (mermaidCode.startsWith('```mermaid')) {
        mermaidCode = mermaidCode.replace('```mermaid', '').replace('```', '').trim();
    } else if (mermaidCode.startsWith('```')) {
        mermaidCode = mermaidCode.replace('```', '').replace('```', '').trim();
    }

    return new Response(JSON.stringify({ mermaid: mermaidCode }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
