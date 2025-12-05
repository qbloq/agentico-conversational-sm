-- Migration: 00013_state_machines
-- Description: Create state_machines table and decouple state definition from code
-- Date: 2025-12-05

-- =============================================================================
-- STATE MACHINES TABLE (client_template)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.state_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  states JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(name, version)
);

-- =============================================================================
-- STATE MACHINES TABLE (client_tag_markets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_tag_markets.state_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  states JSONB NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(name, version)
);

-- =============================================================================
-- UPDATE SESSIONS TABLE (client_template)
-- =============================================================================

-- Change current_state and previous_state to TEXT to allow dynamic states
ALTER TABLE client_template.sessions 
  ALTER COLUMN current_state DROP DEFAULT,
  ALTER COLUMN current_state TYPE TEXT USING current_state::TEXT,
  ALTER COLUMN current_state SET DEFAULT 'initial',
  ALTER COLUMN previous_state TYPE TEXT USING previous_state::TEXT;

-- =============================================================================
-- UPDATE SESSIONS TABLE (client_tag_markets)
-- =============================================================================

ALTER TABLE client_tag_markets.sessions 
  ALTER COLUMN current_state DROP DEFAULT,
  ALTER COLUMN current_state TYPE TEXT USING current_state::TEXT,
  ALTER COLUMN current_state SET DEFAULT 'initial',
  ALTER COLUMN previous_state TYPE TEXT USING previous_state::TEXT;

-- =============================================================================
-- SEED DATA (client_tag_markets)
-- =============================================================================

