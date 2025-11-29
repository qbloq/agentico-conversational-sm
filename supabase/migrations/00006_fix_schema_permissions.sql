-- Migration: 00006_fix_schema_permissions
-- Description: Grant usage on client schema to API roles
-- Date: 2024-11-28

-- Grant usage on schema to standard Supabase roles
GRANT USAGE ON SCHEMA client_tag_markets TO anon, authenticated, service_role;

-- Grant all privileges to service_role (admin)
GRANT ALL ON ALL TABLES IN SCHEMA client_tag_markets TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA client_tag_markets TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA client_tag_markets TO service_role;

-- Grant basic access to authenticated/anon (if needed for client access later)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA client_tag_markets TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA client_tag_markets TO anon, authenticated;
