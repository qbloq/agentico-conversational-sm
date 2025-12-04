-- Migration: 00010_update_conversation_states
-- Description: Add new states to conversation_state enum for Refactor
-- Date: 2024-12-02

-- We need to add values to the enum. 
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block usually, 
-- but Supabase migrations might handle this. If it fails, we might need to recreate the type.
-- However, for local dev, we can try adding them.

-- Update client_tag_markets schema
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'pitching_12x';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'pitching_copy_trading';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'pitching_academy';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'returning_customer';
ALTER TYPE client_tag_markets.conversation_state ADD VALUE IF NOT EXISTS 'support_general';

-- Update client_template schema (for future clients)
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'pitching_12x';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'pitching_copy_trading';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'pitching_academy';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'returning_customer';
ALTER TYPE client_template.conversation_state ADD VALUE IF NOT EXISTS 'support_general';
