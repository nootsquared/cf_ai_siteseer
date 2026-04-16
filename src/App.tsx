import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Globe, Code, Cloud } from "lucide-react";
import { DotGridBackground } from "./components/ui/dot-grid-background";
import { EncryptedText } from "./components/ui/encrypted-text";
import { Tooltip } from "./components/ui/tooltip-card";
import { GooeyInput } from "./components/ui/gooey-input";
import { Dashboard } from "./components/ui/dashboard";
import {
  QueryHistorySidebar,
  type QueryHistoryEntry,
} from "./components/ui/query-history-sidebar";
import { createJob, isValidUrl, verifyUrl, type JobState } from "./lib/api";
import "./App.css";

const developerLinks = (
  <div className="flex flex-col gap-3">
    <a
      href="https://github.com/pranavmaringanti"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 text-neutral-500 hover:text-neutral-900 transition-colors"
    >
      <Code size={13} className="shrink-0" />
      <span className="text-xs dev-link-text">github.com/pranavmaringanti</span>
    </a>
    <a
      href="https://linkedin.com/in/pranavmaringanti"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 text-neutral-500 hover:text-neutral-900 transition-colors"
    >
      <ExternalLink size={13} className="shrink-0" />
      <span className="text-xs dev-link-text">linkedin.com/in/pranavmaringanti</span>
    </a>
    <a
      href="https://pranavmaringanti.com"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 text-neutral-500 hover:text-neutral-900 transition-colors"
    >
      <Globe size={13} className="shrink-0" />
      <span className="text-xs dev-link-text">pranavmaringanti.com</span>
    </a>
  </div>
);

type SubmitState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "error"; message: string }
  | { kind: "active"; jobId: string; url: string; initialState?: JobState };

let entryCounter = 0;

