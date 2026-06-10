import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '../_rateLimit.js';

// Daily brief — summarizes today's board + habits with Claude Fable 5.

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';
const HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (!(await checkRateLimit(`planner-brief:${ip}`, 10, 60_000))) {
    return res.status(429).json({ error: 'rate limited' });
  }

  const cycle = String(req.query.cycle || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (!cycle) return res.status(400).json({ error: 'cycle=YYYY-MM-DD required' });

  try {
    const [tasks, habits] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/planner_tasks?cycle_date=eq.${cycle}&select=title,block,lane,priority,status,carried`, { headers: HEADERS }).then(r => r.json()),
      fetch(`${SB_URL}/rest/v1/habit_logs?date=eq.${cycle}&done=eq.true&select=habit`, { headers: HEADERS }).then(r => r.json()),
    ]);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-fable-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      system: `You write a terse daily brief for Micko's life planner. Blocks: Promote 1-5PM (content/DMs), Fulfill 6-10PM (client work), Build 11PM-3AM (systems). Style: short, punchy, numbers first, no fluff. Max 6 lines. Call out: heaviest block, carried tasks (clear them first), missing habits (protein 176g, creatine, workout matter most), and one focus directive for the day.`,
      messages: [{
        role: 'user',
        content: `Cycle ${cycle}\nTasks: ${JSON.stringify(tasks)}\nHabits done: ${JSON.stringify(habits.map(h => h.habit))}`,
      }],
    });
    if (msg.stop_reason === 'refusal' || !msg.content.length) {
      return res.status(200).json({ brief: 'Brief unavailable.' });
    }
    const brief = msg.content.find(b => b.type === 'text')?.text || 'Brief unavailable.';
    return res.status(200).json({ brief });
  } catch (e) {
    return res.status(500).json({ error: 'brief failed' });
  }
}
