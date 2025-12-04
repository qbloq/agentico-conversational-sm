/**
 * Registration Link Edge Function
 * 
 * Handles registration link clicks from customers during the closing state.
 * - Tracks link click with IP, User Agent, and screen resolution
 * - Updates session state to post_registration
 * - Schedules follow-up for 15 minutes later
 * - Returns HTML with Open Graph tags for rich link preview
 * - Redirects to TAG Markets registration portal
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import {
  createSupabaseSessionStore,
} from '../_shared/adapters/index.ts';

serve(async (req) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  const screenResolution = url.searchParams.get('screen_resolution');

  // Validate session ID
  if (!sessionId) {
    return new Response(
      generateErrorHTML('Invalid link - missing session ID'),
      { 
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }

  try {
    const supabase = createSupabaseClient();
    
    // Get session to determine schema
    // We need to find which schema this session belongs to
    // For now, we'll assume client_tag_markets (can be enhanced later)
    const schemaName = 'client_tag_markets';
    
    const sessionStore = createSupabaseSessionStore(supabase, schemaName);
    const session = await sessionStore.findById(sessionId);

    if (!session) {
      return new Response(
        generateErrorHTML('Session not found'),
        { 
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      );
    }

    // Capture tracking data
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
               req.headers.get('x-real-ip') ||
               'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Update session
    await sessionStore.update(sessionId, {
      currentState: 'post_registration',
      previousState: session.currentState,
      context: {
        ...session.context,
        registrationLinkClicked: true,
      },
    });

    // Update registration tracking fields
    await supabase
      .schema(schemaName)
      .from('sessions')
      .update({
        registration_clicked_at: new Date().toISOString(),
        registration_ip: ip,
        registration_user_agent: userAgent,
        registration_screen_resolution: screenResolution || 'unknown',
        registration_status: 'link_clicked',
      })
      .eq('id', sessionId);

    // Schedule follow-up for 15 minutes later
    const followupTime = new Date();
    followupTime.setMinutes(followupTime.getMinutes() + 15);

    await supabase
      .schema(schemaName)
      .from('followup_queue')
      .insert({
        session_id: sessionId,
        scheduled_at: followupTime.toISOString(),
        followup_type: 'custom',
        template_name: 'registration_check',
        status: 'pending',
      });

    console.log(`[Registration Link] Session ${sessionId} clicked from IP ${ip}`);

    // Return HTML with Open Graph tags and redirect
    return new Response(
      generateSuccessHTML(),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );

  } catch (error) {
    console.error('Error processing registration link:', error);
    return new Response(
      generateErrorHTML('An error occurred. Please try again.'),
      { 
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }
    );
  }
});

function generateSuccessHTML(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Open Graph Tags for Rich Link Preview -->
  <meta property="og:title" content="Registra tu cuenta Amplify X12" />
  <meta property="og:description" content="TAG Markets Cuenta Apalancada 1:12" />
  <meta property="og:image" content="https://tournament.tagmarkets.com/assets/logo-tag-BYchnq3N.png" />
  <meta property="og:type" content="website" />
  
  <!-- Twitter Card Tags -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Registra tu cuenta Amplify X12" />
  <meta name="twitter:description" content="TAG Markets Cuenta Apalancada 1:12" />
  <meta name="twitter:image" content="https://tournament.tagmarkets.com/assets/logo-tag-BYchnq3N.png" />
  
  <title>Registra tu cuenta Amplify X12</title>
  
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    }
    
    .logo {
      width: 120px;
      height: auto;
      margin-bottom: 24px;
    }
    
    h1 {
      color: #1a202c;
      font-size: 28px;
      margin-bottom: 16px;
      font-weight: 700;
    }
    
    p {
      color: #4a5568;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    
    .spinner {
      width: 40px;
      height: 40px;
      margin: 20px auto;
      border: 4px solid #e2e8f0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .redirect-text {
      color: #718096;
      font-size: 14px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="https://tournament.tagmarkets.com/assets/logo-tag-BYchnq3N.png" alt="TAG Markets" class="logo" />
    <h1>¡Excelente! 🚀</h1>
    <p>Estamos preparando tu registro para la cuenta Amplify X12.</p>
    <div class="spinner"></div>
    <p class="redirect-text">Redirigiendo al portal de registro...</p>
  </div>
  
  <script>
    // Capture screen resolution and send it back
    const screenRes = window.screen.width + 'x' + window.screen.height;
    const currentUrl = new URL(window.location.href);
    
    // If screen resolution not already in URL, add it and reload
    if (!currentUrl.searchParams.get('screen_resolution')) {
      currentUrl.searchParams.set('screen_resolution', screenRes);
      window.location.href = currentUrl.toString();
    } else {
      // Redirect to TAG Markets portal after 2 seconds
      setTimeout(() => {
        window.location.href = 'https://portal.tagmarkets.com/es/live_signup?sidc=78E1EB08-A660-4825-A6AB-55B83FB3765F';
      }, 100);
    }
  </script>
</body>
</html>`;
}

function generateErrorHTML(message: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    }
    
    h1 {
      color: #e53e3e;
      font-size: 24px;
      margin-bottom: 16px;
    }
    
    p {
      color: #4a5568;
      font-size: 16px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>❌ Error</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
