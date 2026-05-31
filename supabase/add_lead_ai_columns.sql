-- Add AI-generated columns to outreach_leads
alter table outreach_leads
  add column if not exists opener_text text,
  add column if not exists qualifier text,         -- hot / warm / cold
  add column if not exists followers text,
  add column if not exists source text default 'screenshot',
  add column if not exists disqualify_reason text; -- populated if Claude flags as competitor/low followers/etc

-- Allow anon insert (for n8n webhook writing via publishable key)
grant insert on public.outreach_leads to anon;

-- RLS: allow anon insert
create policy if not exists "anon insert leads" on outreach_leads
  for insert to anon with check (true);
