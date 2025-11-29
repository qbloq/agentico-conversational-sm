-- Migration: 00007_dev_seed_channel_mapping
-- Description: Insert dev channel mapping for webhook testing
-- Date: 2024-11-28

INSERT INTO public.channel_mappings (client_id, channel_type, channel_id, schema_name, is_active)
VALUES ('tag_markets', 'whatsapp', '123456789', 'client_tag_markets', true)
ON CONFLICT (channel_type, channel_id) DO NOTHING;
