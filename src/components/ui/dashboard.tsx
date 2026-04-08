"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useJob } from "../../lib/useJob";
import type {
  AgentKey,
  Claim,
  JobPhase,
  JobState,
  SourceTier,
  TaskLogEntry,
  Verdict,
} from "../../lib/api";

// ── Filters ─────────────────────────────────────────────────────────────────

type FilterTab = "all" | "true" | "false" | "uncertain" | "pending";

// ── Animated Number ─────────────────────────────────────────────────────────
// A smooth, spring-driven counter that tweens whenever the value changes.

function AnimatedNumber({
  value,
  suffix = "",
  className = "",
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 110, damping: 20, mass: 0.9 });
  const rounded = useTransform(spring, (v) => Math.round(v).toString() + suffix);

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  return <motion.span className={className}>{rounded}</motion.span>;
}

// ── Donut Chart ─────────────────────────────────────────────────────────────

function DonutChart({ score }: { score: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 22 });
  const offset = useTransform(spring, (v) => circumference - (v / 100) * circumference);
  const text = useTransform(spring, (v) => `${Math.round(v)}%`);

  useEffect(() => {
    mv.set(score);
  }, [score, mv]);

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
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <motion.span className="absolute inset-0 flex items-center justify-center text-base font-semibold text-zinc-900">
        {text}
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

// ── Phase / agent derivation ────────────────────────────────────────────────

type AgentStatus = "done" | "running" | "pending" | "error";

type DerivedAgent = {
  name: string;
  statusMessage: string;
  progress: number;
  status: AgentStatus;
};

function deriveAgents(state: JobState): DerivedAgent[] {
  const { phase, totalClaims, processedClaims } = state;
  const analysisProgress =
    totalClaims > 0 ? Math.round((processedClaims / totalClaims) * 100) : 0;

  // Phase ordering: queued -> fetching -> extracting -> analyzing -> complete
  const order: JobPhase[] = ["queued", "fetching", "extracting", "analyzing", "complete"];
  const idx = order.indexOf(phase);
  const past = (p: JobPhase) => idx > order.indexOf(p);

  const errored = phase === "error";
  const analyzing = phase === "analyzing";
  const analysisDone = phase === "complete";
  const fetchingDone = past("fetching");
  const extractingNow = phase === "extracting";
  const extractionDone = past("extracting");

  return [
    {
      name: "Fetch Agent",
      statusMessage: errored && !fetchingDone
        ? "Failed to fetch page"
        : phase === "queued"
          ? "Waiting to start"
          : phase === "fetching"
            ? "Downloading page contents"
            : "Page fetched",
      progress: fetchingDone ? 100 : phase === "fetching" ? 55 : errored ? 100 : 0,
      status: errored && !fetchingDone
        ? "error"
        : fetchingDone
          ? "done"
          : phase === "fetching"
            ? "running"
            : "pending",
    },
    {
      name: "Extraction Agent",
      statusMessage: errored && !extractionDone
        ? "Halted"
        : extractingNow
          ? "Parsing claims from article"
          : extractionDone
            ? `Extracted ${totalClaims} claims`
            : "Waiting for fetch",
      progress: extractionDone ? 100 : extractingNow ? 65 : 0,
      status:
        errored && !extractionDone
          ? "pending"
          : extractingNow
            ? "running"
            : extractionDone
              ? "done"
              : "pending",
    },
    {
      name: "Evidence Retrieval",
      statusMessage: errored && !analysisDone
        ? "Halted"
        : analyzing
          ? `Searching evidence · ${processedClaims}/${totalClaims}`
          : analysisDone
            ? "All sources gathered"
            : "Awaiting claims",
      progress: analysisDone ? 100 : analyzing ? analysisProgress : 0,
      status:
        errored && !analysisDone
          ? "pending"
          : analyzing
            ? "running"
            : analysisDone
              ? "done"
              : "pending",
    },
    {
      name: "Verdict Judge",
      statusMessage: errored && !analysisDone
        ? "Halted"
        : analyzing
          ? `Evaluating · ${processedClaims}/${totalClaims}`
          : analysisDone
            ? "Verdicts finalized"
            : "Waiting for evidence",
      progress: analysisDone ? 100 : analyzing ? analysisProgress : 0,
      status:
        errored && !analysisDone
          ? "pending"
          : analyzing
            ? "running"
            : analysisDone
              ? "done"
              : "pending",
    },
  ];
}

