// n8n → planner task inserter. POST { title, block?, lane?, priority?, source?, source_id? }
// Auth: x-webhook-secret header must match PLANNER_WEBHOOK_SECRET env var.

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

function cycleDate() {
  // Asia/Manila; day rolls over at 5AM
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  if (now.getHours() < 5) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.PLANNER_WEBHOOK_SECRET;
  if (!secret || req.headers['x-webhook-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title required' });

  const row = {
    title,
    block: ['promote', 'fulfill', 'build'].includes(b.block) ? b.block : 'build',
    lane: ['inboundos', 'music', 'personal'].includes(b.lane) ? b.lane : 'inboundos',
    priority: [1, 2, 3].includes(b.priority) ? b.priority : 2,
    source: String(b.source || 'n8n').slice(0, 40),
    source_id: b.source_id ? String(b.source_id).slice(0, 120) : null,
    cycle_date: b.cycle_date || cycleDate(),
  };

  const r = await fetch(`${SB_URL}/rest/v1/planner_tasks`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify([row]),
  });
  if (!r.ok) return res.status(502).json({ error: 'supabase insert failed', detail: await r.text() });
  const [task] = await r.json();
  return res.status(200).json({ ok: true, id: task?.id });
}
