# Job Tracker Worker — Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Rewrite the Cloudflare Worker to replace the placeholder Durable Object with a `JobTracker` DO that acts as a per-job state store. The main Worker exposes two public HTTP routes for submitting a URL analysis job and checking its status.

---

## Data Model

Each DO instance owns exactly one job, keyed by a UUID job ID. State is persisted in DO storage.

```ts
type JobStatus = "pending" | "processing" | "complete" | "error";

type Claim = {
  text: string;
  verdict: "true" | "false" | "uncertain";
  explanation: string;
};

type JobState = {
  id: string;
  url: string;
  status: JobStatus;
  claims: Claim[];
  error?: string;
  createdAt: number;
  updatedAt: number;
};
```

---

## Durable Object — `JobTracker`

One DO instance per job, addressed by UUID job ID.

### Internal Routes (Worker → DO only, not publicly exposed)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/`  | Returns current `JobState` as JSON. Initializes state if not yet set (status: `"pending"`). |
| `POST` | `/`  | Accepts a partial patch `Partial<JobState>`, merges into stored state, persists, returns updated `JobState`. |

### Initialization

On `GET /`, if no state exists in storage, the DO initializes with:
- `status: "pending"`
- `claims: []`
- `createdAt` and `updatedAt` set to `Date.now()`

The `id` and `url` are passed as query params on the first `GET /` call so the DO can self-initialize without a separate creation step.

---

## Worker Fetch Handler

### Public Routes

#### `POST /jobs`
- **Body:** `{ url: string }`
- **Action:** Validates URL is present, generates a UUID job ID, gets DO stub by that ID, calls `GET /?id=<id>&url=<url>` on the stub to initialize state, returns `{ jobId: string }`.
- **Response:** `201 Created` with `{ jobId }`

#### `GET /jobs/:id`
- **Action:** Gets DO stub by job ID, calls `GET /` on the stub, returns the full `JobState`.
- **Response:** `200 OK` with `JobState`, or `404` if the stub returns no state.

All other routes return `405 Method Not Allowed`.

---

## Adding AI Later

When AI analysis is ready:

1. In the `POST /jobs` handler, after initializing the job, add:
   ```ts
   ctx.waitUntil(runAnalysis(stub, url, env));
   ```
2. `runAnalysis` POSTs `{ status: "processing" }` to the DO, runs the AI call, then POSTs `{ status: "complete", claims: [...] }` (or `{ status: "error", error: "..." }` on failure).

No changes needed to the DO's interface or the public routes.

---

## `wrangler.jsonc` Changes

- Rename DO class: `MyDurableObject` → `JobTracker`
- Rename binding: `MY_DURABLE_OBJECT` → `JOB_TRACKER`
- Add a new migration tag `v2` with `new_sqlite_classes: ["JobTracker"]`
- Keep existing `v1` migration entry

---

## Error Handling

- `POST /jobs` with missing/invalid URL → `400 Bad Request`
- `GET /jobs/:id` with unknown ID → `404 Not Found`
- DO internal errors → `500 Internal Server Error` with `{ error: message }`
