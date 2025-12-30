-- Migration: 00022_unique_active_escalation
-- Description: Enforce a single active escalation per session
-- Date: 2024-12-30

-- For client_template
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_escalation_per_session 
ON client_template.escalations (session_id) 
WHERE status IN ('open', 'assigned', 'in_progress');

-- For client_tag_markets
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_escalation_per_session 
ON client_tag_markets.escalations (session_id) 
WHERE status IN ('open', 'assigned', 'in_progress');
