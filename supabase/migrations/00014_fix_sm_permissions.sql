
-- Migration: 00014_fix_sm_permissions
-- Description: Fix permissions for state_machines table
-- Date: 2024-12-05

-- Grant full access to service_role (Edge Functions) and postgres (Dashboard)
GRANT ALL ON TABLE client_template.state_machines TO service_role;
GRANT ALL ON TABLE client_template.state_machines TO postgres;

GRANT ALL ON TABLE client_tag_markets.state_machines TO service_role;
GRANT ALL ON TABLE client_tag_markets.state_machines TO postgres;

-- Grant access to authenticated/anon users (for WebApp)
GRANT ALL ON TABLE client_template.state_machines TO authenticated;
GRANT ALL ON TABLE client_template.state_machines TO anon;

GRANT ALL ON TABLE client_tag_markets.state_machines TO authenticated;
GRANT ALL ON TABLE client_tag_markets.state_machines TO anon;

-- Add RLS policies for authenticated/anon users (allow read/write for now - internal tool)
CREATE POLICY "Public full access" ON client_template.state_machines
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON client_template.state_machines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Public full access" ON client_tag_markets.state_machines
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON client_tag_markets.state_machines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
