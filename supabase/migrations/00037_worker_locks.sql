-- Worker locks table for single-instance guard on background workers
-- Prevents multiple parallel self-invocation chains from running simultaneously

CREATE TABLE IF NOT EXISTS public.worker_locks (
  id TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Allow service_role full access (Edge Functions use service_role)
ALTER TABLE public.worker_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.worker_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.worker_locks IS 'Distributed lock table for Edge Function workers. Locks auto-expire via TTL to handle crashes.';
