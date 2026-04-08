export type TavilyResult = {
  title: string;
  url: string;
  content: string;
};

export async function searchClaim(
  claim: string,
  apiKey: string
): Promise<TavilyResult[]> {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: claim,
        search_depth: 'basic',
        max_results: 3,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json<{ results: TavilyResult[] }>();
    return data.results ?? [];
  } catch {
    return [];
  }
}
