-- Migration: 00012_create_storage_buckets
-- Description: Create storage buckets for media uploads
-- Date: 2024-12-04

-- =============================================================================
-- STORAGE BUCKETS
-- =============================================================================

-- Create media bucket for TAG Markets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-tag-markets',
  'media-tag-markets',
  true,  -- Public bucket so URLs are accessible
  52428800,  -- 50MB limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/amr',
    'video/mp4',
    'video/3gpp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- STORAGE POLICIES
-- =============================================================================

-- Allow service role to upload files
CREATE POLICY "Service role can upload media"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'media-tag-markets');

-- Allow service role to read files
CREATE POLICY "Service role can read media"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'media-tag-markets');

-- Allow service role to update files
CREATE POLICY "Service role can update media"
ON storage.objects FOR UPDATE
TO service_role
USING (bucket_id = 'media-tag-markets');

-- Allow service role to delete files
CREATE POLICY "Service role can delete media"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'media-tag-markets');

-- Allow public read access (since bucket is public)
CREATE POLICY "Public can read media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media-tag-markets');
