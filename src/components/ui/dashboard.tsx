"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

// ── Types ──────────────────────────────────────────────────────────────────

type ClaimVerdict = "true" | "false" | "unverifiable" | "checking";
type AgentStatus = "running" | "idle";
type FilterTab = "all" | "true" | "false" | "unverifiable";

interface Claim {
  id: number;
  text: string;
  explanation: string;
  verdict: ClaimVerdict;
  sources: string[];
  confidence: number;
  checking?: boolean;
}

interface Agent {
  name: string;
  statusMessage: string;
  progress: number;
  status: AgentStatus;
}

interface SourceDomain {
  domain: string;
  citationCount: number;
}

export interface FactCheckResult {
  url: string;
  score?: number;
  claims?: Claim[];
  agents?: Agent[];
  sources?: SourceDomain[];
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_URL = "climatedaily.news/report-2024";
const MOCK_SCORE = 74;

const MOCK_AGENTS: Agent[] = [
  { name: "Fact Extraction Agent", statusMessage: "Parsing article content", progress: 85, status: "running" },
  { name: "Source Verification Agent", statusMessage: "Cross-referencing citations", progress: 62, status: "running" },
  { name: "Credibility Scoring Agent", statusMessage: "Computing weighted score", progress: 41, status: "running" },
  { name: "Cross-Reference Agent", statusMessage: "Awaiting fact data", progress: 0, status: "idle" },
];

const MOCK_SOURCES: SourceDomain[] = [
  { domain: "ipcc.ch", citationCount: 8 },
  { domain: "nature.com", citationCount: 6 },
  { domain: "noaa.gov", citationCount: 5 },
  { domain: "reuters.com", citationCount: 4 },
  { domain: "bbc.com", citationCount: 3 },
  { domain: "climatedebate.net", citationCount: 2 },
];

const MOCK_CLAIMS: Claim[] = [
  {
    id: 1,
    text: "Global surface temperatures have increased by approximately 1.1°C above pre-industrial levels.",
    explanation: "Consistent with IPCC AR6 and multiple independent temperature datasets tracking global averages since pre-industrial baselines.",
    verdict: "true",
    sources: ["ipcc.ch", "nature.com"],
    confidence: 97,
  },
  {
    id: 2,
    text: "Renewable energy accounts for over 90% of new electricity capacity added globally in 2023.",
    explanation: "IEA data shows approximately 30% of new global capacity was renewable — this claim overstates the figure by roughly 3×.",
    verdict: "false",
    sources: ["iea.org", "reuters.com"],
    confidence: 91,
  },
  {
    id: 3,
    text: "Scientists have reached a 97% consensus on human-caused climate change.",
    explanation: "Cook et al. (2013) and subsequent meta-analyses confirm ~97% of actively publishing climate scientists endorse the anthropogenic warming consensus.",
    verdict: "true",
    sources: ["nature.com", "nasa.gov"],
    confidence: 95,
  },
  {
    id: 4,
    text: "The economic cost of transitioning to net-zero will exceed $200 trillion by 2050.",
    explanation: "Estimates range from $100T to $300T+ depending on methodology and assumed discount rates. No single authoritative projection exists.",
    verdict: "unverifiable",
    sources: ["imf.org", "worldbank.org"],
    confidence: 42,
  },
  {
    id: 5,
    text: "Sea levels have risen approximately 20 cm since 1900 due to thermal expansion and glacier melt.",
    explanation: "NOAA tide gauge and satellite altimetry records confirm 20–23 cm of rise since 1900, attributed to thermal expansion and melting land ice.",
    verdict: "true",
    sources: ["noaa.gov", "nasa.gov"],
    confidence: 98,
  },
  {
    id: 6,
    text: "Carbon capture technology can currently absorb 1 billion tons of CO₂ per year.",
    explanation: "Current global direct air capture capacity is approximately 0.01 billion tons/year. The claim overstates actual capacity by ~100×.",
    verdict: "false",
    sources: ["iea.org", "nature.com"],
    confidence: 96,
  },
  {
    id: 7,
    text: "Arctic sea ice extent is expanding due to natural multi-decadal oceanic cycles.",
    explanation: "Verifying against NSIDC satellite records and recent Arctic monitoring data...",
    verdict: "checking",
    sources: [],
    confidence: 0,
    checking: true,
  },
];

// ── Verdict config (monochrome) ─────────────────────────────────────────────

const VERDICT_CFG: Record<ClaimVerdict, { badge: string; label: string }> = {
  true: {
    badge: "bg-zinc-900 text-white",
    label: "True",
  },
  false: {
    badge: "bg-zinc-100 text-zinc-700 border border-zinc-300",
    label: "False",
  },
  unverifiable: {
    badge: "bg-zinc-50 text-zinc-500 border border-zinc-200",
    label: "Unverifiable",
  },
  checking: {
    badge: "bg-zinc-50 text-zinc-400 border border-zinc-100",
    label: "Checking",
  },
};

// ── Donut Chart ─────────────────────────────────────────────────────────────

function DonutChart({ score }: { score: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const filled = (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: 80, height: 80 }}>
      <svg width="80" height="80" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e4e4e7" strokeWidth="12" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#18181b"
          strokeWidth="12"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - filled }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <motion.span
        className="absolute inset-0 flex items-center justify-center text-base font-semibold text-zinc-900"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      >
        {score}%
      </motion.span>
    </div>
  );
}

