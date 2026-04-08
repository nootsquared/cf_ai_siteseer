export type ExtractionResult = {
  title: string;
  claims: string[];
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export async function extractClaims(url: string): Promise<ExtractionResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const blocks: string[] = [];
  let current = '';
  let title = '';

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        title += chunk.text;
      },
    })
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

  // Decode entities, split into sentences, filter short ones
  const sentences = blocks.flatMap((block) =>
    decodeHtmlEntities(block)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 40 && s.split(/\s+/).length >= 6)
  );

  return {
    title: decodeHtmlEntities(title.trim()),
    claims: [...new Set(sentences)],
  };
}
