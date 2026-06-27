// hermes-scrape — weekly Instagram lead sourcing for InboundOS / Hermes
//
// Flow (all server-side on Supabase's network, so Apify is reachable):
//   1. Run Apify instagram-scraper on each hashtag -> collect post authors
//   2. Run Apify instagram-scraper on those profiles -> follower count + bio
//   3. Dedupe against outreach_leads
//   4. ICP filter (1K-100K followers, solo DFY, drop coach/course/disqualifies)
//   5. Insert survivors at stage 0 (no opener — openers are written later)
//
// Secrets required (Supabase Dashboard -> Edge Functions -> Secrets):
//   APIFY_TOKEN   — your Apify API token
// Auto-injected by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2";

const APIFY_TOKEN = Deno.env.get("APIFY_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APIFY_ACTOR = "apify~instagram-scraper";

// Default niches to mine if the caller doesn't pass any.
const DEFAULT_HASHTAGS = [
  "smma", "smmaagency", "leadgenagency", "coldoutreach",
  "contentagency", "ugcagency", "videoagency", "marketingagency",
];

// ICP gates from icp_profile / agent_memory.
const MIN_FOLLOWERS = 1000;
const MAX_FOLLOWERS = 100000;
// Bio signals that an account is a coach/course/creator, or a disqualify signal.
const NEGATIVE = [
  "coach", "course", "mentor", "masterclass", "academy", "cohort",
  "ebook", "free guide", "free training", "link in bio for free",
  "founder & ceo", "we are hiring", "team of",
];
// Bio signals of an active DFY service offering.
const POSITIVE = [
  "dfy", "done for you", "done-for-you", "agency", "we manage",
  "i help", "book a call", "clients", "lead gen", "appointments",
  "content", "social media management", "smma", "ugc", "ghostwriting",
];

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

function qualify(p: Profile): { ok: boolean; reason?: string; score: number } {
  const f = p.followersCount ?? 0;
  if (p.private) return { ok: false, reason: "private account", score: 0 };
  if (f < MIN_FOLLOWERS) return { ok: false, reason: `under 1K (${f})`, score: 0 };
  if (f > MAX_FOLLOWERS) return { ok: false, reason: `over 100K (${f})`, score: 0 };
  const bio = (p.biography ?? "").toLowerCase();
  if (!bio) return { ok: false, reason: "empty bio", score: 0 };
  if (NEGATIVE.some((w) => bio.includes(w))) {
    return { ok: false, reason: "coach/course/team signal", score: 0 };
  }
  const hits = POSITIVE.filter((w) => bio.includes(w)).length;
  if (hits === 0) return { ok: false, reason: "no DFY service signal", score: 0 };
  // Desperation-to-sophistication: smaller accounts score higher (closer to ICP).
  const sizeScore = f < 10000 ? 3 : f < 30000 ? 2 : 1;
  return { ok: true, score: Math.min(10, hits + sizeScore + 3) };
}

Deno.serve(async (req) => {
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const hashtags: string[] = body.hashtags ?? DEFAULT_HASHTAGS;
    const postsPerTag: number = body.postsPerTag ?? 40;
    const target: number = body.target ?? 100;
    const dryRun: boolean = body.dryRun ?? false;

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Existing handles -> skip set
    const { data: existing, error: exErr } = await sb
      .from("outreach_leads").select("ig_handle");
    if (exErr) throw exErr;
    const seen = new Set((existing ?? []).map((r) => r.ig_handle?.toLowerCase()));

    // 1. Collect candidate usernames from hashtag posts
    const posts = await apify({
      search: hashtags.join(" "),
      searchType: "hashtag",
      searchLimit: hashtags.length,
      resultsType: "posts",
      resultsLimit: postsPerTag,
      addParentData: false,
    });
    const candidates = Array.from(
      new Set(
        posts.map((x: any) => x.ownerUsername)
          .filter((u: string) => u && !seen.has(u.toLowerCase())),
      ),
    ).slice(0, target * 6); // over-scrape; most get filtered

    if (candidates.length === 0) {
      return Response.json({ ok: true, candidates: 0, qualified: 0, note: "no new candidates" });
    }

    // 2. Fetch profile details (follower count + bio)
    const profiles: Profile[] = await apify({
      directUrls: candidates.map((u) => `https://www.instagram.com/${u}/`),
      resultsType: "details",
      resultsLimit: candidates.length,
    });

    // 3 + 4. Qualify
    const rows: any[] = [];
    const rejected: Record<string, number> = {};
    for (const p of profiles) {
      if (!p.username || seen.has(p.username.toLowerCase())) continue;
      const v = qualify(p);
      if (!v.ok) { rejected[v.reason!] = (rejected[v.reason!] ?? 0) + 1; continue; }
      seen.add(p.username.toLowerCase());
      rows.push({
        ig_handle: p.username,
        full_name: p.fullName ?? null,
        follower_count: p.followersCount ?? null,
        bio_notes: p.biography ?? null,
        stage: 0,
        source: "hermes_apify",
        approved: false,
        dm_sent: false,
        qualifier: `DFY bio signal, ${p.followersCount} followers, ${p.postsCount ?? "?"} posts`,
        notes: JSON.stringify({
          score: v.score,
          profile_url: `https://instagram.com/${p.username}`,
          posts_count: p.postsCount ?? null,
          platforms_found: ["ig"],
          opener_pattern_used: null,
          sourced_by: "hermes-scrape edge fn",
        }),
      });
      if (rows.length >= target) break;
    }

    if (dryRun) {
      return Response.json({
        ok: true, dryRun: true, candidates: candidates.length,
        qualified: rows.length, rejected, sample: rows.slice(0, 5),
      });
    }

    let inserted = 0;
    if (rows.length) {
      const { error: insErr, count } = await sb
        .from("outreach_leads").insert(rows, { count: "exact" });
      if (insErr) throw insErr;
      inserted = count ?? rows.length;
    }

    return Response.json({
      ok: true, candidates: candidates.length, qualified: rows.length,
      inserted, rejected,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
