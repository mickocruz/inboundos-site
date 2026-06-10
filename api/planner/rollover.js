// Vercel cron — 5AM Asia/Manila (21:00 UTC). Carries unfinished tasks to the new cycle.

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';
const HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

function manilaDates() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // At 5AM Manila the previous cycle is yesterday's date; the new cycle is today.
  const today = new Date(now);
  const prev = new Date(now); prev.setDate(prev.getDate() - 1);
  return { prevCycle: iso(prev), newCycle: iso(today) };
}

export default async function handler(req, res) {
  // Vercel cron sends Authorization: Bearer CRON_SECRET when configured
  if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { prevCycle, newCycle } = manilaDates();

  // Move all unfinished tasks from the previous cycle into the new one, flagged carried
  const r = await fetch(
    `${SB_URL}/rest/v1/planner_tasks?cycle_date=eq.${prevCycle}&status=neq.done`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({ cycle_date: newCycle, carried: true, updated_at: new Date().toISOString() }),
    }
  );
  if (!r.ok) return res.status(502).json({ error: 'rollover failed', detail: await r.text() });
  const moved = await r.json();
  return res.status(200).json({ ok: true, prevCycle, newCycle, carried: moved.length });
}
