
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
    const { currentStates, messages, userMessage } = await req.json();

    if (!userMessage) {
      throw new Error('Missing userMessage');
    }

    const provider = createGeminiProvider({
      apiKey: Deno.env.get('GOOGLE_API_KEY') || '',
      model: 'gemini-2.5-flash', // Use a capable model
    });

    const systemPrompt = `You are an expert AI Architect for conversational State Machines.
    Your goal is to help the user design a JSON-based State Machine for a Sales/Support bot.
    
    Current State Machine Configuration (JSON):
    ${JSON.stringify(currentStates, null, 2)}
    
    You have the ability to:
    1. Answer questions about the design.
    2. Propose updates to the JSON structure.
    
    OUTPUT FORMAT:
    You must always return a JSON object with the following structure:
    {
      "message": "Your textual response to the user explaining changes or answering questions.",
      "updatedStates": (Optional) The FULL updated JSON object for 'states' if you decided to modify the design. If no changes, omit this or return null.
    }
    
    RULES for 'updatedStates':
    - It must be the COMPLETE state machine object, not just a diff.
    - Ensure strict adherence to the schema: keys are state names, values contain 'objective', 'description', 'allowedTransitions' (array), 'transitionGuidance' (map), etc.
    - Ensure 'allowedTransitions' includes 'escalated' and 'completed' where appropriate.
    
    Respond concisely and professionally.`;

    // Flatten chat history for context if needed, currently just using userMessage + System
    // Ideally we pass recent history.
    
    const response = await provider.generateResponse({
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt: systemPrompt,
        jsonMode: true
    });
    
    let result;
    try {
        let content = response.content || '{}';
        
        // Strip markdown code blocks if present (e.g., ```json ... ```)
        const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) {
            content = codeBlockMatch[1].trim();
        }
        
        result = JSON.parse(content);
    } catch (e) {
        console.error('JSON parsing error:', e);
        console.error('Raw content:', response.content);
        
        // Fallback if JSON parsing fails
        result = {
            message: response.content || "I'm sorry, I couldn't process that request correctly."
        };
    }

    return new Response(JSON.stringify(result), {
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
