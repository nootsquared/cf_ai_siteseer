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

// ─── LLM: claim filtering ───────────────────────────────────────────────────

async function filterToVerifiableClaims(
  sentences: string[],
  title: string,
  env: Env,
): Promise<string[]> {
  // Process in chunks to stay within context limits
  const chunkSize = 30;
  const kept: string[] = [];

  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunk = sentences.slice(i, i + chunkSize);
    const numbered = chunk.map((s, idx) => `${idx + 1}. ${s}`).join('\n');

    try {
      const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
        messages: [
          {
            role: 'system',
            content: `You are a claim extractor. Given numbered sentences from a news article, return ONLY the numbers of sentences that are VERIFIABLE FACTUAL CLAIMS — statements that can be checked against external evidence (statistics, dates, events, scientific facts, legal rulings, etc.).

EXCLUDE:
- Opinions, analysis, or editorial commentary
- Quotes or attributions ("X said…", "according to X…") unless they contain a specific checkable fact
- Vague or subjective statements
- Descriptions of emotions or reactions
- Transition sentences or article structure
- Duplicate or near-duplicate claims

Return a JSON array of the numbers to KEEP. Aim for the 10-15 strongest, most specific claims. Example: [1, 4, 7, 12]`,
          },
          {
            role: 'user',
            content: `Article: ${title}\n\nSentences:\n${numbered}`,
          },
        ],
      })) as { response: string };

      const responseText =
        typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      const jsonMatch = responseText.trim().match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const indices = JSON.parse(jsonMatch[0]) as unknown[];
        for (const idx of indices) {
          const n = Number(idx);
          if (Number.isInteger(n) && n >= 1 && n <= chunk.length) {
            kept.push(chunk[n - 1]);
          }
        }
      }
    } catch {
      // On failure (including timeout), fall back to keeping the chunk as-is
      kept.push(...chunk);
    }
  }

  // Cap at 20 claims max to keep analysis focused
  return kept.slice(0, 20);
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
            'You are a research assistant specializing in primary-source verification. Given a claim from a news article, generate 2-3 short, focused search queries to find evidence from PRIMARY sources like government reports, academic papers, official transcripts, or dedicated fact-checkers. Avoid queries that would surface news opinion or social media. Respond with ONLY a JSON array of strings. Example: ["query one", "query two"]',
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

  const today = new Date().toISOString().slice(0, 10);

  const evidenceText = evidence
    .map((r, i) => {
      const date = r.published_date ? ` · ${r.published_date.slice(0, 10)}` : '';
      return `${i + 1}. [${r._classified.tier.toUpperCase()} · ${r._classified.domain}${date}] ${r.title} — ${r.content}`;
    })
    .join('\n');

  const answerBlock =
    tavilyAnswers.length > 0
      ? `\n\nSearch engine summary of the above:\n${tavilyAnswers.join('\n---\n')}`
      : '';

  try {
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
      messages: [
        {
          role: 'system',
          content: `You are a careful fact-checker. Today is ${today}. You will be given a claim and recent evidence from trusted sources (self-citations and social media have already been removed).

RULES:
- Base your verdict ONLY on the provided evidence. Ignore any prior knowledge you may have — it may be outdated.
- Prefer the most recent sources when evidence conflicts, and prefer higher-tier sources (PRIMARY > ACADEMIC > FACTCHECK > NEWS).
- If two or more independent credible sources corroborate the claim, verdict is "true".
- Only mark "false" when the evidence CLEARLY contradicts the claim. Minor imprecision (e.g. a number being approximate) is NOT false.
- If the evidence is ambiguous, mixed, or absent, use "uncertain". Do NOT guess "false" when unsure.
- A claim being a common opinion or interpretation (not a factual statement) should be "uncertain".

Respond with ONLY a valid JSON object:
{"verdict": "true" | "false" | "uncertain", "explanation": "one sentence citing which source supports your verdict"}
Do not include any text outside the JSON.`,
        },
        {
          role: 'user',
          content: `Claim: ${claim}\n\nEvidence:\n${evidenceText}${answerBlock}`,
        },
      ],
    })) as { response: string };

    const responseText =
      typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
    const jsonMatch = responseText.trim().match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON object in response');

    const parsed = JSON.parse(jsonMatch[0]) as { verdict: string; explanation: string };
    if (!['true', 'false', 'uncertain'].includes(parsed.verdict)) {
      throw new Error(`Invalid verdict: ${parsed.verdict}`);
    }

    return {
      text: claim,
      verdict: parsed.verdict as Claim['verdict'],
      explanation: String(parsed.explanation),
      sources,
    };
  } catch {
    return {
      text: claim,
      verdict: 'uncertain',
      explanation: 'Could not evaluate against available evidence.',
      sources,
    };
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

    const claimTexts = await filterToVerifiableClaims(rawSentences, title, env);

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
