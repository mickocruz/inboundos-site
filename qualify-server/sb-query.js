#!/usr/bin/env node
// Read-only Supabase query helper for the chat agent.
// Usage: node sb-query.js <table> [selectCols] [filter]
//   node sb-query.js sops
//   node sb-query.js clients "name,status,mrr"
//   node sb-query.js outreach_leads "ig_handle,qualifier,stage" "qualifier=eq.hot"
// SELECT-only. Never writes. Returns up to 100 rows as JSON.

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
// Service-role key — runs server-side only (never sent to browser). Bypasses RLS so the
// chat agent can read the full company brain. SELECT-only enforced by this script.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

// Allowlist of readable tables (your company brain). No PII-sensitive auth tables.
const ALLOWED = new Set([
  'sops','systems','knowledge_base','clients','client_tasks','client_config','client_billing',
  'competitors','content_bucket','content_pillars','hooks','icp_profile','micko_profile',
  'agent_roster','agent_activity','agent_runs','agent_comms','agent_signals','agent_goals',
  'agent_memory','agent_skills','agent_items','org_chart','revenue_sales','weekly_reports',
  'daily_reports','outreach_leads','inbound_leads','sales_calls','niche_news','documents',
  'routines','pm_tasks','planner_tasks','onboarding','applications'
]);

async function main() {
  const [table, cols, filter] = process.argv.slice(2);
  if (!table) { console.error('usage: sb-query.js <table> [cols] [filter]'); process.exit(1); }
  if (!ALLOWED.has(table)) {
    console.error(`table "${table}" not readable. Allowed: ${[...ALLOWED].join(', ')}`);
    process.exit(1);
  }
  const select = cols && cols.trim() ? cols.trim() : '*';
  let url = `${SB_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=100`;
  if (filter && filter.trim()) url += `&${encodeURIComponent(filter.trim())}`;

  const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) { console.error(`query failed (${r.status}): ${await r.text()}`); process.exit(1); }
  const rows = await r.json();
  console.log(JSON.stringify(rows, null, 1));
}

main().catch(e => { console.error(e.message); process.exit(1); });
