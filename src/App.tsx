import { ExternalLink, FileText, Globe, Code } from "lucide-react";
import { DotGridBackground } from "./components/ui/dot-grid-background";
import { EncryptedText } from "./components/ui/encrypted-text";
import { Tooltip } from "./components/ui/tooltip-card";
import { GooeyInput } from "./components/ui/gooey-input";
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
      href="/resume.pdf"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 text-neutral-500 hover:text-neutral-900 transition-colors"
    >
      <FileText size={13} className="shrink-0" />
      <span className="text-xs dev-link-text">Resume</span>
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
  return (
    <div className="app-root">
      <DotGridBackground />

      <div className="content-center">
        {/* Title */}
        <h1 className="siteseer-title">
          <EncryptedText
            text="SITE-SEER"
            revealDelayMs={65}
            flipDelayMs={40}
            encryptedClassName="char-encrypted"
            revealedClassName="char-revealed"
          />
        </h1>

        {/* Subtitle */}
        <p className="subtitle-text">
          Developed by{" "}
          <Tooltip content={developerLinks} containerClassName="inline">
            <span className="developer-name">Pranav Maringanti</span>
          </Tooltip>
        </p>

        {/* Input section */}
        <div className="input-section">
          <span className="input-pretext">Enter website URL</span>

          <GooeyInput
            placeholder="Enter website URL"
            expandedWidth={420}
            collapsedWidth={280}
            expandedOffset={44}
          />

          <p className="input-subtext">
            Add a URL to parse through and scan for false information
          </p>
        </div>
      </div>
    </div>
  );
}
