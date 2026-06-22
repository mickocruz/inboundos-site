-- Pipeline automation tables for GHL-style auto-sequences
-- =============================================================
-- RLS DESIGN NOTE — agent_signals
-- ---------------------------------------------------------------
-- anon role: read + insert only.
--   Read: dashboard visibility (anyone with anon key can see signals)
--   Insert: agents emit events via anon key
-- UPDATE is intentionally DENIED for anon.
--   Reason: status field (pending/processing/done/failed) must only
--   be set by backend workers running with service_role.
--   Allowing anon update would let any client with the publishable
--   key mark signals done/failed, corrupting agent-to-agent comms.
-- service_role bypasses RLS entirely — no explicit policy needed.
-- =============================================================

-- Add conversation thread + last_dm_checked to outreach_leads
alter table outreach_leads
  add column if not exists conversation_thread jsonb default '[]',
  add column if not exists last_dm_checked_at timestamptz,
  add column if not exists ig_user_id text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists updated_at timestamptz default now();

-- Trigger: update updated_at on any row change
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists outreach_leads_updated_at on outreach_leads;
create trigger outreach_leads_updated_at
  before update on outreach_leads
  for each row execute function update_updated_at();

-- agent_signals: inter-agent event bus
create table if not exists agent_signals (
  id uuid default gen_random_uuid() primary key,
  from_agent text not null,
  to_agent text not null,
  signal_type text not null,  -- 'wake','handoff','stage_change','alert'
  payload jsonb default '{}',
  status text default 'pending', -- 'pending','processing','done','failed'
  created_at timestamptz default now(),
  processed_at timestamptz
);

-- agent_comms: live group chat log between agents
create table if not exists agent_comms (
  id uuid default gen_random_uuid() primary key,
  from_agent text not null,
  to_agent text,              -- null = broadcast
  message text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table agent_signals enable row level security;
-- anon can read signals (dashboard visibility)
create policy if not exists "anon read signals" on agent_signals for select to anon using (true);
-- anon can insert new signals (agents emit events)
create policy if not exists "anon insert signals" on agent_signals for insert to anon with check (true);
-- ONLY service_role can update status (prevents clients marking signals done)
-- No update policy for anon = denied by RLS default

alter table agent_comms enable row level security;
create policy if not exists "anon read comms" on agent_comms for select to anon using (true);
create policy if not exists "anon insert comms" on agent_comms for insert to anon with check (true);
