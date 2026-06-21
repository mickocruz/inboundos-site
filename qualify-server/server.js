// InboundOS Lead Qualify Server
// Runs locally — receives screenshots from dashboard, runs claude CLI, saves to Supabase
// Start: node server.js
// Requires: claude CLI authenticated (claude --version to verify)

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load .env from project root
const ENV_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const PORT = 3001;
const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
// Public (anon) key — safe in browser, NOT used for this server's own DB writes.
const SB_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';
// Server-only key used for ALL of this backend's Supabase calls. Service role bypasses RLS,
// so the dashboard can lock tables to logged-in users without breaking server writes.
// NEVER expose SB_KEY to the browser. Falls back to anon key if service key is absent.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SB_ANON_KEY;
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const IG_TOKEN = process.env.IG_ACCESS_TOKEN || '';

function isLocalRequest(req) {
  // Trust this Mac (loopback) AND devices on the same home wifi (phone, iPad). The dashboard
  // sets a placeholder 'local' token on these since there's no real login on your own network.
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const host = (req.headers.host || '').split(':')[0];
  const isPrivate = (a) =>
    a === '127.0.0.1' || a === '::1' || a === 'localhost' ||
    /^192\.168\.\d+\.\d+$/.test(a) ||
    /^10\.\d+\.\d+\.\d+$/.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(a);
  return isPrivate(ip) || isPrivate(host);
}

function checkAuth(req) {
  // Localhost = your own machine, trusted, no login required.
  if (isLocalRequest(req)) return true;
  // Accept either a static INTERNAL_TOKEN or a valid non-expired Supabase JWT
  const headerToken = req.headers['x-internal-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!headerToken) return false;
  // Static token check (fast path for server-to-server)
  if (INTERNAL_TOKEN && headerToken === INTERNAL_TOKEN) return true;
  // JWT check: validate structure + expiry + signature
  try {
    const parts = headerToken.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.sub) return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    // Verify HMAC-SHA256 signature — fail closed if secret not set
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return false;
    const crypto = require('crypto');
    const signingInput = parts[0] + '.' + parts[1];
    const expected = crypto.createHmac('sha256', jwtSecret).update(signingInput).digest('base64url');
    if (expected !== parts[2]) return false;
    return true;
  } catch { return false; }
}

async function nexusAlert(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🤖 InboundOS\n${msg}`, parse_mode: 'Markdown' })
    });
  } catch(e) { console.error('[nexusAlert] failed:', e.message); }
}

async function logError(page, message, context) {
  try {
    await fetch(`${SB_URL}/rest/v1/error_log`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, error_message: message, context: context || {} })
    });
  } catch(e) { /* non-fatal */ }
}
const APOLLO_WORKFLOW_ID = process.env.APOLLO_WORKFLOW_ID || '0QoReLvsYWUaIrIO';
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

const SKILL_PATH = path.join(os.homedir(), '.claude/skills/inboundos-daily-dm/SKILL.md');

const PROMPT = `You are running the InboundOS Daily DM skill. Read the skill file below, then analyze the attached Instagram profile screenshot.

Output ONLY valid JSON with this exact structure:
{
  "ig_handle": "handle without @",
  "full_name": "display name or empty string",
  "niche": "2-3 word niche",
  "followers": "follower count as shown e.g. 12.4K",
  "link_in_bio": "url or description of link if visible, else null",
  "story_highlights": "comma-separated highlight labels if visible e.g. 'Results, FAQ, Services', else null",
  "has_offer": true,
  "qualifier": "hot or warm or cold",
  "disqualified": false,
  "disqualify_reason": null,
  "content_read": "what you actually observe about their content from the screenshot: post count, how recent the last posts look, view counts or like counts if visible, whether reels vs photos, whether hooks/captions repeat or vary, comment activity. Be concrete. If a signal isn't visible, say 'not visible' for it — do NOT guess.",
  "pain_point": "their SINGLE most likely content pain, chosen from what content_read actually shows — pick ONE and only if the evidence supports it. Options: 'low_views' (posting but views/likes low for follower count), 'inconsistent_posting' (clear gaps, stale last post), 'no_hook_variety' (same hook/format repeated), 'no_clear_icp' (bio/content doesn't name who they help), 'good_content_no_cta' (decent content, no offer/conversion path), 'high_volume_low_engagement' (lots of posts, dead comments/likes), 'strong_proof_quiet_content' (great results in bio but barely posts). If genuinely unclear, use 'unknown'. NEVER default to 'inconsistent_posting' just because it's easy — only if you SEE gaps.",
  "opener_text": "Stage 1 cold DM opener. TROJAN HORSE METHOD: appear as a genuinely curious peer or observer — NOT a vendor, NOT a helper, NOT an agency. Your only job is to get a reply. One reply = thread in their Primary inbox = mission complete. NEVER pitch, offer, or hint at a service. NEVER ask for anything except a simple answer to a specific question.\n\nRULES:\n- 1-2 sentences MAX. Under 28 words total.\n- All lowercase. Commas and periods only — no em dashes, no exclamation marks.\n- Sound like a real person who noticed something specific, not a template.\n- Reference ONE hyper-specific detail visible in their profile: a reel topic, a caption phrase, their bio claim, a result they posted, a highlight label. If you can't name a specific real detail, you are not being specific enough.\n- Ask ONE question that is so easy to answer it would feel rude to ignore. The question should feel like natural curiosity — not a setup, not a segue into your offer.\n- NEVER: 'i love your content', 'great profile', 'i built you a tool', 'AI', 'scriptwriter', 'agency', 'i help people like you', 'would you be open to', 'just wanted to reach out', offer, link, email ask.\n- Never start a sentence with 'I' as the opening word.\n\nPAIN-TO-ANGLE MAP (question must match the diagnosed pain):\n- low_views -> noticed the output but views look quiet for their size. ask what they think is holding the reach back, or if a specific format they tried did better.\n- inconsistent_posting -> saw a gap in posting. ask what's been pulling them away from it lately — clients? capacity?\n- no_hook_variety -> same hook or format repeating. acknowledge the format seems to work, ask if they've tested a different angle with that topic.\n- no_clear_icp -> bio or content is broad. ask who they're specifically trying to reach — be curious, not corrective.\n- good_content_no_cta -> decent content but no conversion path. ask where they usually send people after a reel lands.\n- high_volume_low_engagement -> lots of posts, low interaction. ask if the engagement is matching the effort they're putting in.\n- strong_proof_quiet_content -> strong results or client proof in bio, but barely posting. ask why they're not putting those wins out more.\n- unknown -> pick one genuinely visible, specific detail and ask a simple honest question about it.\n\nEXAMPLES (notice: specific, short, curious, zero setup):\n- low_views: 'hey sarah, your posting rhythm looks solid but the views seem light for 12k. what do you think is capping the reach?'\n- strong_proof_quiet_content: 'hey marco, 200+ clients in the bio but the grid's been pretty quiet. any reason you're not putting those wins out more?'\n- no_clear_icp: 'hey jen, saw the reels but couldn't tell from the profile who you're actually trying to reach. who's the main client?'\n- inconsistent_posting: 'hey dave, noticed a stretch without posts. clients getting busy or just pulling focus elsewhere?'\n- good_content_no_cta: 'hey lisa, the reels are landing well. where do people usually go after they watch — do you send them anywhere?'\n\nEach opener must read like it was written for this one person. If it could work on 50 other accounts unchanged, rewrite it.",
  "notes": "the specific profile detail + the pain_point you diagnosed, in plain words — must be verifiable from the screenshot. never 'great content' or generic compliments."
}

Qualifier (based on business signal, NOT follower count):
- hot: clear business offer + active content + link in bio or story highlights showing services/results
- warm: has a business niche but missing link, highlights, or recent activity
- cold: no clear offer, looks personal, inactive, or no business signal at all

has_offer: true if they have ANY of — link in bio pointing to an offer/service, story highlights showing clients/results/services/FAQ, bio that mentions a service or product. false if purely personal account with no business signals.

DISQUALIFY if ANY of these are true:
1. Bio or content clearly identifies them as: SMMA, social media agency, SMM agency, content agency, ghostwriter, influencer, actor, model, musician, athlete, or brand account. These are not buyers — SMMAs already know how to grow on social; the content system is a weak sell to them.
2. No business offer visible AND looks like a pure personal/consumer account with no intent to sell anything.
Follower count alone is NEVER a disqualify reason.

TARGET (do qualify): solo consultants, B2B service providers, coaches, mentors, fractional executives, done-for-you service operators who are NOT social-media-focused. They sell expertise or services, not social media growth.

If disqualified: set disqualified:true, disqualify_reason to one-line reason, opener_text to empty string.

Return ONLY the JSON object. No markdown fences. No explanation.

--- SKILL FILE ---
`;

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

// Rate limiting: max 20 qualify requests per minute per IP
const _rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  _rateLimitMap.set(ip, entry);
  return entry.count <= 20;
}

// Per-user rate limiting: max 30 requests per minute keyed on JWT sub
// Prevents VPN rotation bypassing the IP rate limit
const _userRateLimitMap = new Map();
function checkUserRateLimit(sub) {
  const now = Date.now();
  const entry = _userRateLimitMap.get(sub) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  _userRateLimitMap.set(sub, entry);
  return entry.count <= 30;
}

// Extract JWT sub from Authorization header (returns null if not a JWT or static token)
function extractJwtSub(req) {
  const headerToken = req.headers['authorization']?.replace('Bearer ', '');
  if (!headerToken) return null;
  try {
    const parts = headerToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.sub || null;
  } catch { return null; }
}

async function qualifyImage(base64Image) {
  // Write image to temp file with random suffix to avoid collisions
  const tmpImg = path.join(os.tmpdir(), `lead_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  const b64data = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
  fs.writeFileSync(tmpImg, Buffer.from(b64data, 'base64'));

  // Read skill file
  let skillContent = '';
  try { skillContent = fs.readFileSync(SKILL_PATH, 'utf8'); } catch(e) { skillContent = '(skill file not found)'; }

  const fullPrompt = PROMPT + skillContent;

  const promptWithImage = fullPrompt + `\n\nThe Instagram profile screenshot is saved at: ${tmpImg}\nRead that image file to analyze the profile.`;

  return new Promise((resolve, reject) => {
    const args = ['-p', '--add-dir', os.tmpdir(), '--allowedTools', 'Read', promptWithImage];
    const proc = execFile('claude', args, { timeout: 60000, maxBuffer: 1024 * 1024 * 4 }, (err, stdout, stderr) => {
      fs.unlink(tmpImg, () => {});
      if (err) return reject(new Error(stderr || err.message));
      let text = stdout.trim();
      text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      try {
        resolve(JSON.parse(text));
      } catch(e) {
        reject(new Error('Claude did not return valid JSON: ' + text.slice(0, 200)));
      }
    });
  });
}

