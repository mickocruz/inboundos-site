const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

function verifySession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.sub) return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inboundos.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!verifySession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const agent = req.query.agent;
  if (!agent) return res.status(400).json({ error: 'Missing agent' });

  if (req.method === 'GET') {
    const r = await fetch(
      `${SB_URL}/rest/v1/agent_skills?agent=eq.${encodeURIComponent(agent)}&select=content&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!r.ok) return res.status(500).json({ error: 'DB error' });
    const rows = await r.json();
    const content = rows[0]?.content || `# ${agent} Skill\n\nNo skill content yet. Edit this to define how ${agent} should behave.`;
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(content);
  }

  if (req.method === 'POST') {
    let content = '';
    await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { content = body; resolve(); });
      req.on('error', reject);
    });

    const r = await fetch(`${SB_URL}/rest/v1/agent_skills`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ agent, content }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: err });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
