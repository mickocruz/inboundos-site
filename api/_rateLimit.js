// Persistent rate limiting via Supabase — survives Vercel serverless cold starts
// Table required: rate_limits (key TEXT PRIMARY KEY, count INT, reset_at BIGINT)
// Run this SQL once in Supabase:
//   CREATE TABLE IF NOT EXISTS rate_limits (
//     key TEXT PRIMARY KEY,
//     count INT NOT NULL DEFAULT 0,
//     reset_at BIGINT NOT NULL
//   );
//   ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
//   -- No client access needed — only service role (server-side only)

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function checkRateLimit(key, limit, windowMs) {
  // If no service key configured, fall back to in-memory (dev only)
  if (!SB_SERVICE_KEY) {
    return _inMemoryFallback(key, limit, windowMs);
  }

  const now = Date.now();
  const newResetAt = now + windowMs;

  try {
    // Upsert: insert or increment atomically via RPC
    const res = await fetch(`${SB_URL}/rest/v1/rpc/check_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SB_SERVICE_KEY,
        Authorization: `Bearer ${SB_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_ms: windowMs }),
    });

    if (!res.ok) {
      // If RPC doesn't exist yet, fall through to allow (fail open on infra error)
      return true;
    }
    const data = await res.json();
    return data === true || data?.allowed === true;
  } catch {
    return true; // fail open on network error — don't block legit users
  }
}

// In-memory fallback for local dev (single process only)
const _mem = new Map();
function _inMemoryFallback(key, limit, windowMs) {
  const now = Date.now();
  const rec = _mem.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
  rec.count++;
  _mem.set(key, rec);
  return rec.count <= limit;
}
