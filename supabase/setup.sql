-- 1. Enable pgcrypto for password hashing
create extension if not exists pgcrypto;

-- 2. Clients table
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  client_id text not null,   -- used in Supabase queries e.g. micko_cruz
  client_slug text not null, -- used in URL e.g. micko-cruz
  created_at timestamptz default now()
);

-- 3. Password verify function (called by Edge Function)
create or replace function verify_password(input_password text, stored_hash text)
returns boolean language sql security definer as $$
  select stored_hash = crypt(input_password, stored_hash);
$$;

-- 4. Insert Micko's account
-- Replace 'ringotwo764' with whatever password you want
insert into clients (username, password_hash, client_id, client_slug)
values (
  'micko-cruz',
  crypt('ringotwo764', gen_salt('bf')),
  'micko_cruz',
  'micko-cruz'
)
on conflict (username) do update
  set password_hash = excluded.password_hash,
      client_id = excluded.client_id,
      client_slug = excluded.client_slug;

-- 5. Lock down table — only service role can read (Edge Function uses service role)
alter table clients enable row level security;
create policy "no public access" on clients for all using (false);
