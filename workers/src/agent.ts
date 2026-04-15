/**
 * FactCheckAgent — Cloudflare Agents-powered agentic fact-checker
 *
 * Two-phase pipeline:
 *  1. Intelligent claim classification (LLM decides what is verifiable)
 *  2. Agentic verification loop:
 *       Round 1: LLM generates focused queries → Tavily search → LLM evaluation
 *       Round 2: If evidence is weak, LLM generates alternative-angle queries
 *                and retries — this is the "agentic" decision point
 *
 * Uses direct LLM calls (no tool calling) for reliability with Llama 3.3 70B.
 */

import { Agent } from 'agents';
import { extractClaims } from './extract';
import { searchClaim, type TavilyResult } from './search';
import { filterAndRank } from './trust';
import type {
  AgentKey,
  Claim,
  ClaimSource,
  JobState,
  TaskLogEntry,
  TaskStatus,
} from './index';

// ─── Internal types ───────────────────────────────────────────────────────────

type ClassifiedEvidence = TavilyResult & {
  _classified: { domain: string; tier: string; weight: number };
};

// ─── FactCheckAgent ───────────────────────────────────────────────────────────

export class FactCheckAgent extends Agent<Env, JobState> {
  initialState: JobState = {
    id: '',
    url: '',
    status: 'pending',
    phase: 'queued',
    totalClaims: 0,
    processedClaims: 0,
    claims: [],
    tasks: [],
    createdAt: 0,
    updatedAt: 0,
  };

  // ── HTTP interface ──────────────────────────────────────────────────────────

  async onRequest(request: Request): Promise<Response> {
    const reqUrl = new URL(request.url);

    if (request.method === 'GET') {
      const id = reqUrl.searchParams.get('id');
      const jobUrl = reqUrl.searchParams.get('url');

      // Initialisation: GET /?id=X&url=Y
      if (id && jobUrl) {
        const now = Date.now();
        const newState: JobState = {
          id,
          url: jobUrl,
          status: 'pending',
          phase: 'queued',
          totalClaims: 0,
          processedClaims: 0,
          claims: [],
          tasks: [],
          createdAt: now,
          updatedAt: now,
        };
        this.setState(newState);
        this.ctx.waitUntil(this.startAnalysis(jobUrl));
        return Response.json(newState, { status: 201 });
      }

      // Poll: GET /
      const current = this.state;
      if (!current?.id) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
      }
      return Response.json(current);
    }

