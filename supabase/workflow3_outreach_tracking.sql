-- Workflow 3: DM → Soft Qual → Form → Booking tracking
-- Run in Supabase SQL editor

-- Add pipeline_stage columns to outreach_leads if not present
alter table outreach_leads
  add column if not exists stage int default 0,
  add column if not exists stage_updated_at timestamptz default now(),
  add column if not exists dm_sent_at timestamptz,
  add column if not exists dm_replied_at timestamptz,
  add column if not exists form_sent_at timestamptz,
  add column if not exists form_filled_at timestamptz,
  add column if not exists call_booked_at timestamptz,
  add column if not exists call_outcome text,        -- showed / no_show / closed / lost
  add column if not exists notes text,
  add column if not exists ig_handle text,
  add column if not exists created_at timestamptz default now();

-- Stage legend:
-- 0 = identified (Hunter found them, not contacted yet)
-- 1 = DM sent
-- 2 = DM replied
-- 3 = form sent
-- 4 = form filled
-- 5 = call booked
-- 6 = call completed
-- 7 = closed (paid)
-- 8 = lost

-- Allow anon read (dashboard CRM reads this)
create policy if not exists "anon read leads" on outreach_leads
  for select to anon using (true);

-- Allow anon update (n8n updates stage via anon key)
create policy if not exists "anon update leads" on outreach_leads
  for update to anon using (true);

-- applications table (from apply.html form)
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  name text,
  instagram text,
  business text,
  revenue text,
  blocker text,
  other_blocker text,
  duration text,
  investment text,
  why_now text,
  email text,
  source text default 'direct',
  status text default 'new',            -- new / reviewed / qualified / disqualified
  forge_triggered_at timestamptz,
  created_at timestamptz default now()
);

-- Allow anon insert (from public apply.html form)
alter table applications enable row level security;
create policy if not exists "anon insert applications" on applications
  for insert to anon with check (true);

-- Allow anon update (Forge webhook marks forge_triggered_at)
create policy if not exists "anon update applications" on applications
  for update to anon using (true);

-- Allow anon read (dashboard reads new applications)
create policy if not exists "anon read applications" on applications
  for select to anon using (true);
