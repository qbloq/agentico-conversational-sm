/**
 * Send Human Message Edge Function
 * 
 * Endpoint for human agents to send messages to customers.
 * Messages are saved to the conversation history and sent via WhatsApp.
 * 
 * POST /send-human-message
 * Body: { escalationId, message }
 * Headers: Authorization: Bearer <agent-jwt>
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AgentPayload {
  sub: string;
  phone: string;
  clientSchema: string;
  exp: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Verify agent
    const agent = await verifyAgent(req);
    if (!agent) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body (JSON or FormData)
    let escalationId: string;
    let message: string | undefined;
    let templateName: string | undefined;
    let languageCode: string | undefined;
    let imageFile: File | undefined;
    let caption: string | undefined;

    const contentType = req.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);
    
    // Check if it's multipart/form-data (image upload)
    const isFormData = contentType.toLowerCase().includes('multipart/form-data');
    
    let replyToMessageId: string | undefined | null;

    if (isFormData) {
      // Handle image upload
      console.log('Parsing as FormData...');
      try {
        const formData = await req.formData();
        escalationId = formData.get('escalationId') as string;
        imageFile = formData.get('image') as File;
        caption = formData.get('caption') as string | undefined;
        replyToMessageId = formData.get('replyToMessageId') as string | undefined;
        
        console.log('Received image upload:', {
          escalationId,
          imageFileName: imageFile?.name,
          imageSize: imageFile?.size,
          caption,
          replyToMessageId
        });
      } catch (formError) {
        console.error('FormData parse error:', formError);
        return new Response(
          JSON.stringify({ error: 'Failed to parse form data' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Handle JSON (text or template message)
      console.log('Parsing as JSON...');
      try {
        const body = await req.json();
        escalationId = body.escalationId;
        message = body.message;
        templateName = body.templateName;
        languageCode = body.languageCode;
        replyToMessageId = body.replyToMessageId;
      } catch (jsonError) {
        console.error('JSON parse error:', jsonError);
        console.error('Content-Type was:', contentType);
        return new Response(
          JSON.stringify({ error: 'Invalid request format. Expected JSON or multipart/form-data.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!escalationId || (!message && !templateName && !imageFile)) {
      return new Response(
        JSON.stringify({ error: 'escalationId and either message, templateName, or image are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Get escalation with session details
    const { data: escalation, error: escError } = await supabase
      .schema(agent.clientSchema)
      .from('escalations')
      .select(`
        id,
        status,
        assigned_to,
        session:session_id (
          id,
          channel_type,
          channel_id,
          channel_user_id
        )
      `)
      .eq('id', escalationId)
      .single();

    if (escError || !escalation) {
      return new Response(
        JSON.stringify({ error: 'Escalation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify escalation status
    if (escalation.status === 'resolved' || escalation.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: 'Escalation is already closed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auto-assign if not assigned
    if (!escalation.assigned_to) {
      await supabase
        .schema(agent.clientSchema)
        .from('escalations')
        .update({
          assigned_to: agent.sub,
          assigned_at: new Date().toISOString(),
          status: 'in_progress',
        })
        .eq('id', escalationId);
    } else {
      // Update status to in_progress
      await supabase
        .schema(agent.clientSchema)
        .from('escalations')
        .update({ status: 'in_progress' })
        .eq('id', escalationId);
    }

    const session = escalation.session;

    // Handle image upload if present
    let mediaUrl: string | undefined;
    if (imageFile) {
      try {
        console.log('Processing image upload...');
        console.log('Image details:', {
          name: imageFile.name,
          type: imageFile.type,
          size: imageFile.size
        });
        
        // Upload to Supabase Storage
        const date = new Date();
        const ext = imageFile.name.split('.').pop() || 'jpg';
        const path = `${agent.clientSchema}/${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}/${crypto.randomUUID()}.${ext}`;
        
        console.log('Uploading to path:', path);
        
        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from('media-tag-markets') // Using existing bucket
          .upload(path, await imageFile.arrayBuffer(), {
            contentType: imageFile.type,
            upsert: false,
          });

        if (uploadError) {
          console.error('Failed to upload image:', uploadError);
          console.error('Upload error details:', JSON.stringify(uploadError));
          return new Response(
            JSON.stringify({ 
              error: 'Failed to upload image', 
              details: uploadError.message 
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Upload successful:', uploadData);

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('media-tag-markets')
          .getPublicUrl(path);
        
        mediaUrl = urlData.publicUrl;
        console.log('Image uploaded to:', mediaUrl);
      } catch (error) {
        console.error('Image upload error:', error);
        console.error('Error details:', error instanceof Error ? error.message : String(error));
        return new Response(
          JSON.stringify({ 
            error: 'Failed to process image',
            details: error instanceof Error ? error.message : 'Unknown error'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Resolve platform_message_id if replying to a message
    let platformReplyToId: string | undefined;
    if (replyToMessageId) {
      const { data: repliedMsg } = await supabase
        .schema(agent.clientSchema)
        .from('messages')
        .select('platform_message_id')
        .eq('id', replyToMessageId)
        .single();
      
      if (repliedMsg?.platform_message_id) {
        platformReplyToId = repliedMsg.platform_message_id;
      }
    }

    // Save message to DB
    const { data: savedMessage, error: msgError } = await supabase
      .schema(agent.clientSchema)
      .from('messages')
      .insert({
        session_id: session.id,
        direction: 'outbound',
        type: imageFile ? 'image' : (templateName ? 'template' : 'text'),
        content: imageFile ? (caption || null) : (message || (templateName ? `Template: ${templateName}` : null)),
        media_url: mediaUrl,
        sent_by_agent_id: agent.sub, // Proper FK to human_agents table
        reply_to_message_id: replyToMessageId,
      })
      .select()
      .single();

    if (msgError) {
      console.error('Failed to save message:', msgError);
      return new Response(
        JSON.stringify({ error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send via WhatsApp
    const sent = await sendWhatsAppMessage(
      session.channel_id,          // phone_number_id
      session.channel_user_id,     // customer phone
      message || caption || '',
      agent.clientSchema,
      templateName,
      languageCode,
      mediaUrl,                     // Pass media URL for image messages
      platformReplyToId             // Pass platform ID for replies
    );

    if (!sent) {
      // Message saved but not sent - mark for retry or notify
      console.error('Failed to send WhatsApp message');
      return new Response(
        JSON.stringify({ 
          success: true, 
          warning: 'Message saved but WhatsApp delivery failed',
          messageId: savedMessage.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update session last_message_at
    await supabase
      .schema(agent.clientSchema)
      .from('sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', session.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: savedMessage.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Verify agent JWT
 */
