-- Migration: 00031_deposit_notifications
-- Description: Create deposit_events table and triggers for notifications and billing.

-- =============================================================================
-- PUBLIC SCHEMA: Helper Function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_agent_on_deposit()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT := 'https://rddcxuymsyoovwgbawja.supabase.co';
BEGIN
  -- Call notify-agent edge function for new deposits
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/notify-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY_PLACEHOLDER'
    ),
    body := jsonb_build_object(
      'type', 'new_deposit',
      'record', row_to_json(NEW),
      'schema', TG_TABLE_SCHEMA
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- CLIENT TEMPLATE SCHEMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.deposit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_template.sessions(id),
  contact_id UUID NOT NULL REFERENCES client_template.contacts(id),
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  ai_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE client_template.deposit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_template.deposit_events
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger
DROP TRIGGER IF EXISTS trigger_notify_deposit ON client_template.deposit_events;
CREATE TRIGGER trigger_notify_deposit
  AFTER INSERT ON client_template.deposit_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_deposit();

-- =============================================================================
-- CLIENT TAG_MARKETS SCHEMA
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.deposit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_tag_markets.sessions(id),
  contact_id UUID NOT NULL REFERENCES client_tag_markets.contacts(id),
  amount DECIMAL(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  ai_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE client_tag_markets.deposit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON client_tag_markets.deposit_events
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger
DROP TRIGGER IF EXISTS trigger_notify_deposit ON client_tag_markets.deposit_events;
CREATE TRIGGER trigger_notify_deposit
  AFTER INSERT ON client_tag_markets.deposit_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_deposit();
