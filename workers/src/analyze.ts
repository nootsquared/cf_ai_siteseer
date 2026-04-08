import type { Claim } from './index';
import { extractClaims } from './extract';
import { searchClaim, TavilyResult } from './search';

// Step 1: Ask the LLM to generate focused search queries for a claim
async function generateSearchQueries(
  claim: string,
  articleTitle: string,
  env: Env
): Promise<string[]> {
  try {
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
      messages: [
        {
          role: 'system',
          content:
            'You are a research assistant. Given a claim from a news article, generate 2-3 short, focused search queries to find evidence that could verify or refute it. Respond with ONLY a JSON array of strings, no other text. Example: ["query one", "query two", "query three"]',
        },
        {
          role: 'user',
          content: `Article: ${articleTitle}\nClaim: ${claim}`,
        },
      ],
    })) as { response: string };

    console.log(`[generateSearchQueries] raw response for "${claim.slice(0, 60)}...":`, result.response);

    // Workers AI sometimes returns a pre-parsed object instead of a string
    const responseText = typeof result.response === 'string'
      ? result.response
      : JSON.stringify(result.response);

    const jsonMatch = responseText.trim().match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const queries = JSON.parse(jsonMatch[0]) as unknown[];
    return queries
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 3);
  } catch (e) {
    console.log(`[generateSearchQueries] failed, falling back to raw claim:`, e);
    return [claim];
  }
}

// Step 2: Search Tavily for each query and combine results (deduplicated by URL)
async function searchWithQueries(queries: string[], apiKey: string): Promise<TavilyResult[]> {
  const allResults = await Promise.all(queries.map((q) => searchClaim(q, apiKey)));
  const seen = new Set<string>();
  const deduped: TavilyResult[] = [];
  for (const result of allResults.flat()) {
    if (!seen.has(result.url)) {
      seen.add(result.url);
      deduped.push(result);
    }
  }
  return deduped;
}

// Step 3: Evaluate the claim against the gathered evidence
async function evaluateClaim(
  claim: string,
  evidence: TavilyResult[],
  env: Env
): Promise<Claim> {
  const evidenceText =
    evidence.length > 0
      ? evidence.map((r, i) => `${i + 1}. ${r.title} — ${r.content}`).join('\n')
      : 'No evidence found.';

  try {
    const result = (await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as any, {
      messages: [
        {
          role: 'system',
          content:
            'You are a fact-checker. Given a claim and web search results as evidence, respond with ONLY a valid JSON object with two fields: "verdict" (must be exactly one of: "true", "false", "uncertain") and "explanation" (one sentence summarizing your reasoning). Do not include any text outside the JSON object.',
        },
        {
          role: 'user',
          content: `Claim: ${claim}\nEvidence:\n${evidenceText}`,
        },
      ],
    })) as { response: string };

    console.log(`[evaluateClaim] raw response for "${claim.slice(0, 60)}...":`, result.response);

    // Workers AI sometimes returns a pre-parsed object instead of a string
    const responseText = typeof result.response === 'string'
      ? result.response
      : JSON.stringify(result.response);

    // Extract JSON — handle markdown code fences and extra surrounding text
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
    };
  } catch (e) {
    console.log(`[evaluateClaim] failed:`, e);
    return { text: claim, verdict: 'uncertain', explanation: 'Could not evaluate.' };
  }
}

async function postToStub(stub: DurableObjectStub, patch: Record<string, unknown>): Promise<void> {
  await stub.fetch('https://do.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function runAnalysis(
  stub: DurableObjectStub,
  url: string,
  env: Env
): Promise<void> {
  try {
    await postToStub(stub, { status: 'processing' });

    const { title, claims: claimTexts } = await extractClaims(url);
    console.log(`[runAnalysis] extracted ${claimTexts.length} claims from "${title}"`);

    const allClaims: Claim[] = [];
    const batchSize = 5;

    for (let i = 0; i < claimTexts.length; i += batchSize) {
      const batch = claimTexts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (claim) => {
          const queries = await generateSearchQueries(claim, title, env);
          console.log(`[runAnalysis] queries for claim:`, queries);
          const evidence = await searchWithQueries(queries, env.TAVILY_API_KEY);
          return evaluateClaim(claim, evidence, env);
        })
      );
      allClaims.push(...results);
    }

    await postToStub(stub, { status: 'complete', claims: allClaims });
  } catch (e) {
    await postToStub(stub, { status: 'error', error: String(e) });
  }
}
