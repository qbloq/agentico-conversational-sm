-- Migration: 00003_client_schema_template
-- Description: Template for client-specific schemas
-- Date: 2024-11-28
-- 
-- This file serves as a template. To create a new client schema:
-- 1. Copy this file
-- 2. Replace 'client_template' with the actual schema name (e.g., 'client_tag_markets')
-- 3. Run the migration

-- =============================================================================
-- SCHEMA CREATION
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS client_template;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

-- Conversation states (state machine)
DO $$ BEGIN
  CREATE TYPE client_template.conversation_state AS ENUM (
    'initial',
    'qualifying',
    'diagnosing',
    'pitching',
    'handling_objection',
    'closing',
    'post_registration',
    'deposit_support',
    'follow_up',
    'escalated',
    'completed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Channel types
DO $$ BEGIN
  CREATE TYPE client_template.channel_type AS ENUM (
    'whatsapp',
    'instagram',
    'messenger'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- CONTACTS TABLE
-- =============================================================================

-- Contacts: Stores persistent user identity across all channels
CREATE TABLE IF NOT EXISTS client_template.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  
  -- Profile
  language TEXT DEFAULT 'es',
  country TEXT,
  timezone TEXT,
  
  -- Funnel Status (Persistent across sessions)
  has_registered BOOLEAN DEFAULT FALSE,
  deposit_confirmed BOOLEAN DEFAULT FALSE,
  lifetime_value DECIMAL(10,2) DEFAULT 0,
  
  -- Attribution
  utm_source TEXT,
  utm_campaign TEXT,
  referral_code TEXT,
  
  -- Metadata (flexible JSONB)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CONTACT IDENTITIES TABLE
-- =============================================================================

-- Maps channel-specific user IDs to contacts
-- Allows same person to be recognized across WhatsApp, Instagram, etc.
CREATE TABLE IF NOT EXISTS client_template.contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES client_template.contacts(id) ON DELETE CASCADE,
  
  -- Channel identification
  channel_type client_template.channel_type NOT NULL,
  channel_user_id TEXT NOT NULL,         -- wa_id, ig_id, psid, etc.
  
  -- Metadata
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: One contact per channel user
  UNIQUE(channel_type, channel_user_id)
);

-- =============================================================================
-- SESSIONS TABLE
-- =============================================================================

-- Sessions: Represents a conversation thread
CREATE TABLE IF NOT EXISTS client_template.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES client_template.contacts(id) ON DELETE CASCADE,
  
  -- Channel identification (entry point for this session)
  channel_type client_template.channel_type NOT NULL,
  channel_id TEXT NOT NULL,              -- WhatsApp phone_number_id, IG page_id, etc.
  channel_user_id TEXT NOT NULL,         -- User's ID in that channel
  
  -- State machine
  current_state client_template.conversation_state DEFAULT 'initial',
  previous_state client_template.conversation_state,
  
  -- Context (flexible JSONB for conversation-specific data)
  context JSONB DEFAULT '{}',
  
  -- Status
  status TEXT CHECK (status IN ('active', 'paused', 'closed', 'archived')) DEFAULT 'active',
  
  -- Escalation
  is_escalated BOOLEAN DEFAULT FALSE,
  escalated_to TEXT,
  escalation_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  
  -- Unique constraint: One active session per user per channel
  UNIQUE(channel_type, channel_id, channel_user_id)
);

-- =============================================================================
-- MESSAGES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_template.sessions(id) ON DELETE CASCADE,
  
  -- Direction
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  
  -- Content
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'audio', 'template', 'interactive')),
  content TEXT,
  
  -- Media (if applicable)
  media_url TEXT,
  media_storage_path TEXT,               -- Path in Supabase Storage
  transcription TEXT,                    -- For audio messages
  image_analysis JSONB,                  -- For image messages
  
  -- Platform metadata
  platform_message_id TEXT,              -- WhatsApp/Meta message ID
  delivery_status TEXT CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

-- =============================================================================
-- KNOWLEDGE BASE TABLE
-- =============================================================================

-- FAQ articles for RAG retrieval
CREATE TABLE IF NOT EXISTS client_template.knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Content (from Intercom FAQ)
  title TEXT NOT NULL,                   -- Article title (question)
  answer TEXT NOT NULL,                  -- Full answer text
  url TEXT,                              -- Original source URL
  
  -- Categorization
  category TEXT NOT NULL,                -- Parent category
  semantic_tags TEXT[],                  -- From enrichment
  key_concepts TEXT[],                   -- Main topics
  related_entities TEXT[],               -- Related entities
  
  -- Summary (for quick context in prompts)
  summary TEXT,
  
  -- Related articles
  related_articles JSONB,                -- Array of {title, url}
  
  -- Vector embedding for semantic search
  embedding VECTOR(1536),                 -- Gemini text-embedding-004 dimension
  
  -- Metadata
  priority INT DEFAULT 0,                -- Higher = preferred match
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- FOLLOW-UP QUEUE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.followup_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES client_template.sessions(id) ON DELETE CASCADE,
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ NOT NULL,
  followup_type TEXT CHECK (followup_type IN ('short_term', 'daily', 'custom')),
  
  -- Template to use
  template_name TEXT,
  template_params JSONB,
  
  -- Status
  status TEXT CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')) DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_template.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES client_template.sessions(id),
  contact_id UUID REFERENCES client_template.contacts(id),
  
  -- Event
  event_type TEXT NOT NULL,              -- e.g., 'state_change', 'escalation', 'registration'
  event_data JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Contacts
CREATE INDEX IF NOT EXISTS idx_contacts_email ON client_template.contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON client_template.contacts(phone) WHERE phone IS NOT NULL;

-- Contact Identities
CREATE INDEX IF NOT EXISTS idx_contact_identities_lookup 
  ON client_template.contact_identities(channel_type, channel_user_id);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_contact ON client_template.sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup 
  ON client_template.sessions(channel_type, channel_id, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON client_template.sessions(current_state) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sessions_escalated ON client_template.sessions(is_escalated) WHERE is_escalated = TRUE;

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_session ON client_template.messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON client_template.messages(session_id, created_at DESC);

-- Knowledge Base
CREATE INDEX IF NOT EXISTS idx_kb_category ON client_template.knowledge_base(category) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_kb_embedding ON client_template.knowledge_base 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Follow-up Queue
CREATE INDEX IF NOT EXISTS idx_followup_pending 
  ON client_template.followup_queue(scheduled_at) WHERE status = 'pending';

-- Audit Log
CREATE INDEX IF NOT EXISTS idx_audit_session ON client_template.audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_contact ON client_template.audit_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON client_template.audit_log(event_type, created_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE client_template.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.contact_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.followup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_template.audit_log ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for Edge Functions)
CREATE POLICY "Service role full access" ON client_template.contacts
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.contact_identities
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.sessions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.messages
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.knowledge_base
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.followup_queue
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON client_template.audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION client_template.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON client_template.contacts
  FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON client_template.sessions
  FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();

CREATE TRIGGER knowledge_base_updated_at
  BEFORE UPDATE ON client_template.knowledge_base
  FOR EACH ROW EXECUTE FUNCTION client_template.update_updated_at();