    if (request.method === 'POST') {
      const existing = this.state;
      if (!existing?.id) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
      }
      type Patch = Partial<JobState> & { appendTasks?: TaskLogEntry[] };
      const patch = await request.json<Patch>();
      const { appendTasks, ...rest } = patch;
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
      this.setState(updated);
      return Response.json(updated);
    }

    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  private mkTask(
    agent: AgentKey,
    label: string,
    status: TaskStatus = 'done',
  ): TaskLogEntry {
    return { id: crypto.randomUUID(), agent, label, status, ts: Date.now() };
  }

  private trunc(s: string, n = 80): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  private patch(updates: Partial<JobState> & { appendTasks?: TaskLogEntry[] }): void {
    const cur = this.state;
    if (!cur) return;
    const { appendTasks, ...rest } = updates;
    const mergedTasks = appendTasks
      ? [...(cur.tasks ?? []), ...appendTasks].slice(-250)
      : cur.tasks ?? [];
    this.setState({ ...cur, ...rest, tasks: mergedTasks, updatedAt: Date.now() });
  }

  /** Update the status of a single existing task by id. */
  private patchTask(taskId: string, status: TaskStatus): void {
    const cur = this.state;
    if (!cur) return;
    const tasks = (cur.tasks ?? []).map(t => t.id === taskId ? { ...t, status } : t);
    this.setState({ ...cur, tasks, updatedAt: Date.now() });
  }

  // ── Phase 1: Intelligent claim classification ─────────────────────────────
  //
  // LLM classifies each sentence into a typed category so we skip navigation
  // text, footers, opinions, and vague statements — only verifiable facts
  // reach Phase 2.

  async classifyClaims(sentences: string[], title: string): Promise<string[]> {
    const kept: string[] = [];
    const chunkSize = 10;
    let failures = 0;

    for (let i = 0; i < sentences.length && kept.length < 20; i += chunkSize) {
      const chunk = sentences.slice(i, i + chunkSize);
      const numbered = chunk.map((s, j) => `${j + 1}. ${s}`).join('\n');

      try {
        const result = (await this.env.AI.run(
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof this.env.AI.run>[0],
          {
            messages: [
              {
                role: 'system',
                content: `You are a claim classifier. Classify each numbered sentence.

TYPES:
- verifiable_fact: specific, checkable assertion (dates, statistics, events, scientific facts, legal rulings)
- statistical_claim: contains numbers, percentages, or measurable data
- opinion: subjective viewpoint or prediction
- page_element: navigation, footer, author bio, related articles, advertisement
- generic: vague statement without specific checkable facts

Article: "${this.trunc(title, 100)}"

Respond with ONLY a compact JSON array:
[{"i":1,"t":"verifiable_fact","v":true,"r":"specific date"},{"i":2,"t":"page_element","v":false,"r":"nav text"}]

Fields: i=1-based index, t=type, v=should_verify(boolean), r=brief reason`,
              },
              { role: 'user', content: `Classify:\n${numbered}` },
            ],
          } as Parameters<typeof this.env.AI.run>[1],
        )) as { response: string };

        const text = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
        const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/);
        if (jsonMatch) {
          type Row = { i: number; t: string; v: boolean; r: string };
          const rows = JSON.parse(jsonMatch[0]) as Row[];
          const toVerify = rows.filter(r => r.v);
          const skipped = rows.filter(r => !r.v);

          for (const row of toVerify) {
            if (row.i >= 1 && row.i <= chunk.length) kept.push(chunk[row.i - 1]);
          }

          const batchNum = Math.floor(i / chunkSize) + 1;
          const skipNote = skipped.length > 0 ? ` (skipped: ${skipped.map(r => r.t).join(', ')})` : '';
          this.patch({
            appendTasks: [
              this.mkTask('extract', `Batch ${batchNum}: ${toVerify.length} verifiable claims found${skipNote}`),
            ],
          });
        }
      } catch {
        failures++;
      }
    }

    if (failures > 0 && kept.length === 0) {
      this.patch({
        appendTasks: [
          this.mkTask('extract', 'LLM classification unavailable — using heuristic filter', 'error'),
        ],
      });
      return this.heuristicFilter(sentences);
    }

    return kept.slice(0, 20);
  }

  private heuristicFilter(sentences: string[]): string[] {
    return sentences
      .filter(
        s =>
          /\d/.test(s) &&
          !/^(see also|references|external links|further reading)/i.test(s.trim()),
      )
      .sort((a, b) =>
        (/\b(1[0-9]{3}|20[0-2][0-9])\b/.test(b) ? 1 : 0) -
        (/\b(1[0-9]{3}|20[0-2][0-9])\b/.test(a) ? 1 : 0),
      )
      .slice(0, 10);
  }

  // ── Phase 2: Agentic two-round verification ───────────────────────────────
  //
  // Round 1: LLM generates focused search queries → Tavily search → LLM verdict
  // Round 2 (conditional): If evidence is weak (< 2 trusted sources), the agent
  //   decides to retry with alternative-angle queries — this is the "agentic"
  //   decision point where the model recognises failure and adapts.

  /** Generate 2-3 targeted search queries for a claim. */
  private async generateQueries(
    claim: string,
    title: string,
    angle: 'initial' | 'alternative',
  ): Promise<string[]> {
    const instruction =
      angle === 'initial'
        ? 'Generate 2-3 specific search queries to find sources that verify or refute this claim. Include key terms, names, dates, and numbers from the claim.'
        : 'The previous search returned weak evidence. Generate 2-3 DIFFERENT queries using alternative keywords, related concepts, or broader context to find better sources.';

    try {
      const result = (await this.env.AI.run(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof this.env.AI.run>[0],
        {
          messages: [
            {
              role: 'system',
              content: `${instruction}\nRespond with ONLY a JSON array of strings: ["query 1", "query 2"]`,
            },
            {
              role: 'user',
              content: `Article: ${this.trunc(title, 100)}\nClaim: ${claim}`,
            },
          ],
        } as Parameters<typeof this.env.AI.run>[1],
      )) as { response: string };

      const text = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return [claim];
      const queries = JSON.parse(match[0]) as unknown[];
      const valid = queries
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .slice(0, 3);
      return valid.length > 0 ? valid : [claim];
    } catch {
      return [claim];
    }
  }

  /** Run parallel Tavily searches, deduplicating by URL. */
  private async runSearches(
    queries: string[],
  ): Promise<{ evidence: ClassifiedEvidence[]; answers: string[] }> {
    const all = await Promise.all(
      queries.map(q => searchClaim(q, this.env.TAVILY_API_KEY)),
    );
    const seenUrls = new Set<string>();
    const raw: TavilyResult[] = [];
    const answers: string[] = [];

    for (const s of all) {
      if (s.answer?.trim()) answers.push(s.answer.trim());
      for (const r of s.results) {
        if (!seenUrls.has(r.url)) { seenUrls.add(r.url); raw.push(r); }
      }
    }

    const evidence = filterAndRank(raw, this.state?.url ?? '', 2, 10) as ClassifiedEvidence[];
    return { evidence, answers };
  }

  /** Use LLM to evaluate a claim against evidence. Falls back to heuristic. */
  private async evalClaim(
    claim: string,
    evidence: ClassifiedEvidence[],
    answers: string[],
  ): Promise<{ verdict: Claim['verdict']; explanation: string }> {
    if (evidence.length === 0) {
      return {
        verdict: 'uncertain',
        explanation: 'No trusted sources found to verify this claim.',
      };
    }

    const summary =
      answers.length > 0
        ? answers[0].slice(0, 600)
        : evidence
            .slice(0, 3)
            .map(e => `${e._classified.domain}: ${e.content.slice(0, 200)}`)
            .join('\n');

    try {
      const result = (await this.env.AI.run(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof this.env.AI.run>[0],
        {
          messages: [
            {
              role: 'system',
              content:
                'You are a fact-checker. Reply with exactly one word: true, false, or uncertain.\n' +
                '- true: evidence supports or does not contradict the claim\n' +
                '- false: evidence directly contradicts a specific fact in the claim\n' +
                '- uncertain: evidence is off-topic, insufficient, or inconclusive\n' +
                'Output ONLY the single word.',
            },
            {
              role: 'user',
              content: `CLAIM: ${claim}\n\nEVIDENCE:\n${summary}`,
            },
          ],
          max_tokens: 10,
        } as Parameters<typeof this.env.AI.run>[1],
      )) as { response: string };

      const raw = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
      const word = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
      const verdict = (['true', 'false', 'uncertain'] as const).find(v => word.includes(v)) ?? null;

      if (verdict) {
        const top = evidence[0]._classified.domain;
        const explanation =
          verdict === 'true'
            ? `Supported by ${top}${evidence.length > 1 ? ` and ${evidence.length - 1} other source(s)` : ''}.`
            : verdict === 'false'
            ? `Contradicted by ${top}.`
            : `Sources found but did not directly address this claim.`;
        return { verdict, explanation };
      }
      throw new Error('unrecognised verdict');
    } catch {
      return this.heuristicVerdict(claim, evidence, answers);
    }
  }

  private heuristicVerdict(
    claim: string,
    evidence: ClassifiedEvidence[],
    answers: string[],
  ): { verdict: Claim['verdict']; explanation: string } {
    if (evidence.length === 0) {
      return { verdict: 'uncertain', explanation: 'No sources found.' };
    }
    const combined = [...answers, ...evidence.map(e => `${e.title ?? ''} ${e.content}`)].join(' ').toLowerCase();
    const stop = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'was', 'is', 'were', 'be', 'been', 'by', 'with', 'as', 'that', 'from']);
    const words = claim.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
    const ratio = words.length > 0 ? words.filter(w => combined.includes(w)).length / words.length : 0;
    const top = evidence[0]._classified.domain;
    return ratio >= 0.4
      ? { verdict: 'true', explanation: `Supported by ${top}${evidence.length > 1 ? ` and ${evidence.length - 1} other source(s)` : ''}.` }
      : { verdict: 'uncertain', explanation: `Sources found but limited correspondence with claim (${top}).` };
  }

  /** Two-round agentic verification for a single claim. */
  async verifyClaim(
    claim: string,
    title: string,
    claimNum: number,
    total: number,
  ): Promise<Claim> {
    const short = this.trunc(claim, 60);

    this.patch({
      appendTasks: [
        this.mkTask('judge', `[${claimNum}/${total}] Verifying: "${short}"`, 'running'),
      ],
    });

    // ── Round 1: Initial search ────────────────────────────────────────────
    const queries1 = await this.generateQueries(claim, title, 'initial');
    const qLabel = queries1.length === 1 ? `"${this.trunc(queries1[0], 55)}"` : `${queries1.length} queries`;

    this.patch({
      appendTasks: [
        this.mkTask('evidence', `[${claimNum}/${total}] Round 1 — searching ${qLabel}`, 'running'),
        ...queries1.slice(0, 2).map(q => this.mkTask('evidence', `  ↳ "${this.trunc(q, 60)}"`)),
      ],
    });

    const { evidence: ev1, answers: ans1 } = await this.runSearches(queries1);
    const q1 = ev1.length >= 3 ? 'strong' : ev1.length >= 1 ? 'limited' : 'none';

    this.patch({
      appendTasks: [
        this.mkTask('evidence', `[${claimNum}/${total}] Round 1: ${ev1.length} trusted source(s) — quality: ${q1}`),
      ],
    });

    let evidence = ev1;
    let answers = ans1;

    // ── Round 2: Agentic retry if evidence was weak ───────────────────────
    if (ev1.length < 2) {
      this.patch({
        appendTasks: [
          this.mkTask('evidence', `[${claimNum}/${total}] Weak evidence detected — agent retrying with alternative angle`, 'running'),
        ],
      });

      const queries2 = await this.generateQueries(claim, title, 'alternative');

      this.patch({
        appendTasks: [
          this.mkTask('evidence', `[${claimNum}/${total}] Round 2 — ${queries2.length} alternative quer${queries2.length === 1 ? 'y' : 'ies'}`, 'running'),
          ...queries2.slice(0, 2).map(q => this.mkTask('evidence', `  ↳ "${this.trunc(q, 60)}"`)),
        ],
      });

      const { evidence: ev2, answers: ans2 } = await this.runSearches(queries2);
      const seenDomains = new Set(ev1.map(e => e._classified.domain));
      const newEvidence = ev2.filter(e => !seenDomains.has(e._classified.domain));
      evidence = [...ev1, ...newEvidence];
      answers = [...ans1, ...ans2];

      const q2 = evidence.length >= 3 ? 'strong' : evidence.length >= 1 ? 'limited' : 'still poor';
      this.patch({
        appendTasks: [
          this.mkTask('evidence', `[${claimNum}/${total}] Round 2: ${evidence.length} total source(s) — quality: ${q2}`),
        ],
      });
    }

    // ── Evaluate ──────────────────────────────────────────────────────────
    this.patch({
      appendTasks: [
        this.mkTask('judge', `[${claimNum}/${total}] Evaluating ${evidence.length} source(s)…`, 'running'),
      ],
    });

    const { verdict, explanation } = await this.evalClaim(claim, evidence, answers);

    this.patch({
      appendTasks: [
        this.mkTask('judge', `[${claimNum}/${total}] ${verdict.toUpperCase()}: ${this.trunc(explanation, 90)}`),
      ],
    });

    return {
      text: claim,
      verdict,
      explanation,
      sources: evidence.slice(0, 6).map(e => ({
        domain: e._classified.domain,
        tier: e._classified.tier as ClaimSource['tier'],
        weight: e._classified.weight,
      })),
    };
  }

  // ── Main orchestrator ─────────────────────────────────────────────────────

  async startAnalysis(url: string): Promise<void> {
    try {
      const resolvingTask = this.mkTask('fetch', `Resolving ${new URL(url).hostname}`, 'running');
      const downloadingTask = this.mkTask('fetch', 'Downloading page HTML', 'running');
      this.patch({
        status: 'processing',
        phase: 'fetching',
        appendTasks: [resolvingTask, downloadingTask],
      });

      const { title, claims: rawSentences } = await extractClaims(url);

      // Mark fetch tasks done as soon as the page arrives — don't wait for the whole job
      this.patchTask(resolvingTask.id, 'done');
      this.patchTask(downloadingTask.id, 'done');

      const classifyingTask = this.mkTask('extract', 'Classifying sentences with LLM — identifying verifiable claims…', 'running');
      this.patch({
        phase: 'extracting',
        title,
        appendTasks: [
          this.mkTask('fetch', `Page received · "${this.trunc(title, 50)}"`),
          this.mkTask('extract', `${rawSentences.length} candidate sentences extracted`),
          classifyingTask,
        ],
      });

      const claimTexts = await this.classifyClaims(rawSentences, title);

      // Mark classifying done as soon as LLM finishes — don't wait for the whole job
      this.patchTask(classifyingTask.id, 'done');

      this.patch({
        totalClaims: claimTexts.length,
        phase: 'analyzing',
        appendTasks: [
          this.mkTask('extract', `Classification complete: ${claimTexts.length} verifiable claims from ${rawSentences.length} sentences`),
          this.mkTask('evidence', `Starting agentic verification of ${claimTexts.length} claim(s)…`, 'running'),
        ],
      });

      const allClaims: Claim[] = [];
      const total = claimTexts.length;

      for (let i = 0; i < claimTexts.length; i++) {
        const verified = await this.verifyClaim(claimTexts[i], title, i + 1, total);
        allClaims.push(verified);
        this.patch({ processedClaims: allClaims.length, claims: allClaims });
      }

      this.patch({
        status: 'complete',
        phase: 'complete',
        claims: allClaims,
        processedClaims: allClaims.length,
        appendTasks: [
          this.mkTask('judge', `All ${allClaims.length} verdicts finalised`),
          this.mkTask('fetch', 'Analysis complete'),
        ],
      });
    } catch (e) {
      this.patch({
        status: 'error',
        phase: 'error',
        error: String(e),
        appendTasks: [
          this.mkTask('fetch', `Error: ${String(e).slice(0, 120)}`, 'error'),
        ],
      });
    }
  }
}
