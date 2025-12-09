
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { createSupabaseStateMachineStore } from '../_shared/adapters/index.ts';

serve(async (req) => {
  try {
    const supabase = createSupabaseClient();
    // Use the schema from the request or default to client_tag_markets for testing
    const schemaName = 'client_tag_markets'; 
    
    const store = createSupabaseStateMachineStore(supabase, schemaName);
    
    const config = await store.findActive('default_sales_flow');
    
    if (config) {
      return new Response(JSON.stringify({
        status: 'success',
        message: 'Successfully loaded State Machine from DB',
        initialState: config.initial,
        statesCount: Object.keys(config).length
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    } else {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'State Machine not found or not active'
      }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message,
      stack: error.stack
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' } 
    });
  }
});
