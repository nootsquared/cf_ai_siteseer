import type { AgentKey, Claim, ClaimSource, TaskLogEntry, TaskStatus } from './index';
import { extractClaims } from './extract';
import { searchClaim, TavilyResult } from './search';
import { filterAndRank } from './trust';

// ─── Task-log helpers ───────────────────────────────────────────────────────

function task(agent: AgentKey, label: string, status: TaskStatus = 'done'): TaskLogEntry {
  return {
    id: crypto.randomUUID(),
    agent,
    label,
    status,
    ts: Date.now(),
  };
}

async function postPatch(
  stub: DurableObjectStub,
  patch: Record<string, unknown>,
): Promise<void> {
  await stub.fetch('https://do.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// ─── Heuristic claim filter (used as fallback when LLM is unavailable) ───────

function heuristicFilterClaims(sentences: string[]): string[] {
  return sentences
    .filter((s) => {
      // Must contain at least one digit (dates, statistics, counts make claims checkable)
      if (!/\d/.test(s)) return false;
      // Skip pure navigation / section headers
      if (/^(see also|references|external links|further reading|notes|bibliography)/i.test(s.trim())) return false;
      // Skip sentences that are just UI labels or metadata fragments
      if (/^(born|died|in office|nationality|children|spouse|parents|education)[\s:]/i.test(s.trim())) return false;
      return true;
    })
    // Prefer sentences with year-like numbers — these are historical/factual
    .sort((a, b) => {
      const aYear = /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(a) ? 1 : 0;
      const bYear = /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(b) ? 1 : 0;
      return bYear - aYear;
    })
    .slice(0, 10);
}

// ─── LLM: claim filtering ───────────────────────────────────────────────────

async function filterToVerifiableClaims(
  sentences: string[],
  title: string,
  env: Env,
  stub: DurableObjectStub,
): Promise<string[]> {
  // Process in chunks to stay within context limits
  const chunkSize = 20; // smaller chunks = shorter prompts = less likely to fail
  const kept: string[] = [];
  let llmFailures = 0;
  let firstError = '';

  for (let i = 0; i < sentences.length; i += chunkSize) {
    // Stop once we have enough claims — avoids burning through all chunks unnecessarily
    if (kept.length >= 10) break;

    const chunk = sentences.slice(i, i + chunkSize);
    const numbered = chunk.map((s, idx) => `${idx + 1}. ${s}`).join('\n');

    try {
      const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
        messages: [
          {
            role: 'system',
            content: `You are a claim extractor. Given numbered sentences, return ONLY the numbers of sentences that are VERIFIABLE FACTUAL CLAIMS — statements checkable against external evidence (statistics, dates, events, scientific facts, legal rulings, etc.).

EXCLUDE opinions, editorial commentary, vague statements, plot summaries of fiction, and duplicate claims.

Respond with ONLY a JSON array of integers. Example: [1, 4, 7, 12]`,
          },
          {
            role: 'user',
            content: `Article: ${title}\n\nSentences:\n${numbered}`,
          },
        ],
      })) as { response: string };

      const responseText =
        typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      // Match only arrays of integers to avoid matching English text in brackets
      const jsonMatch = responseText.match(/\[\s*(?:\d+(?:\s*,\s*\d+)*)?\s*\]/);
      if (jsonMatch) {
        const indices = JSON.parse(jsonMatch[0]) as unknown[];
        for (const idx of indices) {
          const n = Number(idx);
          if (Number.isInteger(n) && n >= 1 && n <= chunk.length) {
            kept.push(chunk[n - 1]);
          }
        }
      }
    } catch (err) {
      llmFailures++;
      if (!firstError) firstError = String(err).slice(0, 120);
    }
  }

  // If every LLM call failed, surface the error and fall back to heuristic filtering
  const totalChunks = Math.ceil(sentences.length / chunkSize);
  if (llmFailures === totalChunks && totalChunks > 0) {
    await postPatch(stub, {
      appendTasks: [
        task('extract', `LLM filtering unavailable (${firstError || 'unknown error'}) — using heuristic fallback`, 'error'),
        task('extract', 'Applying heuristic claim filter…', 'running'),
      ],
    });
    return heuristicFilterClaims(sentences);
  }

  return kept.slice(0, 10);
}

// ─── LLM: query generation ──────────────────────────────────────────────────

async function generateSearchQueries(
  claim: string,
  articleTitle: string,
  env: Env,
): Promise<string[]> {
  try {
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
      messages: [
        {
          role: 'system',
          content:
            'You are a research assistant. Given a claim, generate 2-3 short, focused search queries that will find sources discussing the same topic. Include the key facts, names, and dates from the claim. Respond with ONLY a JSON array of strings. Example: ["query one", "query two"]',
        },
        {
          role: 'user',
          content: `Article: ${articleTitle}\nClaim: ${claim}`,
        },
      ],
    })) as { response: string };

    const responseText =
      typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
    const jsonMatch = responseText.trim().match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const queries = JSON.parse(jsonMatch[0]) as unknown[];
    return queries
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [claim];
  }
}

