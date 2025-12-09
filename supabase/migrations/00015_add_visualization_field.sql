-- Migration: 00015_add_visualization_field
-- Description: Add visualization column to state_machines table
-- Date: 2025-12-06

ALTER TABLE client_template.state_machines
ADD COLUMN IF NOT EXISTS visualization JSONB DEFAULT '{}'::jsonb;

ALTER TABLE client_tag_markets.state_machines
ADD COLUMN IF NOT EXISTS visualization JSONB DEFAULT '{}'::jsonb;
