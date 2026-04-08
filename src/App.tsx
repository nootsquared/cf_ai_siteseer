import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Globe, Code } from "lucide-react";
import { DotGridBackground } from "./components/ui/dot-grid-background";
import { EncryptedText } from "./components/ui/encrypted-text";
import { Tooltip } from "./components/ui/tooltip-card";
import { GooeyInput } from "./components/ui/gooey-input";
import { Dashboard } from "./components/ui/dashboard";
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

export default function App() {
  const [inputUrl, setInputUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);

  const handleSubmit = () => {
    if (inputUrl.trim()) setSubmittedUrl(inputUrl.trim());
  };

  const handleReset = () => {
    setSubmittedUrl(null);
    setInputUrl("");
  };

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {!submittedUrl ? (
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
                <span className="input-pretext">Enter website URL</span>

                <div
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && inputUrl.trim()) handleSubmit();
                  }}
                >
                  <GooeyInput
                    value={inputUrl}
                    onValueChange={setInputUrl}
                    placeholder="Enter website URL"
                    expandedWidth={420}
                    collapsedWidth={280}
                    expandedOffset={44}
                  />
                </div>

                <p className="input-subtext">
                  Add a URL to parse through and scan for false information
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          /* ── Dashboard ── */
          <Dashboard key="dashboard" result={{ url: submittedUrl }} onReset={handleReset} />
        )}
      </AnimatePresence>
    </div>
  );  
}
