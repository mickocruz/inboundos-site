# InboundOS — Client Installation Guide

**Version:** 2.0  
**Prepared by:** Micko (InboundOS)

---

## What This Is

InboundOS is an AI-powered content and lead system installed inside your business. Once it's set up, it runs on autopilot — writing content, tracking leads, and logging activity without you having to manage it manually.

This guide walks you through getting everything set up from scratch. You don't need to be technical. Just follow each step in order.

**How long it takes:** 2–4 hours total (most of that is waiting for accounts to verify or approve)

---

## What You'll Need (and What It Costs)

### Paid Tools

| Tool           | What It Does                            | Cost                                              |
| -------------- | --------------------------------------- | ------------------------------------------------- |
| **Claude Pro** | The AI that writes your content         | $20/mo                                            |
| **n8n**        | Runs your automations in the background | $20/mo (cloud) or free (self-hosted — see Step 3) |
| **Supabase**   | Stores your data                        | Free                                              |

**Cheapest option:** ~$20/mo — self-hosted n8n + Claude Pro only (no API billing)  
**Cloud option:** ~$40/mo — n8n Cloud + Claude Pro only  
**Full cloud + API:** ~$55/mo — n8n Cloud + Claude Pro + Claude API usage

> Claude has two modes: **Pro subscription** ($20/mo flat) and **API** (pay per use). You can run InboundOS on Pro alone using the `claude -p` flag — no API account needed. Micko will set this up based on your n8n setup. See Step 5 for details.

### Free Accounts

- Instagram Business account (connected to a Facebook page)
- Meta Developer account (for Instagram API — Micko will help with this)

---

## Step 1 — Create Your Supabase Database

Supabase is where all your data lives — your leads, content, agent activity, and settings. Each client gets their own private database. Your data never mixes with anyone else's.

1. Go to **supabase.com** and create a free account
2. Click **New Project**
3. Give it a name (e.g. `my-inboundos`) and set a strong password — save this somewhere safe
4. Wait about 2 minutes for it to finish setting up
5. On the left sidebar, click **SQL Editor**
6. Paste the first block below → click **Run**:

```sql
-- Enable pgcrypto for password hashing
create extension if not exists pgcrypto;

-- Clients table
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  client_id text not null,
  client_slug text not null,
  client_supabase_url text,
  client_supabase_anon text,
  client_supabase_service text,
  created_at timestamptz default now()
);

-- Password verify function
create or replace function verify_password(input_password text, stored_hash text)
returns boolean language sql security definer as $$
  select stored_hash = crypt(input_password, stored_hash);
$$;

-- Lock down table
alter table clients enable row level security;
create policy "no public access" on clients for all using (false);
```

7. Once that finishes, paste the second block → click **Run**:

```sql
-- Hash password helper
create or replace function hash_password(input_password text)
returns text language sql security definer as $$
  select crypt(input_password, gen_salt('bf'));
$$;

-- Client config table
create table if not exists client_config (
  id uuid primary key default gen_random_uuid(),
  client_id text unique not null,
  first_name text,
  last_name text,
  agency_name text,
  niche text,
  icp_title text,
  icp_pain text,
  icp_result text,
  icp_revenue text,
  voice_tone text,
  voice_words text,
  voice_avoid text,
  voice_pillars text,
  anthropic_key_enc text,
  n8n_webhook text,
  post_frequency text,
  platform text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lock down
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
```
9. Go to **Project Settings → API** (left sidebar)
10. Copy and save these three things — you'll need them later:
    - **Project URL** (looks like `https://xxxxxx.supabase.co`)
    - **anon public** key (long string starting with `eyJ...`)
    - **service_role** key (another long string — keep this private, never share it publicly)

---

## Step 2 — Share Your Supabase Keys With Micko

Once both SQL blocks have run, go to **Project Settings → API** and copy these three things:

- **Project URL** (looks like `https://xxxxxx.supabase.co`)
- **anon public** key (long string starting with `eyJ...`)
- **service_role** key (another long string)

Send all three to Micko directly (DM is fine).

> **Why does Micko need these?**  
> Your data lives entirely in *your* Supabase — Micko doesn't store it or have access to your business information. These keys are only used so your dashboard knows where to pull *your* data from when you log in. Think of it like giving someone the address to your house so they can connect your front door to the right key — they're not moving in. You can revoke or rotate these keys in Supabase at any time.

Once Micko has them, he'll set up your account and send you your login credentials. Nothing else needed on your end for now.

---

## Step 3 — Set Up n8n (Your Automation Engine)

n8n is the tool that makes everything run automatically. Think of it as the engine under the hood — it's what triggers your agents, posts your content, and logs everything on a schedule.

You have three options. Pick the one that fits your situation:

---

### Option A — n8n Cloud ($20/mo) — Best for most people

**Why choose this:** Easiest setup. No servers, no terminal. Just sign up and it's running in minutes. Worth the $20/mo if you want zero technical headaches.

1. Go to **n8n.io** → sign up → choose the **Starter** plan
2. Your n8n URL will look like `https://yourname.app.n8n.cloud`
3. Done — move to Step 4

> ⚠️ If you use Option A, you'll need **Claude API** (Option A in Step 5) — Claude Pro's `claude -p` flag only works on your own machine, not a cloud server.

---

### Option B — Self-Host on a VPS (~$6/mo) — Best for low cost

**Why choose this:** Cheapest option. You rent a small server (~$6/mo) and run n8n on it yourself. Also lets you use Claude Pro instead of the API, saving another $3–15/mo. Slight technical setup but Micko can walk you through it.

