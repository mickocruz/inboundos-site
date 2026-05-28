# InboundOS — Client Onboarding SOP (Internal)

**For:** Micko only  
**Version:** 2.0

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

### Step 1 — Run the Provisioner Script (Does Everything Automatically)

Once client sends you their 3 Supabase keys, run this one command from the repo:

```bash
cd /Users/mknevamiss/Claude/Projects/inboundos-site

python3 scripts/provision-client.py \
  --email their@email.com \
  --username john-smith \
  --password their-password \
  --sb-url https://xxxx.supabase.co \
  --sb-anon eyJ... \
  --sb-service eyJ...
```

This single command automatically:
- Pulls their answers from the onboarding form
- Creates their login in your master database
- Writes their full `client_config` (ICP, voice, niche, pillars) to their Supabase
- Generates a folder of pre-filled workflow JSON files at `client-workflows/john-smith/`

No SQL. No manual fill-in. Done in seconds.

---

### Step 2 — (Optional) Spot-Check Their Config

If you want to verify the auto-populated config looks right:

Go to **their Supabase** → Table Editor → `client_config` → find their row. Fields should be populated from their onboarding form. Edit anything that looks off.

---

### Step 3 — Send Client Their Login + Workflow Files

The script prints a summary at the end. Send client:

> Your InboundOS dashboard is ready.
> 
> Login: inboundos.vercel.app/login  
> Username: `their-username`  
> Password: `their-password`

Also zip and send them the folder: `client-workflows/john-smith/`

Tell them: *"Import each .json file into n8n. Then add your Claude API key and Instagram token — that's the only manual part left."*

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
