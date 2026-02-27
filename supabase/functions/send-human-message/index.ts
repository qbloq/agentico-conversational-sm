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
    console.log('--- Send Human Message v1.0.6 ---');
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
    let videoFile: File | undefined;
    let audioFile: File | undefined;
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
        videoFile = formData.get('video') as File;
        audioFile = formData.get('audio') as File;
        caption = formData.get('caption') as string | undefined;
        replyToMessageId = formData.get('replyToMessageId') as string | undefined;
        
        console.log('Received upload:', {
          escalationId,
          imageFileName: imageFile?.name,
          videoFileName: videoFile?.name,
          audioFileName: audioFile?.name,
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

    if (!escalationId || (!message && !templateName && !imageFile && !videoFile && !audioFile)) {
      return new Response(
        JSON.stringify({ error: 'escalationId and either message, templateName, image, video, or audio are required' }),
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

    // Load client config for dynamic bucket and WhatsApp token
    console.log('Fetching client config for schema:', agent.clientSchema);
    const { data: clientConfig, error: configError } = await supabase
      .from('client_configs')
      .select('storage_bucket')
      .eq('schema_name', agent.clientSchema)
      .eq('is_active', true)
      .limit(1) // Avoid .single() error if multiple rows exist
      .maybeSingle();

    if (configError) {
      console.error('Error fetching client config:', configError);
    }

    const storageBucket = clientConfig?.storage_bucket || `media-${agent.clientSchema.replace('client_', '').replace(/_/g, '-')}`;
    console.log('Calculated storage bucket:', storageBucket);

    // Handle image/video/audio upload if present
    let mediaUrl: string | undefined;
    const mediaFile = imageFile || videoFile || audioFile;
    const isVideo = !!videoFile;
    const isAudio = !!audioFile;

    if (mediaFile) {
      try {
        const typeLabel = isVideo ? 'video' : (isAudio ? 'audio' : 'image');
        console.log(`Processing ${typeLabel} upload...`);
        console.log('Media details:', {
          name: mediaFile.name,
          type: mediaFile.type,
          size: mediaFile.size
        });
        
        // Normalize MIME type (Meta rejects "audio/ogg; codecs=opus" on processing)
        let contentType = mediaFile.type;
        if (isAudio && contentType.includes(';')) {
          contentType = contentType.split(';')[0].trim();
          console.log(`Normalized audio content-type from ${mediaFile.type} to ${contentType}`);
        }

        // Upload to Supabase Storage
        const date = new Date();
        let ext = mediaFile.name.split('.').pop() || (isVideo ? 'mp4' : (isAudio ? 'aac' : 'jpg'));
        
        if (isAudio && contentType) {
          if (contentType.includes('webm')) ext = 'webm';
          else if (contentType.includes('mp4')) ext = 'mp4';
          else if (contentType.includes('ogg')) ext = 'ogg';
          else if (contentType.includes('aac')) ext = 'aac';
          else if (contentType.includes('mpeg')) ext = 'mp3';
        }
        
        const path = `${agent.clientSchema}/${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}/${crypto.randomUUID()}.${ext}`;
        
        console.log(`Uploading to path: ${path} with contentType: ${contentType}`);

        const { data: uploadData, error: uploadError } = await supabase
          .storage
          .from(storageBucket)
          .upload(path, await mediaFile.arrayBuffer(), {
            contentType: contentType,
            upsert: false,
          });

        if (uploadError) {
          const typeLabel = isVideo ? 'video' : (isAudio ? 'audio' : 'image');
          console.error(`[v1.0.7] Failed to upload ${typeLabel} to bucket ${storageBucket}:`, uploadError);
          return new Response(
            JSON.stringify({ 
              error: `Failed to upload ${typeLabel}`, 
              details: uploadError.message,
              bucket: storageBucket,
              path: path,
              version: '1.0.7'
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Upload successful:', uploadData);

        // Get public URL
        const { data: urlData } = supabase.storage
          .from(storageBucket)
          .getPublicUrl(path);
        
        mediaUrl = urlData.publicUrl;
        console.log('Media uploaded to:', mediaUrl);
      } catch (error) {
        console.error('Media upload error:', error);
        console.error('Error details:', error instanceof Error ? error.message : String(error));
        return new Response(
          JSON.stringify({ 
            error: 'Failed to process media',
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

    // Send message to WhatsApp via Meta API
    let deliverySuccess = false;
    let fallbackMessageId: string | undefined;
    
    // For audio, we upload directly to Meta to bypass Supabase Storage content-type stripping
    let directMediaId: string | undefined;
    
    if (isAudio && mediaFile) {
       console.log(`Audio detected. Original media file type: ${mediaFile.type}, ContentType: ${contentType}`);
       
       // Force a WhatsApp-compatible mime type regardless of what Deno extracted
       let uploadMimeType = 'audio/mp4'; 
       if (contentType && contentType !== 'multipart/form-data') {
         if (contentType.includes('ogg') || contentType.includes('opus')) uploadMimeType = 'audio/ogg'; // WhatsApp accepts ogg but Meta verification is flaky
         if (contentType.includes('mp4')) uploadMimeType = 'audio/mp4';
         if (contentType.includes('aac')) uploadMimeType = 'audio/aac';
         if (contentType.includes('mpeg')) uploadMimeType = 'audio/mpeg';
       }

       console.log('Uploading directly to Meta /media endpoint to preserve MIME type as: ' + uploadMimeType);
       const supabaseForSecrets = createClient(
          Deno.env.get('SUPABASE_URL') || '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        );
        const { data: secretRow } = await supabaseForSecrets
          .from('client_secrets')
          .select('secrets')
          .eq('client_id', agent.clientSchema.replace('client_', ''))
          .eq('channel_type', 'whatsapp')
          .single();
        const accessToken = secretRow?.secrets?.access_token || Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN');

       if (accessToken && escalation.session?.channel_id) {
         try {
           // Construct manual multipart/form-data payload to guarantee Content-Type headers
           const boundary = '----WebKitFormBoundary' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
           
           const textEncoder = new TextEncoder();
           const rawBuffer = await mediaFile.arrayBuffer();
           
           // Build the multipart payload
           const preamble = textEncoder.encode(
             `--${boundary}\r\n` +
             `Content-Disposition: form-data; name="messaging_product"\r\n\r\n` +
             `whatsapp\r\n` +
             `--${boundary}\r\n` +
             `Content-Disposition: form-data; name="type"\r\n\r\n` +
             `${uploadMimeType}\r\n` +
             `--${boundary}\r\n` +
             `Content-Disposition: form-data; name="file"; filename="${mediaFile.name || 'audio.mp4'}"\r\n` +
             `Content-Type: ${uploadMimeType}\r\n\r\n`
           );
           
           const postamble = textEncoder.encode(`\r\n--${boundary}--\r\n`);
           
           // Concatenate preamble, binary data, and postamble
           const payloadLength = preamble.length + rawBuffer.byteLength + postamble.length;
           const payload = new Uint8Array(payloadLength);
           payload.set(preamble, 0);
           payload.set(new Uint8Array(rawBuffer), preamble.length);
           payload.set(postamble, preamble.length + rawBuffer.byteLength);

           const uploadRes = await fetch(`https://graph.facebook.com/v24.0/${escalation.session.channel_id}/media`, {
             method: 'POST',
             headers: {
               'Authorization': `Bearer ${accessToken}`,
               'Content-Type': `multipart/form-data; boundary=${boundary}`
             },
             body: payload
           });
           
           if (uploadRes.ok) {
             const resData = await uploadRes.json();
             directMediaId = resData.id;
             console.log(`Direct Meta Media Upload Success: Media ID ${directMediaId}`);
           } else {
             console.error('Direct Meta Media Upload Failed:', await uploadRes.text());
           }
         } catch(e) {
           console.error('Exception during direct Meta media upload:', e);
         }
       }
    }

    // Save message to DB
    const { data: savedMessage, error: msgError } = await supabase
      .schema(agent.clientSchema)
      .from('messages')
      .insert({
        session_id: session.id,
        direction: 'outbound',
        type: audioFile ? 'audio' : (videoFile ? 'video' : (imageFile ? 'image' : (templateName ? 'template' : 'text'))),
        content: (imageFile || videoFile || audioFile) ? (caption || null) : (message || (templateName ? `Template: ${templateName}` : null)),
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
    const sent = await sendWhatsAppMessage({
      phoneNumberId: session.channel_id,
      to: session.channel_user_id,
      text: message || caption || '',
      clientSchema: agent.clientSchema,
      templateName,
      languageCode,
      mediaUrl: (!directMediaId) ? mediaUrl : undefined,
      mediaId: directMediaId,
      replyToMessageId: platformReplyToId,
      mediaType: audioFile ? 'audio' : (videoFile ? 'video' : (imageFile ? 'image' : undefined))
    });

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
        mediaUrl,
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

interface WhatsAppMessagePayload {
  phoneNumberId: string;
  to: string;
  text?: string;
  clientSchema: string;
  templateName?: string;
  languageCode?: string;
  mediaUrl?: string;
  mediaId?: string;
  replyToMessageId?: string;
  mediaType?: 'image' | 'video' | 'audio';
}

/**
 * Send message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(payload: WhatsAppMessagePayload): Promise<boolean> {
  const {
    phoneNumberId,
    to,
    text,
    clientSchema,
    templateName,
    languageCode = 'es_CO',
    mediaUrl,
    mediaId,
    replyToMessageId,
    mediaType
  } = payload;

  // Get access token from client secrets, fallback to env var
  const supabaseForSecrets = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  );
  const { data: secretRow } = await supabaseForSecrets
    .from('client_secrets')
    .select('secrets')
    .eq('client_id', clientSchema.replace('client_', ''))
    .eq('channel_type', 'whatsapp')
    .single();
  const accessToken = secretRow?.secrets?.access_token || Deno.env.get('TAG_WHATSAPP_ACCESS_TOKEN');

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
    } else if (mediaId) {
      const type = mediaType || 'audio';
      body.type = type;
      body[type] = {
        id: mediaId
      };
      if (text && type !== 'audio') {
        body[type].caption = text;
      }
    } else if (mediaUrl) {
      // Send image, video or audio with optional caption
      const type = mediaType || 'image';
      body.type = type;
      body[type] = {
        link: mediaUrl,
      };
      if (text && type !== 'audio') { // WhatsApp doesnt support captions for audio
        body[type].caption = text;
      }
    } else {
      body.type = 'text';
      if (text) {
        body.text = { body: text };
      }
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

    const resBody = await response.json();
    if (!response.ok) {
      console.error('WhatsApp API error body:', JSON.stringify(resBody));
      return false;
    }

    console.log(`Message sent to ${to} by agent (${mediaType || (templateName ? 'template' : 'text')}). Meta ID: ${resBody.messages?.[0]?.id}`);
    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
  }
}
