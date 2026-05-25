import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://inboundos.vercel.app',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const required = ['first_name', 'last_name', 'agency_name', 'username', 'password', 'client_id', 'client_slug'];
  for (const key of required) {
    if (!body[key]?.trim()) return json({ error: `Missing field: ${key}` }, 400);
  }

  if (body.password.length < 8) return json({ error: 'Password must be 8+ characters' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Check username not taken
  const { data: existing } = await supabase
    .from('ctrl_users')
    .select('id')
    .eq('username', body.client_slug)
    .single();

  if (existing) return json({ error: 'Username already taken. Choose another.' }, 409);

  // Hash password via pgcrypto rpc
  const { data: hashData, error: hashErr } = await supabase.rpc('hash_password', {
    input_password: body.password,
  });
  if (hashErr || !hashData) return json({ error: 'Password hashing failed' }, 500);

  // Insert client login row
  const { error: userErr } = await supabase.from('ctrl_users').insert({
    username: body.client_slug,
    password_hash: hashData,
    client_id: body.client_id,
    client_slug: body.client_slug,
  });
  if (userErr) return json({ error: userErr.message }, 500);

  // Encrypt API key (store as-is; in prod swap for Vault)
  const { error: configErr } = await supabase.from('client_config').insert({
    client_id: body.client_id,
    first_name: body.first_name.trim(),
    last_name: body.last_name.trim(),
    agency_name: body.agency_name.trim(),
    niche: body.niche || null,
    icp_title: body.icp_title || null,
    icp_pain: body.icp_pain || null,
    icp_result: body.icp_result || null,
    icp_revenue: body.icp_revenue || null,
    voice_tone: body.voice_tone || null,
    voice_words: body.voice_words || null,
    voice_avoid: body.voice_avoid || null,
    voice_pillars: body.voice_pillars || null,
    anthropic_key_enc: body.anthropic_key || null,
    n8n_webhook: body.n8n_webhook || null,
    post_frequency: body.post_frequency || null,
    platform: body.platform || null,
  });
  if (configErr) return json({ error: configErr.message }, 500);

  return json({ ok: true, client_slug: body.client_slug });
});
