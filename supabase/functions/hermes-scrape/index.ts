// hermes-scrape — weekly Instagram lead sourcing for InboundOS / Hermes
//
// Strategy: mine the ENGAGERS of competitor accounts (their audience IS agency
// owners), not random hashtags. Cheap discovery + budget-capped enrichment.
//
// Two phases (body.phase):
//   "discover" — for each competitor seed: recent posts -> commenters ->
//                pre-filter faceless handles -> dedupe -> queue in lead_candidates
//   "enrich"   — pull a batch of pending candidates -> Apify profile details ->
//                qualify (1K-100K, DFY signal, personal brand) -> insert stage 0.
//                Respects a rolling weekly enrichment cap so spend stays bounded.
//
// Run weekly: discover once, then enrich on a short interval until cap/queue empty.
//
// Secrets: APIFY_TOKEN. Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "jsr:@supabase/supabase-js@2";

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APIFY_ACTOR = "apify~instagram-scraper";

const DEFAULT_SEEDS = ["seanpurvis.ai", "chriswesst", "innovalos"];
const POSTS_PER_SEED = 10;
const COMMENTS_PER_POST = 30;
const ENRICH_BATCH = 30;     // profiles per enrich invocation (fits Apify sync)
const WEEKLY_CAP = 500;      // max enrichments per rolling 7 days (cost ceiling)

// ICP gates.
const MIN_FOLLOWERS = 1000;
const MAX_FOLLOWERS = 100000;
const NEGATIVE = [
  "coach", "course", "mentor", "masterclass", "academy", "cohort",
  "ebook", "free guide", "free training", "link in bio for free",
  "founder & ceo", "we are hiring", "team of",
];
const POSITIVE = [
  "dfy", "done for you", "done-for-you", "i manage", "i help", "book a call",
  "clients", "lead gen", "appointments", "content", "social media management",
  "smma", "ugc", "ghostwriting",
];
const BRAND_WORDS = [
  "agency", "media", "studio", "studios", "collective", "labs", "group",
  "solutions", "systems", "consulting", "consultancy", "co.", "marketing co",
  "agence", "agncy", "agcy", "& co", "the agency", "socials", "creatives",
];
// Cheap pre-enrichment handle filter: drop obvious faceless brand handles
// before paying to look them up. Conservative so we keep ambiguous people.
const FACELESS_HANDLE = /(agency|\bmedia\b|studio|collective|labs|consult|socials)/;

type Profile = {
  username: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  postsCount?: number;
  private?: boolean;
};