// ─── Tavily: search + filter ────────────────────────────────────────────────

async function searchWithQueries(
  queries: string[],
  apiKey: string,
): Promise<{ results: TavilyResult[]; answers: string[] }> {
  const all = await Promise.all(queries.map((q) => searchClaim(q, apiKey)));
  const seen = new Set<string>();
  const deduped: TavilyResult[] = [];
  const answers: string[] = [];
  for (const bundle of all) {
    if (bundle.answer && bundle.answer.trim()) answers.push(bundle.answer.trim());
    for (const result of bundle.results) {
      if (!seen.has(result.url)) {
        seen.add(result.url);
        deduped.push(result);
      }
    }
  }
  return { results: deduped, answers };
}

// ─── LLM: evaluation ────────────────────────────────────────────────────────

// Derive verdict without LLM by using source tier + Tavily answer text matching.
// Used as fallback when the LLM call fails or returns unusable output.
function heuristicVerdict(
  claim: string,
  evidence: Array<TavilyResult & { _classified: { domain: string; tier: string; weight: number } }>,
  tavilyAnswers: string[],
): { verdict: Claim['verdict']; explanation: string } {
  if (evidence.length === 0) {
    return { verdict: 'uncertain', explanation: 'No sources found for this claim.' };
  }

  // If Tavily's own synthesized answer is available, do simple keyword overlap
  // between the claim and the answer to decide relevance.
  const combinedText = [
    ...tavilyAnswers,
    ...evidence.map((e) => `${e.title} ${e.content}`),
  ].join(' ').toLowerCase();

  // Extract meaningful words from the claim (skip stop words)
  const stopWords = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'was', 'is', 'were', 'be', 'been', 'by', 'with', 'as', 'that', 'which', 'who', 'this', 'then', 'from']);
  const claimWords = claim.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const matchCount = claimWords.filter((w) => combinedText.includes(w)).length;
  const matchRatio = claimWords.length > 0 ? matchCount / claimWords.length : 0;

  const topSource = evidence[0]._classified.domain;

  if (matchRatio >= 0.4) {
    return {
      verdict: 'true',
      explanation: `Supported by ${topSource} and ${evidence.length - 1} other source${evidence.length > 2 ? 's' : ''}.`,
    };
  }

  return {
    verdict: 'uncertain',
    explanation: `Sources found but content overlap with claim is low (${topSource}).`,
  };
}

