
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient, resolveSchema } from '../_shared/supabase.ts';

serve(async (req) => {
  // CORS configuration
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    
    if (!clientId) {
      throw new Error('Missing variable: clientId');
    }

    const publicClient = createSupabaseClient(); // Default to public
    const schemaName = await resolveSchema(publicClient, clientId);

    if (!schemaName) {
      throw new Error(`Client not found or schema not resolved for ID: ${clientId}`);
    }

    const supabase = createSupabaseClient(schemaName);
    const table = 'followup_configs';

    // GET: List or Fetch Follow-up Config
    if (req.method === 'GET') {
      const name = url.searchParams.get('name');
      
      if (name) {
        // Fetch specific by name
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .eq('name', name)
          .single();
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        // List all configs
        const { data, error } = await supabase
          .schema(schemaName)
          .from(table)
          .select('*')
          .order('name', { ascending: true });
          
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST: Create or Update
    if (req.method === 'POST') {
      const body = await req.json();
      const { name, type, content, variables_config = [] } = body;
      
      if (!name || !type || content === undefined) {
        throw new Error('Missing required fields: name, type, content');
      }

      if (!['text', 'template'].includes(type)) {
        throw new Error('Invalid type: must be "text" or "template"');
      }

      const payload = {
        name,
        type,
        content,
        variables_config, // JSONB
        updated_at: new Date()
      };
      
      // Upsert: Try insert, on conflict update
      // Since 'name' is primary key
      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .upsert(payload)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // DELETE: Remove a config
    if (req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      if (!name) {
        throw new Error('Missing variable: name');
      }

      const { error } = await supabase
        .schema(schemaName)
        .from(table)
        .delete()
        .eq('name', name);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Method not allowed', { 
      status: 405, 
      headers: corsHeaders 
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
