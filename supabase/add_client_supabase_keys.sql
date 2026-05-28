-- Run this in YOUR (Micko's) Supabase SQL editor
-- Adds per-client Supabase connection info to the clients table

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_supabase_url text,
  ADD COLUMN IF NOT EXISTS client_supabase_anon text,
  ADD COLUMN IF NOT EXISTS client_supabase_service text;
