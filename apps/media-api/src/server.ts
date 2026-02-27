import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { PassThrough } from 'stream';

// Configure absolute ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Load .env from root or specific app
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Set up Multer for in-memory uploads
const upload = multer({ storage: multer.memoryStorage() });

// Verify required envs
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to transcode buffer to AAC
async function transcodeToAAC(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Create an input stream from the buffer
    const inputStream = new PassThrough();
    inputStream.end(inputBuffer);

    // Create an output stream to collect the AAC bytes
    const chunks: Buffer[] = [];
    const outputStream = new PassThrough();
    
    outputStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    outputStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    outputStream.on('error', (err) => {
      reject(err);
    });

    // Run fluent-ffmpeg pipe
    ffmpeg(inputStream)
      .outputFormat('adts') // ADTS is the container format for raw AAC streams
      .audioCodec('aac')
      .on('error', (err) => {
        console.error('[FFmpeg] Error transcoding audio:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('[FFmpeg] Transcoding to AAC complete');
      })
      .pipe(outputStream, { end: true });
  });
}

// Media Upload Endpoint
app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const clientId = req.query.cid as string;
    const escalationId = req.query.escalationId as string;
    // Extract metadata from form fields
    const to = req.body.to;
    let mimeType = req.body.mimeType || 'audio/mp4'; 
    console.log("to", to);
    console.log("mimeType", mimeType);
    const isAudio = req.body.isAudio === 'true';

    console.log(`[MediaUpload] Received request for cid=${clientId}, phone=${to}, audio=${isAudio}`);

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!clientId) {
      return res.status(400).json({ error: 'Missing cid parameter' });
    }

    // 1. Fetch Config & Access Token
    const { data: configRow } = await supabase
      .from('client_configs')
      .select('schema_name')
      .eq('client_id', clientId)
      .single();

    if (!configRow) {
      return res.status(404).json({ error: `Client config not found for ${clientId}` });
    }

    const { data: secretRow } = await supabase
      .from('client_secrets')
      .select('secrets')
      .eq('client_id', clientId)
      .eq('channel_type', 'whatsapp')
      .single();

    const accessToken = secretRow?.secrets?.accessToken || process.env.TAG_WHATSAPP_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({ error: 'Could not resolve WhatsApp Access Token' });
    }

    // Determine the Channel ID by fetching escalation/session
    let channelId = null;
    let sessionId = null;
    if (escalationId) {
       const { data: escalation } = await supabase
         .schema(configRow.schema_name)
         .from('escalations')
         .select('session_id')
         .eq('id', escalationId)
         .single();
         
       if (escalation) {
         sessionId = escalation.session_id;
         const { data: sessionData } = await supabase
           .schema(configRow.schema_name)
           .from('sessions')
           .select('channel_id')
           .eq('id', sessionId)
           .single();
         channelId = sessionData?.channel_id;
       }
    }

    if (!channelId) {
      return res.status(400).json({ error: 'Could not resolve WhatsApp channel (phone number) ID from escalation' });
    }
    
    let processBuffer = file.buffer;
    let finalFileName = file.originalname || 'media.bin';
    
    // TRANSCODING BLOCK: If it's audio, forcefully transcode to AAC to satisfy Meta's rigid restrictions
    if (isAudio && mimeType !== 'audio/aac') {
      console.log(`[MediaUpload] Transcoding incoming ${mimeType} audio file strictly to AAC...`);
      try {
         processBuffer = await transcodeToAAC(file.buffer);
         mimeType = 'audio/aac';
         finalFileName = 'audio.aac';
      } catch (err) {
         // Silently fallback if ffmpeg fails (but log loudly)
         console.error('[MediaUpload] Falling back to original buffer due to transcode failure.', err);
      }
    }

    // 2. Post Direct to Meta /media
    console.log(`[MediaUpload] Uploading explicit generic buffer of size ${processBuffer.length} exactly as ${mimeType} to Graph API...`);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    
    // Pass raw transcoded buffer explicitly formatted for Meta Form Boundary
    form.append('file', processBuffer, {
      filename: finalFileName,
      contentType: mimeType,
    });

    try {
      const uploadRes = await axios.post(
        `https://graph.facebook.com/v24.0/${channelId}/media`,
        form,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...form.getHeaders() // Crucial for axios to inject exact multipart boundary
          }
        }
      );

      const mediaId = uploadRes.data.id;
      console.log(`[MediaUpload] Success! Meta Media ID: ${mediaId}`);
      
      // 3. Resolve internal Agent ID for DB tracking
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
         return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }
      
      const token = authHeader.substring(7);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      let agentId = 'unknown';
      if (user) agentId = user.id;

      // Check if this is replying to a platform message
      const replyToMessageId = req.body.replyToMessageId;
      let platformReplyToId = undefined;
      
      if (replyToMessageId) {
        const { data: repliedMsg } = await supabase
          .schema(configRow.schema_name)
          .from('messages')
          .select('platform_message_id')
          .eq('id', replyToMessageId)
          .single();
        
        if (repliedMsg?.platform_message_id) {
          platformReplyToId = repliedMsg.platform_message_id;
        }
      }

      // 4. Save into Database
      const { data: savedMessage, error: msgError } = await supabase
        .schema(configRow.schema_name)
        .from('messages')
        .insert({
          session_id: sessionId,
          direction: 'outbound',
          type: isAudio ? 'audio' : 'video',
          content: null,
          media_url: mediaId, // Just store ID locally
          sent_by_agent_id: agentId,
          reply_to_message_id: replyToMessageId || null,
        })
        .select()
        .single();
        
      if (msgError) console.error("Could not save message to Supabase DB:", msgError);
      
      // 5. Build and Fire WhatsApp Message sending the Media ID
      const messageBody: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: isAudio ? 'audio' : 'video'
      };
      
      messageBody[messageBody.type] = {
        id: mediaId
      };
      
      if (platformReplyToId) {
        messageBody.context = {
          message_id: platformReplyToId
        };
      }
      
      console.log(`[MediaUpload] Sending WA message with media payload...`);
      const waRes = await axios.post(
        `https://graph.facebook.com/v24.0/${channelId}/messages`,
        messageBody,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      
      console.log(`[MediaUpload] Message dispatched! WhatsApp ID: ${waRes.data?.messages?.[0]?.id}`);
      
      // 6. Update session metadata 
      await supabase
        .schema(configRow.schema_name)
        .from('sessions')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', sessionId);
      
      return res.json({ 
        success: true, 
        messageId: savedMessage?.id || null,
        mediaUrl: null,
      });
      
    } catch (apiError: any) {
      console.error('[MediaUpload] Meta Graph API Rejected Upload:', apiError.response?.data || apiError.message);
      return res.status(502).json({ error: 'Meta Graph API format rejection', details: apiError.response?.data });
    }
  } catch (error: any) {
    console.error('[MediaUpload] Internal Server Error:', error);
    res.status(500).json({ error: error.message });
  }
});

import https from 'https';
import http from 'http';

// Basic Healthcheck
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

const keyPath = path.join(__dirname, '..', 'server.key');
const certPath = path.join(__dirname, '..', 'server.cert');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  https.createServer(options, app).listen(port, () => {
    console.log(`Media API Backend listening securely at https://localhost:${port}`);
  });
} else {
  console.warn("SSL certificates not found. Falling back to HTTP.");
  http.createServer(app).listen(port, () => {
    console.log(`Media API Backend listening at http://localhost:${port}`);
  });
}
