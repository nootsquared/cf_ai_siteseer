"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, RotateCw, AlertTriangle } from "lucide-react";
import { Tooltip } from "./tooltip-card";
import type { JobState } from "../../lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueryHistoryEntry = {
  id: string;
  jobId: string;
  url: string;
  title?: string;
  status: "loading" | "complete" | "error";
  phase?: string;
  score: number;
  overallProgress: number;
  trueClaims: number;
  falseClaims: number;
  uncertainClaims: number;
  totalClaims: number;
  processedClaims: number;
  timestamp: number;
  cachedState?: JobState;
};

// ── Mini Pie Chart ───────────────────────────────────────────────────────────

function MiniPie({
  progress,
  status,
  size = 28,
}: {
  progress: number;
  status: "loading" | "complete" | "error";
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 4;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference - (Math.max(0, Math.min(100, progress)) / 100) * circumference;

  const ringColor =
    status === "error"
      ? "#991b1b"
      : status === "complete"
        ? "#16a34a"
        : "#52525b";

  const bgColor = status === "loading" ? "#27272a" : "#3f3f46";

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth="3" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      {status === "complete" && (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="absolute inset-0"
        >
          <path
            d={`M ${cx - 3.5} ${cy + 0.5} L ${cx - 1} ${cy + 3} L ${cx + 4} ${cy - 2.5}`}
            fill="none"
            stroke="#16a34a"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {status === "loading" && (
        <span
          className="absolute inset-0 flex items-center justify-center text-zinc-400 tabular-nums"
          style={{ fontSize: 8, fontFamily: "'Share Tech Mono', monospace" }}
        >
          {Math.round(progress)}
        </span>
      )}
    </div>
  );
}

// ── Tooltip Content ──────────────────────────────────────────────────────────

function EntryTooltipContent({ entry }: { entry: QueryHistoryEntry }) {
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-2" style={{ minWidth: 200 }}>
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs font-semibold text-zinc-800 truncate"
          style={{ maxWidth: 160 }}
        >
          {entry.title || extractDomain(entry.url)}
        </span>
        <span className="text-[10px] text-zinc-400 flex-shrink-0 font-mono">{timeStr}</span>
      </div>

      <div
        className="text-[10px] text-zinc-500 truncate font-mono"
        style={{ maxWidth: 220 }}
      >
        {entry.url}
      </div>

      {entry.status === "loading" && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-zinc-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-zinc-700 rounded-full transition-all duration-500"
              style={{ width: `${entry.overallProgress}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-400 tabular-nums font-mono">
            {Math.round(entry.overallProgress)}%
          </span>
        </div>
      )}

      {entry.status === "complete" && (
        <div className="flex gap-3 pt-1 border-t border-neutral-100">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs font-bold text-zinc-900 tabular-nums">{entry.score}%</span>
            <span className="text-[9px] text-zinc-400">Score</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs font-bold text-zinc-800 tabular-nums">{entry.trueClaims}</span>
            <span className="text-[9px] text-zinc-400">True</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs font-bold text-zinc-800 tabular-nums">{entry.falseClaims}</span>
            <span className="text-[9px] text-zinc-400">False</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs font-bold text-zinc-800 tabular-nums">{entry.uncertainClaims}</span>
            <span className="text-[9px] text-zinc-400">Unsure</span>
          </div>
        </div>
      )}

      {entry.status === "error" && (
        <div className="flex items-center gap-1.5 text-[10px] text-red-600">
          <AlertTriangle size={10} />
          Analysis failed
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

// ── Main Sidebar ─────────────────────────────────────────────────────────────

interface QueryHistorySidebarProps {
  entries: QueryHistoryEntry[];
  activeJobId: string | null;
  onSelect: (entry: QueryHistoryEntry) => void;
  onRetry: (entry: QueryHistoryEntry) => void;
}

export function QueryHistorySidebar({
  entries,
  activeJobId,
  onSelect,
  onRetry,
}: QueryHistorySidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex flex-shrink-0 relative" style={{ zIndex: 40 }}>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="h-full bg-white border-r border-zinc-200 overflow-hidden flex flex-col"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 23px, rgba(0,0,0,0.02) 23px, rgba(0,0,0,0.02) 24px)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3.5 border-b border-zinc-200 flex-shrink-0"
              style={{ height: 48 }}
            >
              <span
                className="text-xs font-medium text-zinc-700 tracking-wide uppercase"
                style={{ fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.1em", fontSize: 10 }}
              >
                Query Log
              </span>
              <button
                onClick={() => setCollapsed(true)}
                type="button"
                className="text-zinc-400 hover:text-zinc-700 transition-colors p-1 -mr-1 rounded"
                title="Collapse panel"
              >
                <ChevronLeft size={14} />
              </button>
            </div>

            {/* Session warning */}
            <div
              className="px-3.5 py-2 border-b border-zinc-100 bg-zinc-50/70 flex-shrink-0"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              <p className="text-[9px] text-zinc-400 leading-relaxed" style={{ letterSpacing: "0.02em" }}>
                Session only — queries are not persisted across page refreshes or new instances.
              </p>
            </div>

            {/* Entries */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {entries.length === 0 ? (
                <div className="px-3.5 py-8 text-center">
                  <p
                    className="text-[10px] text-zinc-400"
                    style={{ fontFamily: "'Share Tech Mono', monospace" }}
                  >
                    No queries yet.
                    <br />
                    Enter a URL to begin.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence initial={false}>
                    {entries.map((entry) => {
                      const isActive = entry.jobId === activeJobId;
                      const domain = extractDomain(entry.url);
                      const displayName = entry.title || domain;

                      return (
                        <Tooltip
                          key={entry.id}
                          content={<EntryTooltipContent entry={entry} />}
                          containerClassName="block"
                        >
                          <motion.div
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -16 }}
                            transition={{ duration: 0.22, ease: "easeOut" }}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(entry)}
                              className={`w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 transition-colors border-b border-zinc-100 group ${
                                isActive
                                  ? "bg-zinc-100/80"
                                  : "hover:bg-zinc-50"
                              }`}
                            >
                              <MiniPie
                                progress={entry.status === "complete" ? entry.score : entry.overallProgress}
                                status={entry.status}
                              />

                              <div className="flex-1 min-w-0">
                                <div
                                  className={`text-[11px] truncate leading-tight ${
                                    isActive ? "text-zinc-900 font-medium" : "text-zinc-700"
                                  }`}
                                  style={{ fontFamily: "'Share Tech Mono', monospace" }}
                                >
                                  {displayName}
                                </div>
                                <div
                                  className="text-[9px] text-zinc-400 truncate mt-0.5"
                                  style={{ fontFamily: "'Share Tech Mono', monospace" }}
                                >
                                  {entry.status === "loading"
                                    ? `${entry.phase ?? "Processing"}… ${Math.round(entry.overallProgress)}%`
                                    : entry.status === "error"
                                      ? "Failed"
                                      : `${entry.score}% · ${entry.totalClaims} claims`}
                                </div>
                              </div>

                              {/* Retry button */}
                              {(entry.status === "complete" || entry.status === "error") && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRetry(entry);
                                  }}
                                  className="flex-shrink-0 p-1 rounded text-zinc-300 hover:text-zinc-700 hover:bg-zinc-100 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Re-analyze this URL"
                                >
                                  <RotateCw size={11} />
                                </button>
                              )}

                              {/* Loading spinner for active loading entries */}
                              {entry.status === "loading" && (
                                <div
                                  className="flex-shrink-0 w-3 h-3 border border-zinc-300 rounded-full animate-spin"
                                  style={{ borderTopColor: "#52525b" }}
                                />
                              )}
                            </button>
                          </motion.div>
                        </Tooltip>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Collapsed toggle tab */}
      {collapsed && (
        <motion.button
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, delay: 0.1 }}
          onClick={() => setCollapsed(false)}
          type="button"
          className="absolute top-[56px] -right-0 left-0 w-7 h-7 flex items-center justify-center bg-white border border-zinc-200 border-l-0 rounded-r-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors shadow-sm"
          style={{ zIndex: 41 }}
          title="Expand query log"
        >
          <ChevronRight size={13} />
        </motion.button>
      )}
    </div>
  );
}
