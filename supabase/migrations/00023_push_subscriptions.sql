-- Migration: 00023_push_subscriptions.sql
-- Description: Adds push_subscriptions table and triggers to notify agents via Edge Functions.

-- =============================================================================
-- CLIENT TEMPLATE
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES client_tag_markets.human_agents(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, subscription)
);

-- RLS
ALTER TABLE client_template.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents can manage their own subscriptions" ON client_template.push_subscriptions
  FOR ALL USING (agent_id::text = auth.uid()::text); -- Assuming agent_id in token matches

-- =============================================================================
-- CLIENT TAG_MARKETS
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES client_tag_markets.human_agents(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  device_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, subscription)
);

-- RLS
ALTER TABLE client_tag_markets.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents can manage their own subscriptions" ON client_tag_markets.push_subscriptions
  FOR ALL USING (agent_id::text = auth.uid()::text);

-- =============================================================================
-- NOTIFICATION TRIGGERS
-- =============================================================================

-- Enable pg_net if not enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function to call Edge Function
CREATE OR REPLACE FUNCTION public.notify_agent_on_escalation()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT := 'https://rddcxuymsyoovwgbawja.supabase.co';
BEGIN
  -- Call notify-agent edge function for new escalations (Broadcast)
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/notify-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY_PLACEHOLDER'
    ),
    body := jsonb_build_object(
      'type', 'new_escalation',
      'record', row_to_json(NEW),
      'schema', TG_TABLE_SCHEMA
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.notify_agent_on_message()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT := 'https://rddcxuymsyoovwgbawja.supabase.co';
BEGIN
  -- Only trigger for inbound messages
  IF NEW.direction = 'inbound' THEN
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/notify-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY_PLACEHOLDER'
      ),
      body := jsonb_build_object(
        'type', 'new_message',
        'record', row_to_json(NEW),
        'schema', TG_TABLE_SCHEMA
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply Triggers to client_template
DROP TRIGGER IF EXISTS trigger_notify_escalation ON client_template.escalations;
CREATE TRIGGER trigger_notify_escalation
  AFTER INSERT ON client_template.escalations
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_escalation();

DROP TRIGGER IF EXISTS trigger_notify_message ON client_template.messages;
CREATE TRIGGER trigger_notify_message
  AFTER INSERT ON client_template.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_message();

-- Apply Triggers to client_tag_markets
DROP TRIGGER IF EXISTS trigger_notify_escalation ON client_tag_markets.escalations;
CREATE TRIGGER trigger_notify_escalation
  AFTER INSERT ON client_tag_markets.escalations
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_escalation();

DROP TRIGGER IF EXISTS trigger_notify_message ON client_tag_markets.messages;
CREATE TRIGGER trigger_notify_message
  AFTER INSERT ON client_tag_markets.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_agent_on_message();
