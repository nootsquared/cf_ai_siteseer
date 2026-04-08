import { DurableObject } from "cloudflare:workers";
import { runAnalysis } from './analyze';

// ─── Shared Types ────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "processing" | "complete" | "error";

export type JobPhase =
  | "queued"
  | "fetching"
  | "extracting"
  | "analyzing"
  | "complete"
  | "error";

export type ClaimSource = {
  domain: string;
  tier: "primary" | "academic" | "factcheck" | "news";
  weight: number;
};

export type Claim = {
  text: string;
  verdict: "true" | "false" | "uncertain";
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

// ─── CORS ────────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function jsonCors(data: unknown, init: ResponseInit = {}): Response {
  return withCors(Response.json(data, init));
}

// ─── Durable Object ──────────────────────────────────────────────────────────

export class JobTracker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const reqUrl = new URL(request.url);

    if (request.method === "GET") {
      const state = await this.ctx.storage.get<JobState>("job");

      if (!state) {
        const id = reqUrl.searchParams.get("id");
        const jobUrl = reqUrl.searchParams.get("url");

        if (id && jobUrl) {
          const now = Date.now();
          const newState: JobState = {
            id,
            url: jobUrl,
            status: "pending",
            phase: "queued",
            totalClaims: 0,
            processedClaims: 0,
            claims: [],
            tasks: [],
            createdAt: now,
            updatedAt: now,
          };
          await this.ctx.storage.put("job", newState);
          return Response.json(newState, { status: 201 });
        }

        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      return Response.json(state);
    }

    // POST /start — kick off the analysis pipeline inside the DO
    if (request.method === "POST" && reqUrl.pathname === "/start") {
      const { url: targetUrl } = await request.json<{ url: string }>();
      const selfStub = this.env.JOB_TRACKER.get(this.ctx.id);
      this.ctx.waitUntil(runAnalysis(selfStub, targetUrl, this.env));
      return Response.json({ ok: true });
    }

    if (request.method === "POST") {
      const existing = await this.ctx.storage.get<JobState>("job");
      if (!existing) {
        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      const patch = await request.json<
        Partial<JobState> & { appendTasks?: TaskLogEntry[] }
      >();
      const { appendTasks, ...rest } = patch;

      // Cap task log so the DO state doesn't grow unbounded.
      const mergedTasks = appendTasks
        ? [...(existing.tasks ?? []), ...appendTasks].slice(-250)
        : (rest.tasks ?? existing.tasks ?? []);

      const updated: JobState = {
        ...existing,
        ...rest,
        tasks: mergedTasks,
        id: existing.id,
        url: existing.url,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put("job", updated);
      return Response.json(updated);
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

// ─── Worker Fetch Handler ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // POST /verify — HEAD check a URL to confirm reachability
    if (request.method === "POST" && parts[0] === "verify" && parts.length === 1) {
      let body: { url?: unknown };
      try {
        body = await request.json();
      } catch {
        return jsonCors({ ok: false, error: "Invalid JSON body" }, { status: 400 });
      }
      if (!body.url || typeof body.url !== "string") {
        return jsonCors({ ok: false, error: "Missing required field: url" }, { status: 400 });
      }

      let parsed: URL;
      try {
        parsed = new URL(body.url);
      } catch {
        return jsonCors({ ok: false, error: "Invalid URL format" }, { status: 400 });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return jsonCors({ ok: false, error: "URL must use http or https" }, { status: 400 });
      }

      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8_000);
        // Use HEAD to avoid downloading the full page body
        const probe = await fetch(parsed.toString(), {
          method: "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SiteSeer/1.0; +https://siteseer.dev)",
          },
          redirect: "follow",
          signal: ac.signal,
        });
        clearTimeout(timer);
        // Any response (even 403/405) proves the site is reachable
        return jsonCors({ ok: true, status: probe.status });
      } catch (e) {
        const msg = (e as Error).name === "AbortError"
          ? "Request timed out — the site took too long to respond"
          : `Unreachable: ${(e as Error).message}`;
        return jsonCors({ ok: false, error: msg }, { status: 200 });
      }
    }

    // POST /jobs — submit a URL, get back a job ID
    if (request.method === "POST" && parts[0] === "jobs" && parts.length === 1) {
      let body: { url?: unknown };
      try {
        body = await request.json();
      } catch {
        return jsonCors({ error: "Invalid JSON body" }, { status: 400 });
      }

      if (!body.url || typeof body.url !== "string") {
        return jsonCors({ error: "Missing required field: url" }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      const stub = env.JOB_TRACKER.get(env.JOB_TRACKER.idFromName(jobId));

      const initUrl = new URL("https://do.internal/");
      initUrl.searchParams.set("id", jobId);
      initUrl.searchParams.set("url", body.url);
      await stub.fetch(initUrl.toString());

      // Start analysis inside the DO — its execution model supports long-running I/O
      ctx.waitUntil(
        stub.fetch('https://do.internal/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: body.url }),
        }),
      );

      return jsonCors({ jobId }, { status: 201 });
    }

    // GET /jobs/:id — check status and results
    if (request.method === "GET" && parts[0] === "jobs" && parts.length === 2) {
      const jobId = parts[1];
      const stub = env.JOB_TRACKER.get(env.JOB_TRACKER.idFromName(jobId));
      const doRes = await stub.fetch("https://do.internal/");

      const body = await doRes.json();
      return jsonCors(body, { status: doRes.status });
    }

    return withCors(new Response("Method Not Allowed", { status: 405 }));
  },
} satisfies ExportedHandler<Env>;
