#!/usr/bin/env node
// Scoped write helper. Locked to allowlisted tables only.
// Anything else is rejected. Uses the service-role key (server-side only).
//
// Usage:
//   node sb-write.js agent_comms '{"from_agent":"ATLAS","to_agent":"Hermes","message":"..."}'
//   node sb-write.js daily_reports '{"report_date":"2026-06-15","headline":"...", ...}'
//   node sb-write.js agent_items '{"client_id":"micko_cruz","agent":"quill","type":"script","content":"...","status":"draft","metadata":{}}'

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

// ONLY these tables are writable. Nothing touches leads, clients, billing, etc.
const WRITABLE = new Set(['agent_comms', 'daily_reports', 'agent_items', 'content_bucket']);

async function main() {
  const [table, json] = process.argv.slice(2);
  if (!table || !json) { console.error('usage: sb-write.js <table> <json>'); process.exit(1); }
  if (!WRITABLE.has(table)) {
    console.error(`table "${table}" not writable. Only: ${[...WRITABLE].join(', ')}`);
    process.exit(1);
  }
  let row;
  try { row = JSON.parse(json); } catch (e) { console.error('bad JSON:', e.message); process.exit(1); }

  // daily_reports: upsert on report_date so re-runs update instead of duplicate.
  const prefer = table === 'daily_reports'
    ? 'return=representation,resolution=merge-duplicates'
    : 'return=representation';

  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) { console.error(`write failed (${r.status}): ${await r.text()}`); process.exit(1); }
  console.log(JSON.stringify(await r.json()));
}

main().catch(e => { console.error(e.message); process.exit(1); });
