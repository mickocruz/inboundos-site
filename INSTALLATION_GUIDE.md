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

| Tool | What It Does | Cost |
|------|-------------|------|
| **Claude (Anthropic)** | The AI that writes your content | $20/mo |
| **n8n** | Runs your automations in the background | $20/mo (cloud) or ~$6/mo (self-hosted — see Step 3) |
| **Supabase** | Stores your data | Free |

**Lowest possible monthly cost:** ~$26/mo if you self-host n8n on a cheap server  
**Cloud option (easier):** ~$40/mo

> Note: Claude's AI automation features use a separate "API" that's billed by usage — not the same as the $20/mo chat app. Micko will walk you through getting your API key. Typical usage costs $3–15/mo on top of your subscription.

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
6. Micko will send you two SQL files: `setup.sql` and `provision.sql`
7. Open `setup.sql`, copy all the text, paste it into the SQL Editor, click **Run**
8. Do the same with `provision.sql`
9. Go to **Project Settings → API** (left sidebar)
10. Copy and save these three things — you'll need them later:
    - **Project URL** (looks like `https://xxxxxx.supabase.co`)
    - **anon public** key (long string starting with `eyJ...`)
    - **service_role** key (another long string — keep this private, never share it publicly)

---

## Step 2 — Add Yourself as a Client

Now you need to create your login inside the database.

1. In Supabase, go to **SQL Editor**
2. Paste this and fill in your details:

```sql
INSERT INTO clients (username, password_hash, client_id, client_slug)
VALUES (
  'your-name',
  crypt('choose-a-password', gen_salt('bf')),
  'your_name',
  'your-name'
);

INSERT INTO client_config (client_id, first_name, last_name, agency_name, niche)
VALUES (
  'your_name',
  'Your First Name',
  'Your Last Name',
  'Your Agency Name',
  'What you do (e.g. social media for coaches)'
);
```

3. Click **Run**

You can fill in the rest of your profile (ideal client, brand voice, content settings) through the dashboard after you're logged in.

---

## Step 3 — Set Up n8n (Your Automation Engine)

n8n is the tool that makes everything run automatically. Think of it as the engine under the hood. You have two options:

### Option A — n8n Cloud (Easier, $20/mo)

1. Go to **n8n.io** → sign up → choose the **Starter** plan
2. Your account URL will look like `https://yourname.app.n8n.cloud`
3. Done — move to Step 4

### Option B — Self-Host (Cheaper, ~$6/mo)

This runs n8n on a small rented server. Good if you want to keep costs down.

1. Rent a server from DigitalOcean, Hetzner, or Vultr (~$6/mo)
2. Once you have access to the server, run these commands one at a time:

```bash
# Install Docker (the software that runs n8n)
curl -fsSL https://get.docker.com | sh

# Start n8n
docker run -d \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  --restart unless-stopped \
  n8nio/n8n
```

3. Open a browser and go to `http://your-server-ip:5678`
4. Create your n8n account on the first screen

If you're not comfortable with servers, use Option A. The $14/mo difference is worth the time saved.

---

## Step 4 — Import the Automation Workflow

1. In n8n, click **Workflows** in the left sidebar
2. Click **+** → **Import from File**
3. Upload the file Micko sends you: `n8n-ig-scheduler.json`
4. The workflow will appear — **do not turn it on yet**

---

## Step 5 — Connect Your Accounts

This is where you link everything together. Each connection is called a "credential" in n8n.

### Connect Supabase (your database)

In each workflow node that talks to Supabase, add these headers using your keys from Step 1:
- **Header:** `apikey` → **Value:** your service_role key
- **Header:** `Authorization` → **Value:** `Bearer ` followed by your service_role key

### Connect Claude (AI)

1. Go to **console.anthropic.com** → sign up or log in
2. Click **API Keys** → **Create Key** → copy it
3. In n8n: **Credentials → New → Header Auth**
   - Name: `Anthropic`
   - Header: `x-api-key`
   - Value: your API key

### Connect Instagram

1. Go to **developers.facebook.com** → create an App → add the **Instagram Graph API** product
2. Follow the steps to get a **long-lived access token** for your Instagram Business account
3. Add that token to n8n as a Header Auth credential

> Instagram tokens expire every 60 days. You'll need to refresh it when it does. Micko can help automate this.

---

## Step 6 — Fill In Your Business Profile

Go to Supabase SQL Editor and fill in your full profile:

```sql
UPDATE client_config SET
  icp_title = 'Who is your ideal client? (e.g. Marketing Directors at SaaS companies)',
  icp_pain = 'What problem do they have?',
  icp_result = 'What result do you give them?',
  icp_revenue = 'What is their typical revenue? (e.g. $10k–$50k/mo)',
  voice_tone = 'How do you sound? (e.g. Direct, confident, no fluff)',
  voice_words = 'Words you use a lot (e.g. systems, leverage, install)',
  voice_avoid = 'Words you hate (e.g. guru, hustle, grind)',
  voice_pillars = 'Your content pillars (e.g. Authority, Results, Process)',
  post_frequency = 'daily',
  platform = 'instagram'
WHERE client_id = 'your_name';
```

Replace each value with your actual answers, then click **Run**.

---

## Step 7 — Test Everything

1. Open the workflow in n8n
2. Click **Test Workflow** (the play button at the top)
3. Watch each step — green checkmark = good, red = something's wrong
4. If you see a red error, click it to read the message — usually a missing or wrong credential
5. Check Instagram after the test to confirm a post was created

---

## Step 8 — Turn It On

Once all steps show green:

1. Click the **Active** toggle in the top-right corner of the workflow
2. It's now live — runs automatically on your chosen schedule

---

## Step 9 — Send Micko Your Supabase Details

Your dashboard is hosted by Micko (you don't need to build or deploy anything). It reads from *your* private Supabase database — your data never mixes with other clients.

Send Micko these three things from Step 1:
- Your **Supabase Project URL**
- Your **anon key**
- Your **service_role key**

Micko will add your account and send you a login URL + credentials to access your dashboard.

---

## Troubleshooting

| Problem | What to Do |
|---------|-----------|
| n8n step shows a red error | Click it → read the message → usually a wrong or missing credential |
| Supabase returns "401 Unauthorized" | You used the wrong key — use the **service_role** key, not the anon key |
| Instagram post fails | Your token expired (they last 60 days) — get a new one |
| Claude returns "401" | API key is wrong or has no credits — check console.anthropic.com |
| Dashboard login doesn't work | Client record not created — redo Step 2 |

---

## Monthly Cost Summary

| Setup | Monthly Cost |
|-------|-------------|
| n8n Cloud + Claude API | ~$40–55/mo |
| Self-hosted n8n + Claude API | ~$20–30/mo |

*Claude API varies by volume. One post/day = ~$3–8/mo. More output = up to $25/mo.*

---

## Support

Installation support is included in your onboarding. Reach out to Micko directly with any questions.
