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
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8806106449:AAH9ROFiHxmz6FvOcWffL_ra8R34q7hEn0I';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '956012734';

async function nexusAlert(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🤖 InboundOS\n${msg}`, parse_mode: 'Markdown' })
    });
  } catch(e) { /* non-fatal */ }
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
const QUILL_WORKFLOW_ID = process.env.QUILL_WORKFLOW_ID || '0QoReLvsYWUaIrIO';

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
  "opener_text": "the Stage 1 cold DM opener — follow this exact format: 'hey [first name], i love your content — [1 specific personalized detail from their profile: a stat, achievement, niche angle, or something unique you noticed]. [smooth transition phrase — vary between: 'i did notice X though,', 'only thing is i noticed X,', 'one thing i did notice though, X'] you haven't been posting consistently, so i went ahead and built an AI scriptwriter trained for [their niche] — hooks, frameworks, anti-AI vocab & all that, what's a good email i can send it to?' — all lowercase, casual, never start a sentence with I except after a comma, personalized detail must be specific not generic",
  "notes": "the specific profile detail you used to personalize — must be verifiable from the screenshot: a stat, years of experience, press mention, client result, unique positioning, or specific content angle. never use 'great content' or generic compliments"
}

Qualifier (based on business signal, NOT follower count):
- hot: clear business offer + active content + link in bio or story highlights showing services/results
- warm: has a business niche but missing link, highlights, or recent activity
- cold: no clear offer, looks personal, inactive, or no business signal at all

has_offer: true if they have ANY of — link in bio pointing to an offer/service, story highlights showing clients/results/services/FAQ, bio that mentions a service or product. false if purely personal account with no business signals.

DISQUALIFY only if ALL of these are true: no business offer visible, no service/product mentioned anywhere, looks like a pure personal/consumer account with no intent to sell anything.
Follower count alone is NEVER a disqualify reason.

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
    const args = ['-p', '--add-dir', os.tmpdir(), '--dangerously-skip-permissions', promptWithImage];
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
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' };

// Slug-based routes: /{slug}/{page} → /dashboard/{page}.html
const SLUG_PAGES = ['agents','pipeline','performance','research','clients','sales-calls',
  'sops','org-chart','crm','command','vault','chat','edge','metrics','roi','database'];

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

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  // Allow any local network origin (192.168.x.x, 10.x.x.x, 172.16-31.x.x) plus known origins
  const isLocalNetwork = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);
  const allowedOrigins = ['https://inboundos.vercel.app'];
  res.setHeader('Access-Control-Allow-Origin', (isLocalNetwork || allowedOrigins.includes(origin)) ? origin : 'http://localhost:3001');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve static files for GET requests
  if (req.method === 'GET') { serveStatic(req, res); return; }

  // Trigger Quill workflow via n8n API
  if (req.method === 'POST' && req.url === '/run-quill') {
    try {
      const r = await fetch(`${N8N_URL}/api/v1/workflows/${QUILL_WORKFLOW_ID}/run`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || JSON.stringify(data));
      console.log('[Quill] Triggered:', data.data?.executionId || data);
      nexusAlert('✍️ *Quill* triggered — scripts generating now');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, executionId: data.data?.executionId }));
    } catch(e) {
      console.error('[Quill] Error:', e.message);
      nexusAlert(`❌ *Quill* trigger failed — ${e.message}`);
      await logError('run-quill', e.message, {});
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // Run an agent task via Claude CLI
  if (req.method === 'POST' && req.url === '/agent/run') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch(e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
    }
    const { id, agent, task, ideaTitle, funnelStage } = body;
    if (!agent || !task) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing agent or task' })); return;
    }

    // Build skill path
    const skillName = agent.toLowerCase();
    const skillPaths = [
      path.join(os.homedir(), `.claude/plugins/cache/inboundos-ctrl/inboundos-ctrl-skills/1.0.0/skills/${skillName}/SKILL.md`),
      path.join(os.homedir(), `.claude/skills/${skillName}.md`),
    ];
    let skillContent = '';
    for (const sp of skillPaths) {
      try { skillContent = fs.readFileSync(sp, 'utf8'); break; } catch(e) {}
    }

    const prompt = `You are ${agent}, an InboundOS AI agent. Your task: ${task}.${ideaTitle ? ` Content idea to work with: "${ideaTitle}".` : ''}${funnelStage ? ` Funnel stage: ${funnelStage}.` : ''}

${skillContent ? `--- SKILL ---\n${skillContent.slice(0, 8000)}\n--- END SKILL ---\n\n` : ''}Complete the task. Return ONLY a JSON object with this structure:
{
  "kind": "${skillName}_result",
  "summary": "one sentence summary of what was done",
  "output": "the full output text, script, or result"
}`;

    console.log(`[${agent}] Running task: ${task}`);
    try {
      const result = await new Promise((resolve, reject) => {
        const args = ['-p', '--dangerously-skip-permissions', prompt];
        execFile('claude', args, { timeout: 120000, maxBuffer: 1024 * 1024 * 8 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          let text = stdout.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
          try { resolve(JSON.parse(text)); }
          catch(e) { resolve({ kind: `${skillName}_result`, summary: task, output: text }); }
        });
      });
      console.log(`[${agent}] Done: ${result.summary || 'complete'}`);
      nexusAlert(`✅ *${agent}* done — ${result.summary || task}`);
      // Feature G: Log to Supabase agent_activity for persistent activity log
      fetch(`${SB_URL}/rest/v1/agent_activity`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agent, run_date: new Date().toISOString().slice(0,10), output_summary: result.summary || task, raw_json: { task } })
      }).catch(() => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ task: { id, agent, task, status: 'done', progress: 100, result, updatedAt: Date.now() } }));
    } catch(e) {
      console.error(`[${agent}] Error:`, e.message);
      nexusAlert(`❌ *${agent}* failed — ${e.message}`);
      await logError(`agent/${agent}`, e.message, { task });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/qualify') {
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
  }

  const clientIP = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded — max 20 requests/min' }));
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
  if (added > 0) nexusAlert(`✅ Echo qualified *${added}* lead${added > 1 ? 's' : ''} → CRM${failed ? ` · ${failed} failed` : ''}`);
  if (failed > 0 && added === 0) nexusAlert(`⚠️ Echo qualify failed — ${failed} error${failed > 1 ? 's' : ''}. Check server.`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ results }));
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
