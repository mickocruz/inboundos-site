// Rate limit: 5 attempts per 15 min per IP on login — persisted in Supabase
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// In-memory fallback for local dev
const _mem = new Map();
function _memFallback(ip) {
  const now = Date.now();
  const rec = _mem.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + LOGIN_WINDOW_MS; }
  rec.count++;
  _mem.set(ip, rec);
  return rec.count <= LOGIN_LIMIT;
}

async function checkRateLimit(ip) {
  if (!SB_SERVICE_KEY) return _memFallback(ip);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/check_rate_limit`, {
      method: 'POST',
      headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: `login:${ip}`, p_limit: LOGIN_LIMIT, p_window_ms: LOGIN_WINDOW_MS }),
    });
    if (!res.ok) return true; // fail open on infra error
    const data = await res.json();
    return data === true || data?.allowed === true;
  } catch { return true; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inboundos.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!(await checkRateLimit(ip))) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string' || password.length > 200) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return res.status(500).json({ error: 'Server misconfigured' });
  if (password !== secret) return res.status(401).json({ error: 'Wrong password' });

  return res.status(200).json({ ok: true });
}
