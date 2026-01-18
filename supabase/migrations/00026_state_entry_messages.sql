-- Migration: 00026_state_entry_messages
-- Description: Create state_entry_messages table for database-driven state entry responses
-- Date: 2026-01-13

-- =============================================================================
-- STATE ENTRY MESSAGES TABLE (client_template)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.state_entry_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_machine_id UUID NOT NULL REFERENCES client_template.state_machines(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  
  -- Complete response sequence as JSONB array of BotResponse objects
  responses JSONB NOT NULL,
  
  -- Optional: Session context updates to apply on state entry
  session_updates JSONB DEFAULT '{}',
  
  -- Metadata
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One response sequence per state per state machine
  UNIQUE(state_machine_id, state)
);

-- =============================================================================
-- STATE ENTRY MESSAGES TABLE (client_tag_markets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.state_entry_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_machine_id UUID NOT NULL REFERENCES client_tag_markets.state_machines(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  
  -- Complete response sequence as JSONB array of BotResponse objects
  responses JSONB NOT NULL,
  
  -- Optional: Session context updates to apply on state entry
  session_updates JSONB DEFAULT '{}',
  
  -- Metadata
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One response sequence per state per state machine
  UNIQUE(state_machine_id, state)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Create indexes with error handling for ownership issues
DO $$ 
BEGIN
  CREATE INDEX IF NOT EXISTS idx_state_entry_messages_sm_state 
    ON client_template.state_entry_messages(state_machine_id, state) 
    WHERE is_active = TRUE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping index creation on client_template.state_entry_messages due to permissions';
END $$;

DO $$ 
BEGIN
  CREATE INDEX IF NOT EXISTS idx_state_entry_messages_sm_state 
    ON client_tag_markets.state_entry_messages(state_machine_id, state) 
    WHERE is_active = TRUE;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping index creation on client_tag_markets.state_entry_messages due to permissions';
END $$;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- Enable RLS with error handling
DO $$ 
BEGIN
  ALTER TABLE client_template.state_entry_messages ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping RLS enable on client_template.state_entry_messages due to permissions';
END $$;

DO $$ 
BEGIN
  ALTER TABLE client_tag_markets.state_entry_messages ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping RLS enable on client_tag_markets.state_entry_messages due to permissions';
END $$;

-- Create policies only if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'client_template' 
    AND tablename = 'state_entry_messages' 
    AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON client_template.state_entry_messages
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'client_tag_markets' 
    AND tablename = 'state_entry_messages' 
    AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON client_tag_markets.state_entry_messages
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Create triggers only if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'state_entry_messages_updated_at' 
    AND tgrelid = 'client_template.state_entry_messages'::regclass
  ) THEN
    CREATE TRIGGER state_entry_messages_updated_at
      BEFORE UPDATE ON client_template.state_entry_messages
      FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'state_entry_messages_updated_at' 
    AND tgrelid = 'client_tag_markets.state_entry_messages'::regclass
  ) THEN
    CREATE TRIGGER state_entry_messages_updated_at
      BEFORE UPDATE ON client_tag_markets.state_entry_messages
      FOR EACH ROW EXECUTE FUNCTION client_tag_markets.update_updated_at();
  END IF;
END $$;

-- =============================================================================
-- SEED DATA (client_tag_markets)
-- =============================================================================

-- Migrate existing hardcoded responses for default_sales_flow state machine

-- pitching_12x state
INSERT INTO client_tag_markets.state_entry_messages (
  state_machine_id,
  state,
  responses,
  session_updates,
  description
)
SELECT 
  id,
  'pitching_12x',
  '[
    {
      "type": "text",
      "content": "Te explico cómo funcionan:\\n\\nLas Cuentas Apalancadas X12, son cuentas que te permiten operar con un capital mayor al que depositas.\\n\\nPor ejemplo, si depositas $500 en una cuenta apalancada, podrás operar con $6,000. \\n\\nEs importante no perder más del 10% del balance de la cuenta apalancada para evitar el cierre de la misma.\\n\\nEste drawdown es estático y no crece conforme aumente el balance de tu cuenta. (Así que no afecta tus ganancias)",
      "delayMs": 1000
    },
    {
      "type": "text",
      "content": "*Recalcar que:*\\n1. No debes pasar ningún examen o prueba, la cuenta se entrega de inmediato y lista para operar\\n2. Puedes retirar ganancias todos los días, desde el primer día\\n3. No hay reparto de ganancias, te quedas con el 100% de tus profits",
      "delayMs": 4000
    },
    {
      "type": "text",
      "content": "Si tienes alguna inquietud, no dudes en preguntarme.",
      "delayMs": 4000
    }
  ]'::jsonb,
  '{"context": {"pitchComplete": true}}'::jsonb,
  'Burst sequence for 12x Pitch (Flow A) - explains value proposition, key considerations, and drawdown rules'
FROM client_tag_markets.state_machines
WHERE name = 'default_sales_flow' AND is_active = TRUE
ON CONFLICT (state_machine_id, state) DO NOTHING;

-- closing state
INSERT INTO client_tag_markets.state_entry_messages (
  state_machine_id,
  state,
  responses,
  session_updates,
  description
)
SELECT 
  id,
  'closing',
  '[
    {
      "type": "text",
      "content": "Excelente, lo primero es hacer el registro. 🚀\\n\\nEstaré aquí contigo durante todo el proceso. Si tienes alguna duda al llenar el formulario o realizar el depósito, solo pregúntame.",
      "delayMs": 1000
    },
    {
      "type": "template",
      "templateName": "registro_x12",
      "templateButtonParams": ["{{session.id}}"],
      "templateHeaderImage": "https://tournament.tagmarkets.com/assets/logo-tag-BYchnq3N.png",
      "content": "Una vez que hayas completado el registro, pásame tu correo electrónico para verificar que todo esté en orden.\\n\\nhttps://h.parallelo.ai/register?sessionId={{session.id}}",
      "delayMs": 1000
    }
  ]'::jsonb,
  '{"context": {"registrationStatus": "pending"}}'::jsonb,
  'Closing sequence - sends registration link with WhatsApp template'
FROM client_tag_markets.state_machines
WHERE name = 'default_sales_flow' AND is_active = TRUE
ON CONFLICT (state_machine_id, state) DO NOTHING;