async function checkDuplicate(igHandle) {
  const res = await fetch(`${SB_URL}/rest/v1/outreach_leads?ig_handle=eq.${encodeURIComponent(igHandle)}&select=id,ig_handle&limit=1`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.length > 0;
}

async function saveToSupabase(lead) {
  // Duplicate check
  const isDuplicate = await checkDuplicate(lead.ig_handle);
  if (isDuplicate) {
    return { duplicate: true, ig_handle: lead.ig_handle };
  }

  const body = JSON.stringify({
    ig_handle: lead.ig_handle,
    full_name: lead.full_name || '',
    niche: lead.niche || '',
    followers: lead.followers || '',
    qualifier: lead.qualifier || 'cold',
    opener_text: lead.opener_text || '',
    disqualify_reason: lead.disqualify_reason || null,
    notes: lead.disqualified
      ? `⚠️ DISQUALIFIED: ${lead.disqualify_reason}`
      : [
          lead.notes || '',
          lead.pain_point ? `🎯 pain: ${lead.pain_point}` : '',
          lead.content_read ? `👀 ${lead.content_read}` : '',
          lead.link_in_bio ? `🔗 ${lead.link_in_bio}` : '',
          lead.story_highlights ? `📌 Highlights: ${lead.story_highlights}` : ''
        ].filter(Boolean).join('\n'),
    stage: lead.disqualified ? 7 : 0,
    source: 'screenshot'
  });

  const res = await fetch(`${SB_URL}/rest/v1/outreach_leads`, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  return await res.json();
}

const STATIC_DIR = path.join(__dirname, '..');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.otf':'font/otf' };

// Slug-based routes: /{slug}/{page} → /dashboard/{page}.html
const SLUG_PAGES = ['agents','pipeline','performance','research','clients','sales-calls',
  'crm','chat','metrics','roi','tasks','activity'];

function resolveSlugRoute(urlPath) {
  const parts = urlPath.split('/').filter(Boolean);
  // /{slug}/{page} or /{slug}/{page}/
  if (parts.length >= 2 && SLUG_PAGES.includes(parts[1])) {
    return `/dashboard/${parts[1]}.html`;
  }
  // /{page} where page is a known dashboard page (no slug)
  if (parts.length === 1 && SLUG_PAGES.includes(parts[0])) {
    return `/dashboard/${parts[0]}.html`;
  }
  return null;
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Rewrite slug-based nav routes to dashboard HTML files
  const rewritten = resolveSlugRoute(urlPath);
  if (rewritten) urlPath = rewritten;

  const filePath = path.join(STATIC_DIR, urlPath);
  const ext = path.extname(filePath);
  if (!filePath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Agent chat / skill / config endpoints (used by dashboard pages) ──
const CONFIG_PATH = path.join(__dirname, 'config.json');
const ARGUS_RESULTS_PATH = path.join(__dirname, 'argus-results.json');
const CHAT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

function findSkillFile(skillName) {
  const candidates = [
    path.join(os.homedir(), `.claude/plugins/cache/inboundos-ctrl/inboundos-ctrl-skills/1.0.0/skills/${skillName}/SKILL.md`),
    path.join(os.homedir(), `.claude/skills/${skillName}/SKILL.md`),
    path.join(os.homedir(), `.claude/skills/${skillName}.md`),
  ];
  for (const sp of candidates) {
    if (fs.existsSync(sp)) return sp;
  }
  return null;
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Settings file that disables hooks (caveman/deploy) for server-spawned agents
const AGENT_SETTINGS = path.join(__dirname, 'agent-settings.json');
const SB_QUERY = path.join(__dirname, 'sb-query.js');

// Tables the chat agent may read (mirrors sb-query.js allowlist for the prompt)
const READABLE_TABLES = 'sops, systems, knowledge_base, clients, client_tasks, competitors, content_bucket, content_pillars, hooks, icp_profile, micko_profile, agent_roster, agent_activity, agent_runs, agent_comms, agent_goals, agent_memory, org_chart, revenue_sales, weekly_reports, daily_reports, outreach_leads, inbound_leads, sales_calls, niche_news, documents, routines, pm_tasks';

// ── Agent routing ──
// Each specialist owns a domain. ATLAS (orchestrator / CEO) is the default for general or
// cross-domain questions. Routing is keyword-based so there's no extra latency.
const AGENT_DOMAINS = {
  Apollo: { desc: 'Head of Content. Owns scripts, hooks, reels, captions, content pillars, posting, Instagram content.',
    kw: ['content','script','hook','reel','caption','post','pillar','video','idea','instagram content','write a','draft a','generate a'] },
  Hermes: { desc: 'Head of Sales. Owns leads, outreach, DMs, qualifying, the CRM pipeline, cold messages, prospects.',
    kw: ['lead','dm','outreach','cold','prospect','qualify','crm','pipeline','message','reply','follow up','followup','close','booking'] },
  Clio:   { desc: 'COO. Owns clients, onboarding, fulfillment, SOPs, systems, operations, delivery, tasks.',
    kw: ['client','onboard','sop','system','fulfill','deliver','operation','task','process','workflow','install','christian','meenal'] },
  Argus:  { desc: 'Chief Intelligence Officer. Owns competitor research, market intel, niche news, trends.',
    kw: ['competitor','research','intel','market','trend','news','niche','analyze','spy','what are they'] },
};
const ATLAS_DESC = 'ATLAS is the orchestrator (CEO). Sees the whole business. Handles general questions, strategy, status, cross-domain asks, daily reports, and anything that touches more than one area.';

function routeAgent(text) {
  const t = (text || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const [name, d] of Object.entries(AGENT_DOMAINS)) {
    let score = 0;
    for (const k of d.kw) if (t.includes(k)) score++;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  // No clear domain match → ATLAS (orchestrator) takes general/strategy questions.
  return bestScore >= 1 ? best : 'ATLAS';
}

// Ruben Hassid anti-AI voice — compact version injected into every chat answer.
const VOICE_RULES = `Write like a sharp human, not an AI. Hard rules:
- Short paragraphs, 1-2 sentences. Vary sentence length, no metronome rhythm.
- Contractions always (don't, it's, you're). Use "I" and "you". Active voice.
- NO em dashes. Use commas, periods, colons, or parentheses.
- Be specific: numbers as digits, real names, concrete details. Take a stance.
- When unsure, say so plainly ("I think", "probably", "kinda").
- BANNED words: delve, realm, leverage, harness, unlock, robust, seamless, streamline, elevate, empower, crucial, pivotal, holistic, dynamic, game-changer, testament, foster, showcase, optimize, scalable, transformative, intricate, vibrant, landscape, tapestry, navigate, ensure, utilize.
- BANNED phrases: "it's worth noting", "in order to", "let's dive in", "I'd be happy to", "at the end of the day", "that said", "furthermore", "moreover", "great question".
- FATAL (never do this): negative parallelism / reframe. No "it's not X, it's Y", "not just X but Y", "X isn't dead, Y is the future", "the question isn't X". Just say the positive claim directly.
- No rule-of-three lists of adjectives. No fake "from X to Y" ranges. No "-ing" filler phrases ("highlighting", "underscoring").
- If you've made the point, stop. No summary paragraph.`;

async function handleAgentChat(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) {
    return sendJSON(res, 400, { error: 'Invalid JSON body' });
  }
  const { agent, messages } = body;
  if (agent === '_check') return sendJSON(res, 200, { ok: true });
  if (!Array.isArray(messages) || !messages.length) {
    return sendJSON(res, 400, { error: 'Missing messages' });
  }
  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

  const cleanMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content }));
  if (!cleanMessages.length) return sendJSON(res, 400, { error: 'No valid messages' });

  // Route: pick the agent from the latest user message (unless caller forced a specific one).
  const lastUser = [...cleanMessages].reverse().find(m => m.role === 'user');
  const chosen = (!agent || agent === 'auto') ? routeAgent(lastUser ? lastUser.content : '') : agent;
  const agentDesc = AGENT_DOMAINS[chosen] ? AGENT_DOMAINS[chosen].desc : ATLAS_DESC;

  const skillName = String(chosen).toLowerCase().replace(/[^a-z0-9-]/g, '');
  let skillContent = '';
  const sp = findSkillFile(skillName);
  if (sp) { try { skillContent = fs.readFileSync(sp, 'utf8').slice(0, 12000); } catch (e) { console.error('[chat] skill read failed:', e.message); } }

  // Build a single prompt: system framing + conversation transcript.
  // The agent answers from Micko's live Supabase data via the read-only sb-query.js helper.
  const transcript = cleanMessages
    .map(m => `${m.role === 'user' ? 'Micko' : chosen}: ${m.content}`)
    .join('\n\n');

  const prompt = `You are ${chosen}, an InboundOS AI agent answering Micko's questions in the dashboard chat.
Your role: ${agentDesc}
Micko owns InboundOS (AI system installs for agency owners). He is NOT a developer, so answer plain, no jargon, concise.

--- HOW TO WRITE (follow exactly) ---
${VOICE_RULES}

You can read his live company database (Supabase) to answer factually. To read a table, run:
  node "${SB_QUERY}" <table> [columns] [filter]
Examples:
  node "${SB_QUERY}" clients "name,status"
  node "${SB_QUERY}" outreach_leads "ig_handle,qualifier,stage" "qualifier=eq.hot"
  node "${SB_QUERY}" knowledge_base "title,summary"
Readable tables: ${READABLE_TABLES}
This helper is SELECT-only, so you cannot change any data. Query the relevant table(s) BEFORE answering questions about his data, SOPs, clients, leads, content, or company info. If a table comes back empty, say so plainly ("you have no SOPs saved yet"). Never invent data.
${skillContent ? `\n--- YOUR SKILL ---\n${skillContent}\n--- END SKILL ---\n` : ''}
--- CONVERSATION ---
${transcript}

Answer Micko's last message. Plain text or light markdown. Be direct. Do not name yourself or sign off (the UI already shows who you are).

CRITICAL FINAL CHECK before you reply: scan your answer for the reframe / negative-parallelism pattern and DELETE it. This overrides any example in your skill file. Banned, no exceptions, even for hooks:
- "X isn't Y. It's Z." / "You're not X. You're Y." / "Not X, but Y." / "It's not about X, it's about Y." / "Stop X, start Y." / "X is dead, Y is the future." / "The question isn't X."
If your reply contains any sentence that first negates one thing then asserts another, rewrite it as a single direct positive statement. Just say the thing.
Also delete engagement bait if present: "here's the part nobody tells you", "what nobody tells you", "most people don't realize", "let that sink in", "read that again", "this changes everything". Cut the bait, keep the substance.`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  // Tell the client which agent picked up this message (for the bubble label).
  res.write(`data: ${JSON.stringify({ meta: { agent: chosen } })}\n\n`);

  // Spawn the claude CLI (runs on Micko's subscription — no API key, no per-call cost).
  // Hooks disabled via agent-settings.json so caveman/deploy hooks don't pollute replies.
  // Tool grant is locked to the one read-only query script — the agent cannot run any other
  // command. sb-query.js is SELECT-only, so chat can read data but never change or delete it.
  const args = [
    '-p', prompt,
    '--model', CHAT_MODEL,
    '--settings', AGENT_SETTINGS,
    '--allowedTools', `Bash(node ${SB_QUERY}:*)`,
    '--disallowedTools', 'Write,Edit,WebFetch,WebSearch',
  ];
  const proc = execFile('claude', args, { timeout: 90000, maxBuffer: 1024 * 1024 * 8 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[chat] Error:', stderr || err.message);
        res.write(`data: ${JSON.stringify({ error: (stderr || err.message).slice(0, 300) })}\n\n`);
        return res.end();
      }
      const text = stdout.trim();
      // Emit as a single token chunk, then done. (CLI -p returns final text only.)
      res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      res.write('data: {"done":true}\n\n');
      res.end();
    });
  // Abort the child if the client disconnects
  req.on('close', () => { try { proc.kill(); } catch {} });
}

// ── ATLAS orchestrator daily run (local, subscription CLI) ──
// Runs the ATLAS skill: reads agent activity + business data, writes the daily report to
// daily_reports, assigns tasks to specialists via agent_comms, pings Telegram.
const SB_WRITE = path.join(__dirname, 'sb-write.js');

async function handleAtlasRun(req, res) {
  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

  let skill = '';
  const sp = findSkillFile('atlas');
  if (sp) { try { skill = fs.readFileSync(sp, 'utf8'); } catch (e) { console.error('[atlas] skill read failed:', e.message); } }
  if (!skill) return sendJSON(res, 500, { error: 'ATLAS skill not found' });

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `${skill}

--- THIS RUN ---
Today is ${today}. Do your daily orchestrator run now.

You have two helper scripts (the only way you touch the database):
- READ:  node "${SB_QUERY}" <table> [columns] [filter]
- WRITE: node "${SB_WRITE}" <table> '<json row>'   (only agent_comms and daily_reports are writable)

Steps:
0. Read pm_tasks where status=in.(todo,in_progress). For each agent (apollo, hermes, clio, argus), note what open tasks already exist. Do NOT assign a new task if they already have an open one covering the same gap.
1. Read agent_activity (run_date=eq.${today} or recent), agent_runs, outreach_leads (count by qualifier+stage), clients, sales_calls, agent_goals, and last-24h agent_comms.
2. Build the report exactly in the format your skill defines. Each section on its own line, blank line between sections. NEVER merge sections into one paragraph. Apply the VOICE rules hard. No reframe pattern.
3. Assign up to 3 concrete tasks by writing each to agent_comms. TITLE: 3-6 word verb phrase only (e.g. "DM 20 Hot Leads"). DESCRIPTION: plain English, what to do and why, no code or database terms.
4. Save the report to daily_reports (one row, report_date=${today}, include raw_md).
5. After saving, print ONLY the raw_md report text as your final output (nothing else).`;

  console.log('[ATLAS] Daily run starting…');
  const args = [
    '-p', prompt,
    '--model', process.env.ATLAS_MODEL || CHAT_MODEL,
    '--settings', AGENT_SETTINGS,
    '--allowedTools', `Bash(node ${SB_QUERY}:*),Bash(node ${SB_WRITE}:*)`,
    '--disallowedTools', 'Write,Edit,WebFetch,WebSearch',
  ];
  execFile('claude', args, { timeout: 180000, maxBuffer: 1024 * 1024 * 16 }, async (err, stdout, stderr) => {
    if (err) {
      console.error('[ATLAS] Error:', stderr || err.message);
      await logError('atlas/run', stderr || err.message, {});
      nexusAlert(`❌ *ATLAS* daily run failed — ${(stderr || err.message).slice(0, 200)}`);
      return sendJSON(res, 500, { error: (stderr || err.message).slice(0, 300) });
    }
    const report = stdout.trim();
    console.log('[ATLAS] Done. Report saved.');
    nexusAlert(report.slice(0, 3500)); // Telegram cap
    sendJSON(res, 200, { ok: true, report });
  });
}

function handleSkillGet(req, res, skillName) {
  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
  const sp = findSkillFile(skillName);
  if (!sp) return sendJSON(res, 404, { error: 'Skill not found' });
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(fs.readFileSync(sp, 'utf8'));
}

// ── /generate — used by n8n scriptwriter workflows (Quill, Apollo) ──
// Accepts form-urlencoded or JSON: { system, prompt }
// Calls claude CLI with system+prompt, returns { output } as JSON.
async function handleGenerate(req, res) {
  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
  let body = '';
  try { body = (await readBody(req)).toString('utf8'); } catch (e) { return sendJSON(res, 400, { error: 'Bad body' }); }

  let system = '', prompt = '';
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { ({ system = '', prompt = '' } = JSON.parse(body)); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }
  } else {
    // form-urlencoded
    const params = new URLSearchParams(body);
    system = params.get('system') || '';
    prompt = params.get('prompt') || '';
  }
  if (!prompt) return sendJSON(res, 400, { error: 'prompt required' });

  const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
  const args = [
    '-p', fullPrompt,
    '--model', process.env.QUILL_MODEL || 'claude-haiku-4-5-20251001',
    '--settings', AGENT_SETTINGS,
  ];
  execFile('claude', args, { timeout: 90000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[generate] Error:', stderr || err.message);
      return sendJSON(res, 500, { error: (stderr || err.message).slice(0, 300) });
    }
    sendJSON(res, 200, { output: stdout.trim() });
  });
}

