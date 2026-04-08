// ─── API client for the SiteSeer worker ─────────────────────────────────────

export type JobStatus = "pending" | "processing" | "complete" | "error";

export type JobPhase =
  | "queued"
  | "fetching"
  | "extracting"
  | "analyzing"
  | "complete"
  | "error";

export type Verdict = "true" | "false" | "uncertain";

export type SourceTier = "primary" | "academic" | "factcheck" | "news";

export type ClaimSource = {
  domain: string;
  tier: SourceTier;
  weight: number;
};

export type Claim = {
  text: string;
  verdict: Verdict;
  explanation: string;
  sources: ClaimSource[];
};

export type AgentKey = "fetch" | "extract" | "evidence" | "judge";

export type TaskStatus = "pending" | "running" | "done" | "error";

export type TaskLogEntry = {
  id: string;
  agent: AgentKey;
  label: string;
  status: TaskStatus;
  ts: number;
};

export type JobState = {
  id: string;
  url: string;
  title?: string;
  status: JobStatus;
  phase: JobPhase;
  totalClaims: number;
  processedClaims: number;
  claims: Claim[];
  tasks: TaskLogEntry[];
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const WORKER_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8787";

export function isValidUrl(raw: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function verifyUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${WORKER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    return data;
  } catch {
    return {
      ok: false,
      error: `Backend unreachable at ${WORKER_URL}. Start it with: cd workers && npx wrangler dev`,
    };
  }
}

export async function createJob(url: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create job: ${text}`);
  }
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

export async function fetchJob(jobId: string): Promise<JobState> {
  const res = await fetch(`${WORKER_URL}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch job: ${res.status}`);
  return (await res.json()) as JobState;
}
