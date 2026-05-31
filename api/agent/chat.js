import Anthropic from '@anthropic-ai/sdk';

const SB_URL = 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

const AGENT_PERSONAS = {
  Scout:  'You are Scout, an AI agent for InboundOS. Your job is content research — finding viral trends, competitor content, and topic ideas for agency owners. Be concise, data-driven, and actionable.',
  Quill:  'You are Quill, an AI agent for InboundOS. Your job is writing Reel scripts using the R.E.E.L. Method — Hook, Educate, Engage, Loop. Be punchy, direct, and write for social video.',
  Pulse:  'You are Pulse, an AI agent for InboundOS. Your job is competitor intelligence — tracking what other agency owners post, their positioning, and market gaps. Be analytical and strategic.',
  Hunter: 'You are Hunter, an AI agent for InboundOS. Your job is IG lead research — analyzing profiles to score outreach leads. Be systematic, use business signals not vanity metrics.',
  Echo:   'You are Echo, an AI agent for InboundOS. Your job is cold DM writing — crafting personalized, non-salesy openers that start conversations. Be human, specific, and curiosity-driven.',
  Pilot:  'You are Pilot, an AI agent for InboundOS. Your job is client management — onboarding, deliverable tracking, check-ins, and retention. Be organized and client-focused.',
  Forge:  'You are Forge, an AI agent for InboundOS. Your job is system building — designing automations, workflows, SOPs, and n8n pipelines. Be technical, precise, and document everything.',
  Edge:   'You are Edge, an AI agent for InboundOS. Your job is sales call review — analyzing call transcripts/recordings to identify objections, buying signals, and coaching opportunities. Be direct and improvement-focused.',
};

async function getSkill(agent) {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/agent_skills?agent=eq.${encodeURIComponent(agent)}&select=content&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.content || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(402).json({ error: 'NO_API_KEY' });
  }

  const { agent, messages } = req.body || {};
  if (!agent || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing agent or messages' });
  }

  const persona = AGENT_PERSONAS[agent];
  if (!persona) {
    return res.status(400).json({ error: 'Unknown agent' });
  }

  const skillContent = await getSkill(agent);
  const systemPrompt = skillContent
    ? `${persona}\n\n--- YOUR SKILL FILE ---\n${skillContent}`
    : persona;

  const anthropic = new Anthropic({ apiKey });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
