import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '../_rateLimit.js';

// Parses a quick-add task string into { title, block, lane, priority } using Claude Fable 5.

const SYSTEM = `You sort tasks for Micko Cruz's life planner. He runs InboundOS (AI consulting agency) and is also a hip-hop artist (Miko Kasino).

Time blocks:
- "promote" (1-5PM): content creation, reels, scripts, posting, DMs, outreach, social media
- "fulfill" (6-10PM): client work, deliverables, client calls, SMM work for Christian/Creative Deals
- "build" (11PM-3AM): systems, automation, n8n workflows, coding, website, agents, deep work

Lanes:
- "inboundos": business tasks (default)
- "music": Miko Kasino — songs, studio, mixing, music industry networking
- "personal": health, errands, family, fitness, appointments

Priority: 1 = urgent/important, 2 = normal (default), 3 = low/someday.

Respond with ONLY a JSON object: {"title": "<cleaned task title>", "block": "promote|fulfill|build", "lane": "inboundos|music|personal", "priority": 1|2|3}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!(await checkRateLimit(`planner-qa:${ip}`, 30, 60_000))) {
    return res.status(429).json({ error: 'rate limited' });
  }

  const text = (req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-fable-5',
      max_tokens: 1000,
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    if (msg.stop_reason === 'refusal' || !msg.content.length) {
      return res.status(200).json({ title: text, block: null, lane: 'inboundos', priority: 2 });
    }
    const out = msg.content.find(b => b.type === 'text')?.text || '';
    const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    return res.status(200).json({
      title: String(json.title || text).slice(0, 200),
      block: ['promote', 'fulfill', 'build'].includes(json.block) ? json.block : null,
      lane: ['inboundos', 'music', 'personal'].includes(json.lane) ? json.lane : 'inboundos',
      priority: [1, 2, 3].includes(json.priority) ? json.priority : 2,
    });
  } catch (e) {
    // fall back gracefully — client inserts with defaults
    return res.status(200).json({ title: text, block: null, lane: 'inboundos', priority: 2 });
  }
}
