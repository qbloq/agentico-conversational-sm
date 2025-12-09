-- Migration: 00016_change_visualization_to_text
-- Description: Change visualization column from JSONB to TEXT to store Mermaid code directly
-- Date: 2025-12-06

-- For client_template
ALTER TABLE client_template.state_machines 
DROP COLUMN IF EXISTS visualization;

ALTER TABLE client_template.state_machines 
ADD COLUMN visualization TEXT;

-- For client_tag_markets
ALTER TABLE client_tag_markets.state_machines 
DROP COLUMN IF EXISTS visualization;

ALTER TABLE client_tag_markets.state_machines 
ADD COLUMN visualization TEXT;
