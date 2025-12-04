-- Migration: 00011_add_registration_tracking
-- Description: Add registration tracking columns to sessions table
-- Date: 2025-12-03

-- =============================================================================
-- Add registration tracking columns to client_template schema
-- =============================================================================

ALTER TABLE client_template.sessions
  ADD COLUMN IF NOT EXISTS registration_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_ip TEXT,
  ADD COLUMN IF NOT EXISTS registration_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS registration_screen_resolution TEXT,
  ADD COLUMN IF NOT EXISTS registration_status TEXT CHECK (registration_status IN ('pending', 'link_clicked', 'registered'));

-- =============================================================================
-- Add registration tracking columns to client_tag_markets schema
-- =============================================================================

ALTER TABLE client_tag_markets.sessions
  ADD COLUMN IF NOT EXISTS registration_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_ip TEXT,
  ADD COLUMN IF NOT EXISTS registration_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS registration_screen_resolution TEXT,
  ADD COLUMN IF NOT EXISTS registration_status TEXT CHECK (registration_status IN ('pending', 'link_clicked', 'registered'));

-- =============================================================================
-- Add index for registration status queries
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_sessions_registration_status 
  ON client_template.sessions(registration_status) 
  WHERE registration_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_registration_status 
  ON client_tag_markets.sessions(registration_status) 
  WHERE registration_status IS NOT NULL;
