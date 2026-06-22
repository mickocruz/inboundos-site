// Proxies apply.html webhook calls to n8n.
// Requires N8N_WEBHOOK_URL in Vercel env vars (e.g. https://your-n8n.domain.com)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const n8nBase = process.env.N8N_WEBHOOK_URL;
  if (!n8nBase) {
    return res.status(503).json({ error: 'Webhook service not configured' });
  }

  const hook = req.query.hook;
  if (!hook || !/^[a-z0-9-]{1,50}$/.test(hook)) {
    return res.status(400).json({ error: 'Invalid hook name' });
  }

  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => { body += chunk; });
    req.on('end', resolve);
    req.on('error', reject);
  });

  const upstream = await fetch(`${n8nBase}/webhook/${hook}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const text = await upstream.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: true }; }

  return res.status(upstream.ok ? 200 : upstream.status).json(json);
}
