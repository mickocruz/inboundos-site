-- ================================================================
-- InboundOS RLS Audit + Fix
-- Run this entire file in Supabase SQL Editor (one paste, one run)
-- agent_skills excluded (table does not exist)
-- ================================================================

-- ── STEP 1: ENABLE RLS ON ALL TABLES (safe to re-run) ──────────
ALTER TABLE IF EXISTS public.outreach_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_pillars   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.onboarding        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ctrl_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.error_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_activity    ENABLE ROW LEVEL SECURITY;


-- ── STEP 2: DROP OLD PERMISSIVE POLICIES (clean slate) ──────────
DROP POLICY IF EXISTS "Allow all outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Public read outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Allow authenticated" ON public.outreach_leads;
DROP POLICY IF EXISTS "Allow all clients" ON public.clients;
DROP POLICY IF EXISTS "Allow authenticated" ON public.clients;
DROP POLICY IF EXISTS "Allow all ctrl_users" ON public.ctrl_users;
DROP POLICY IF EXISTS "Allow authenticated" ON public.ctrl_users;
DROP POLICY IF EXISTS "Allow all client_config" ON public.client_config;
DROP POLICY IF EXISTS "Allow authenticated" ON public.client_config;
DROP POLICY IF EXISTS "Allow all error_log" ON public.error_log;
DROP POLICY IF EXISTS "Allow all agent_activity" ON public.agent_activity;


-- ── STEP 3: OUTREACH_LEADS ──────────────────────────────────────
DROP POLICY IF EXISTS "outreach_leads_anon_insert" ON public.outreach_leads;
DROP POLICY IF EXISTS "outreach_leads_auth_select" ON public.outreach_leads;
DROP POLICY IF EXISTS "outreach_leads_auth_update" ON public.outreach_leads;
DROP POLICY IF EXISTS "outreach_leads_auth_delete" ON public.outreach_leads;

CREATE POLICY "outreach_leads_anon_insert" ON public.outreach_leads
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "outreach_leads_auth_select" ON public.outreach_leads
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "outreach_leads_auth_update" ON public.outreach_leads
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "outreach_leads_auth_delete" ON public.outreach_leads
  FOR DELETE TO authenticated USING (true);


-- ── STEP 4: CLIENTS — service role only (no policies = no anon/auth access) ─


-- ── STEP 5: CLIENT_CONFIG ───────────────────────────────────────
DROP POLICY IF EXISTS "client_config_auth_select" ON public.client_config;
DROP POLICY IF EXISTS "client_config_auth_update" ON public.client_config;

CREATE POLICY "client_config_auth_select" ON public.client_config
  FOR SELECT TO authenticated
  USING (
    client_id = (
      SELECT client_id FROM public.ctrl_users
      WHERE email = (SELECT auth.email())
      LIMIT 1
    )
  );

CREATE POLICY "client_config_auth_update" ON public.client_config
  FOR UPDATE TO authenticated
  USING (
    client_id = (SELECT client_id FROM public.ctrl_users WHERE email = (SELECT auth.email()) LIMIT 1)
  )
  WITH CHECK (
    client_id = (SELECT client_id FROM public.ctrl_users WHERE email = (SELECT auth.email()) LIMIT 1)
  );


-- ── STEP 6: CTRL_USERS ──────────────────────────────────────────
DROP POLICY IF EXISTS "ctrl_users_auth_select" ON public.ctrl_users;

CREATE POLICY "ctrl_users_auth_select" ON public.ctrl_users
  FOR SELECT TO authenticated
  USING (email = (SELECT auth.email()));


-- ── STEP 7: ERROR_LOG + AGENT_ACTIVITY ─────────────────────────
DROP POLICY IF EXISTS "error_log_auth_insert" ON public.error_log;
DROP POLICY IF EXISTS "agent_activity_auth_insert" ON public.agent_activity;
DROP POLICY IF EXISTS "agent_activity_auth_select" ON public.agent_activity;

CREATE POLICY "error_log_auth_insert" ON public.error_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "agent_activity_auth_insert" ON public.agent_activity
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "agent_activity_auth_select" ON public.agent_activity
  FOR SELECT TO authenticated USING (true);


-- ── STEP 8: CLIENT_TASKS / AGENT_ITEMS / CONTENT_PILLARS / ONBOARDING ──
DROP POLICY IF EXISTS "client_tasks_auth_all" ON public.client_tasks;
DROP POLICY IF EXISTS "agent_items_auth_all" ON public.agent_items;
DROP POLICY IF EXISTS "content_pillars_auth_all" ON public.content_pillars;
DROP POLICY IF EXISTS "onboarding_auth_all" ON public.onboarding;

CREATE POLICY "client_tasks_auth_all" ON public.client_tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "agent_items_auth_all" ON public.agent_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "content_pillars_auth_all" ON public.content_pillars
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "onboarding_auth_all" ON public.onboarding
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── STEP 9: VERIFY ──────────────────────────────────────────────
SELECT
  t.tablename,
  t.rowsecurity AS rls_on,
  COUNT(p.policyname) AS policies
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'outreach_leads','clients','client_tasks','agent_items',
    'content_pillars','onboarding','client_config','ctrl_users',
    'error_log','agent_activity'
  )
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;
