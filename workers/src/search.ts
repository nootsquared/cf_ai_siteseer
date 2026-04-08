export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
  score?: number;
};

// Tavily search tuned for fact-checking:
//   - advanced depth for richer snippets
//   - news topic with a multi-year window so recent reporting is preferred
//   - include_answer gives us Tavily's own synthesized summary to ground the LLM
export async function searchClaim(
  claim: string,
  apiKey: string,
): Promise<{ results: TavilyResult[]; answer?: string }> {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: claim,
        search_depth: 'advanced',
        topic: 'news',
        days: 1825, // ~5 years
        max_results: 8,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      // Fall back to a general search if the news topic returned nothing usable
      const fallback = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: claim,
          search_depth: 'advanced',
          topic: 'general',
          max_results: 8,
          include_answer: true,
        }),
      });
      if (!fallback.ok) return { results: [] };
      const d = await fallback.json<{ results: TavilyResult[]; answer?: string }>();
      return { results: d.results ?? [], answer: d.answer };
    }

    const data = await response.json<{ results: TavilyResult[]; answer?: string }>();
    return { results: data.results ?? [], answer: data.answer };
  } catch {
    return { results: [] };
  }
}
