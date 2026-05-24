import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://inboundos.vercel.app',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { username, password } = body;
  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase
    .from('ctrl_users')
    .select('client_id, client_slug, password_hash')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Incorrect username' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Compare password using Postgres pgcrypto via rpc
  const { data: match, error: hashErr } = await supabase.rpc('verify_password', {
    input_password: password,
    stored_hash: data.password_hash,
  });

  if (hashErr || !match) {
    return new Response(JSON.stringify({ error: 'Incorrect password' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(
    JSON.stringify({ client_id: data.client_id, client_slug: data.client_slug }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