// ── Verdict config ──────────────────────────────────────────────────────────

const VERDICT_CFG: Record<
  Verdict | "pending",
  { badge: string; label: string; borderClass: string }
> = {
  true: {
    badge: "bg-zinc-900 text-white",
    label: "True",
    borderClass: "border-zinc-200",
  },
  false: {
    badge: "bg-zinc-100 text-zinc-700 border border-zinc-300",
    label: "False",
    borderClass: "border-zinc-200",
  },
  uncertain: {
    badge: "bg-zinc-50 text-zinc-500 border border-zinc-200",
    label: "Uncertain",
    borderClass: "border-zinc-200",
  },
  pending: {
    badge: "bg-zinc-50 text-zinc-400 border border-dashed border-zinc-300",
    label: "Pending",
    borderClass: "border-dashed border-zinc-300",
  },
};

const PHASE_LABEL: Record<JobPhase, string> = {
  queued: "Queued",
  fetching: "Fetching page",
  extracting: "Extracting claims",
  analyzing: "Analyzing claims",
  complete: "Complete",
  error: "Error",
};

// ── Main Component ──────────────────────────────────────────────────────────

interface DashboardProps {
  jobId: string;
  url: string;
  onReset?: () => void;
}

export function Dashboard({ jobId, url, onReset }: DashboardProps) {
  const { state, pollError } = useJob(jobId);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  // Default placeholder state until first poll arrives
  const live: JobState = state ?? {
    id: jobId,
    url,
    status: "pending",
    phase: "queued",
    totalClaims: 0,
    processedClaims: 0,
    claims: [],
    tasks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const claims = live.claims ?? [];
  const totalClaims = live.totalClaims || claims.length;
  const trueClaims = claims.filter((c) => c.verdict === "true");
  const falseClaims = claims.filter((c) => c.verdict === "false");
  const uncertainClaims = claims.filter((c) => c.verdict === "uncertain");

  // A claim is "pending" if extraction has run (we know totalClaims) but we
  // haven't received a verdict for it yet. These appear as dashed placeholders.
  const pendingCount = Math.max(0, totalClaims - claims.length);

  // Weighted credibility score — true counts full, uncertain half, false zero.
  const evaluated = claims.length;
  const score = useMemo(() => {
    if (evaluated === 0) return 0;
    const weighted =
      trueClaims.length * 100 + uncertainClaims.length * 50 + falseClaims.length * 0;
    return Math.round(weighted / evaluated);
  }, [evaluated, trueClaims.length, uncertainClaims.length, falseClaims.length]);

  const agents = deriveAgents(live);
  const runningCount = agents.filter((a) => a.status === "running").length;

  // Mirror the Pipeline Agents card height onto the Sources card so the
  // sources list becomes internally scrollable instead of stretching the row.
  const agentsCardRef = useRef<HTMLDivElement>(null);
  const [agentsCardHeight, setAgentsCardHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = agentsCardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setAgentsCardHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Source aggregation from real claims — preserves tier so each chip can
  // show where its trust weight comes from.
  const sources = useMemo(() => {
    const map = new Map<string, { domain: string; tier: SourceTier; citationCount: number }>();
    for (const c of claims) {
      for (const s of c.sources ?? []) {
        const existing = map.get(s.domain);
        if (existing) {
          existing.citationCount += 1;
        } else {
          map.set(s.domain, { domain: s.domain, tier: s.tier, citationCount: 1 });
        }
      }
    }
    const tierOrder: Record<SourceTier, number> = {
      primary: 0,
      academic: 1,
      factcheck: 2,
      news: 3,
    };
    return [...map.values()]
      .sort(
        (a, b) =>
          tierOrder[a.tier] - tierOrder[b.tier] || b.citationCount - a.citationCount,
      )
      .slice(0, 10);
  }, [claims]);

  const maxCitations = Math.max(...sources.map((s) => s.citationCount), 1);

  const verdictText =
    evaluated === 0
      ? "Analyzing"
      : score >= 70
        ? "Mostly credible"
        : score >= 45
          ? "Mixed credibility"
          : "Low credibility";

  const overallProgress =
    live.phase === "complete"
      ? 100
      : live.phase === "error"
        ? 100
        : live.phase === "queued"
          ? 4
          : live.phase === "fetching"
            ? 14
            : live.phase === "extracting"
              ? 28
              : totalClaims > 0
                ? 28 + Math.round((claims.length / totalClaims) * 70)
                : 35;

  // Build a filtered list that optionally includes pending placeholder rows
  type DisplayRow =
    | { kind: "claim"; claim: Claim; index: number }
    | { kind: "pending"; index: number };

  const displayRows: DisplayRow[] = useMemo(() => {
    const rows: DisplayRow[] = [];
    if (activeFilter === "all" || activeFilter === "true") {
      trueClaims.forEach((c, i) => rows.push({ kind: "claim", claim: c, index: i }));
      if (activeFilter === "true") return rows;
    }
    if (activeFilter === "all" || activeFilter === "false") {
      falseClaims.forEach((c, i) => rows.push({ kind: "claim", claim: c, index: i }));
      if (activeFilter === "false") return rows;
    }
    if (activeFilter === "all" || activeFilter === "uncertain") {
      uncertainClaims.forEach((c, i) => rows.push({ kind: "claim", claim: c, index: i }));
      if (activeFilter === "uncertain") return rows;
    }
    if (activeFilter === "all" || activeFilter === "pending") {
      for (let i = 0; i < pendingCount; i++) rows.push({ kind: "pending", index: i });
    }
    return rows;
  }, [activeFilter, trueClaims, falseClaims, uncertainClaims, pendingCount]);

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
          <PhasePill phase={live.phase} />
        </div>
        <button
          onClick={onReset}
          type="button"
          className="flex-shrink-0 text-xs text-zinc-600 border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50 hover:border-zinc-300 transition-colors bg-white font-medium"
        >
          Check another
        </button>
      </header>

      {/* ── Global progress bar ── */}
      <div className="relative h-[2px] bg-zinc-100 w-full overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 bg-zinc-800"
          initial={{ width: 0 }}
          animate={{ width: `${overallProgress}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
        {live.phase !== "complete" && live.phase !== "error" && (
          <motion.div
            className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-zinc-400/40 to-transparent"
            animate={{ left: ["-10%", "110%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>

      {/* ── Main ── */}
      <main
        className="flex-1 flex flex-col gap-3 w-full mx-auto box-border"
        style={{ maxWidth: 1200, padding: "20px 20px 48px" }}
      >
        {/* Error banner */}
        <AnimatePresence>
          {(live.phase === "error" || pollError) && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-zinc-50 border border-zinc-300 rounded-lg p-3 text-xs text-zinc-700"
            >
              <span className="font-medium">Analysis halted:</span>{" "}
              {live.error ?? pollError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 4 Stat Cards ── */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {/* Score card */}
          <motion.div
            layout
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col items-center justify-center gap-2.5"
            {...fadeUp(0.06)}
          >
            <DonutChart score={score} />
            <div className="text-center">
              <div className="text-xs text-zinc-400">
                Based on <AnimatedNumber value={evaluated} />{" "}
                {totalClaims > evaluated ? `of ${totalClaims}` : ""} claims
              </div>
              <motion.div
                key={verdictText}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="text-xs font-medium text-zinc-600 mt-0.5"
              >
                {verdictText}
              </motion.div>
            </div>
          </motion.div>

          {/* True */}
          <StatCard
            label="True"
            sublabel="Verified by sources"
            value={trueClaims.length}
            delay={0.1}
          />

          {/* False */}
          <StatCard
            label="False"
            sublabel="Contradicted by sources"
            value={falseClaims.length}
            delay={0.14}
          />

          {/* Pending / Uncertain */}
          <StatCard
            label={pendingCount > 0 ? "In Progress" : "Uncertain"}
            sublabel={
              pendingCount > 0
                ? `${uncertainClaims.length} uncertain · ${pendingCount} pending`
                : "Insufficient evidence"
            }
            value={pendingCount > 0 ? pendingCount : uncertainClaims.length}
            delay={0.18}
            pulse={pendingCount > 0}
          />
        </div>

        {/* ── Middle Row: Agents + Sources ── */}
        <div
          className="grid gap-3 items-start"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          {/* Agents Card */}
          <motion.div
            layout
            ref={agentsCardRef}
            className="bg-white border border-zinc-200 rounded-lg p-4 relative"
            {...fadeUp(0.22)}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-zinc-900">Pipeline Agents</span>
              <div className="flex items-center gap-1.5">
                <span className="relative flex" style={{ width: 7, height: 7 }}>
                  {runningCount > 0 && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-60" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full ${
                      runningCount > 0 ? "bg-zinc-800" : "bg-zinc-300"
                    }`}
                    style={{ width: 7, height: 7 }}
                  />
                </span>
                <span className="text-xs text-zinc-400">
                  <AnimatedNumber value={runningCount} /> running
                </span>
              </div>
            </div>

            <div className="flex flex-col divide-y divide-zinc-100">
              {agents.map((agent) => {
                const agentKey = AGENT_KEY_BY_NAME[agent.name];
                const agentTasks = live.tasks?.filter((t) => t.agent === agentKey) ?? [];
                return (
                  <div
                    key={agent.name}
                    className="py-3 first:pt-0 last:pb-0 flex items-start gap-3"
                  >
                    <PieIcon progress={agent.progress} status={agent.status} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-xs font-semibold text-zinc-800 truncate tracking-tight">
                          {agent.name}
                        </div>
                        <AgentStatusPill status={agent.status} />
                      </div>

                      <TaskCarousel
                        tasks={agentTasks}
                        fallback={agent.statusMessage}
                        running={agent.status === "running"}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Sources Card */}
          <motion.div
            layout
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col overflow-hidden"
            style={agentsCardHeight ? { height: agentsCardHeight } : undefined}
            {...fadeUp(0.26)}
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <span className="text-sm font-medium text-zinc-900">Source Domains</span>
              <span className="text-xs text-zinc-400">
                <AnimatedNumber value={sources.length} /> unique
              </span>
            </div>

            {sources.length === 0 ? (
              <div className="text-xs text-zinc-400 py-8 text-center">
                {live.phase === "analyzing"
                  ? "Gathering evidence from the web…"
                  : "Sources will appear as claims are verified."}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-zinc-100 flex-1 min-h-0 overflow-y-auto pr-3 -mr-3">
                <AnimatePresence initial={false}>
                  {sources.map((source, i) => (
                    <motion.div
                      key={source.domain}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.03 }}
                      className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold border flex-shrink-0 ${TIER_CFG[source.tier].chipClass}`}
                        style={{ width: 66, textAlign: "center" }}
                      >
                        {TIER_CFG[source.tier].short}
                      </span>
                      <div
                        className="text-xs text-zinc-700 truncate font-mono"
                        style={{ flex: "1 1 auto", minWidth: 0 }}
                        title={source.domain}
                      >
                        {source.domain}
                      </div>
                      <div
                        className="flex-shrink-0 bg-zinc-100 rounded-full overflow-hidden"
                        style={{ height: 3, width: 80 }}
                      >
                        <motion.div
                          className={`h-full rounded-full ${TIER_CFG[source.tier].barClass}`}
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(source.citationCount / maxCitations) * 100}%`,
                          }}
                          transition={{ duration: 0.55, ease: "easeOut" }}
                        />
                      </div>
                      <div
                        className="text-xs text-zinc-500 tabular-nums flex-shrink-0 text-right"
                        style={{ width: 22 }}
                      >
                        <AnimatedNumber value={source.citationCount} />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </div>

        {/* ── Claims Section ── */}
        <motion.div
          layout
          className="bg-white border border-zinc-200 rounded-lg p-4"
          {...fadeUp(0.3)}
        >
          {/* Header + filters */}
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-900">Claims</span>
              {live.title && (
                <span
                  className="text-xs text-zinc-400 truncate"
                  style={{ maxWidth: 320 }}
                  title={live.title}
                >
                  · {live.title}
                </span>
              )}
            </div>
            <div className="flex gap-0.5 bg-zinc-50 border border-zinc-200 p-0.5 rounded-md">
              {(["all", "true", "false", "uncertain", "pending"] as FilterTab[]).map((tab) => {
                const count =
                  tab === "all"
                    ? claims.length + pendingCount
                    : tab === "true"
                      ? trueClaims.length
                      : tab === "false"
                        ? falseClaims.length
                        : tab === "uncertain"
                          ? uncertainClaims.length
                          : pendingCount;
                if (tab === "pending" && pendingCount === 0 && live.phase === "complete")
                  return null;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveFilter(tab)}
                    type="button"
                    className={`text-xs px-2.5 py-1 rounded transition-all font-medium capitalize ${
                      activeFilter === tab
                        ? "bg-white text-zinc-900 shadow-sm border border-zinc-200"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {tab} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Claims list */}
          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {displayRows.length === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-zinc-400 py-6 text-center"
                >
                  {live.phase === "complete"
                    ? "No claims match this filter."
                    : "Claims will appear here as they are processed."}
                </motion.div>
              )}

              {displayRows.map((row, i) => {
                if (row.kind === "pending") {
                  return (
                    <motion.div
                      key={`pending-${row.index}`}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.18, delay: i * 0.015 }}
                      className="p-3 border border-dashed border-zinc-300 rounded-md bg-zinc-50/30 relative overflow-hidden"
                    >
                      <motion.div
                        className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-zinc-200/60 to-transparent pointer-events-none"
                        animate={{ left: ["-10%", "110%"] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                      />
                      <div className="flex items-start gap-2.5">
                        <div
                          className="flex-shrink-0 rounded-full border-2 border-zinc-200 animate-spin mt-0.5"
                          style={{ width: 13, height: 13, borderTopColor: "#52525b" }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="h-2 bg-zinc-200 rounded w-3/4 mb-2" />
                          <div className="h-2 bg-zinc-100 rounded w-1/2" />
                        </div>
                        <span
                          className={`flex-shrink-0 text-xs px-2 py-0.5 rounded font-medium ${VERDICT_CFG.pending.badge}`}
                        >
                          {VERDICT_CFG.pending.label}
                        </span>
                      </div>
                    </motion.div>
                  );
                }

                const claim = row.claim;
                const cfg = VERDICT_CFG[claim.verdict];
                return (
                  <motion.div
                    key={`${claim.verdict}-${row.index}-${claim.text.slice(0, 20)}`}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.18, delay: i * 0.015 }}
                    className="p-3 border border-zinc-100 rounded-md bg-zinc-50/50"
                  >
                    <div className="flex items-start gap-2.5 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug mb-1 text-zinc-800">{claim.text}</p>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          {claim.explanation}
                        </p>
                      </div>
                      <span
                        className={`flex-shrink-0 text-xs px-2 py-0.5 rounded font-medium ${cfg.badge}`}
                      >
                        {cfg.label}
                      </span>
                    </div>

                    {claim.sources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {claim.sources.map((src, j) => (
                          <span
                            key={j}
                            className={`text-[10px] px-2 py-0.5 rounded font-mono border flex items-center gap-1.5 ${TIER_CFG[src.tier].chipClass}`}
                            title={`${TIER_CFG[src.tier].label} · weight ${src.weight}`}
                          >
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full ${TIER_CFG[src.tier].dotClass}`}
                            />
                            {src.domain}
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
        {/* ── Disclaimer ── */}
        <motion.div
          className="relative mt-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-5 py-4 overflow-hidden"
          {...fadeUp(0.36)}
        >
          {/* Faint diagonal hatch overlay */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, #000 0px, #000 1px, transparent 1px, transparent 6px)",
            }}
          />

          <div className="relative flex gap-3.5 items-start">
            {/* Caution glyph */}
            <div
              className="flex-shrink-0 mt-0.5 flex items-center justify-center rounded border border-zinc-300 bg-white text-zinc-500"
              style={{ width: 22, height: 22, fontSize: 11, fontWeight: 700 }}
            >
              !
            </div>

            <div className="flex flex-col gap-2.5 min-w-0">
              <p
                className="text-[11px] leading-relaxed text-zinc-500 font-mono"
                style={{ letterSpacing: "0.01em" }}
              >
                <span className="font-semibold text-zinc-700">AI-generated analysis.</span>{" "}
                Results are produced by language models and may contain inaccuracies,
                hallucinations, or misinterpretations. Do not treat verdicts as definitive
                fact.
              </p>
              <p
                className="text-[11px] leading-relaxed text-zinc-500 font-mono"
                style={{ letterSpacing: "0.01em" }}
              >
                <span className="font-semibold text-zinc-700">Sources are not guaranteed.</span>{" "}
                While sources are filtered by domain reputation, individual articles may
                still contain errors, bias, or outdated information.
              </p>
              <p
                className="text-[11px] leading-relaxed text-zinc-500 font-mono"
                style={{ letterSpacing: "0.01em" }}
              >
                <span className="font-semibold text-zinc-700">Access limitations.</span>{" "}
                This tool cannot bypass paywalls, cookie consent walls, login gates, or
                other access restrictions — content behind these barriers will not be
                analyzed.
              </p>
            </div>
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  sublabel,
  value,
  delay,
  pulse,
}: {
  label: string;
  sublabel: string;
  value: number;
  delay: number;
  pulse?: boolean;
}) {
  return (
    <motion.div
      layout
      className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-1 relative overflow-hidden"
      {...fadeUp(delay)}
    >
      {pulse && (
        <motion.div
          className="absolute inset-x-0 top-0 h-[2px] bg-zinc-800"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <div className="text-4xl font-bold text-zinc-900 leading-none tabular-nums">
        <AnimatedNumber value={value} />
      </div>
      <div className="text-sm font-medium text-zinc-700 mt-1">{label}</div>
      <div className="text-xs text-zinc-400">{sublabel}</div>
    </motion.div>
  );
}

function AgentStatusPill({ status }: { status: AgentStatus }) {
  const map: Record<AgentStatus, { cls: string; label: string }> = {
    done: { cls: "bg-zinc-100 text-zinc-500 border-zinc-200", label: "done" },
    running: { cls: "bg-zinc-900 text-white border-zinc-900", label: "running" },
    pending: { cls: "bg-zinc-50 text-zinc-400 border-zinc-200", label: "pending" },
    error: { cls: "bg-zinc-100 text-zinc-700 border-zinc-300", label: "error" },
  };
  const { cls, label } = map[status];
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`flex-shrink-0 text-xs px-2 py-0.5 rounded border font-medium ${cls}`}
    >
      {label}
    </motion.span>
  );
}

function PhasePill({ phase }: { phase: JobPhase }) {
  const label = PHASE_LABEL[phase];
  const active = phase !== "complete" && phase !== "error";
  return (
    <motion.span
      layout
      key={phase}
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-medium flex items-center gap-1.5 ${
        phase === "error"
          ? "bg-zinc-100 text-zinc-700 border-zinc-300"
          : phase === "complete"
            ? "bg-zinc-900 text-white border-zinc-900"
            : "bg-white text-zinc-600 border-zinc-200"
      }`}
    >
      {active && (
        <span className="relative flex" style={{ width: 6, height: 6 }}>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 opacity-70" />
          <span
            className="relative inline-flex rounded-full bg-zinc-800"
            style={{ width: 6, height: 6 }}
          />
        </span>
      )}
      {label}
    </motion.span>
  );
}

// ── Constants: tier styling & agent mapping ─────────────────────────────────

const TIER_CFG: Record<
  SourceTier,
  {
    label: string;
    short: string;
    chipClass: string;
    dotClass: string;
    barClass: string;
  }
> = {
  primary: {
    label: "Primary source",
    short: "PRIMARY",
    chipClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dotClass: "bg-emerald-500",
    barClass: "bg-emerald-600",
  },
  academic: {
    label: "Peer-reviewed / academic",
    short: "ACADEMIC",
    chipClass: "bg-indigo-50 text-indigo-800 border-indigo-200",
    dotClass: "bg-indigo-500",
    barClass: "bg-indigo-600",
  },
  factcheck: {
    label: "Fact-checker / wire service",
    short: "FACTCHK",
    chipClass: "bg-amber-50 text-amber-800 border-amber-200",
    dotClass: "bg-amber-500",
    barClass: "bg-amber-600",
  },
  news: {
    label: "General news",
    short: "NEWS",
    chipClass: "bg-zinc-100 text-zinc-600 border-zinc-200",
    dotClass: "bg-zinc-500",
    barClass: "bg-zinc-600",
  },
};

const AGENT_KEY_BY_NAME: Record<string, AgentKey> = {
  "Fetch Agent": "fetch",
  "Extraction Agent": "extract",
  "Evidence Retrieval": "evidence",
  "Verdict Judge": "judge",
};

// ── Pie chart icon ──────────────────────────────────────────────────────────

function PieIcon({
  progress,
  status,
}: {
  progress: number;
  status: AgentStatus;
}) {
  const size = 34;
  const cx = size / 2;
  const cy = size / 2;
  const r = 13;
  const circumference = 2 * Math.PI * r;

  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 22 });
  const dashOffset = useTransform(
    spring,
    (v) => circumference - (Math.max(0, Math.min(100, v)) / 100) * circumference,
  );

  useEffect(() => {
    mv.set(progress);
  }, [progress, mv]);

  const ringColor =
    status === "error"
      ? "#991b1b"
      : status === "done"
        ? "#16a34a"
        : status === "running"
          ? "#18181b"
          : "#a1a1aa";

  const bgColor = status === "pending" ? "#f4f4f5" : "#e4e4e7";

  return (
    <motion.div
      className="relative flex-shrink-0"
      style={{ width: size, height: size }}
      animate={status === "running" ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={
        status === "running"
          ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.3 }
      }
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth="5" />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
        />
        {status === "done" && (
          <motion.path
            d={`M ${cx - 4} ${cy + 0.5} L ${cx - 1} ${cy + 3.5} L ${cx + 4.5} ${cy - 2.5}`}
            fill="none"
            stroke={ringColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            style={{ transform: "rotate(90deg)", transformOrigin: `${cx}px ${cy}px` }}
          />
        )}
        {status === "running" && (
          <motion.circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth="1"
            strokeOpacity={0.25}
            animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
        )}
      </svg>
    </motion.div>
  );
}

// ── Task carousel (vertical rolling log) ────────────────────────────────────

function TaskCarousel({
  tasks,
  fallback,
  running,
}: {
  tasks: TaskLogEntry[];
  fallback: string;
  running: boolean;
}) {
  // Show the last 3 tasks in reverse chronological order.
  const visible = tasks.slice(-3).reverse();

  return (
    <div className="relative" style={{ height: 42 }}>
      {visible.length === 0 ? (
        <div className="text-[11px] text-zinc-400 leading-tight mt-0.5 truncate font-mono">
          {fallback}
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {visible.map((t, i) => {
            const opacity = i === 0 ? 1 : i === 1 ? 0.55 : 0.25;
            const y = i * 14;
            const isHead = i === 0;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: y - 12, filter: "blur(2px)" }}
                animate={{
                  opacity,
                  y,
                  filter: "blur(0px)",
                }}
                exit={{ opacity: 0, y: y + 14, filter: "blur(2px)" }}
                transition={{
                  duration: 0.32,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="absolute inset-x-0 flex items-center gap-1.5 font-mono truncate"
                style={{
                  fontSize: isHead ? 11 : 10,
                  color: isHead ? "#27272a" : "#a1a1aa",
                  fontWeight: isHead ? 500 : 400,
                  letterSpacing: "0.01em",
                }}
              >
                {isHead && running && (
                  <motion.span
                    className="inline-block w-1 h-1 rounded-full bg-zinc-900 flex-shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {isHead && !running && (
                  <span className="inline-block w-1 h-1 rounded-full bg-zinc-300 flex-shrink-0" />
                )}
                <span className="truncate">{t.label}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}

// Backward-compatible export
export type { JobState as FactCheckResult };
