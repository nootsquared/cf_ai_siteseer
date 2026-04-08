// ─── Source Trust Classifier ────────────────────────────────────────────────
// Rules:
//   1. A page cannot be verified by its own origin (including subdomains).
//   2. Major social-media / user-generated platforms are excluded outright.
//   3. Remaining sources are tiered:
//        - primary:   .gov / .edu / official orgs (WHO, NASA, IPCC, IMF, …)
//        - academic:  peer-reviewed journals & preprint archives
//        - factcheck: dedicated fact-checkers + major wire services (AP, Reuters)
//        - news:      everything else reputable enough to keep around
//   4. Higher-tier sources rank above lower-tier ones, then by domain diversity.

export type SourceTier = "primary" | "academic" | "factcheck" | "news" | "excluded";

export type ClassifiedSource = {
  domain: string;
  tier: SourceTier;
  weight: number; // 0..1 — used to weight evidence and to sort
  excludedReason?: "self" | "social" | "blocked";
};

const SOCIAL = new Set([
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.com",
  "fb.watch",
  "instagram.com",
  "twitter.com",
  "x.com",
  "t.co",
  "tiktok.com",
  "reddit.com",
  "linkedin.com",
  "pinterest.com",
  "threads.net",
  "snapchat.com",
  "quora.com",
  "tumblr.com",
  "discord.com",
  "whatsapp.com",
  "telegram.org",
  "mastodon.social",
  "bsky.app",
  "bsky.social",
  "truthsocial.com",
  "rumble.com",
  "vimeo.com",
  "twitch.tv",
]);

// User-generated / encyclopedic sources we don't treat as verifying authorities.
const BLOCKED = new Set([
  "wikipedia.org",
  "simple.wikipedia.org",
  "wikimedia.org",
  "wikiquote.org",
  "fandom.com",
  "medium.com",
  "substack.com",
  "quora.com",
  "answers.com",
  "ehow.com",
  "buzzfeed.com",
  "dailymail.co.uk",
  "thesun.co.uk",
  "infowars.com",
  "naturalnews.com",
  "breitbart.com",
]);

// Peer-reviewed / academic
const ACADEMIC = new Set([
  "nature.com",
  "science.org",
  "sciencemag.org",
  "pnas.org",
  "nejm.org",
  "thelancet.com",
  "cell.com",
  "bmj.com",
  "arxiv.org",
  "biorxiv.org",
  "medrxiv.org",
  "jstor.org",
  "springer.com",
  "link.springer.com",
  "wiley.com",
  "onlinelibrary.wiley.com",
  "sciencedirect.com",
  "plos.org",
  "journals.plos.org",
  "researchgate.net",
  "acm.org",
  "ieee.org",
  "royalsocietypublishing.org",
  "annualreviews.org",
  "scholar.google.com",
  "semanticscholar.org",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
]);

// Major official / inter-governmental bodies
const OFFICIAL = new Set([
  "who.int",
  "un.org",
  "unesco.org",
  "unhcr.org",
  "imf.org",
  "worldbank.org",
  "ipcc.ch",
  "nasa.gov",
  "noaa.gov",
  "nih.gov",
  "cdc.gov",
  "fda.gov",
  "epa.gov",
  "doe.gov",
  "energy.gov",
  "nsf.gov",
  "census.gov",
  "bls.gov",
  "bea.gov",
  "federalreserve.gov",
  "treasury.gov",
  "europa.eu",
  "ec.europa.eu",
  "oecd.org",
  "iea.org",
  "fao.org",
  "wto.org",
  "icrc.org",
  "amnesty.org",
  "supremecourt.gov",
  "congress.gov",
  "gao.gov",
]);

// Dedicated fact-checkers + wire services
const FACTCHECK = new Set([
  "politifact.com",
  "snopes.com",
  "factcheck.org",
  "fullfact.org",
  "poynter.org",
  "leadstories.com",
  "afpfactcheck.com",
  "factcheckni.org",
  "checkyourfact.com",
  "apnews.com",
  "ap.org",
  "reuters.com",
  "afp.com",
]);

function normalize(raw: string): string {
  try {
    const u = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./, "").toLowerCase();
  }
}

// True if `candidate` is the same host as `origin` or a subdomain of it.
function sameOrigin(candidate: string, origin: string): boolean {
  if (!origin) return false;
  if (candidate === origin) return true;
  if (candidate.endsWith("." + origin)) return true;
  // Also collapse subdomains of candidate matching origin root
  const parts = (h: string) => h.split(".");
  const a = parts(candidate).slice(-2).join(".");
  const b = parts(origin).slice(-2).join(".");
  return a === b;
}

