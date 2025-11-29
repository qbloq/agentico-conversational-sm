-- Migration: 00001_extensions
-- Description: Enable required PostgreSQL extensions
-- Date: 2024-11-28

-- Vector similarity search for RAG
CREATE EXTENSION IF NOT EXISTS vector;

-- Scheduled jobs for follow-ups
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
