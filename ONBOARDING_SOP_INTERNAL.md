# InboundOS — Client Onboarding SOP (Internal)

**For:** Micko only  
**Version:** 1.0

---

## Overview

This is what Micko does every time a new client is onboarded. Client follows their own guide (Installation Guide). This covers your side.

Total time: ~20 minutes once client sends their Supabase keys.

---

## What Client Does First

Send them the **Client Installation Guide**. They handle:
- Creating their Supabase project
- Running `setup.sql` and `provision.sql`
- Setting up n8n and importing the workflow
- Connecting credentials (Supabase, Claude, Instagram)

They send you back:
- Supabase Project URL
- Anon key
- Service role key

Don't start your steps until you have all three.

---

## Your Checklist (Do In Order)

### Step 1 — Add Client via Admin Page

Go to: `inboundos.vercel.app/admin/add-client`  
Password: (your admin password)

Fill in:
- First name, last name, agency name
- Username — lowercase, dashes only (e.g. `john-smith`)
- Password — set something strong, you'll send this to them
- Their Supabase URL, anon key, service role key

Hit **Add Client**.

This automatically:
- Creates their login in your master database
- Creates their `client_config` record in their own Supabase
- Links their Supabase keys to their account so the dashboard loads their data

---

### Step 2 — Fill In Their Business Profile

Go to **their Supabase** → SQL Editor and run:

```sql
UPDATE client_config SET
  niche = 'their niche',
  icp_title = 'their ideal client title',
  icp_pain = 'their ICP pain point',
  icp_result = 'result you deliver',
  icp_revenue = 'ICP revenue range',
  voice_tone = 'their tone',
  voice_words = 'power words',
  voice_avoid = 'words to avoid',
  voice_pillars = 'content pillars',
  post_frequency = 'daily',
  platform = 'instagram'
WHERE client_id = 'their_client_id';
```

You'll have this info from their onboarding form.

---

### Step 3 — Send Client Their Login

Message them:

> Your InboundOS dashboard is ready.
> 
> Login: inboundos.vercel.app/login  
> Username: `their-username`  
> Password: `their-password`

---

### Step 4 — Verify It Works

1. Log in as them (use their credentials)
2. Open browser console → run:
```js
JSON.parse(localStorage.getItem('sb_session'))
```
3. Confirm `client_supabase_url`, `client_supabase_anon`, `client_supabase_service` are all populated with their values (not null)
4. Check that the dashboard loads without errors

---

### Step 5 — Help Them Activate n8n

Once their dashboard is confirmed working:

1. Jump on a quick call or send a Loom
2. Walk them through clicking **Active** on their n8n workflow
3. Confirm first scheduled post fires correctly

---

## Notes

- **Each client has their own Supabase.** Your master Supabase only stores login info + Supabase keys. Their actual data (leads, content, agent logs) lives in their own DB.
- **Dashboard is on your Vercel.** Clients don't deploy anything. They just log in at your URL.
- **Instagram tokens expire every 60 days.** Remind clients to refresh. Add a calendar reminder when you onboard them.
- **n8n workflow file** — always send the latest `n8n-ig-scheduler.json` from the repo, not an old copy.

---

## If Something Breaks

| Problem | Fix |
|---------|-----|
| Dashboard loads but shows no data | Their Supabase keys weren't saved correctly — redo Step 1 |
| Login fails after adding client | Check `clients` table in your master Supabase — confirm row exists with correct username |
| `client_config` insert failed (shown in admin form) | Their Supabase didn't have `provision.sql` run — ask them to re-run it |
| n8n workflow errors on first run | Missing credential — walk them through Step 5 of client guide |
