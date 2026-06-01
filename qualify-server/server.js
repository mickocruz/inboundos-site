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
const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
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

async function qualifyImage(base64Image) {
  // Write image to temp file
  const tmpImg = path.join(os.tmpdir(), `lead_${Date.now()}.jpg`);
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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, executionId: data.data?.executionId }));
    } catch(e) {
      console.error('[Quill] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/qualify') {
    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
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
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ results }));
});

server.listen(PORT, () => {
  console.log(`\n✓ InboundOS Qualify Server running at http://localhost:${PORT}`);
  console.log(`  POST /qualify  — { images: ["data:image/jpeg;base64,..."] }`);
  console.log(`  Skill: ${SKILL_PATH}`);
  console.log(`  Supabase: ${SB_URL}\n`);
});
