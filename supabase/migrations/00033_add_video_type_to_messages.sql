-- Add 'video' to messages type check constraint
-- This allows video messages to be saved to the database

-- Update client_tag_markets schema
ALTER TABLE client_tag_markets.messages 
DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE client_tag_markets.messages 
ADD CONSTRAINT messages_type_check 
CHECK (type = ANY (ARRAY['text'::text, 'image'::text, 'audio'::text, 'video'::text, 'template'::text, 'interactive'::text]));

-- Update client_template schema
ALTER TABLE client_template.messages 
DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE client_template.messages 
ADD CONSTRAINT messages_type_check 
CHECK (type = ANY (ARRAY['text'::text, 'image'::text, 'audio'::text, 'video'::text, 'template'::text, 'interactive'::text]));
