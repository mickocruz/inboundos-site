import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit } from '../../_rateLimit.js';
const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

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

    // Cryptographic signature verification using Supabase JWT secret
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return false; // fail closed — never trust unsigned tokens
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expected = createHmac('sha256', jwtSecret).update(signingInput).digest('base64url');
    const actual = parts[2];
    try {
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return false;
    } catch { return false; }
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inboundos.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!(await checkRateLimit(`skill:${ip}`, 60, 60 * 1000))) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
  }

  if (!verifySession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const agent = req.query.agent;
  if (!agent || typeof agent !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(agent)) {
    return res.status(400).json({ error: 'Invalid agent' });
  }

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
    let totalSize = 0;
    const MAX_SKILL_SIZE = 100 * 1024; // 100KB max
    await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        totalSize += chunk.length;
        if (totalSize > MAX_SKILL_SIZE) { reject(new Error('Payload too large')); return; }
        body += chunk;
      });
      req.on('end', () => { content = body; resolve(); });
      req.on('error', reject);
    }).catch(err => {
      if (!res.headersSent) res.status(413).json({ error: err.message });
      return;
    });
    if (res.headersSent) return;

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
