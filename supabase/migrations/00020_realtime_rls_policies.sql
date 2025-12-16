-- Migration: 00020_realtime_rls_policies
-- Description: Add RLS policies to allow anon role to receive Realtime events for messages
-- Date: 2024-12-15

-- =============================================================================
-- Enable anon read access for Realtime subscriptions
-- =============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE client_tag_markets.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE client_template.messages;

-- client_template schema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'client_template' 
    AND tablename = 'messages' 
    AND policyname = 'anon_read_messages_realtime'
  ) THEN
    CREATE POLICY anon_read_messages_realtime 
      ON client_template.messages 
      FOR SELECT 
      TO anon 
      USING (true);
  END IF;
END $$;

-- client_tag_markets schema
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'client_tag_markets' 
    AND tablename = 'messages' 
    AND policyname = 'anon_read_messages_realtime'
  ) THEN
    CREATE POLICY anon_read_messages_realtime 
      ON client_tag_markets.messages 
      FOR SELECT 
      TO anon 
      USING (true);
  END IF;
END $$;
