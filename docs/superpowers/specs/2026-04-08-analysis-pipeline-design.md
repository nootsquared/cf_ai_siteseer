# Analysis Pipeline — Design Spec

**Date:** 2026-04-08
**Status:** Approved

## Overview

When a job is submitted via `POST /jobs`, the Worker kicks off a background analysis task via `ctx.waitUntil`. The task fetches the submitted URL, extracts readable text using Cloudflare's `HTMLRewriter`, splits it into sentence-level claims, searches each claim against the Tavily API for real web evidence, then asks Llama 3.3 on Workers AI to evaluate each claim as true/false/uncertain. Results are written back to the `JobTracker` Durable Object via its existing `POST /` route.

---

## File Structure

### `src/extract.ts`
Responsible for fetching the URL and returning a filtered array of sentence-level claims.

- Fetches the URL with `fetch(url)`
- Pipes the response through `HTMLRewriter` to collect text content from: `p`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `li`, `article`, `main`, `section`, `blockquote`, `td`
- Skips text from: `script`, `style`, `nav`, `footer`, `header`, `aside`, `button`, `label`, `input`
- Collected text is joined and split into sentences by `.`, `!`, `?` followed by whitespace or end of string
- Filters out any sentence shorter than 40 characters or fewer than 6 words
- Returns `string[]`

### `src/search.ts`
Responsible for querying the Tavily search API for a single claim.

- Exports `searchClaim(claim: string, apiKey: string): Promise<TavilyResult[]>`
- POSTs to `https://api.tavily.com/search` with body `{ api_key, query: claim, search_depth: "basic", max_results: 3 }`
- Returns array of `{ title: string, url: string, content: string }`
- On error, returns empty array (does not throw — allows analysis to continue with no evidence)

```ts
export type TavilyResult = {
  title: string;
  url: string;
  content: string;
};
```

### `src/analyze.ts`
Responsible for orchestrating the full analysis pipeline for a single job.

- Exports `runAnalysis(stub: DurableObjectStub, url: string, env: Env): Promise<void>`
- Flow:
  1. POST `{ status: "processing" }` to the DO stub
  2. Call `extractClaims(url)` → get `string[]`
  3. Process in batches of 5 using `Promise.all`
  4. For each claim: call `searchClaim(claim, env.TAVILY_API_KEY)`, then call `env.AI.run(...)` with the claim + search results
  5. Parse AI response as JSON `{ verdict, explanation }`; on parse failure use `{ verdict: "uncertain", explanation: "Could not evaluate." }`
  6. Collect all `Claim` objects
  7. POST `{ status: "complete", claims }` to the DO stub
  8. On any thrown error, POST `{ status: "error", error: String(e) }` to the DO stub

### `src/index.ts`
Only change: in `POST /jobs`, after `await stub.fetch(initUrl.toString())`, add:

```ts
ctx.waitUntil(runAnalysis(stub, body.url, env));
```

---

## AI Prompt

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

System message:
> You are a fact-checker. Given a claim and web search results as evidence, respond with ONLY a valid JSON object with two fields: "verdict" (must be exactly one of: "true", "false", "uncertain") and "explanation" (one sentence summarizing your reasoning). Do not include any text outside the JSON object.

User message:
> Claim: {claim}
> Evidence:
> 1. {title} — {content}
> 2. {title} — {content}
> 3. {title} — {content}

---

## Environment Secret

`TAVILY_API_KEY` is stored as a Wrangler secret:
```bash
wrangler secret put TAVILY_API_KEY
```

Since secrets don't appear in `wrangler types` output, `TAVILY_API_KEY: string` is added manually to the `Env` interface in `worker-configuration.d.ts`.

---

## Error Handling

| Failure point | Behavior |
|---|---|
| URL fetch fails | `runAnalysis` catches, POSTs `status: "error"` to DO |
| No claims extracted | POSTs `status: "complete"` with empty `claims: []` |
| Tavily search fails | Returns `[]` for that claim, analysis continues |
| AI response not valid JSON | Claim gets `{ verdict: "uncertain", explanation: "Could not evaluate." }` |
| Any unhandled error | `runAnalysis` catch block POSTs `status: "error"` |