function endsWithTld(domain: string, tld: string): boolean {
  return domain === tld.replace(/^\./, "") || domain.endsWith(tld);
}

function isGovEdu(domain: string): boolean {
  return (
    endsWithTld(domain, ".gov") ||
    endsWithTld(domain, ".edu") ||
    endsWithTld(domain, ".mil") ||
    endsWithTld(domain, ".gov.uk") ||
    endsWithTld(domain, ".ac.uk") ||
    endsWithTld(domain, ".edu.au") ||
    endsWithTld(domain, ".gov.au") ||
    endsWithTld(domain, ".ac.jp") ||
    endsWithTld(domain, ".edu.cn") ||
    endsWithTld(domain, ".gc.ca") ||
    endsWithTld(domain, ".gov.in")
  );
}

function inSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const s of set) {
    if (domain === s || domain.endsWith("." + s)) return true;
  }
  return false;
}

export function classifySource(rawUrl: string, originUrl: string): ClassifiedSource {
  const domain = normalize(rawUrl);
  const origin = normalize(originUrl);

  if (!domain) return { domain, tier: "excluded", weight: 0, excludedReason: "blocked" };

  if (sameOrigin(domain, origin)) {
    return { domain, tier: "excluded", weight: 0, excludedReason: "self" };
  }
  if (inSet(domain, SOCIAL)) {
    return { domain, tier: "excluded", weight: 0, excludedReason: "social" };
  }
  if (inSet(domain, BLOCKED)) {
    return { domain, tier: "excluded", weight: 0, excludedReason: "blocked" };
  }
  if (isGovEdu(domain) || inSet(domain, OFFICIAL)) {
    return { domain, tier: "primary", weight: 1.0 };
  }
  if (inSet(domain, ACADEMIC)) {
    return { domain, tier: "academic", weight: 0.95 };
  }
  if (inSet(domain, FACTCHECK)) {
    return { domain, tier: "factcheck", weight: 0.85 };
  }
  return { domain, tier: "news", weight: 0.5 };
}

// Filter + rank a list of Tavily results. Drops excluded sources, then scores
// remaining items by (tier weight * recency bonus) before de-duping by domain.
// Recency is important: older reporting is often contradicted by newer findings.
export function filterAndRank<
  T extends { url: string; published_date?: string; score?: number },
>(
  results: T[],
  originUrl: string,
  maxPerDomain = 2,
  maxTotal = 10,
): Array<T & { _classified: ClassifiedSource; _finalScore: number }> {
  const now = Date.now();

  const classified = results.map((r) => {
    const tierInfo = classifySource(r.url, originUrl);
    // Recency bonus: decays linearly from 1.0 (today) to 0.6 at ~5 years old.
    // Missing dates get a neutral 0.8 so they aren't harshly penalized.
    let recency = 0.8;
    if (r.published_date) {
      const t = Date.parse(r.published_date);
      if (!Number.isNaN(t)) {
        const years = Math.max(0, (now - t) / (365 * 24 * 60 * 60 * 1000));
        recency = Math.max(0.6, 1 - years * 0.08);
      }
    }
    // Combine tier weight, recency, and Tavily's own relevance score.
    const relevance = typeof r.score === "number" ? Math.min(1, Math.max(0, r.score)) : 0.7;
    const finalScore = tierInfo.weight * recency * (0.5 + 0.5 * relevance);
    return { ...r, _classified: tierInfo, _finalScore: finalScore };
  });

  const kept = classified.filter((r) => r._classified.tier !== "excluded");

  // Sort by final score descending; ties broken by tier rank.
  const tierRank: Record<SourceTier, number> = {
    primary: 0,
    academic: 1,
    factcheck: 2,
    news: 3,
    excluded: 99,
  };
  kept.sort((a, b) => {
    if (b._finalScore !== a._finalScore) return b._finalScore - a._finalScore;
    return tierRank[a._classified.tier] - tierRank[b._classified.tier];
  });

  const perDomain = new Map<string, number>();
  const final: typeof kept = [];
  for (const r of kept) {
    const d = r._classified.domain;
    const c = perDomain.get(d) ?? 0;
    if (c >= maxPerDomain) continue;
    perDomain.set(d, c + 1);
    final.push(r);
    if (final.length >= maxTotal) break;
  }
  return final;
}
