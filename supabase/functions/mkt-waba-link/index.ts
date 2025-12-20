// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { WABAClient } from 'npm:whatsapp-business';

const withCors = (handler: (req: Request) => Promise<Response>) => {
  return async (req: Request) => {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    };
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: corsHeaders
      });
    }
    
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
  
    // Call the original handler and add CORS headers to its response
    const response = await handler(req);
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  };
};

// Define the main handler for the Edge Function
Deno.serve(withCors(async (req: Request) => {
  const { code, phoneNumberId, wabaId, businessId } = await req.json();
  const url = "https://graph.facebook.com/v22.0/oauth/access_token";

  const client = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );
    const { data: { user: authUser }, error: authErr } = await authClient.auth.getUser();
    console.log(authUser)
    if (authErr || !authUser) {
      return new Response('Unauthorized', { status: 401 });
    }

    /*const { data: user, error: userErr } = await client
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (userErr || !user) {
      console.error('Failed to load user from Supabase:', userErr);
      return new Response('User not found', { status: 404 });
    }*/

    // Check if WABA already exists in Supabase
    const { data: existsWaba, error: existsErr } = await client
      .from('meta_wabas')
      .select('*')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle();

    if (existsErr) {
      console.error('Error checking existing WABA:', existsErr);
    }

    if (existsWaba) {
      return new Response(JSON.stringify({ name: existsWaba.name, phoneNumber: existsWaba.phone_number }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('Adding new WABA', phoneNumberId)
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        "client_id": Deno.env.get('META_APP_CLIENT_ID'),
        "client_secret": Deno.env.get('META_APP_SECRET'),
        code,
        "grant_type": "authorization_code",
        // "redirect_uri": "https://app.parallelo.ai/"
      }),
      headers: {"Content-Type": "application/json"},
    });
    const data = await response.json();

    const { access_token: accessToken } = data
    if (!accessToken) {
      return new Response(null, { status: 400 });
    }

    const wabaClient = new WABAClient({
      phoneId: phoneNumberId,
      accountId: wabaId,
      apiToken: accessToken,
    })
    
    const profile = await wabaClient.getBusinessProfile()
    const singlePhoneNumber = await wabaClient.getSingleBusinessPhoneNumber(phoneNumberId)
    console.log(singlePhoneNumber)


    const registered = await wabaClient.registerPhone({ phoneNumberId, pin: '450045' })
    console.log('registered', registered)
    
    const subsUrl = `https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`
    const subscribeRes = await fetch(subsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
    });

    const subscribed = await subscribeRes.json();
    console.log('subscribed', subscribed)
  
    const {
      verified_name: verifiedName,
      display_phone_number: phoneNumber,
    } = singlePhoneNumber

    // Insert into Supabase `meta_wabas`
    const { data: waba, error: insertErr } = await client
      .from('meta_wabas')
      .insert([
        {
          name: verifiedName,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          business_id: businessId,
          phone_number: phoneNumber,
          access_token: accessToken,
        }
      ])
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to insert into meta_wabas:', insertErr);
      return new Response(JSON.stringify({ error: 'Failed to save WABA metadata' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ name: waba.name, phoneNumber: waba.phone_number }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.log(e)
    return new Response(null, { status: 500 })
  }
}))