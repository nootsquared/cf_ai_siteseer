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

// Heuristics to reject blocks that are clearly not natural-language prose
function isGarbageBlock(raw: string): boolean {
  // CSS / inline styles: contain CSS curly braces
  if (/[{}]/.test(raw)) return true;

  // Wikipedia TOC entries: start with a digit and contain "Toggle" or "subsection"
  if (/^\d+[\s\u00a0]/.test(raw.trim()) && /Toggle|subsection/i.test(raw)) return true;

  return false;
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
  // Track nesting depth of style/script elements so their text is suppressed
  let suppressDepth = 0;

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        title += chunk.text;
      },
    })
    // Suppress text inside <style> and <script> regardless of nesting
    .on('style, script, noscript', {
      element(el) {
        suppressDepth++;
        el.onEndTag(() => {
          suppressDepth--;
        });
      },
    })
    // Prose elements only — no <td> (infobox), no <li> (TOC on wikis)
    .on('p, blockquote, li', {
      element(el) {
        if (suppressDepth > 0) return;
        if (current.trim()) {
          blocks.push(current.trim());
        }
        current = '';
        el.onEndTag(() => {
          if (suppressDepth > 0) {
            current = '';
            return;
          }
          if (current.trim()) {
            blocks.push(current.trim());
          }
          current = '';
        });
      },
      text(chunk) {
        if (suppressDepth > 0) return;
        current += chunk.text;
      },
    });

  await rewriter.transform(response).arrayBuffer();

  // Decode entities, reject garbage blocks, split into sentences
  const sentences = blocks
    .map((block) => decodeHtmlEntities(block))
    .filter((block) => !isGarbageBlock(block))
    .flatMap((block) =>
      block
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        // Must be long enough and end with terminal punctuation (complete sentences)
        .filter(
          (s) =>
            s.length >= 40 &&
            s.split(/\s+/).length >= 6 &&
            /[.!?]$/.test(s) &&
            !isGarbageBlock(s),
        ),
    );

  return {
    title: decodeHtmlEntities(title.trim()),
    claims: [...new Set(sentences)],
  };
}
