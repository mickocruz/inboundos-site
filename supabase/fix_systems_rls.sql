-- SECURITY FIX — enable RLS on public.systems
--
-- Problem: table `public.systems` has a policy `anon_read_systems`
-- (SELECT for anon, USING true) but Row Level Security was NOT enabled
-- on the table. With RLS off, the policy is ignored and the table is
-- fully open through the API — anyone with the public anon key could
-- read AND write/delete the 6 rows.
--
-- Fix: turn RLS on so the existing read-only policy actually applies.
-- After this, anon can still READ systems (dashboard keeps working) but
-- can no longer write or delete through PostgREST. Matches every other
-- table's posture.
--
-- Apply via: Supabase SQL Editor, or `supabase db push`.

alter table public.systems enable row level security;
