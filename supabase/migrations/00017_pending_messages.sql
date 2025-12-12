-- Migration: Create pending_messages table for debounce buffer
-- This table stores messages waiting to be processed after debounce delay

-- Creating in client_tag_markets schema (add to other client schemas as needed)

CREATE TABLE IF NOT EXISTS client_tag_markets.pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Session identification
  session_key_hash TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  
  -- Message content
  message_content TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  media_url TEXT,
  transcription TEXT,
  platform_message_id TEXT,
  
  -- Timing
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_process_at TIMESTAMPTZ NOT NULL,
  
  -- Concurrency control
  processing_started_at TIMESTAMPTZ,  -- NULL = not processing, set = being processed
  
  -- Retry tracking
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for finding mature sessions ready for processing
CREATE INDEX IF NOT EXISTS idx_pending_messages_mature 
  ON client_tag_markets.pending_messages (scheduled_process_at)
  WHERE processing_started_at IS NULL AND retry_count < 3;

-- Index for fetching all messages for a session
CREATE INDEX IF NOT EXISTS idx_pending_messages_session 
  ON client_tag_markets.pending_messages (session_key_hash, received_at);

-- Index for cleanup of stuck messages
CREATE INDEX IF NOT EXISTS idx_pending_messages_stuck
  ON client_tag_markets.pending_messages (processing_started_at)
  WHERE processing_started_at IS NOT NULL;

-- Comment
COMMENT ON TABLE client_tag_markets.pending_messages IS 'Buffer for incoming messages waiting for debounce processing';
COMMENT ON COLUMN client_tag_markets.pending_messages.session_key_hash IS 'Hash of channelType:channelId:channelUserId for grouping';
COMMENT ON COLUMN client_tag_markets.pending_messages.scheduled_process_at IS 'When this message should be processed (after debounce delay)';
COMMENT ON COLUMN client_tag_markets.pending_messages.processing_started_at IS 'Concurrency lock - set when worker starts processing';

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS
ALTER TABLE client_tag_markets.pending_messages ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role full access" ON client_tag_markets.pending_messages
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- GRANTS (for service role and authenticated access)
-- =============================================================================

-- Grant table access
GRANT ALL ON client_tag_markets.pending_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_tag_markets.pending_messages TO authenticated;
