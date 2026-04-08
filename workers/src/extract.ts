export async function extractClaims(url: string): Promise<string[]> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SiteSeer/1.0; +https://siteseer.dev)',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const blocks: string[] = [];
  let current = '';

  // Collect text block-by-block from content elements.
  // Each element handler resets `current` on open and flushes on close.
  const rewriter = new HTMLRewriter()
    .on('p, h1, h2, h3, h4, h5, h6, li, blockquote, td', {
      element(el) {
        if (current.trim()) {
          blocks.push(current.trim());
        }
        current = '';
        el.onEndTag(() => {
          if (current.trim()) {
            blocks.push(current.trim());
          }
          current = '';
        });
      },
      text(chunk) {
        current += chunk.text;
      },
    });

  await rewriter.transform(response).arrayBuffer();

  // Split each block into sentences, filter short ones
  const sentences = blocks.flatMap((block) =>
    block
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40 && s.split(/\s+/).length >= 6)
  );

  // Deduplicate
  return [...new Set(sentences)];
}