async function verifyAgent(req: Request): Promise<AgentPayload | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const jwtSecret = Deno.env.get('AGENT_JWT_SECRET') || 'your-secret-key';

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    return await verify(token, key) as unknown as AgentPayload;
  } catch {
    return null;
  }
}

/**
 * Send message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  clientSchema: string,
  templateName?: string,
  languageCode: string = 'es_CO',
  mediaUrl?: string,
  replyToMessageId?: string
): Promise<boolean> {
  // Get access token based on client (for now use env var)
  const accessToken = Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN');

  if (!accessToken) {
    console.error('WhatsApp access token not configured');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
    };

    if (templateName) {
      body.type = 'template';
      body.template = {
        name: templateName,
        language: { code: languageCode },
      };
    } else if (mediaUrl) {
      // Send image with optional caption
      body.type = 'image';
      body.image = {
        link: mediaUrl,
      };
      if (text) {
        body.image.caption = text;
      }
    } else {
      body.type = 'text';
      body.text = { body: text };
    }

    if (replyToMessageId) {
      body.context = {
        message_id: replyToMessageId
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('WhatsApp API error:', error);
      return false;
    }

    console.log(`Message sent to ${to} by agent (${mediaUrl ? 'image' : templateName ? 'template' : 'text'})`);
    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
  }
}