// ── Animation helper ────────────────────────────────────────────────────────

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, delay, ease: "easeOut" as const },
  },
});

// ── Main Component ──────────────────────────────────────────────────────────

interface FactCheckDashboardProps {
  result?: FactCheckResult;
  onReset?: () => void;
}

export function FactCheckDashboard({ result, onReset }: FactCheckDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const url = result?.url ?? MOCK_URL;
  const score = result?.score ?? MOCK_SCORE;
  const claims = result?.claims ?? MOCK_CLAIMS;
  const agents = result?.agents ?? MOCK_AGENTS;
  const sources = result?.sources ?? MOCK_SOURCES;

  const trueClaims = claims.filter((c) => c.verdict === "true");
  const falseClaims = claims.filter((c) => c.verdict === "false");
  const unverifiableClaims = claims.filter((c) => c.verdict === "unverifiable");
  const totalClaims = claims.length;

  const filteredClaims =
    activeFilter === "all" ? claims : claims.filter((c) => c.verdict === activeFilter);

  const maxCitations = Math.max(...sources.map((s) => s.citationCount), 1);
  const runningCount = agents.filter((a) => a.status === "running").length;

  const verdictText =
    score >= 70 ? "Mostly credible" : score >= 45 ? "Mixed credibility" : "Low credibility";

  return (
    <motion.div
      className="min-h-screen flex flex-col bg-white"
      style={{
        backgroundImage: "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* ── Navbar ── */}
      <header
        className="sticky top-0 z-50 bg-white border-b border-zinc-200 flex items-center justify-between px-5"
        style={{ height: 48 }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-medium text-zinc-900 flex-shrink-0 tracking-tight">
            SiteSeer
          </span>
          <span
            className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded truncate"
            style={{ maxWidth: 360 }}
            title={url}
          >
            {url}
          </span>
        </div>
        <button
          onClick={onReset}
          type="button"
          className="flex-shrink-0 text-xs text-zinc-600 border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50 hover:border-zinc-300 transition-colors bg-white font-medium"
        >
          Check another
        </button>
      </header>

      {/* ── Main ── */}
      <main
        className="flex-1 flex flex-col gap-3 w-full mx-auto box-border"
        style={{ maxWidth: 1200, padding: "20px 20px 48px" }}
      >
        {/* ── 4 Stat Cards ── */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>

          {/* Score card */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col items-center justify-center gap-2.5"
            {...fadeUp(0.06)}
          >
            <DonutChart score={score} />
            <div className="text-center">
              <div className="text-xs text-zinc-400">Based on {totalClaims} claims</div>
              <div className="text-xs font-medium text-zinc-600 mt-0.5">{verdictText}</div>
            </div>
          </motion.div>

          {/* True */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-1"
            {...fadeUp(0.10)}
          >
            <motion.div
              className="text-4xl font-bold text-zinc-900 leading-none tabular-nums"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              {trueClaims.length}
            </motion.div>
            <div className="text-sm font-medium text-zinc-700 mt-1">True</div>
            <div className="text-xs text-zinc-400">Verified by sources</div>
          </motion.div>

          {/* False */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-1"
            {...fadeUp(0.14)}
          >
            <motion.div
              className="text-4xl font-bold text-zinc-900 leading-none tabular-nums"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.46 }}
            >
              {falseClaims.length}
            </motion.div>
            <div className="text-sm font-medium text-zinc-700 mt-1">False</div>
            <div className="text-xs text-zinc-400">Contradicted by sources</div>
          </motion.div>

          {/* Unverifiable */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-1"
            {...fadeUp(0.18)}
          >
            <motion.div
              className="text-4xl font-bold text-zinc-900 leading-none tabular-nums"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.52 }}
            >
              {unverifiableClaims.length}
            </motion.div>
            <div className="text-sm font-medium text-zinc-700 mt-1">Unverifiable</div>
            <div className="text-xs text-zinc-400">Insufficient evidence</div>
          </motion.div>
        </div>

        {/* ── Middle Row: Agents + Sources ── */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>

          {/* Agents Card */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4 relative"
            {...fadeUp(0.22)}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-zinc-900">Active Agents</span>
              <div className="flex items-center gap-1.5">
                <span className="relative flex" style={{ width: 7, height: 7 }}>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-60" />
                  <span className="relative inline-flex rounded-full bg-zinc-800" style={{ width: 7, height: 7 }} />
                </span>
                <span className="text-xs text-zinc-400">{runningCount} running</span>
              </div>
            </div>

            <div className="flex flex-col divide-y divide-zinc-100">
              {agents.map((agent, i) => (
                <div key={i} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-800 truncate">{agent.name}</div>
                      <div className="text-xs text-zinc-400 truncate">{agent.statusMessage}</div>
                    </div>
                    <span
                      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded border font-medium ${
                        agent.status === "running"
                          ? "bg-zinc-900 text-white border-zinc-900"
                          : "bg-zinc-50 text-zinc-400 border-zinc-200"
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                  <div className="bg-zinc-100 rounded-full overflow-hidden" style={{ height: 2 }}>
                    <motion.div
                      className="h-full bg-zinc-800 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${agent.progress}%` }}
                      transition={{ duration: 0.7, delay: 0.4 + i * 0.09, ease: "easeOut" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Sources Card */}
          <motion.div
            className="bg-white border border-zinc-200 rounded-lg p-4"
            {...fadeUp(0.26)}
          >
            <div className="text-sm font-medium text-zinc-900 mb-3">Source Domains</div>

            <div className="flex flex-col divide-y divide-zinc-100">
              {sources.map((source, i) => (
                <div key={i} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <div
                    className="text-xs text-zinc-600 truncate flex-shrink-0 font-mono"
                    style={{ width: 130 }}
                  >
                    {source.domain}
                  </div>
                  <div className="flex-1 bg-zinc-100 rounded-full overflow-hidden" style={{ height: 3 }}>
                    <motion.div
                      className="h-full bg-zinc-800 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(source.citationCount / maxCitations) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.42 + i * 0.07, ease: "easeOut" }}
                    />
                  </div>
                  <div className="text-xs text-zinc-400 tabular-nums flex-shrink-0 text-right" style={{ width: 18 }}>
                    {source.citationCount}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ── Claims Section ── */}
        <motion.div
          className="bg-white border border-zinc-200 rounded-lg p-4"
          {...fadeUp(0.30)}
        >
          {/* Header + filters */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-zinc-900">Claims</span>
            <div className="flex gap-0.5 bg-zinc-50 border border-zinc-200 p-0.5 rounded-md">
              {(["all", "true", "false", "unverifiable"] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveFilter(tab)}
                  type="button"
                  className={`text-xs px-2.5 py-1 rounded transition-all font-medium ${
                    activeFilter === tab
                      ? "bg-white text-zinc-900 shadow-sm border border-zinc-200"
                      : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  {tab === "all"
                    ? `All (${claims.length})`
                    : tab === "true"
                    ? `True (${trueClaims.length})`
                    : tab === "false"
                    ? `False (${falseClaims.length})`
                    : `Unverifiable (${unverifiableClaims.length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Claims list */}
          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {filteredClaims.map((claim, i) => {
                const cfg = VERDICT_CFG[claim.verdict];
                const isChecking = claim.checking;

                return (
                  <motion.div
                    key={claim.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.16, delay: i * 0.025 }}
                    className="p-3 border border-zinc-100 rounded-md bg-zinc-50/50"
                  >
                    {/* Top row */}
                    <div className="flex items-start gap-2.5 mb-2">
                      {isChecking && (
                        <div
                          className="flex-shrink-0 rounded-full border-2 border-zinc-200 animate-spin mt-0.5"
                          style={{ width: 13, height: 13, borderTopColor: "#52525b" }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-snug mb-1 ${isChecking ? "text-zinc-400" : "text-zinc-800"}`}>
                          {claim.text}
                        </p>
                        <p className="text-xs text-zinc-400 leading-relaxed">{claim.explanation}</p>
                      </div>
                      <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded font-medium ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                    </div>

                    {/* Source chips */}
                    {claim.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {claim.sources.map((src, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200 font-mono"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    )}

                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}

// Backward-compatible alias
export { FactCheckDashboard as Dashboard };
