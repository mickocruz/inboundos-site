# Settings Slide-Out Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings slide-out drawer that opens when any dashboard client clicks their name card at the bottom of the sidebar, showing profile, account, and preferences sections pulled from Supabase.

**Architecture:** A shared JS/CSS snippet handles the drawer — injected via a `<script src="../dashboard/settings-panel.js">` tag on all 9 dashboard pages. The drawer renders over the sidebar (slides in from left), reads client data from a `profiles` Supabase table using the existing anon key pattern, and writes preference changes back. All 9 dashboard HTML files get the same two-line addition (include + trigger on `.mk-avatar-wrap`).

**Tech Stack:** Vanilla JS, CSS transitions, Supabase REST API (anon key, browser-direct), existing NHGrotesk + DM Sans fonts, same dark glass design system as dashboard.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `dashboard/settings-panel.js` | Create | Drawer HTML injection, open/close logic, Supabase read/write |
| `dashboard/settings-panel.css` | Create | Drawer styles matching dark glass aesthetic |
| `dashboard/*.html` (all 9) | Modify | Add CSS link, JS script tag, click handler on `.mk-avatar-wrap` |

---

### Task 1: Create `settings-panel.css`

**Files:**
- Create: `dashboard/settings-panel.css`

- [ ] **Step 1: Create the CSS file**

```css
/* settings-panel.css */
#settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s ease;
}
#settings-overlay.open {
  opacity: 1;
  pointer-events: all;
}

#settings-drawer {
  position: fixed;
  top: 0;
  left: 0;
  width: 280px;
  height: 100vh;
  background: rgba(7,11,18,0.97);
  border-right: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(32px) saturate(160%);
  -webkit-backdrop-filter: blur(32px) saturate(160%);
  z-index: 201;
  display: flex;
  flex-direction: column;
  padding: 0;
  transform: translateX(-100%);
  transition: transform 0.26s cubic-bezier(0.4,0,0.2,1);
  box-shadow: 4px 0 32px rgba(0,0,0,0.5);
}
#settings-drawer.open {
  transform: translateX(0);
}

#settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
#settings-title {
  font-family: 'NHGrotesk', sans-serif;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -0.3px;
  color: #ffffff;
}
#settings-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
#settings-close:hover {
  background: rgba(255,255,255,0.12);
  color: #fff;
}

#settings-body {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 0 0 24px;
}
#settings-body::-webkit-scrollbar { display: none; }

.sp-section {
  padding: 18px 20px 0;
}
.sp-section + .sp-section {
  border-top: 1px solid rgba(255,255,255,0.05);
  margin-top: 18px;
}
.sp-section-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.28);
  margin-bottom: 14px;
}

/* Profile avatar */
.sp-avatar-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.sp-avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid rgba(79,195,247,0.25);
  background: rgba(255,255,255,0.06);
}
.sp-avatar-name {
  font-family: 'NHGrotesk', sans-serif;
  font-size: 15px;
  font-weight: 900;
  color: #fff;
  line-height: 1.2;
}
.sp-avatar-company {
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  margin-top: 2px;
}

/* Fields */
.sp-field {
  margin-bottom: 12px;
}
.sp-field-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: rgba(255,255,255,0.35);
  margin-bottom: 5px;
}
.sp-field-value {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 7px;
  padding: 8px 11px;
  line-height: 1.3;
}

/* Badge */
.sp-badge {
  display: inline-block;
  font-family: 'DM Sans', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(79,195,247,0.12);
  color: rgba(79,195,247,0.9);
  border: 1px solid rgba(79,195,247,0.18);
}

/* Toggle */
.sp-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.sp-toggle-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: rgba(255,255,255,0.7);
}
.sp-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  cursor: pointer;
}
.sp-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}
.sp-toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 20px;
  background: rgba(255,255,255,0.1);
  transition: background 0.2s;
}
.sp-toggle input:checked + .sp-toggle-track {
  background: rgba(79,195,247,0.7);
}
.sp-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  pointer-events: none;
}
.sp-toggle input:checked ~ .sp-toggle-thumb {
  transform: translateX(16px);
}

/* Select */
.sp-select {
  width: 100%;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 7px;
  padding: 8px 11px;
  appearance: none;
  cursor: pointer;
  outline: none;
}
.sp-select:focus {
  border-color: rgba(79,195,247,0.3);
}

/* Loading state */
.sp-loading {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  padding: 40px 20px;
  text-align: center;
}

/* Onboarding status dot */
.sp-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.sp-status-dot.active { background: #4ade80; }
.sp-status-dot.onboarding { background: rgba(79,195,247,0.8); }
.sp-status-dot.inactive { background: rgba(255,255,255,0.2); }
```

- [ ] **Step 2: Verify file saved**

```bash
ls -lh /path/to/inboundos-site/dashboard/settings-panel.css
```
Expected: file exists, non-zero size.

---

### Task 2: Create `settings-panel.js`

