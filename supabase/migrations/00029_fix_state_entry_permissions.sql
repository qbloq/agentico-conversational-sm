-- Fix permissions for state_entry_messages table
-- The table was created by supabase_admin but service_role needs access

-- Grant schema usage to all roles that might need it
GRANT USAGE ON SCHEMA client_tag_markets TO postgres, service_role, authenticated, anon;

-- Grant ALL privileges to postgres (superuser)
GRANT ALL PRIVILEGES ON client_tag_markets.state_entry_messages TO postgres;

-- Grant SELECT to service_role (used by Edge Functions)
GRANT SELECT ON client_tag_markets.state_entry_messages TO service_role;

-- Grant SELECT to authenticated (for potential future use)
GRANT SELECT ON client_tag_markets.state_entry_messages TO authenticated;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA client_tag_markets GRANT SELECT ON TABLES TO service_role;