-- Insert the current hardcoded state machine
INSERT INTO client_tag_markets.state_machines (name, version, initial_state, states, is_active)
VALUES (
  'default_sales_flow',
  '1.0.0',
  'initial',
  '{
  "initial": {
    "state": "initial",
    "objective": "Detect intent and route to appropriate flow based on trading experience",
    "description": "First contact. Ask about trading experience to route appropriately. If user has experience AND shows interest in 12x accounts, transition to \"pitching_12x\". If user has NO experience, offer Premium Academy first. IMPORTANT: Capture trading experience before routing.",
    "completionSignals": [
      "User asks about 12x/leverage and has experience",
      "User has no experience (route to Academy)",
      "User identifies as existing customer"
    ],
    "ragCategories": [
      "Preguntas Frecuentes"
    ],
    "allowedTransitions": [
      "pitching_12x",
      "pitching_academy",
      "returning_customer",
      "pitching_copy_trading",
      "support_general",
      "prospect",
      "escalated"
    ],
    "transitionGuidance": {
      "pitching_12x": "User has trading experience AND shows interest in 12x accounts, leverage, or funding.",
      "pitching_academy": "User has NO trading experience. Offer Academy first.",
      "returning_customer": "User indicates they already have an account.",
      "pitching_copy_trading": "User specifically asks about Copy Trading.",
      "support_general": "User has a specific support question not related to sales.",
      "prospect": "User shows no clear interest in any product.",
      "escalated": "User requests human agent."
    },
    "maxMessages": 2
  },
  "pitching_12x": {
    "state": "pitching_12x",
    "objective": "Explain 12x Leveraged Accounts and handle Q&A",
    "description": "User is interested in 12x accounts. Deliver the value proposition (Concept, Considerations, Drawdown). Answer questions. If not interested, downsell to Copy Trading.",
    "completionSignals": [
      "User wants to register",
      "User is not interested",
      "User asks about Copy Trading"
    ],
    "ragCategories": [
      "12x Cuentas Amplificadas",
      "Tipos de Cuentas",
      "Condiciones De Trading"
    ],
    "allowedTransitions": [
      "closing",
      "pitching_copy_trading",
      "escalated"
    ],
    "transitionGuidance": {
      "closing": "User wants to register or asks for link.",
      "pitching_copy_trading": "User is NOT interested in 12x accounts (Downsell).",
      "escalated": "User requests human help."
    },
    "maxMessages": 6
  },
  "pitching_copy_trading": {
    "state": "pitching_copy_trading",
    "objective": "Offer Copy Trading as alternative",
    "description": "User declined previous offer. Offer Copy Trading. If user indicates interest in Education instead, skip to Academy. If user rejects all, move to prospect state.",
    "completionSignals": [
      "User wants to register for Copy Trading",
      "User is not interested",
      "User asks about Academy/Education"
    ],
    "ragCategories": [
      "Copy Trading",
      "Tipos de Cuentas"
    ],
    "allowedTransitions": [
      "closing",
      "pitching_academy",
      "prospect",
      "escalated"
    ],
    "transitionGuidance": {
      "closing": "User wants to register for Copy Trading.",
      "pitching_academy": "User is NOT interested in Copy Trading BUT explicitly asks for Education.",
      "prospect": "User is NOT interested in Copy Trading and has rejected other offers.",
      "escalated": "User requests human help."
    },
    "maxMessages": 4
  },
  "pitching_academy": {
    "state": "pitching_academy",
    "objective": "Offer Academy/Education to inexperienced traders",
    "description": "User has no trading experience. Offer Premium Academy. If not interested, downsell to Copy Trading.",
    "completionSignals": [
      "User wants to join Academy",
      "User is not interested"
    ],
    "ragCategories": [
      "Academia",
      "Conceptos generales de Trading"
    ],
    "allowedTransitions": [
      "closing",
      "pitching_copy_trading",
      "prospect",
      "escalated"
    ],
    "transitionGuidance": {
      "closing": "User wants to join Academy.",
      "pitching_copy_trading": "User is NOT interested in Academy (Downsell to Copy Trading).",
      "prospect": "User explicitly rejects Academy without interest in alternatives.",
      "escalated": "User requests human help."
    },
    "maxMessages": 3
  },
  "prospect": {
    "state": "prospect",
    "objective": "Re-engage user who rejected all offers",
    "description": "User declined all product offers (Academy, Copy Trading, 12x). Try to understand their needs better and route back to appropriate product flow if they show renewed interest.",
    "completionSignals": [
      "User shows renewed interest in a product",
      "User asks questions about products",
      "User wants to end conversation"
    ],
    "ragCategories": [
      "Preguntas Frecuentes"
    ],
    "allowedTransitions": [
      "pitching_12x",
      "pitching_academy",
      "pitching_copy_trading",
      "support_general",
      "completed",
      "escalated"
    ],
    "transitionGuidance": {
      "pitching_12x": "User shows interest in 12x accounts or has trading experience.",
      "pitching_academy": "User asks about education or training.",
      "pitching_copy_trading": "User asks about Copy Trading.",
      "support_general": "User has general questions.",
      "completed": "User wants to end conversation.",
      "escalated": "User requests human help."
    },
    "maxMessages": 5
  },
  "closing": {
    "state": "closing",
    "objective": "Send registration link and guide user to a successful registration",
    "description": "User wants to proceed with a product. Send registration link and guide process.",
    "completionSignals": [
      "User confirms registration"
    ],
    "ragCategories": [
      "Guías & Tutoriales",
      "Manejo de la Cuenta"
    ],
    "allowedTransitions": [
      "post_registration",
      "escalated"
    ],
    "transitionGuidance": {
      "post_registration": "User confirms they have registered.",
      "escalated": "User has issues registering that require human."
    },
    "maxMessages": 5
  },
  "post_registration": {
    "state": "post_registration",
    "objective": "Capture customer email and confirm registration",
    "description": "User has registered. Ask for and capture their email to verify registration. Once email is provided, transition to returning_customer for ongoing support.",
    "completionSignals": [
      "User provides email address",
      "Email captured and verified"
    ],
    "ragCategories": [
      "Depósitos y Retiros"
    ],
    "allowedTransitions": [
      "completed",
      "returning_customer",
      "escalated"
    ],
    "transitionGuidance": {
      "completed": "User declines to provide email or wants to end conversation.",
      "returning_customer": "User provides their email address - transition to provide ongoing customer support.",
      "escalated": "User requests human help."
    },
    "maxMessages": 3
  },
  "returning_customer": {
    "state": "returning_customer",
    "objective": "Support existing customer",
    "description": "Handle support questions for existing users. Use KB and Conversation Examples for human-like tone.",
    "completionSignals": [
      "Issue resolved",
      "User satisfied"
    ],
    "ragCategories": [
      "Manejo de la Cuenta",
      "Depósitos y Retiros",
      "Plataformas De Trading"
    ],
    "allowedTransitions": [
      "completed",
      "escalated",
      "pitching_12x"
    ],
    "transitionGuidance": {
      "completed": "Issue resolved.",
      "escalated": "Complex issue requiring human.",
      "pitching_12x": "User asks about opening a new 12x account."
    },
    "maxMessages": 10
  },
  "support_general": {
    "state": "support_general",
    "objective": "General support for non-customers",
    "description": "User reached end of sales flow or has general questions. Be helpful but try to route back to value if possible.",
    "completionSignals": [
      "Question answered"
    ],
    "ragCategories": [
      "Preguntas Frecuentes"
    ],
    "allowedTransitions": [
      "completed",
      "escalated",
      "pitching_12x"
    ],
    "transitionGuidance": {
      "completed": "Question answered.",
      "escalated": "User requests human.",
      "pitching_12x": "User shows renewed interest in products."
    },
    "maxMessages": 5
  },
  "follow_up": {
    "state": "follow_up",
    "objective": "Re-engage user",
    "description": "Scheduled follow-up. Check if user registered or needs help.",
    "completionSignals": [
      "User responds"
    ],
    "ragCategories": [],
    "allowedTransitions": [
      "pitching_12x",
      "closing",
      "completed",
      "escalated"
    ],
    "transitionGuidance": {
      "pitching_12x": "User wants to know more.",
      "closing": "User is ready to register.",
      "completed": "User declines.",
      "escalated": "User requests human."
    }
  },
  "escalated": {
    "state": "escalated",
    "objective": "Human agent handover",
    "description": "Conversation handed off to human.",
    "completionSignals": [],
    "ragCategories": [],
    "allowedTransitions": [
      "completed"
    ],
    "transitionGuidance": {
      "completed": "Human closes conversation."
    }
  },
  "completed": {
    "state": "completed",
    "objective": "Conversation ended",
    "description": "Conversation concluded successfully.",
    "completionSignals": [],
    "ragCategories": [],
    "allowedTransitions": [
      "follow_up"
    ],
    "transitionGuidance": {
      "follow_up": "Scheduled re-engagement."
    }
  }
}'::jsonb,
  TRUE
) ON CONFLICT (name, version) DO NOTHING;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

ALTER TABLE client_template.state_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tag_markets.state_machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON client_template.state_machines
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access" ON client_tag_markets.state_machines
  FOR ALL USING (auth.role() = 'service_role');