**Files:**
- Create: `dashboard/settings-panel.js`

- [ ] **Step 1: Create the JS file**

```js
// settings-panel.js
(function () {
  const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzY2ZidWh3bGZoYmx4cHJrd25oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjMyMjUsImV4cCI6MjA5NTAzOTIyNX0.TNIW7H0iR7WxtPJSJi9LPBmqIiQu8w1xJ2MY4eDYVsA';
  const SB_HEADERS = {
    'apikey': SB_ANON,
    'Authorization': `Bearer ${SB_ANON}`,
    'Content-Type': 'application/json'
  };

  // Inject overlay + drawer into DOM
  function injectDrawer() {
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.addEventListener('click', closePanel);

    const drawer = document.createElement('div');
    drawer.id = 'settings-drawer';
    drawer.innerHTML = `
      <div id="settings-header">
        <span id="settings-title">Settings</span>
        <button id="settings-close" onclick="window.__settingsClose()">&#x2715;</button>
      </div>
      <div id="settings-body"><div class="sp-loading">Loading…</div></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  }

  // Fetch client profile from Supabase `profiles` table by email stored in cookie
  // Falls back to static values if table doesn't exist yet
  async function fetchProfile() {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/profiles?select=*&limit=1`,
        { headers: SB_HEADERS }
      );
      if (!res.ok) throw new Error('fetch failed');
      const rows = await res.json();
      return rows[0] || null;
    } catch {
      return null;
    }
  }

  // Save a preference field back to Supabase
  async function savePref(id, field, value) {
    await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${id}`,
      {
        method: 'PATCH',
        headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ [field]: value })
      }
    );
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function statusDot(status) {
    const cls = status === 'active' ? 'active' : status === 'onboarding' ? 'onboarding' : 'inactive';
    return `<span class="sp-status-dot ${cls}"></span>`;
  }

  function renderBody(profile) {
    const body = document.getElementById('settings-body');
    if (!profile) {
      // Graceful fallback — show static info from sidebar
      body.innerHTML = `
        <div class="sp-section">
          <div class="sp-section-label">Profile</div>
          <div class="sp-avatar-row">
            <img class="sp-avatar" src="mk-avatar.jpg" alt="Avatar"/>
            <div>
              <div class="sp-avatar-name">Micko Cruz</div>
              <div class="sp-avatar-company">InboundOS</div>
            </div>
          </div>
        </div>
        <div class="sp-section">
          <div class="sp-section-label">Account</div>
          <div class="sp-field">
            <div class="sp-field-label">Plan</div>
            <div class="sp-field-value"><span class="sp-badge">DWY Coaching</span></div>
          </div>
        </div>
      `;
      return;
    }

    const notifChecked = profile.notify_email ? 'checked' : '';
    const tz = profile.timezone || 'America/New_York';
    const timezones = [
      'America/New_York','America/Chicago','America/Denver',
      'America/Los_Angeles','America/Anchorage','Pacific/Honolulu',
      'Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'
    ];
    const tzOptions = timezones.map(t =>
      `<option value="${t}" ${t === tz ? 'selected' : ''}>${t.replace('_',' ')}</option>`
    ).join('');

    body.innerHTML = `
      <div class="sp-section">
        <div class="sp-section-label">Profile</div>
        <div class="sp-avatar-row">
          <img class="sp-avatar" src="${profile.avatar_url || 'mk-avatar.jpg'}" alt="Avatar"/>
          <div>
            <div class="sp-avatar-name">${profile.full_name || '—'}</div>
            <div class="sp-avatar-company">${profile.company || '—'}</div>
          </div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Email</div>
          <div class="sp-field-value">${profile.email || '—'}</div>
        </div>
      </div>

      <div class="sp-section">
        <div class="sp-section-label">Account</div>
        <div class="sp-field">
          <div class="sp-field-label">Plan</div>
          <div class="sp-field-value"><span class="sp-badge">${profile.plan || 'DWY Coaching'}</span></div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Member Since</div>
          <div class="sp-field-value">${formatDate(profile.start_date || profile.created_at)}</div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Status</div>
          <div class="sp-field-value">${statusDot(profile.status)}${profile.status ? profile.status.charAt(0).toUpperCase() + profile.status.slice(1) : 'Active'}</div>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Onboarding</div>
          <div class="sp-field-value">${profile.onboarding_status || 'Complete'}</div>
        </div>
      </div>

      <div class="sp-section">
        <div class="sp-section-label">Preferences</div>
        <div class="sp-toggle-row">
          <span class="sp-toggle-label">Email notifications</span>
          <label class="sp-toggle">
            <input type="checkbox" id="sp-notify" ${notifChecked}/>
            <div class="sp-toggle-track"></div>
            <div class="sp-toggle-thumb"></div>
          </label>
        </div>
        <div class="sp-field">
          <div class="sp-field-label">Timezone</div>
          <select class="sp-select" id="sp-tz">${tzOptions}</select>
        </div>
      </div>
    `;

    // Wire up preference saves
    document.getElementById('sp-notify').addEventListener('change', function () {
      savePref(profile.id, 'notify_email', this.checked);
    });
    document.getElementById('sp-tz').addEventListener('change', function () {
      savePref(profile.id, 'timezone', this.value);
    });
  }

  async function openPanel() {
    document.getElementById('settings-overlay').classList.add('open');
    document.getElementById('settings-drawer').classList.add('open');
    document.getElementById('settings-body').innerHTML = '<div class="sp-loading">Loading…</div>';
    const profile = await fetchProfile();
    renderBody(profile);
  }

  function closePanel() {
    document.getElementById('settings-overlay').classList.remove('open');
    document.getElementById('settings-drawer').classList.remove('open');
  }

  // Expose globally so HTML onclick can call it
  window.__settingsOpen = openPanel;
  window.__settingsClose = closePanel;

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDrawer);
  } else {
    injectDrawer();
  }
})();
```

- [ ] **Step 2: Verify file saved**

```bash
ls -lh /path/to/inboundos-site/dashboard/settings-panel.js
```
Expected: file exists, non-zero size.

---

### Task 3: Wire up all 9 dashboard HTML files

**Files:**
- Modify: `dashboard/dashboard.html`, `dashboard/agents.html`, `dashboard/clients.html`, `dashboard/sops.html`, `dashboard/org-chart.html`, `dashboard/sales-calls.html`, `dashboard/research.html`, `dashboard/performance.html`, `dashboard/pipeline.html`

For **each** of the 9 files, make these two changes:

**Change A — Add CSS + JS in `<head>` (after existing `<style>` block or before `</head>`):**

```html
<link rel="stylesheet" href="settings-panel.css"/>
<script src="settings-panel.js"></script>
```

**Change B — Make the `.mk-avatar-wrap` div clickable. Find this pattern:**

```html
<div class="sidebar-bottom"><div class="mk-avatar-wrap">
```

Replace with:

```html
<div class="sidebar-bottom"><div class="mk-avatar-wrap" onclick="window.__settingsOpen()" style="cursor:pointer;">
```

- [ ] **Step 1: Edit `dashboard.html`** — add CSS/JS link in head, add onclick to `.mk-avatar-wrap`
- [ ] **Step 2: Edit `agents.html`** — same two changes
- [ ] **Step 3: Edit `clients.html`** — same two changes
- [ ] **Step 4: Edit `sops.html`** — same two changes
- [ ] **Step 5: Edit `org-chart.html`** — same two changes
- [ ] **Step 6: Edit `sales-calls.html`** — same two changes
- [ ] **Step 7: Edit `research.html`** — same two changes
- [ ] **Step 8: Edit `performance.html`** — same two changes
- [ ] **Step 9: Edit `pipeline.html`** — same two changes

- [ ] **Step 10: Verify all 9 files contain the onclick**

```bash
grep -l '__settingsOpen' dashboard/*.html | wc -l
```
Expected output: `9`

- [ ] **Step 11: Commit**

```bash
git add dashboard/settings-panel.css dashboard/settings-panel.js dashboard/*.html
git commit -m "feat: add settings slide-out panel triggered from sidebar user card"
```

---

### Task 4: Supabase `profiles` table (if not exists)

**Files:**
- Reference only — run in Supabase SQL editor

If the `profiles` table doesn't exist yet, the JS gracefully falls back. To get full data, run this SQL in the Supabase dashboard:

- [ ] **Step 1: Run in Supabase SQL editor**

```sql
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text,
  company text,
  avatar_url text,
  plan text default 'DWY Coaching',
  start_date date,
  status text default 'active',
  onboarding_status text default 'Complete',
  notify_email boolean default true,
  timezone text default 'America/New_York',
  created_at timestamptz default now()
);

-- Enable RLS, allow anon read + update own row
alter table profiles enable row level security;
create policy "anon read" on profiles for select using (true);
create policy "anon update" on profiles for update using (true);
```

- [ ] **Step 2: Insert a test row**

```sql
insert into profiles (email, full_name, company, plan, status, start_date)
values ('client@example.com', 'Jane Smith', 'Acme Co', 'DWY Coaching', 'active', '2025-01-15');
```

- [ ] **Step 3: Verify drawer shows data**

Open any dashboard page in browser, click the name card bottom-left — confirm drawer slides in and shows the row data.

---

## Self-Review Notes

- Fallback renders static data if `profiles` table missing — no broken UI on deploy
- All 9 files get identical two-line addition — no per-page logic
- Preferences (notify_email, timezone) write back via PATCH immediately on change
- Drawer closes on overlay click or ✕ button
- Mobile: `.sidebar-bottom` is already `display:none!important` on mobile — drawer trigger hidden on mobile, no conflict
- CSS uses same `rgba(7,11,18)` base, `rgba(79,195,247)` accent, NHGrotesk + DM Sans as existing design system
