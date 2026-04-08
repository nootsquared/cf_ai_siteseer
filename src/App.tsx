import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Globe, Code } from "lucide-react";
import { DotGridBackground } from "./components/ui/dot-grid-background";
import { EncryptedText } from "./components/ui/encrypted-text";
import { Tooltip } from "./components/ui/tooltip-card";
import { GooeyInput } from "./components/ui/gooey-input";
import { Dashboard } from "./components/ui/dashboard";
import { createJob, isValidUrl, verifyUrl } from "./lib/api";
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
  | { kind: "active"; jobId: string; url: string };

export default function App() {
  const [inputUrl, setInputUrl] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

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
    } catch (e) {
      setSubmit({ kind: "error", message: (e as Error).message });
    }
  };

  const handleReset = () => {
    setSubmit({ kind: "idle" });
    setInputUrl("");
  };

  const isVerifying = submit.kind === "verifying";
  const errorMessage = submit.kind === "error" ? submit.message : null;
  const active = submit.kind === "active" ? submit : null;

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {!active ? (
          /* ── Landing ── */
          <motion.div
            key="landing"
            className="landing-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
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
            </div>
          </motion.div>
        ) : (
          /* ── Dashboard ── */
          <Dashboard
            key="dashboard"
            jobId={active.jobId}
            url={active.url}
            onReset={handleReset}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