async function handleSkillSave(req, res, skillName) {
  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
  const content = (await readBody(req)).toString('utf8');
  if (!content.trim()) return sendJSON(res, 400, { error: 'Empty skill content' });
  let sp = findSkillFile(skillName);
  if (!sp) {
    const dir = path.join(os.homedir(), '.claude/skills');
    fs.mkdirSync(dir, { recursive: true });
    sp = path.join(dir, `${skillName}.md`);
  }
  fs.writeFileSync(sp, content);
  sendJSON(res, 200, { ok: true, path: sp });
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return { competitors: [] }; }
}

const SKILL_ROUTE = /^\/(?:api\/)?agent\/skill\/([a-z0-9-]+)$/;

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  // Allow any local network origin (192.168.x.x, 10.x.x.x, 172.16-31.x.x) plus known origins
  const isLocalNetwork = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  const allowedOrigins = ['https://inboundos.vercel.app'];
  res.setHeader('Access-Control-Allow-Origin', (isLocalNetwork || allowedOrigins.includes(origin)) ? origin : 'http://localhost:3001');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];

  // ── Supabase proxy — dashboard fetches go through here so service key handles RLS ──
  if (req.method === 'GET' && urlPath.startsWith('/api/sb/')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const table = urlPath.slice('/api/sb/'.length).replace(/[^a-z0-9_]/g, '');
    if (!table) { sendJSON(res, 400, { error: 'Missing table' }); return; }
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    try {
      const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
      });
      const body = await r.text();
      res.writeHead(r.ok ? 200 : r.status, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch (e) { sendJSON(res, 500, { error: e.message }); }
    return;
  }

  // Approve DMs page — read drafts (service key, bypasses RLS). Localhost-trusted.
  if (req.method === 'GET' && urlPath === '/api/leads') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const sel = 'id,ig_handle,full_name,niche,followers,qualifier,opener_text,notes,approved,dm_sent,stage_label';
      const r = await fetch(`${SB_URL}/rest/v1/outreach_leads?select=${sel}&order=qualifier.asc,updated_at.desc&limit=300`, { headers: SB_HEADERS });
      const data = await r.json();
      return sendJSON(res, 200, Array.isArray(data) ? data : []);
    } catch (e) { return sendJSON(res, 502, { error: 'read failed' }); }
  }
  // Approve DMs page — update one lead (approve / mark sent / save edit).
  const leadMatch = urlPath.match(/^\/api\/leads\/([0-9a-fA-F-]{36})$/);
  if (leadMatch && req.method === 'PATCH') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: 'Invalid JSON' }); }
    // Allowlist columns the page may change. Nothing else gets through.
    const allowed = ['approved','approved_at','dm_sent','dm_sent_at','opener_text','stage','stage_label','opener_sent_at'];
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (!Object.keys(patch).length) return sendJSON(res, 400, { error: 'No valid fields' });
    patch.updated_at = new Date().toISOString();
    try {
      const r = await fetch(`${SB_URL}/rest/v1/outreach_leads?id=eq.${leadMatch[1]}`, {
        method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch)
      });
      if (!r.ok) return sendJSON(res, 502, { error: 'write failed', detail: await r.text() });
      return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 502, { error: 'write failed' }); }
  }

  // Pipeline card delete — proxy to Supabase with service role key so RLS doesn't block
  const pipelineDeleteMatch = urlPath.match(/^\/pipeline\/item\/([0-9a-f-]+)$/);
  if (pipelineDeleteMatch && req.method === 'DELETE') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const itemId = pipelineDeleteMatch[1];
    try {
      const r = await fetch(`${SB_URL}/rest/v1/agent_items?id=eq.${itemId}`, {
        method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' }
      });
      if (!r.ok) return sendJSON(res, 502, { error: 'delete failed', detail: await r.text() });
      return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 502, { error: 'delete failed' }); }
  }

  const pipelineScriptMatch = urlPath.match(/^\/pipeline\/item\/([0-9a-f-]+)\/script$/);
  if (pipelineScriptMatch && req.method === 'PATCH') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const itemId = pipelineScriptMatch[1];
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    if (typeof body.content !== 'string') return sendJSON(res, 400, { error: 'content required' });
    try {
      // Fetch existing metadata to merge (don't wipe other fields)
      const cur = await fetch(`${SB_URL}/rest/v1/agent_items?id=eq.${itemId}&select=metadata`, { headers: SB_HEADERS });
      const rows = cur.ok ? await cur.json() : [];
      const existingMeta = (rows[0] && rows[0].metadata) || {};
      const newMeta = { ...existingMeta, ...(body.metadata || {}) };
      const r = await fetch(`${SB_URL}/rest/v1/agent_items?id=eq.${itemId}`, {
        method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ content: body.content, metadata: newMeta })
      });
      if (!r.ok) return sendJSON(res, 502, { error: 'update failed', detail: await r.text() });
      return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 502, { error: 'update failed' }); }
  }

  const pipelineStatusMatch = urlPath.match(/^\/pipeline\/item\/([0-9a-f-]+)\/status$/);
  if (pipelineStatusMatch && req.method === 'PATCH') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const itemId = pipelineStatusMatch[1];
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    const allowed = ['pending','approved','filming','filmed','scheduled','posted','trashed'];
    if (!allowed.includes(body.status)) return sendJSON(res, 400, { error: 'invalid status' });
    try {
      const r = await fetch(`${SB_URL}/rest/v1/agent_items?id=eq.${itemId}`, {
        method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: body.status })
      });
      if (!r.ok) return sendJSON(res, 502, { error: 'update failed', detail: await r.text() });
      return sendJSON(res, 200, { ok: true });
    } catch (e) { return sendJSON(res, 502, { error: 'update failed' }); }
  }

  // clients write proxy (POST/PATCH/DELETE) — service key handles RLS
  if (urlPath === '/api/clients' && req.method === 'POST') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    const allowed = ['name','company','position','niche','what_they_do','instagram_handle','mrr','status','phase','phase_step','client_since','client_score','next_action','next_action_due','icp','notes','emoji'];
    const row = {}; for (const k of allowed) if (k in body) row[k] = body[k];
    if (!row.name) return sendJSON(res, 400, { error: 'name required' });
    row.created_at = new Date().toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/clients`, { method: 'POST', headers: { ...SB_HEADERS, Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!r.ok) return sendJSON(res, 502, { error: await r.text() });
    return sendJSON(res, 200, { ok: true, data: await r.json() });
  }
  const clientIdMatch = urlPath.match(/^\/api\/clients\/([0-9a-f-]{36})$/);
  if (clientIdMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const cid = clientIdMatch[1];
    if (req.method === 'DELETE') {
      const r = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${cid}`, { method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' } });
      return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
    }
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    const allowed = ['name','company','position','niche','what_they_do','instagram_handle','mrr','status','phase','phase_step','client_since','client_score','next_action','next_action_due','icp','notes','emoji'];
    const patch = { updated_at: new Date().toISOString() }; for (const k of allowed) if (k in body) patch[k] = body[k];
    const r = await fetch(`${SB_URL}/rest/v1/clients?id=eq.${cid}`, { method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
  }

  // pm_tasks write proxy (POST/PATCH/DELETE) — service key handles RLS
  if (urlPath === '/api/tasks' && req.method === 'POST') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    const allowed = ['title','description','status','priority','assignee','due_date','tags','sort_order','source_comm_id'];
    const row = {}; for (const k of allowed) if (k in body) row[k] = body[k];
    if (!row.title) return sendJSON(res, 400, { error: 'title required' });
    const r = await fetch(`${SB_URL}/rest/v1/pm_tasks`, { method: 'POST', headers: { ...SB_HEADERS, Prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify(row) });
    if (!r.ok) return sendJSON(res, 502, { error: await r.text() });
    return sendJSON(res, 200, { ok: true, data: await r.json() });
  }
  const taskIdMatch = urlPath.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
  if (taskIdMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const tid = taskIdMatch[1];
    if (req.method === 'DELETE') {
      const r = await fetch(`${SB_URL}/rest/v1/pm_tasks?id=eq.${tid}`, { method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' } });
      return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
    }
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
    const allowed = ['title','description','status','priority','assignee','due_date','tags'];
    const patch = { updated_at: new Date().toISOString() }; for (const k of allowed) if (k in body) patch[k] = body[k];
    const r = await fetch(`${SB_URL}/rest/v1/pm_tasks?id=eq.${tid}`, { method: 'PATCH', headers: { ...SB_HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
  }

  // ── Chat message persistence ──────────────────────────────────────────────
  // GET  /api/chat/messages?session_id=xxx  → load history
  // POST /api/chat/messages                 → save one message
  // DELETE /api/chat/messages?session_id=xxx → clear session (new chat)
  if (urlPath === '/api/chat/messages') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

    if (req.method === 'GET') {
      const sid = new URL(req.url, 'http://x').searchParams.get('session_id') || 'default';
      try {
        const r = await fetch(`${SB_URL}/rest/v1/chat_messages?session_id=eq.${encodeURIComponent(sid)}&order=created_at.asc&limit=200`, { headers: SB_HEADERS });
        const rows = await r.json();
        return sendJSON(res, 200, Array.isArray(rows) ? rows : []);
      } catch(e) { return sendJSON(res, 502, { error: e.message }); }
    }

    if (req.method === 'POST') {
      let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad json' }); }
      const { session_id = 'default', role, agent, content } = body;
      if (!role || !content) return sendJSON(res, 400, { error: 'role+content required' });
      const row = { session_id, role, content, agent: agent || null };
      const r = await fetch(`${SB_URL}/rest/v1/chat_messages`, { method: 'POST', headers: { ...SB_HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
    }

    if (req.method === 'DELETE') {
      const sid = new URL(req.url, 'http://x').searchParams.get('session_id') || 'default';
      const r = await fetch(`${SB_URL}/rest/v1/chat_messages?session_id=eq.${encodeURIComponent(sid)}`, { method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' } });
      return sendJSON(res, r.ok ? 200 : 502, { ok: r.ok });
    }
  }

  // Agent chat (SSE) — both paths used by dashboard pages
  if (req.method === 'POST' && (urlPath === '/agent/chat' || urlPath === '/api/agent/chat')) {
    await handleAgentChat(req, res); return;
  }

  // ATLAS orchestrator daily run (manual trigger / button)
  if (req.method === 'POST' && (urlPath === '/atlas/run' || urlPath === '/api/atlas/run')) {
    await handleAtlasRun(req, res); return;
  }

  // Live Activity feed — merged stream of ATLAS reports, agent messages, agent runs.
  // Served through the server (service key) since these tables are authenticated-read only.
  if (req.method === 'GET' && (urlPath === '/activity' || urlPath === '/api/activity')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const sb = (p) => fetch(`${SB_URL}/rest/v1/${p}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }).then(r => r.ok ? r.json() : []);
      const sbHdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates' };
      const [reports, comms, activity] = await Promise.all([
        sb('daily_reports?select=report_date,headline,raw_md,created_at&order=created_at.desc&limit=10'),
        sb('agent_comms?select=id,from_agent,to_agent,message,metadata,created_at&order=created_at.desc&limit=60'),
        sb('agent_activity?select=agent_name,output_summary,run_date,created_at&order=created_at.desc&limit=60'),
      ]);

      // Map messy n8n workflow names → canonical agent names
      const AGENT_ALIASES = {
        'atlas': 'Atlas', 'ATLAS': 'Atlas',
        'argus': 'Argus', 'ARGUS': 'Argus',
        'apollo': 'Apollo', 'APOLLO': 'Apollo',
        'hermes': 'Hermes', 'HERMES': 'Hermes',
        'clio': 'Clio', 'CLIO': 'Clio',
        'pulse': 'Argus',                          // Pulse = Argus competitor intel
        'quill': 'Apollo',                         // Quill = Apollo script writer
        'forge': 'Apollo',                         // Forge = Apollo content
        'pilot': 'Clio',                           // Pilot = Clio ops
        'echo': 'Hermes',                          // Echo = Hermes outreach
      };
      const KNOWN_AGENTS = new Set(['Atlas','Argus','Apollo','Hermes','Clio']);
      function normalizeAgent(name) {
        if (!name) return null;
        const trimmed = name.trim();
        if (AGENT_ALIASES[trimmed]) return AGENT_ALIASES[trimmed];
        // Try lowercase match
        const lower = trimmed.toLowerCase();
        for (const [k, v] of Object.entries(AGENT_ALIASES)) {
          if (k.toLowerCase() === lower) return v;
        }
        // Check if it contains a known name
        for (const known of KNOWN_AGENTS) {
          if (trimmed.toLowerCase().includes(known.toLowerCase())) return known;
        }
        return null;
      }

      const VALID_ASSIGNEES = new Set(['atlas','argus','apollo','hermes','clio','micko']);
      const events = [];

      for (const r of reports) {
        events.push({ kind: 'report', agent: 'Atlas', ts: r.created_at, title: r.headline, body: r.raw_md });
      }

      for (const c of comms) {
        const fromAgent = normalizeAgent(c.from_agent) || c.from_agent;
        const toAgent = normalizeAgent(c.to_agent) || c.to_agent || '';
        const isTask = (c.metadata && c.metadata.type) === 'task';
        events.push({ kind: isTask ? 'task' : 'message', agent: fromAgent, to: toAgent, ts: c.created_at, body: c.message });
        // Auto-sync task comms → pm_tasks
        if (isTask && c.id && c.message) {
          const assignee = (c.to_agent || '').toLowerCase();
          // Build a short title (verb + object, max 6 words) from the first sentence
          const firstSentence = (c.message || '').split(/[.\n]/)[0].trim();
          const words = firstSentence.split(/\s+/).slice(0, 6);
          const shortTitle = words.join(' ').replace(/[,;:]+$/, '') || 'Task from Atlas';
          // Description is plain English: what to do, why it matters, no code/jargon
          const row = {
            title: shortTitle,
            description: c.message || null,
            status: 'todo',
            priority: 'high',
            assignee: VALID_ASSIGNEES.has(assignee) ? assignee : null,
            tags: ['atlas'],
            sort_order: new Date(c.created_at).getTime(),
            source_comm_id: String(c.id),
          };
          fetch(`${SB_URL}/rest/v1/pm_tasks`, { method: 'POST', headers: sbHdrs, body: JSON.stringify(row) }).catch((e) => { console.error('[activity] agent task write failed:', e.message); });
        }
        // Auto-create micko task when agent message flags human action needed
        const MICKO_TRIGGERS = /micko (needs to|has to|must|should|just|please|will need to)|needs to be (sent|posted|done|approved) by micko|micko sends|micko posts|blocked|escalat/i;
        if (!isTask && c.message && MICKO_TRIGGERS.test(c.message) && c.id) {
          const firstSentenceMicko = (c.message || '').split(/[.\n]/)[0].trim();
          const wordsMicko = firstSentenceMicko.split(/\s+/).slice(0, 6);
          const shortTitleMicko = `[${fromAgent}] ` + wordsMicko.join(' ').replace(/[,;:]+$/, '');
          const mRow = {
            title: shortTitleMicko,
            description: c.message || null,
            status: 'todo',
            priority: /blocked|escalat/i.test(c.message) ? 'urgent' : 'high',
            assignee: 'micko',
            tags: [fromAgent.toLowerCase(), 'auto-flagged'],
            sort_order: new Date(c.created_at).getTime(),
            source_comm_id: 'micko-' + String(c.id),
          };
          fetch(`${SB_URL}/rest/v1/pm_tasks`, { method: 'POST', headers: sbHdrs, body: JSON.stringify(mRow) }).catch((e) => { console.error('[activity] micko task write failed:', e.message); });
        }
      }

      // Add agent_activity rows — normalize agent name, skip unrecognizable ones
      for (const a of activity) {
        const agentName = normalizeAgent(a.agent_name);
        if (!agentName) continue;
        const ts = a.created_at || a.run_date;
        events.push({ kind: 'activity', agent: agentName, ts, body: a.output_summary });
      }

      // Real agent replies come from agent_comms (written by /agent/run on completion).
      // No synthetic replies — if an agent hasn't run yet, nothing shows.

      events.sort((x, y) => new Date(y.ts) - new Date(x.ts));
      return sendJSON(res, 200, { events: events.slice(0, 80) });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // Clear agent_comms (chat history reset)
  if (req.method === 'POST' && (urlPath === '/activity/clear' || urlPath === '/api/activity/clear')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const r = await fetch(`${SB_URL}/rest/v1/agent_comms?id=gt.0`, {
        method: 'DELETE',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
      });
      if (!r.ok) throw new Error(`Supabase DELETE failed: ${r.status}`);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // n8n scriptwriter routes — /skill/:name and /generate
  const shortSkillMatch = urlPath.match(/^\/skill\/([a-z0-9-]+)$/);
  if (shortSkillMatch && req.method === 'GET') { handleSkillGet(req, res, shortSkillMatch[1]); return; }
  if (urlPath === '/generate' && req.method === 'POST') { await handleGenerate(req, res); return; }

  // Skill editor
  const skillMatch = urlPath.match(SKILL_ROUTE);
  if (skillMatch) {
    if (req.method === 'GET') { handleSkillGet(req, res, skillMatch[1]); return; }
    if (req.method === 'POST') { await handleSkillSave(req, res, skillMatch[1]); return; }
  }

  // Competitor config (research page)
  if (urlPath === '/config') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET') { sendJSON(res, 200, readConfig()); return; }
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { sendJSON(res, 400, { error: 'Invalid JSON' }); return; }
      const cfg = readConfig();
      if (Array.isArray(body.competitors)) cfg.competitors = body.competitors.map(String).slice(0, 20);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      sendJSON(res, 200, cfg); return;
    }
  }

  // Argus intel results (research page)
  if (req.method === 'GET' && urlPath === '/argus/results') {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const data = JSON.parse(fs.readFileSync(ARGUS_RESULTS_PATH, 'utf8'));
      sendJSON(res, 200, data);
    } catch (e) { sendJSON(res, 200, { error: 'no_results' }); }
    return;
  }

  // Serve static files for GET requests
  if (req.method === 'GET') { serveStatic(req, res); return; }

  // Trigger Apollo workflow via n8n API
  if (req.method === 'POST' && req.url === '/run-apollo') {
    if (!checkAuth(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    try {
      const r = await fetch(`${N8N_URL}/api/v1/workflows/${APOLLO_WORKFLOW_ID}/run`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || JSON.stringify(data));
      console.log('[Apollo] Triggered:', data.data?.executionId || data);
      nexusAlert('✍️ *Apollo* triggered — scripts generating now');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, executionId: data.data?.executionId }));
    } catch(e) {
      console.error('[Apollo] Error:', e.message);
      nexusAlert(`❌ *Apollo* trigger failed — ${e.message}`);
      await logError('run-apollo', e.message, {});
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // Run an agent task via Claude CLI
  if (req.method === 'POST' && req.url === '/agent/run') {
    if (!checkAuth(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch(e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
    }
    const { id, agent, task, ideaTitle, funnelStage } = body;
    if (!agent || !task) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing agent or task' })); return;
    }
    const ALLOWED_AGENTS = ['apollo', 'hermes', 'clio', 'argus', 'atlas', 'nexus'];
    if (!ALLOWED_AGENTS.includes(agent.toLowerCase())) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown agent' })); return;
    }
    // Strip prompt injection attempts before embedding user input in agent prompts
    const sanitizeInput = (s) => typeof s === 'string' ? s.replace(/---\s*[\w\s]*---/g, '').replace(/IGNORE\s+(ABOVE|PREVIOUS|ALL)/gi, '').slice(0, 500) : s;
    const safeTask = sanitizeInput(task);
    const safeIdeaTitle = sanitizeInput(ideaTitle);
    const safeFunnelStage = sanitizeInput(funnelStage);

    // Build skill path
    const skillName = agent.toLowerCase();
    const skillPaths = [
      path.join(os.homedir(), `.claude/plugins/cache/inboundos-ctrl/inboundos-ctrl-skills/1.0.0/skills/${skillName}/SKILL.md`),
      path.join(os.homedir(), `.claude/skills/${skillName}.md`),
    ];
    let skillContent = '';
    for (const sp of skillPaths) {
      try { skillContent = fs.readFileSync(sp, 'utf8'); break; } catch(e) { console.error(`[${agent}] skill read failed at ${sp}:`, e.message); }
    }

    const prompt = `You are ${agent}, an InboundOS AI agent.

## STEP 0 — Check your task queue first (always do this before anything else)
Run this command to read your open tasks:
  node "${SB_QUERY}" pm_tasks "id,title,description,priority" "assignee=eq.${skillName}&status=in.(todo,in_progress)&order=priority.desc,created_at.asc"

If there are open tasks:
- Work through them in order (urgent first, then high, then others).
- For each task: do what the description says, then remember the task id — you'll report it in your summary.
- If a task is already in_progress (you or a prior run started it), finish it or note why it's blocked.

If there are no open tasks, skip to the triggered task below.

## TRIGGERED TASK
${safeTask}${safeIdeaTitle ? ` Content idea: "${safeIdeaTitle}".` : ''}${safeFunnelStage ? ` Funnel stage: ${safeFunnelStage}.` : ''}

${skillContent ? `--- SKILL ---\n${skillContent.slice(0, 8000)}\n--- END SKILL ---\n\n` : ''}Complete all work above. Return ONLY a JSON object with this structure:
{
  "kind": "${skillName}_result",
  "summary": "one sentence: what tasks you ran and what got done",
  "output": "the full output text, scripts, or results"
}`;

    console.log(`[${agent}] Running task: ${task}`);

    // Find matching pm_tasks row by id (if provided) or source_comm_id
    const patchTask = async (status) => {
      if (!id) return;
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(id)) return;
      await fetch(`${SB_URL}/rest/v1/pm_tasks?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      }).catch((e) => console.error(`[${agent}] pm_tasks patch failed:`, e.message));
    };

    await patchTask('in_progress');

    try {
      const result = await new Promise((resolve, reject) => {
        const args = ['-p', '--allowedTools', `Read,Write,Bash(node ${SB_QUERY}:*)`, prompt];
        execFile('claude', args, { timeout: 120000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          let text = stdout.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
          try { resolve(JSON.parse(text)); }
          catch(e) { resolve({ kind: `${skillName}_result`, summary: task, output: text }); }
        });
      });
      console.log(`[${agent}] Done: ${result.summary || 'complete'}`);
      await patchTask('done');
      nexusAlert(`✅ *${agent}* done — ${result.summary || task}`);
      // Log to agent_activity
      fetch(`${SB_URL}/rest/v1/agent_activity`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agent, run_date: new Date().toISOString().slice(0,10), output_summary: result.summary || safeTask, raw_json: { task: safeTask } })
      }).catch((e) => { console.error(`[${agent}] activity log failed:`, e.message); });
      // Write real reply to agent_comms so activity feed shows actual status, not fake ack
      fetch(`${SB_URL}/rest/v1/agent_comms`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_agent: agent.toUpperCase(), to_agent: 'ATLAS', message: result.summary || safeTask, metadata: { type: 'status', status: 'done' } })
      }).catch((e) => { console.error(`[${agent}] comms log failed:`, e.message); });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ task: { id, agent, task, status: 'done', progress: 100, result, updatedAt: Date.now() } }));
    } catch(e) {
      await patchTask('todo');
      console.error(`[${agent}] Error:`, e.message);
      nexusAlert(`❌ *${agent}* failed — ${e.message}`);
      await logError(`agent/${agent}`, e.message, { task });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

// ── Instagram Graph API ──
  if (req.method === 'POST' && urlPath.startsWith('/instagram/')) {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
  }
  if (req.method === 'POST' && urlPath === '/instagram/profile') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const fields = 'id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website';
      const r = await fetch(`https://graph.instagram.com/v21.0/me?fields=${fields}&access_token=${IG_TOKEN}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && urlPath === '/instagram/media') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
      const r = await fetch(`https://graph.instagram.com/v21.0/me/media?fields=${fields}&limit=50&access_token=${IG_TOKEN}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && urlPath === '/instagram/insights') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const b = JSON.parse(await readBody(req));
      const mediaId = b.media_id;
      if (!mediaId) return sendJSON(res, 400, { error: 'media_id required' });
      const metrics = 'reach,impressions,plays,saved,shares,total_interactions';
      const r = await fetch(`https://graph.instagram.com/v21.0/${mediaId}/insights?metric=${metrics}&access_token=${IG_TOKEN}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  // List DM conversations (threads)
  if (req.method === 'POST' && urlPath === '/instagram/dms') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const fields = 'id,participants,updated_time,message_count';
      const r = await fetch(`https://graph.instagram.com/v21.0/me/conversations?platform=instagram&fields=${fields}&limit=30&access_token=${IG_TOKEN}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  // Get messages in a specific thread
  if (req.method === 'POST' && urlPath === '/instagram/dm-thread') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const b = JSON.parse(await readBody(req));
      const threadId = b.thread_id;
      if (!threadId) return sendJSON(res, 400, { error: 'thread_id required' });
      const fields = 'id,message,from,to,created_time,attachments';
      const r = await fetch(`https://graph.instagram.com/v21.0/${threadId}/messages?fields=${fields}&limit=50&access_token=${IG_TOKEN}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  // Send a DM reply
  if (req.method === 'POST' && urlPath === '/instagram/dm-reply') {
    if (!IG_TOKEN) return sendJSON(res, 500, { error: 'IG_ACCESS_TOKEN not set in .env' });
    try {
      const b = JSON.parse(await readBody(req));
      const { recipient_id, message } = b;
      if (!recipient_id || !message) return sendJSON(res, 400, { error: 'recipient_id and message required' });
      const r = await fetch(`https://graph.instagram.com/v21.0/me/messages?access_token=${IG_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipient_id }, message: { text: message } })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error.message);
      return sendJSON(res, 200, data);
    } catch(e) { return sendJSON(res, 500, { error: e.message }); }
  }

  if (req.method !== 'POST' || req.url !== '/qualify') {
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
  }

  if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });

  const clientIP = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded — max 20 requests/min per IP' }));
    return;
  }

  // Per-user rate limit (JWT sub) — catches VPN rotation bypasses
  const jwtSub = extractJwtSub(req);
  if (jwtSub && !checkUserRateLimit(jwtSub)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded — max 30 requests/min per user' }));
    return;
  }

  let body;
  try { body = JSON.parse(await readBody(req)); } catch(e) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
  }

  const images = body.images || [];
  if (!images.length) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'No images provided' })); return;
  }

  const results = [];
  for (let i = 0; i < images.length; i++) {
    try {
      console.log(`[${i+1}/${images.length}] Qualifying screenshot…`);
      const lead = await qualifyImage(images[i]);
      console.log(`  → @${lead.ig_handle} | ${lead.qualifier}${lead.disqualified ? ' | DISQUALIFIED' : ''}`);
      const saved = await saveToSupabase(lead);
      if (saved.duplicate) {
        console.log(`  ⚠ Duplicate skipped: @${lead.ig_handle}`);
        results.push({ success: false, duplicate: true, ig_handle: lead.ig_handle, error: `Duplicate: @${lead.ig_handle} already in CRM` });
      } else {
        results.push({ success: true, lead, saved: saved[0] || null });
      }
    } catch(e) {
      console.error(`  ✗ Error:`, e.message);
      results.push({ success: false, error: e.message });
      await logError('qualify-server', e.message, { index: i });
    }
  }

  const added = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r.duplicate).length;
  if (added > 0) nexusAlert(`✅ Hermes qualified *${added}* lead${added > 1 ? 's' : ''} → CRM${failed ? ` · ${failed} failed` : ''}`);
  if (failed > 0 && added === 0) nexusAlert(`⚠️ Hermes qualify failed — ${failed} error${failed > 1 ? 's' : ''}. Check server.`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ results }));
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
  nexusAlert(`🚨 qualify-server crashed: ${err.message.slice(0, 200)}`);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const n of iface) {
      if (n.family === 'IPv4' && !n.internal) { localIP = n.address; break; }
    }
  }
  console.log(`\n✓ InboundOS running at:`);
  console.log(`  Mac:   http://localhost:${PORT}/micko-cruz/agents`);
  console.log(`  Phone: http://${localIP}:${PORT}/micko-cruz/agents`);
  console.log(`  n8n:   ${N8N_URL}\n`);
});
