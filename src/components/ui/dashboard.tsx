"use client";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useJob } from "../../lib/useJob";
import { RotateCw, AlertTriangle, Clock, ChevronRight } from "lucide-react";
import type {
  AgentKey,
  Claim,
  JobPhase,
  JobState,
  SourceTier,
  TaskLogEntry,
  Verdict,
} from "../../lib/api";
import type { QueryHistoryEntry } from "./query-history-sidebar";

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
    <div className="relative" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e4e4e7" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#18181b"
          strokeWidth="8"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <motion.span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-zinc-900 tabular-nums">
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
  initialState?: JobState;
  isHistoricalView?: boolean;
  queryPosition?: { index: number; total: number };
  onReset?: () => void;
  onRetry?: () => void;
  onSelectLatest?: () => void;
  onStateUpdate?: (updates: Partial<QueryHistoryEntry>) => void;
}

// ── Error Boundary ──────────────────────────────────────────────────────────

class DashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: string }
> {
  state = { hasError: false, error: undefined as string | undefined };
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, error: String(err) };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-3 bg-white p-8">
          <AlertTriangle size={24} className="text-zinc-400" />
          <p className="text-sm font-medium text-zinc-700">Something went wrong rendering the dashboard.</p>
          <p className="text-xs text-zinc-400 max-w-sm text-center">{this.state.error}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="text-xs border border-zinc-200 rounded px-3 py-1.5 hover:bg-zinc-50 text-zinc-600 mt-2"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Dashboard({ jobId, url, initialState, isHistoricalView, queryPosition, onReset, onRetry, onSelectLatest, onStateUpdate }: DashboardProps) {
  // Don't poll if we already have a terminal initialState — show it immediately
  const isTerminalInitial = initialState?.status === "complete" || initialState?.status === "error";
  const { state, pollError } = useJob(isTerminalInitial ? null : jobId);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  // Use polled state, then cached initial state (for historical navigation), then empty placeholder
  const live: JobState = state ?? initialState ?? {
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

  // Credibility score — only claims with evidence (true/false) count.
  // Uncertain claims are excluded: no evidence ≠ half-credible.
  const evaluated = claims.length;
  const score = useMemo(() => {
    const evidenced = trueClaims.length + falseClaims.length;
    if (evidenced === 0) return evaluated > 0 ? 50 : 0; // all uncertain → neutral
    return Math.round((trueClaims.length / evidenced) * 100);
  }, [evaluated, trueClaims.length, falseClaims.length]);

  const agents = deriveAgents(live);
  const runningCount = agents.filter((a) => a.status === "running").length;


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

  // ── Report state changes to parent (for sidebar history) ──
  const stableOnStateUpdate = useCallback(
    (updates: Partial<QueryHistoryEntry>) => onStateUpdate?.(updates),
    [onStateUpdate],
  );

  useEffect(() => {
    const historyStatus: QueryHistoryEntry["status"] =
      live.phase === "complete"
        ? "complete"
        : live.phase === "error"
          ? "error"
          : "loading";

    stableOnStateUpdate({
      title: live.title,
      status: historyStatus,
      phase: PHASE_LABEL[live.phase],
      score,
      overallProgress,
      trueClaims: trueClaims.length,
      falseClaims: falseClaims.length,
      uncertainClaims: uncertainClaims.length,
      totalClaims,
      processedClaims: live.processedClaims,
      // Always cache state so sidebar navigation shows last known data immediately
      ...(live.phase !== "queued" ? { cachedState: live } : {}),
    });
  }, [
    live.title,
    live.phase,
    score,
    overallProgress,
    trueClaims.length,
    falseClaims.length,
    uncertainClaims.length,
    totalClaims,
    live.processedClaims,
    stableOnStateUpdate,
  ]);

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
    <DashboardErrorBoundary>
    <motion.div
      className="flex flex-col bg-white"
      style={{
        minHeight: "100svh",
        height: "100svh",
        overflow: "hidden",
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
            style={{ maxWidth: 300 }}
            title={url}
          >
            {url}
          </span>
          <PhasePill phase={live.phase} />
          {isHistoricalView && (
            <span
              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border flex-shrink-0 uppercase tracking-wider"
              style={{
                background: "#fefce8",
                border: "1px solid #fbbf24",
                color: "#92400e",
                fontFamily: "'Share Tech Mono', monospace",
              }}
            >
              <Clock size={9} />
              {queryPosition ? `Query ${queryPosition.index} of ${queryPosition.total}` : "Historical"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isHistoricalView && onSelectLatest && (
            <button
              onClick={onSelectLatest}
              type="button"
              className="flex items-center gap-1 text-xs text-amber-700 border border-amber-300 rounded-md px-3 py-1.5 hover:bg-amber-50 transition-colors bg-amber-50/50 font-medium"
              style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}
            >
              Latest
              <ChevronRight size={11} />
            </button>
          )}
          {onRetry && !isHistoricalView && (
            <button
              onClick={onRetry}
              type="button"
              className="flex items-center gap-1.5 text-xs text-zinc-500 border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50 hover:border-zinc-300 hover:text-zinc-700 transition-colors bg-white font-medium"
              title="Re-analyze this URL"
            >
              <RotateCw size={11} />
              Retry
            </button>
          )}
          <button
            onClick={onReset}
            type="button"
            className="text-xs text-zinc-600 border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50 hover:border-zinc-300 transition-colors bg-white font-medium"
          >
            Check another
          </button>
        </div>
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
        className="flex-1 flex flex-col gap-3 w-full mx-auto box-border overflow-y-auto"
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

        {/* ── Disclaimer ── */}
        <div
          className="flex items-start gap-2.5 rounded-lg px-4 py-3"
          style={{ border: "1px dashed #d4d4d8", background: "#fafafa" }}
        >
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: "#a1a1aa" }} />
          <p className="text-[11.5px] leading-relaxed" style={{ color: "#71717a" }}>
            <span className="font-medium" style={{ color: "#52525b" }}>AI-generated analysis.</span>{" "}
            Verdicts are produced by language models and may contain inaccuracies or hallucinations.
            Sources are filtered by domain reputation but may still be biased or outdated.
            Content behind paywalls or login gates cannot be analyzed.{" "}
            <span className="font-medium" style={{ color: "#52525b" }}>Do not use as a definitive source.</span>
          </p>
        </div>

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

        {/* ── Middle Row: Agent Terminal + Sources ── */}
        <div className="grid gap-3 items-start" style={{ gridTemplateColumns: "3fr 2fr" }}>

          {/* Agent Orchestration Panel */}
          <AgentOrchestrator
            tasks={live.tasks ?? []}
            phase={live.phase}
            processedClaims={live.processedClaims}
            totalClaims={totalClaims}
            runningCount={runningCount}
            delay={0.22}
          />

          {/* Sources Card */}
          <motion.div
            layout
            className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col overflow-hidden"
            style={{ height: 280 }}
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
                  ? "Gathering evidence…"
                  : "Sources appear as claims are verified."}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-zinc-100 flex-1 min-h-0 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {sources.map((source, i) => (
                    <motion.div
                      key={source.domain}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.03 }}
                      className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold border flex-shrink-0 ${TIER_CFG[source.tier].chipClass}`}
                        style={{ width: 60, textAlign: "center" }}
                      >
                        {TIER_CFG[source.tier].short}
                      </span>
                      <div
                        className="text-xs text-zinc-700 truncate font-mono flex-1 min-w-0"
                        title={source.domain}
                      >
                        {source.domain}
                      </div>
                      <div className="flex-shrink-0 bg-zinc-100 rounded-full overflow-hidden" style={{ height: 3, width: 60 }}>
                        <motion.div
                          className={`h-full rounded-full ${TIER_CFG[source.tier].barClass}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${(source.citationCount / maxCitations) * 100}%` }}
                          transition={{ duration: 0.55, ease: "easeOut" }}
                        />
                      </div>
                      <div className="text-xs text-zinc-500 tabular-nums flex-shrink-0" style={{ width: 18 }}>
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
      </main>
    </motion.div>
    </DashboardErrorBoundary>
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

// ── Agent Orchestrator ──────────────────────────────────────────────────────

type AgentMetaEntry = {
  label: string;
  color: string;
  bg: string;
  border: string;
};

const AGENT_META: Record<AgentKey, AgentMetaEntry> = {
  fetch:    { label: "Web Fetcher",      color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  extract:  { label: "Claim Extractor",  color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  evidence: { label: "Evidence Finder",  color: "#0d9488", bg: "#f0fdfa", border: "#99f6e4" },
  judge:    { label: "Verdict Judge",    color: "#7c3aed", bg: "#faf5ff", border: "#ddd6fe" },
};

// ── Monochrome task status icon (circle / checkmark / pie) ──────────────────
function TaskStatusIcon({ status, size = 13 }: { status: string; size?: number }) {
  const half = size / 2;
  const r = half - 1.5;
  if (status === "running") {
    // Spinning dashed arc — rendered as a CSS-animated SVG
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="animate-spin"
        style={{ animationDuration: "1s" }}
      >
        <circle
          cx={half} cy={half} r={r}
          fill="none"
          stroke="#18181b"
          strokeWidth="1.5"
          strokeDasharray={`${r * 1.8} ${r * 4.5}`}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === "done") {
    // Filled circle with white checkmark
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={half} cy={half} r={r + 0.5} fill="#18181b" />
        <path
          d={`M${half - 2.5} ${half} L${half - 0.5} ${half + 2} L${half + 3} ${half - 2.5}`}
          fill="none"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === "error") {
    // Hollow circle with X
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={half} cy={half} r={r} fill="none" stroke="#d1d5db" strokeWidth="1.5" />
        <path
          d={`M${half - 2.2} ${half - 2.2} L${half + 2.2} ${half + 2.2} M${half + 2.2} ${half - 2.2} L${half - 2.2} ${half + 2.2}`}
          stroke="#9ca3af"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  // pending — hollow circle
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={half} cy={half} r={r} fill="none" stroke="#d4d4d8" strokeWidth="1.5" />
    </svg>
  );
}

// Parse a task label into displayable parts
function parseTaskLabel(label: string): {
  isSubtask: boolean;
  claimBadge: string | null;
  text: string;
} {
  const isSubtask = label.startsWith("  \u21b3") || label.startsWith("  ↳");
  if (isSubtask) {
    const clean = label.replace(/^\s*↳\s*"?/, "").replace(/"?\s*$/, "");
    return { isSubtask: true, claimBadge: null, text: clean };
  }
  const claimMatch = label.match(/^\[(\d+)\/(\d+)\]\s*(.*)/);
  if (claimMatch) {
    return { isSubtask: false, claimBadge: `${claimMatch[1]}/${claimMatch[2]}`, text: claimMatch[3] };
  }
  return { isSubtask: false, claimBadge: null, text: label };
}

function AgentRing({
  done,
  total,
  running,
}: {
  done: number;
  total: number;
  running: boolean;
}) {
  const size = 36;
  const r = 14;
  const circ = 2 * Math.PI * r;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 100, damping: 22 });
  const dashOffset = useTransform(spring, (v) => circ - v * circ);

  useEffect(() => {
    mv.set(total > 0 ? done / total : 0);
  }, [done, total, mv]);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f4f4f5" strokeWidth="4" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#18181b"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {running ? (
          <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin" style={{ animationDuration: "1s" }}>
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="#18181b" strokeWidth="1.5" strokeDasharray="12 8" strokeLinecap="round" />
          </svg>
        ) : total > 0 && done === total ? (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M2.5 6.5 L5 9 L9.5 3.5"
              fill="none"
              stroke="#18181b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span style={{ fontSize: 9, color: "#a1a1aa", fontVariantNumeric: "tabular-nums" }}>
            {total > 0 ? `${Math.round((done / total) * 100)}%` : "—"}
          </span>
        )}
      </div>
    </div>
  );
}

const AgentSection = React.memo(function AgentSection({
  agentKey,
  tasks,
}: {
  agentKey: AgentKey;
  tasks: TaskLogEntry[];
}) {
  const cfg = AGENT_META[agentKey];
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasTasks = tasks.length > 0;
  const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "error").length;
  const hasRunning = tasks.some((t) => t.status === "running");
  const agentStatus: "pending" | "running" | "complete" = !hasTasks
    ? "pending"
    : hasRunning
      ? "running"
      : "complete";

  // Only show latest 30 tasks to prevent performance degradation
  const visibleTasks = tasks.slice(-30);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tasks.length]);

  return (
    <div
      style={{
        border: `1px solid ${hasTasks ? cfg.border : "#e4e4e7"}`,
        borderRadius: 8,
        background: hasTasks ? cfg.bg : "#fafafa",
        overflow: "hidden",
        transition: "border-color 0.3s, background 0.3s",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 12px 10px 10px",
          borderBottom: hasTasks ? `1px solid ${cfg.border}` : "none",
        }}
      >
        <AgentRing done={doneTasks} total={tasks.length} running={hasRunning} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 12.5,
              fontWeight: 600,
              color: hasTasks ? cfg.color : "#a1a1aa",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: 1.2,
            }}
          >
            {cfg.label}
          </div>
          <div style={{ fontSize: 10, color: hasTasks ? "#71717a" : "#a1a1aa", marginTop: 2, lineHeight: 1.2 }}>
            {hasTasks ? `${doneTasks} of ${tasks.length} steps done` : "Waiting to start"}
          </div>
        </div>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${agentStatus === "pending" ? "#e4e4e7" : cfg.border}`,
            color: agentStatus === "pending" ? "#a1a1aa" : cfg.color,
            background: agentStatus === "pending" ? "transparent" : `${cfg.color}10`,
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {agentStatus === "running" && (
            <svg width="6" height="6" viewBox="0 0 6 6" className="animate-spin" style={{ animationDuration: "1s", flexShrink: 0 }}>
              <circle cx="3" cy="3" r="2" fill="none" stroke="#71717a" strokeWidth="1.5" strokeDasharray="5 8" strokeLinecap="round" />
            </svg>
          )}
          {agentStatus === "complete" ? "Done" : agentStatus === "running" ? "Active" : "Waiting"}
        </span>
      </div>

      {/* Task list */}
      {hasTasks && (
        <div
          ref={scrollRef}
          style={{
            padding: "8px 10px 8px 12px",
            maxHeight: 160,
            overflowY: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: `${cfg.border} transparent`,
          }}
        >
          <AnimatePresence initial={false}>
            {visibleTasks.map((task) => {
              const { isSubtask, claimBadge, text } = parseTaskLabel(task.label);
              const isRunning = task.status === "running";
              const isError = task.status === "error";

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    paddingLeft: isSubtask ? 18 : 0,
                    paddingTop: 3,
                    paddingBottom: 3,
                    position: "relative",
                  }}
                >
                  {/* Subtask connector */}
                  {isSubtask && (
                    <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: cfg.border }} />
                  )}

                  {/* Status icon */}
                  <div style={{ flexShrink: 0, width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                    <TaskStatusIcon status={task.status} size={13} />
                  </div>

                  {/* Label */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isSubtask ? (
                      <span style={{ fontSize: 11, color: "#71717a", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        {/* subtask small dot */}
                        <svg width="5" height="5" viewBox="0 0 5 5" style={{ flexShrink: 0 }}>
                          <circle cx="2.5" cy="2.5" r="2" fill="#d4d4d8" />
                        </svg>
                        <span style={{ wordBreak: "break-word" }}>{text}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: isRunning ? "#18181b" : isError ? "#ef4444" : "#52525b", fontWeight: isRunning ? 500 : 400, lineHeight: "1.4" }}>
                        {claimBadge && (
                          <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            marginRight: 5,
                            padding: "0 5px",
                            borderRadius: 3,
                            background: `${cfg.color}15`,
                            border: `1px solid ${cfg.color}28`,
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: cfg.color,
                            letterSpacing: "0.03em",
                            verticalAlign: "middle",
                          }}>
                            {claimBadge}
                          </span>
                        )}
                        {text}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});

function AgentOrchestrator({
  tasks,
  phase,
  processedClaims,
  totalClaims,
  runningCount,
  delay,
}: {
  tasks: TaskLogEntry[];
  phase: JobPhase;
  processedClaims: number;
  totalClaims: number;
  runningCount: number;
  delay: number;
}) {
  const tasksByAgent = useMemo(() => {
    const groups: Record<AgentKey, TaskLogEntry[]> = {
      fetch: [],
      extract: [],
      evidence: [],
      judge: [],
    };
    for (const task of tasks) {
      if (task.agent in groups) groups[task.agent].push(task);
    }
    return groups;
  }, [tasks]);

  const doneTaskCount = tasks.filter(
    (t) => t.status === "done" || t.status === "error",
  ).length;

  return (
    <motion.div
      className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3"
      {...fadeUp(delay)}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 600,
              fontSize: 14,
              color: "#18181b",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Agent Orchestration
          </span>
          {runningCount > 0 && (
            <motion.span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 10,
                padding: "2px 9px",
                borderRadius: 999,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                color: "#15803d",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              animate={{ opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <motion.span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                }}
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
              {runningCount} running
            </motion.span>
          )}
          {phase === "complete" && runningCount === 0 && (
            <span
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 10,
                padding: "2px 9px",
                borderRadius: 999,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                color: "#15803d",
              }}
            >
              all done
            </span>
          )}
        </div>
        {tasks.length > 0 && (
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 10,
              color: "#71717a",
            }}
          >
            {doneTaskCount}/{tasks.length}
          </span>
        )}
      </div>

      {/* 2×2 agent grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(["fetch", "extract", "evidence", "judge"] as AgentKey[]).map((key) => (
          <AgentSection key={key} agentKey={key} tasks={tasksByAgent[key]} />
        ))}
      </div>

      {/* Claim progress bar */}
      {phase === "analyzing" && totalClaims > 0 && (
        <div
          className="flex items-center gap-2 pt-1"
          style={{ borderTop: "1px solid #f4f4f5" }}
        >
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9.5,
              color: "#71717a",
            }}
          >
            claims verified
          </span>
          <div
            className="flex-1 rounded-full overflow-hidden"
            style={{ height: 3, background: "#f4f4f5" }}
          >
            <motion.div
              style={{ height: "100%", background: "#18181b", borderRadius: 999 }}
              initial={{ width: 0 }}
              animate={{ width: `${(processedClaims / totalClaims) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <span
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9.5,
              color: "#71717a",
            }}
          >
            {processedClaims}/{totalClaims}
          </span>
        </div>
      )}
    </motion.div>
  );
}
// Backward-compatible export
export type { JobState as FactCheckResult };