async function evaluateClaim(
  claim: string,
  evidence: Array<
    TavilyResult & { _classified: { domain: string; tier: string; weight: number } }
  >,
  tavilyAnswers: string[],
  env: Env,
): Promise<Claim> {
  const sources: ClaimSource[] = evidence.map((e) => ({
    domain: e._classified.domain,
    tier: e._classified.tier as ClaimSource['tier'],
    weight: e._classified.weight,
  }));

  if (evidence.length === 0) {
    return {
      text: claim,
      verdict: 'uncertain',
      explanation: 'No trustworthy sources could be located to verify this claim.',
      sources,
    };
  }

  // Build a compact context for the LLM — use only Tavily's synthesized answer
  // plus top-2 snippet titles. Keeps the prompt well under 500 tokens.
  const summary = tavilyAnswers.length > 0
    ? tavilyAnswers[0].slice(0, 600)
    : evidence.slice(0, 3).map((e) => `${e._classified.domain}: ${e.content.slice(0, 200)}`).join('\n');

  try {
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
      messages: [
        {
          role: 'system',
          content: 'You are a fact-checker. Reply with exactly one word: true, false, or uncertain.\n- true: the summary discusses the same topic and does not contradict the claim\n- false: the summary directly contradicts a specific fact in the claim\n- uncertain: the summary is completely off-topic\nOutput only the single word verdict.',
        },
        {
          role: 'user',
          content: `CLAIM: ${claim}\n\nSUMMARY: ${summary}`,
        },
      ],
      max_tokens: 10,
    } as any)) as { response: string };

    // Extract the raw response text, handling unexpected shapes
    const raw: unknown = result;
    const responseText: string =
      typeof (raw as { response?: unknown }).response === 'string'
        ? (raw as { response: string }).response
        : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw);

    const word = responseText.trim().toLowerCase().replace(/[^a-z]/g, '');
    const verdict = (['true', 'false', 'uncertain'] as const).find((v) => word.includes(v));

    if (verdict) {
      const topSource = evidence[0]._classified.domain;
      const explanation =
        verdict === 'true'
          ? `Supported by ${topSource}${evidence.length > 1 ? ` and ${evidence.length - 1} other source${evidence.length > 2 ? 's' : ''}` : ''}.`
          : verdict === 'false'
          ? `Contradicted by ${topSource}.`
          : `Sources found but did not directly address this claim.`;

      return { text: claim, verdict, explanation, sources };
    }

    // LLM returned something unrecognisable — fall through to heuristic
    throw new Error(`Unrecognised verdict word: "${responseText.slice(0, 30)}"`);
  } catch {
    // LLM failed or returned garbage — use keyword overlap heuristic
    const h = heuristicVerdict(claim, evidence, tavilyAnswers);
    return { text: claim, verdict: h.verdict, explanation: h.explanation, sources };
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export async function runAnalysis(
  stub: DurableObjectStub,
  url: string,
  env: Env,
): Promise<void> {
  try {
    await postPatch(stub, {
      status: 'processing',
      phase: 'fetching',
      appendTasks: [task('fetch', `Resolving ${new URL(url).hostname}`, 'running')],
    });

    await postPatch(stub, {
      appendTasks: [task('fetch', 'Downloading page HTML')],
    });

    const { title, claims: rawSentences } = await extractClaims(url);

    await postPatch(stub, {
      phase: 'extracting',
      title,
      appendTasks: [
        task('fetch', `Received page · "${truncate(title, 50)}"`),
        task('extract', 'Parsing DOM with HTMLRewriter', 'running'),
      ],
    });

    await postPatch(stub, {
      appendTasks: [
        task('extract', `Segmented ${rawSentences.length} candidate sentences`),
        task('extract', 'Filtering to verifiable factual claims…', 'running'),
      ],
    });

    const claimTexts = await filterToVerifiableClaims(rawSentences, title, env, stub);

    await postPatch(stub, {
      totalClaims: claimTexts.length,
      appendTasks: [
        task('extract', `Kept ${claimTexts.length} verifiable claims from ${rawSentences.length} sentences`),
      ],
    });

    await postPatch(stub, {
      phase: 'analyzing',
      appendTasks: [
        task('extract', 'Extraction complete'),
        task('evidence', 'Preparing batch 1 of evidence retrieval', 'running'),
        task('judge', 'Awaiting first evidence bundle', 'pending'),
      ],
    });

    const allClaims: Claim[] = [];
    const batchSize = 5;
    const totalBatches = Math.ceil(claimTexts.length / batchSize);

    for (let i = 0; i < claimTexts.length; i += batchSize) {
      const batch = claimTexts.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      await postPatch(stub, {
        appendTasks: [
          task('evidence', `Batch ${batchNum}/${totalBatches} · synthesising queries`, 'running'),
        ],
      });

      const results = await Promise.all(
        batch.map(async (claim, bi) => {
          const claimNum = i + bi + 1;
          const short = truncate(claim, 60);

          // Query generation
          const queries = await generateSearchQueries(claim, title, env);
          await postPatch(stub, {
            appendTasks: [
              task('evidence', `Claim ${claimNum} · generated ${queries.length} queries`),
              ...queries.map((q) => task('evidence', `→ "${truncate(q, 70)}"`)),
            ],
          });

          // Search
          const { results: raw, answers } = await searchWithQueries(
            queries,
            env.TAVILY_API_KEY,
          );
          await postPatch(stub, {
            appendTasks: [
              task('evidence', `Claim ${claimNum} · ${raw.length} raw results from Tavily`),
            ],
          });

          // Trust filter (2 per domain, up to 10 total — enough for consensus)
          const filtered = filterAndRank(raw, url, 2, 10);
          const dropped = raw.length - filtered.length;
          const filterLabel =
            dropped > 0
              ? `Claim ${claimNum} · kept ${filtered.length}, dropped ${dropped} untrusted`
              : `Claim ${claimNum} · kept ${filtered.length} trusted sources`;
          await postPatch(stub, {
            appendTasks: [task('evidence', filterLabel)],
          });

          // Evaluation
          await postPatch(stub, {
            appendTasks: [
              task('judge', `Evaluating claim ${claimNum} · "${short}"`, 'running'),
            ],
          });

          const evaluated = await evaluateClaim(claim, filtered, answers, env);
          await postPatch(stub, {
            appendTasks: [
              task(
                'judge',
                `Claim ${claimNum} → ${evaluated.verdict.toUpperCase()}`,
              ),
            ],
          });

          return evaluated;
        }),
      );

      allClaims.push(...results);

      await postPatch(stub, {
        processedClaims: allClaims.length,
        claims: allClaims,
        appendTasks: [
          task('evidence', `Batch ${batchNum}/${totalBatches} complete`),
        ],
      });
    }

    await postPatch(stub, {
      status: 'complete',
      phase: 'complete',
      claims: allClaims,
      processedClaims: allClaims.length,
      appendTasks: [
        task('judge', 'All verdicts finalised'),
        task('fetch', 'Pipeline complete'),
      ],
    });
  } catch (e) {
    await postPatch(stub, {
      status: 'error',
      phase: 'error',
      error: String(e),
      appendTasks: [task('fetch', `Error: ${String(e).slice(0, 120)}`, 'error')],
    });
  }
}