async function apify(input: unknown): Promise<any[]> {
  const url =
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
    `?token=${APIFY_TOKEN}&clean=true`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${r.status}: ${await r.text()}`);
  return await r.json();
}

// A human's account, even if they mention an agency. Reject only pure faceless.
function isPersonalBrand(p: Profile): { ok: boolean; reason?: string } {
  const bio = (p.biography ?? "").toLowerCase();
  const firstPerson = /(^|\W)(i|i'm|im|my|me)(\W|$)|i help|i build|i grow|i run/
    .test(bio);
  const namePart = (p.fullName ?? "").split(/[|•\-–·,]/)[0].trim();
  const nameTokens = namePart.split(/\s+/).filter(Boolean);
  const personName = nameTokens.length >= 2 &&
    nameTokens.slice(0, 2).every((t) => /^[A-Za-z][A-Za-z.'’]+$/.test(t)) &&
    !BRAND_WORDS.some((w) => namePart.toLowerCase().includes(w));
  if (firstPerson || personName) return { ok: true };
  const blob = `${(p.username ?? "").toLowerCase()} ${(p.fullName ?? "").toLowerCase()}`;
  if (BRAND_WORDS.some((w) => blob.includes(w))) {
    return { ok: false, reason: "faceless: brand account, no person" };
  }
  if (/(^|\W)(we|our|us|team)(\W|$)/.test(bio)) {
    return { ok: false, reason: "faceless: we/our bio, no person" };
  }
  return { ok: false, reason: "no personal-brand signal" };
}

function qualify(p: Profile): { ok: boolean; reason?: string; score: number } {
  const f = p.followersCount ?? 0;
  if (p.private) return { ok: false, reason: "private account", score: 0 };
  if (f < MIN_FOLLOWERS) return { ok: false, reason: "under 1K", score: 0 };
  if (f > MAX_FOLLOWERS) return { ok: false, reason: "over 100K", score: 0 };
  const bio = (p.biography ?? "").toLowerCase();
  if (!bio) return { ok: false, reason: "empty bio", score: 0 };
  if (NEGATIVE.some((w) => bio.includes(w))) {
    return { ok: false, reason: "coach/course/team signal", score: 0 };
  }
  const hits = POSITIVE.filter((w) => bio.includes(w)).length;
  if (hits === 0) return { ok: false, reason: "no DFY service signal", score: 0 };
  const pb = isPersonalBrand(p);
  if (!pb.ok) return { ok: false, reason: pb.reason!, score: 0 };
  const sizeScore = f < 10000 ? 3 : f < 30000 ? 2 : 1;
  return { ok: true, score: Math.min(10, hits + sizeScore + 3) };
}

// ── discover ────────────────────────────────────────────────────────────────
async function discover(sb: any, body: any) {
  const seeds: string[] = body.seeds ?? DEFAULT_SEEDS;
  const postsPerSeed = body.postsPerSeed ?? POSTS_PER_SEED;
  const commentsPerPost = body.commentsPerPost ?? COMMENTS_PER_POST;

  // 1. Recent posts of each competitor seed.
  const posts = await apify({
    directUrls: seeds.map((s) => `https://www.instagram.com/${s}/`),
    resultsType: "posts",
    resultsLimit: postsPerSeed,
    addParentData: false,
  });
  const postUrls = Array.from(
    new Set(posts.map((p: any) => p.url).filter(Boolean)),
  );
  if (postUrls.length === 0) {
    return { ok: true, phase: "discover", postUrls: 0, queued: 0, note: "no posts" };
  }

  // 2. Commenters on those posts = the dense, high-intent pool.
  const comments = await apify({
    directUrls: postUrls,
    resultsType: "comments",
    resultsLimit: commentsPerPost,
    addParentData: false,
  });
  const touches = new Map<string, number>();
  for (const c of comments as any[]) {
    const u = (c.ownerUsername ?? c.username ?? "").toLowerCase();
    if (u) touches.set(u, (touches.get(u) ?? 0) + 1);
  }

  // 3. Dedupe vs pipeline + cheap faceless-handle pre-filter.
  const { data: existing } = await sb.from("outreach_leads").select("ig_handle");
  const seen = new Set((existing ?? []).map((r: any) => r.ig_handle?.toLowerCase()));
  const rows = [...touches.entries()]
    .filter(([u]) => u && !seen.has(u) && !FACELESS_HANDLE.test(u))
    .map(([u, t]) => ({ ig_handle: u, touches: t, status: "pending", seed: seeds.join(",") }));

  let queued = 0;
  if (rows.length) {
    const { error, count } = await sb
      .from("lead_candidates")
      .upsert(rows, { onConflict: "ig_handle", ignoreDuplicates: true, count: "exact" });
    if (error) throw error;
    queued = count ?? rows.length;
  }
  return {
    ok: true, phase: "discover", seeds, postUrls: postUrls.length,
    commenters: touches.size, queued,
  };
}