1. Rent a server from DigitalOcean, Hetzner, or Vultr (~$6/mo) — smallest plan is fine
2. SSH into your server and run these commands:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Run n8n
docker run -d \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  --restart unless-stopped \
  n8nio/n8n
```

3. Open `http://your-server-ip:5678` in your browser
4. Create your n8n account on first login

---

### Option C — Self-Host on Your Own Computer (Free) — Best if you're always online

**Why choose this:** Completely free. Runs n8n on your Mac or PC. No server rental needed. Downside: your computer needs to be on and connected for automations to fire. If it's off at 7am, the workflow won't run. Good if you have a machine that's always on (like a home server or a desktop you never turn off).

1. Make sure you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
2. Open Terminal and run:

```bash
docker run -d \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  --restart unless-stopped \
  n8nio/n8n
```

3. Open `http://localhost:5678` in your browser
4. Create your n8n account on first login

> ⚠️ If your computer is off or sleeping, scheduled workflows won't run. For reliable daily posting, use Option A or B.

---

**Not sure which to pick?**

| I want… | Pick |
|---------|------|
| Easiest setup, don't mind paying | **Option A** |
| Lowest monthly cost, okay with minor setup | **Option B** |
| Free, have a computer that's always on | **Option C** |

---

## Step 4 — Import Your Workflows

Micko will send you a folder of workflow files — one file per agent, already configured with your business info. No editing needed.

For each file:

1. In n8n, click **Workflows** in the left sidebar
2. Click **+** → **Import from File**
3. Upload the workflow file
4. It will appear on screen — **do not turn it on yet**

Repeat for all files in the folder. The only things you'll add yourself are your private API keys (covered in Step 5).

---

## Step 5 — Connect Your Accounts

This is where you link everything together. Each connection is called a "credential" in n8n.

### Connect Supabase (your database)

In each workflow node that talks to Supabase, add these headers using your keys from Step 1:
- **Header:** `apikey` → **Value:** your service_role key
- **Header:** `Authorization` → **Value:** `Bearer ` followed by your service_role key

### Connect Claude (AI) — Pick One Option

**Option A — Claude API (pay per use, ~$3–15/mo extra)**

Best if you want everything fully automated with no manual steps.

1. Go to **console.anthropic.com** → sign up or log in
2. Click **API Keys** → **Create Key** → copy it
3. In n8n: **Credentials → New → Header Auth**
   - Name: `Anthropic`
   - Header: `x-api-key`
   - Value: your API key

---

**Option B — Claude Pro subscription only ($20/mo, no API billing)**

Best if you already pay for Claude Pro and don't want a separate API bill. Uses the `claude -p` flag to pipe content through Claude directly from your terminal or n8n.

1. You already have Claude Pro — nothing extra to sign up for
2. In your n8n workflow, the Claude nodes will run commands using:
   ```
   claude -p "your prompt here"
   ```
   instead of calling the API directly
3. No API key needed — Claude Pro handles it

> Note: Option B requires Claude to be installed on the same machine running n8n. If you're using n8n Cloud (not self-hosted), use Option A instead. If you self-hosted n8n on your own server, Option B works fine — just install Claude CLI on that server.

**Not sure which to pick?**
- Self-hosted n8n on your own computer or server → **Option B**
- n8n Cloud → **Option A**

### Connect Instagram

1. Go to **developers.facebook.com** → create an App → add the **Instagram Graph API** product
2. Follow the steps to get a **long-lived access token** for your Instagram Business account
3. Add that token to n8n as a Header Auth credential

> Instagram tokens expire every 60 days. You'll need to refresh it when it does. Micko can help automate this.

---

## Step 6 — Test Everything

1. Open the workflow in n8n
2. Click **Test Workflow** (the play button at the top)
3. Watch each step — green checkmark = good, red = something's wrong
4. If you see a red error, click it to read the message — usually a missing or wrong credential
5. Check Instagram after the test to confirm a post was created

---

## Step 7 — Turn It On

Once all steps show green:

1. Click the **Active** toggle in the top-right corner of the workflow
2. It's now live — runs automatically on your chosen schedule

---

## Step 8 — Log Into Your Dashboard

By now Micko has set up your account. You'll have received:
- Dashboard URL: **inboundos.vercel.app/login**
- Your username
- Your password

Log in and confirm everything loads. Your data is in your own private Supabase — nothing shared with other clients.

---

## Troubleshooting

| Problem | What to Do |
|---------|-----------|
| n8n step shows a red error | Click it → read the message → usually a wrong or missing credential |
| Supabase returns "401 Unauthorized" | You used the wrong key — use the **service_role** key, not the anon key |
| Instagram post fails | Your token expired (they last 60 days) — get a new one |
| Claude returns "401" | API key is wrong or has no credits — check console.anthropic.com |
| Dashboard login doesn't work | Contact Micko — account may not be set up yet |

---

## Monthly Cost Summary

| Setup | Monthly Cost |
|-------|-------------|
| Your own computer (Option C) + Claude Pro only | **~$20/mo** |
| VPS server (Option B) + Claude Pro only | ~$26/mo |
| n8n Cloud (Option A) + Claude Pro + API | ~$45–55/mo |

*Claude API is optional. Options B and C can use Claude Pro's `claude -p` flag instead — no API billing needed.*

---

## Support

Installation support is included in your onboarding. Reach out to Micko directly with any questions.
