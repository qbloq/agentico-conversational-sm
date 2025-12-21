-- Migration: 00021_fix_all_schema_permissions
-- Description: Grant usage and table permissions on client schemas to API roles
-- Date: 2024-12-20

-- =============================================================================
-- CLIENT_TAG_MARKETS SCHEMA
-- =============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA client_tag_markets TO anon, authenticated, service_role;

-- Grant all privileges to service_role (Edge Functions)
GRANT ALL ON ALL TABLES IN SCHEMA client_tag_markets TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA client_tag_markets TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA client_tag_markets TO service_role;

-- Grant basic access to authenticated/anon (Realtime and WebApp)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA client_tag_markets TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA client_tag_markets TO anon, authenticated;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;

-- =============================================================================
-- CLIENT_TEMPLATE SCHEMA
-- =============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA client_template TO anon, authenticated, service_role;

-- Grant all privileges to service_role (Edge Functions)
GRANT ALL ON ALL TABLES IN SCHEMA client_template TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA client_template TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA client_template TO service_role;

-- Grant basic access to authenticated/anon (Realtime and WebApp)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA client_template TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA client_template TO anon, authenticated;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA client_template GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_template GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_template GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_template GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
