-- Run this in Supabase SQL Editor after setup.sql

-- Hash password helper (complement to verify_password)
create or replace function hash_password(input_password text)
returns text language sql security definer as $$
  select crypt(input_password, gen_salt('bf'));
$$;

-- Client config table — one row per client, stores ICP + voice + keys
create table if not exists client_config (
  id uuid primary key default gen_random_uuid(),
  client_id text unique not null,
  first_name text,
  last_name text,
  agency_name text,
  niche text,
  -- ICP
  icp_title text,
  icp_pain text,
  icp_result text,
  icp_revenue text,
  -- Voice
  voice_tone text,
  voice_words text,
  voice_avoid text,
  voice_pillars text,
  -- System
  anthropic_key_enc text,  -- store in Supabase Vault in prod
  n8n_webhook text,
  post_frequency text,
  platform text,
  -- Meta
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lock down — only service role reads this
alter table client_config enable row level security;
create policy "no public access" on client_config for all using (false);

-- Auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger client_config_updated_at
  before update on client_config
  for each row execute function set_updated_at();