// ── enrich ──────────────────────────────────────────────────────────────────
async function enrich(sb: any, body: any) {
  const cap = body.cap ?? WEEKLY_CAP;
  const batchSize = body.batch ?? ENRICH_BATCH;
  const dryRun = body.dryRun ?? false;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // Rolling weekly enrichment cap (cost ceiling).
  const { count: processedThisWeek } = await sb
    .from("lead_candidates").select("*", { count: "exact", head: true })
    .neq("status", "pending").gte("processed_at", weekAgo);
  const remaining = cap - (processedThisWeek ?? 0);
  if (remaining <= 0) {
    return { ok: true, phase: "enrich", done: true, reason: "weekly cap reached" };
  }

  const { data: pend } = await sb
    .from("lead_candidates").select("ig_handle, touches")
    .eq("status", "pending").order("touches", { ascending: false })
    .limit(Math.min(batchSize, remaining));
  if (!pend || pend.length === 0) {
    return { ok: true, phase: "enrich", done: true, reason: "queue empty" };
  }

  const profiles: Profile[] = await apify({
    directUrls: pend.map((c: any) => `https://www.instagram.com/${c.ig_handle}/`),
    resultsType: "details",
    resultsLimit: pend.length,
  });
  const byHandle = new Map<string, Profile>();
  for (const p of profiles) if (p.username) byHandle.set(p.username.toLowerCase(), p);

  const now = new Date().toISOString();
  const leadRows: any[] = [];
  let inserted = 0, rejected = 0;
  const sample: any[] = [];

  for (const c of pend as any[]) {
    const p = byHandle.get(c.ig_handle.toLowerCase());
    if (!p) {
      if (!dryRun) {
        await sb.from("lead_candidates").update({
          status: "rejected", reject_reason: "no profile returned", processed_at: now,
        }).eq("ig_handle", c.ig_handle);
      }
      rejected++;
      continue;
    }
    const v = qualify(p);
    if (!v.ok) {
      if (!dryRun) {
        await sb.from("lead_candidates").update({
          status: "rejected", reject_reason: v.reason, processed_at: now,
        }).eq("ig_handle", c.ig_handle);
      }
      rejected++;
      continue;
    }
    const row = {
      ig_handle: p.username,
      full_name: p.fullName ?? null,
      follower_count: p.followersCount ?? null,
      bio_notes: p.biography ?? null,
      stage: 0,
      source: "hermes_apify",
      approved: false,
      dm_sent: false,
      qualifier: `engager of ${c.seed ?? "competitor"}, ${p.followersCount} followers, ${p.postsCount ?? "?"} posts`,
      notes: JSON.stringify({
        score: v.score,
        profile_url: `https://instagram.com/${p.username}`,
        posts_count: p.postsCount ?? null,
        platforms_found: ["ig"],
        opener_pattern_used: null,
        touches: c.touches,
        sourced_by: "hermes-scrape engagers",
      }),
    };
    leadRows.push(row);
    if (sample.length < 5) sample.push({ ig_handle: row.ig_handle, follower_count: row.follower_count, full_name: row.full_name });
  }

  if (dryRun) {
    return { ok: true, phase: "enrich", dryRun: true, batch: pend.length, wouldInsert: leadRows.length, rejected, sample };
  }

  if (leadRows.length) {
    const { error } = await sb.from("outreach_leads")
      .upsert(leadRows, { onConflict: "ig_handle", ignoreDuplicates: true });
    if (error) throw error;
    inserted = leadRows.length;
    await sb.from("lead_candidates").update({ status: "inserted", processed_at: now })
      .in("ig_handle", leadRows.map((r) => r.ig_handle));
  }
  return { ok: true, phase: "enrich", batch: pend.length, inserted, rejected,
    processedThisWeek: (processedThisWeek ?? 0) + pend.length };
}

Deno.serve(async (req) => {
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const phase = body.phase ?? "discover";
    if (phase === "discover") return Response.json(await discover(sb, body));
    if (phase === "enrich") return Response.json(await enrich(sb, body));
    return Response.json({ ok: false, error: `unknown phase: ${phase}` }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? (typeof e === "string" ? e : JSON.stringify(e));
    return Response.json({ ok: false, error: msg, detail: e }, { status: 500 });
  }
});