export default function App() {
  const [inputUrl, setInputUrl] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [navKey, setNavKey] = useState(0);

  const addHistoryEntry = useCallback((jobId: string, url: string) => {
    entryCounter += 1;
    const entry: QueryHistoryEntry = {
      id: `q-${entryCounter}-${Date.now()}`,
      jobId,
      url,
      status: "loading",
      score: 0,
      overallProgress: 4,
      trueClaims: 0,
      falseClaims: 0,
      uncertainClaims: 0,
      totalClaims: 0,
      processedClaims: 0,
      timestamp: Date.now(),
    };
    setQueryHistory((prev) => [entry, ...prev]);
  }, []);

  const updateHistoryEntry = useCallback(
    (jobId: string, updates: Partial<QueryHistoryEntry>) => {
      setQueryHistory((prev) =>
        prev.map((e) => (e.jobId === jobId ? { ...e, ...updates } : e)),
      );
    },
    [],
  );

  const handleSubmit = async () => {
    const raw = inputUrl.trim();
    if (!raw) return;

    const normalized = isValidUrl(raw);
    if (!normalized) {
      setSubmit({ kind: "error", message: "That doesn't look like a valid URL." });
      return;
    }

    setSubmit({ kind: "verifying" });

    const probe = await verifyUrl(normalized);
    if (!probe.ok) {
      setSubmit({
        kind: "error",
        message: probe.error ?? "Unable to reach that URL.",
      });
      return;
    }

    try {
      const jobId = await createJob(normalized);
      setSubmit({ kind: "active", jobId, url: normalized });
      addHistoryEntry(jobId, normalized);
    } catch (e) {
      setSubmit({ kind: "error", message: (e as Error).message });
    }
  };

  const handleReset = () => {
    setNavKey((k) => k + 1);
    setSubmit({ kind: "idle" });
    setInputUrl("");
  };

  const handleRetry = async (entry: QueryHistoryEntry) => {
    setSubmit({ kind: "verifying" });
    setInputUrl(entry.url);

    try {
      const jobId = await createJob(entry.url);
      setSubmit({ kind: "active", jobId, url: entry.url });
      addHistoryEntry(jobId, entry.url);
    } catch (e) {
      setSubmit({ kind: "error", message: (e as Error).message });
    }
  };

  const handleSelectHistory = (entry: QueryHistoryEntry) => {
    setNavKey((k) => k + 1);
    setSubmit({ kind: "active", jobId: entry.jobId, url: entry.url, initialState: entry.cachedState });
  };

  const isVerifying = submit.kind === "verifying";
  const errorMessage = submit.kind === "error" ? submit.message : null;
  const active = submit.kind === "active" ? submit : null;

  // Historical view: active job is not the most recent one in history
  const isHistoricalView = active !== null && queryHistory.length > 0 && queryHistory[0].jobId !== active.jobId;
  const queryPositionIndex = active !== null ? queryHistory.findIndex((e) => e.jobId === active.jobId) : -1;
  const latestEntry = queryHistory[0] ?? null;

  return (
    <div className="app-root" style={{ display: "flex", flexDirection: "row" }}>
      {/* Query History Sidebar — always present when there are entries or active job */}
      {(queryHistory.length > 0 || active) && (
        <QueryHistorySidebar
          entries={queryHistory}
          activeJobId={active?.jobId ?? null}
          onSelect={handleSelectHistory}
          onRetry={handleRetry}
        />
      )}

      {/* Main content area */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <AnimatePresence mode="popLayout">
          {!active ? (
            /* ── Landing ── */
            <motion.div
              key="landing"
              className="landing-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              style={{ position: "relative" }}
            >
              <DotGridBackground />

              <div className="content-center">
                <h1 className="siteseer-title">
                  <EncryptedText
                    text="site-seer"
                    revealDelayMs={65}
                    flipDelayMs={40}
                    encryptedClassName="char-encrypted"
                    revealedClassName="char-revealed"
                  />
                </h1>

                <p className="subtitle-text">
                  Developed by{" "}
                  <Tooltip content={developerLinks} containerClassName="inline">
                    <span className="developer-name">Pranav Maringanti</span>
                  </Tooltip>
                </p>

                <div className="input-section">
                  <span className="input-pretext">
                    {isVerifying ? "Verifying URL…" : "Enter website URL"}
                  </span>

                  <div
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isVerifying && inputUrl.trim()) handleSubmit();
                    }}
                    style={{ opacity: isVerifying ? 0.55 : 1, transition: "opacity 0.2s" }}
                  >
                    <GooeyInput
                      value={inputUrl}
                      onValueChange={(v) => {
                        setInputUrl(v);
                        if (submit.kind === "error") setSubmit({ kind: "idle" });
                      }}
                      placeholder="Enter website URL"
                      expandedWidth={420}
                      collapsedWidth={280}
                      expandedOffset={44}
                      classNames={{
                        trigger: "gooey-search-field",
                        input: "gooey-search-field",
                      }}
                    />
                  </div>

                  <AnimatePresence mode="wait">
                    {errorMessage ? (
                      <motion.p
                        key="err"
                        className="input-subtext"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        style={{ color: "#b91c1c" }}
                      >
                        {errorMessage}
                      </motion.p>
                    ) : isVerifying ? (
                      <motion.p
                        key="ver"
                        className="input-subtext"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        Checking that the link is reachable…
                      </motion.p>
                    ) : (
                      <motion.p
                        key="idle"
                        className="input-subtext"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        Add a URL to parse through and scan for false information
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                <div className="cf-badge">
                  <Cloud size={13} className="cf-badge-icon" />
                  <span>Built for Cloudflare AI Challenge</span>
                </div>
              </div>
            </motion.div>
          ) : (
            /* ── Dashboard ── */
            <motion.div
              key={`dash-${navKey}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ flex: 1, display: "flex", flexDirection: "column" }}
            >
              <Dashboard
                jobId={active.jobId}
                url={active.url}
                initialState={active.initialState}
                isHistoricalView={isHistoricalView}
                queryPosition={queryPositionIndex >= 0 ? { index: queryPositionIndex + 1, total: queryHistory.length } : undefined}
                onReset={handleReset}
                onRetry={() => handleRetry({ jobId: active.jobId, url: active.url } as QueryHistoryEntry)}
                onStateUpdate={(updates) => updateHistoryEntry(active.jobId, updates)}
                onSelectLatest={isHistoricalView && latestEntry ? () => handleSelectHistory(latestEntry) : undefined}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
