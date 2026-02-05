-- Migration: 00035_fix_contact_deletion_cascade
-- Description: Add ON DELETE CASCADE to foreign keys in deposit_events, audit_log, and escalations tables to allow contact deletion.

-- =============================================================================
-- CLIENT_TEMPLATE SCHEMA
-- =============================================================================

-- deposit_events
ALTER TABLE client_template.deposit_events 
  DROP CONSTRAINT IF EXISTS deposit_events_session_id_fkey,
  DROP CONSTRAINT IF EXISTS deposit_events_contact_id_fkey;

ALTER TABLE client_template.deposit_events
  ADD CONSTRAINT deposit_events_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_template.sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT deposit_events_contact_id_fkey 
    FOREIGN KEY (contact_id) REFERENCES client_template.contacts(id) ON DELETE CASCADE;

-- audit_log
ALTER TABLE client_template.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_session_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_log_contact_id_fkey;

ALTER TABLE client_template.audit_log
  ADD CONSTRAINT audit_log_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_template.sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT audit_log_contact_id_fkey 
    FOREIGN KEY (contact_id) REFERENCES client_template.contacts(id) ON DELETE CASCADE;

-- escalations
ALTER TABLE client_template.escalations
  DROP CONSTRAINT IF EXISTS escalations_session_id_fkey;

ALTER TABLE client_template.escalations
  ADD CONSTRAINT escalations_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_template.sessions(id) ON DELETE CASCADE;


-- =============================================================================
-- CLIENT_TAG_MARKETS SCHEMA
-- =============================================================================

-- deposit_events
ALTER TABLE client_tag_markets.deposit_events 
  DROP CONSTRAINT IF EXISTS deposit_events_session_id_fkey,
  DROP CONSTRAINT IF EXISTS deposit_events_contact_id_fkey;

ALTER TABLE client_tag_markets.deposit_events
  ADD CONSTRAINT deposit_events_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_tag_markets.sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT deposit_events_contact_id_fkey 
    FOREIGN KEY (contact_id) REFERENCES client_tag_markets.contacts(id) ON DELETE CASCADE;

-- audit_log
ALTER TABLE client_tag_markets.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_session_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_log_contact_id_fkey;

ALTER TABLE client_tag_markets.audit_log
  ADD CONSTRAINT audit_log_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_tag_markets.sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT audit_log_contact_id_fkey 
    FOREIGN KEY (contact_id) REFERENCES client_tag_markets.contacts(id) ON DELETE CASCADE;

-- escalations
ALTER TABLE client_tag_markets.escalations
  DROP CONSTRAINT IF EXISTS escalations_session_id_fkey;

ALTER TABLE client_tag_markets.escalations
  ADD CONSTRAINT escalations_session_id_fkey 
    FOREIGN KEY (session_id) REFERENCES client_tag_markets.sessions(id) ON DELETE CASCADE;
