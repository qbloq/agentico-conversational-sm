-- Add reply_to_message_id to messages table in client_template (migration template)
ALTER TABLE client_template.messages 
ADD COLUMN reply_to_message_id UUID REFERENCES client_template.messages(id);

-- Apply to existing client_tag_markets schema
ALTER TABLE client_tag_markets.messages 
ADD COLUMN reply_to_message_id UUID REFERENCES client_tag_markets.messages(id);
