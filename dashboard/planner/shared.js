// ── InboundOS Life Planner — shared helpers (Supabase REST, sidebar, cycle logic) ──

const PL_SUPA_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const PL_SUPA_KEY = 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

const PL_HEADERS = {
  apikey: PL_SUPA_KEY,
  Authorization: `Bearer ${PL_SUPA_KEY}`,
  'Content-Type': 'application/json',
};

async function plGet(table, query) {
  const res = await fetch(`${PL_SUPA_URL}/rest/v1/${table}?${query}`, { headers: PL_HEADERS });
  if (!res.ok) throw new Error(`${table} GET ${res.status}`);
  return res.json();
}
async function plInsert(table, rows) {
  const res = await fetch(`${PL_SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...PL_HEADERS, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} INSERT ${res.status}`);
  return res.json();
}
async function plPatch(table, query, patch) {
  const res = await fetch(`${PL_SUPA_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...PL_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`${table} PATCH ${res.status}`);
  return res.json();
}
async function plDelete(table, query) {
  const res = await fetch(`${PL_SUPA_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: PL_HEADERS });
  if (!res.ok) throw new Error(`${table} DELETE ${res.status}`);
}

// ── Cycle logic: day = 12PM wake → 5AM sleep. Before 5AM = still yesterday's cycle. ──
function plCycleDate(d) {
  const t = d ? new Date(d) : new Date();
  if (t.getHours() < 5) t.setDate(t.getDate() - 1);
  return t.toISOString().slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2-$3');
}
function plLocalISO(t) {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function plToday() { // cycle date using local time
  const t = new Date();
  if (t.getHours() < 5) t.setDate(t.getDate() - 1);
  return plLocalISO(t);
}

// Current time block: Promote 1–5PM · Fulfill 6–10PM · Build 11PM–3AM
function plCurrentBlock() {
  const h = new Date().getHours();
  if (h >= 13 && h < 17) return 'promote';
  if (h >= 18 && h < 22) return 'fulfill';
  if (h >= 23 || h < 3) return 'build';
  return null;
}

const PL_BLOCKS = [
  { id: 'promote', label: 'Promote', hours: '1–5PM', color: 'var(--yellow)' },
  { id: 'fulfill', label: 'Fulfill', hours: '6–10PM', color: 'var(--green)' },
  { id: 'build', label: 'Build', hours: '11PM–3AM', color: 'var(--accent)' },
];

// ── Sidebar ──
function plSidebar(active) {
  const items = [
    { id: 'board', href: '/dashboard/planner/', label: 'Board', icon: '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/>' },
    { id: 'focus', href: '/dashboard/planner/focus', label: 'Focus', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>' },
    { id: 'habits', href: '/dashboard/planner/habits', label: 'Habits', icon: '<path d="M20 6L9 17l-5-5"/>' },
    { id: 'fitness', href: '/dashboard/planner/fitness', label: 'Fitness', icon: '<path d="M6.5 6.5h11v11h-11z"/><path d="M2 12h2.5M19.5 12H22M12 2v2.5M12 19.5V22"/>' },
  ];
  const nav = items.map(i =>
    `<div class="nav-item${i.id === active ? ' active' : ''}" onclick="location.href='${i.href}'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.icon}</svg>${i.label}</div>`
  ).join('');
  return `<nav class="sidebar">
    <div class="sidebar-logo-wrap" onclick="location.href='/dashboard/planner/'"><div class="sidebar-logo-text"><span style="color:#fff;">Inbound</span><span style="color:#4FC3F7;">OS</span> <span style="font-size:11px;color:rgba(255,255,255,0.42);font-family:var(--font-data);font-weight:500;letter-spacing:1px;">PLANNER</span></div></div>
    <div class="nav-section"><div class="nav-section-label">Planner</div>${nav}</div>
    <div class="nav-section"><div class="nav-section-label">Apps</div>
      <div class="nav-item" onclick="location.href='https://inboundos.vercel.app/dashboard'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>Dashboard</div>
    </div>
    <div class="sidebar-bottom"><div class="mk-avatar-wrap"><img src="/dashboard/mk-avatar.jpg" alt="MK" style="width:32px;height:32px;object-fit:cover;border-radius:50%;border:1px solid rgba(79,195,247,0.2);"/><div><div class="mk-name">Micko Cruz</div><div class="mk-role">Founder · InboundOS</div></div></div></div>
  </nav>`;
}

// ── Sleep anchor notifications (fires while app is open; Notification API) ──
const PL_ANCHORS = [
  { h: 12, m: 0, msg: 'WAKE — go outside now. Light anchor. No snooze.' },
  { h: 21, m: 0, msg: 'Dim lights. Blue light filter ON.' },
  { h: 23, m: 30, msg: 'Melatonin 0.5mg now.' },
  { h: 3, m: 0, msg: 'HARD STOP. Work ends. No screens.' },
  { h: 4, m: 30, msg: 'Ashwagandha. Wind down. Sleep at 5.' },
];
function plStartAnchors() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  let lastFired = localStorage.getItem('pl_anchor_last') || '';
  setInterval(() => {
    const now = new Date();
    const key = `${plLocalISO(now)}-${now.getHours()}:${now.getMinutes()}`;
    const hit = PL_ANCHORS.find(a => a.h === now.getHours() && a.m === now.getMinutes());
    if (hit && lastFired !== key) {
      lastFired = key;
      localStorage.setItem('pl_anchor_last', key);
      if (Notification.permission === 'granted') new Notification('InboundOS Planner', { body: hit.msg });
      if (hit.h === 3 && typeof plHardStop === 'function') plHardStop();
    }
  }, 20000);
}

function plEsc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function plDateLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
