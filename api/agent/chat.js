import Anthropic from '@anthropic-ai/sdk';
import { createHmac, timingSafeEqual } from 'crypto';
import { checkRateLimit } from '../_rateLimit.js';

const SB_URL = process.env.SUPABASE_URL || 'https://cscfbuhwlfhblxprkwnh.supabase.co';
const SB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_1ZqIVolUXpUocXTtHP3yBA_UFNidOD8';

const AGENT_PERSONAS = {
  Argus:  'You are Argus, CIO of InboundOS. Your job is intelligence — content research, viral trends, competitor analysis, and topic angles for agency owners. Be concise, data-driven, and actionable.',
  Apollo: 'You are Apollo, Head of Content for InboundOS. Your job is scripting and content strategy — writing Reel scripts using the R.E.E.L. Method, planning weekly calendars, and repurposing top performers. Be punchy, direct, and write for social video.',
  Hermes: 'You are Hermes, Head of Sales for InboundOS. Your job is outreach — IG lead research, scoring profiles, writing personalized cold DMs, and managing the pipeline. Be systematic and human.',
  Clio:   'You are Clio, COO of InboundOS. Your job is operations — client onboarding, deliverable tracking, weekly check-ins, churn watch, and retention. Be organized, client-focused, and proactive.',
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

function verifySession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.sub) return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;

    // Cryptographic signature verification using Supabase JWT secret
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return false; // fail closed — never skip sig check
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256') return false; // reject alg:none and other algs
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expected = createHmac('sha256', jwtSecret).update(signingInput).digest('base64url');
    const actual = parts[2];
    try {
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return false;
    } catch { return false; }
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inboundos.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!(await checkRateLimit(`chat:${ip}`, 60, 60 * 1000))) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
  }

  if (!verifySession(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(402).json({ error: 'NO_API_KEY' });
  }

  const { agent, messages } = req.body || {};

  // Validate agent
  if (!agent || typeof agent !== 'string' || agent.length > 50) {
    return res.status(400).json({ error: 'Invalid agent' });
  }

  // Validate messages array
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  for (const m of messages) {
    if (!m || typeof m !== 'object') return res.status(400).json({ error: 'Malformed message' });
    if (!['user', 'assistant'].includes(m.role)) return res.status(400).json({ error: 'Invalid message role' });
    if (typeof m.content !== 'string' || m.content.length > 32000) return res.status(400).json({ error: 'Message too large' });
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
