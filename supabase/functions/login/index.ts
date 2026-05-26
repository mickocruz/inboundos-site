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

  // Look up email from ctrl_users by username
  const { data: user, error: lookupErr } = await supabase
    .from('ctrl_users')
    .select('client_id, client_slug, email')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (lookupErr || !user || !user.email) {
    return new Response(JSON.stringify({ error: 'Incorrect username' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Sign in via Supabase Auth
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const { data: session, error: authErr } = await anonClient.auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (authErr || !session?.session) {
    return new Response(JSON.stringify({ error: 'Incorrect password' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(
    JSON.stringify({
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_at: session.session.expires_at,
      client_id: user.client_id,
      client_slug: user.client_slug,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
