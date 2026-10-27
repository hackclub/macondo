// Keep this list SMALL so the tutorial isn't peppered with highlights.
export const glossaryTerms: Record<string, string> = {
  'HTML': 'HyperText Markup Language. The language used to structure web pages.',
  'CSS': 'Cascading Style Sheets. The language used to style and lay out web pages.',
  'Tailwind': 'A CSS wrapper that ships with ready-made utility classes you add directly to HTML.',
  'Markdown': 'A simple text format that uses symbols like # and ** to create headings and bold text.',

  'tag': 'A building block of HTML, written with angle brackets like <p>.',
  'attribute': 'Extra info added to a tag, written as name="value" inside the opening tag.',
  'element': 'A piece of the page defined by a tag, like a paragraph, heading, or image.',
  'head': 'The part of the page that holds info ABOUT the site (title, linked scripts). Not visible.',
  'body': 'The part of the page that holds everything visitors actually see on screen.',

  'class': 'A label added to an element with class="..." so CSS or Tailwind can style it.',
  'src': 'The attribute on an img tag that points to the URL of the image to load.',
  'alt': 'The attribute on an img tag that describes the image for accessibility.',
  'script': 'A tag that loads JavaScript. The Tailwind CDN is loaded with a script tag in the head.',
  'README': 'A plain-text or Markdown file at the top of a repository that describes the project.',
};

const highlightedOnce = new Set<string>();

export function resetGlossaryTracking(): void {
  highlightedOnce.clear();
}

// Not a sanitizer: `html` passes through verbatim, so it must already be trusted or sanitized.
export function injectGlossaryTerms(html: string): string {
  // Longest first so multi-word terms match before single words.
  const sortedTerms = Object.keys(glossaryTerms).sort((a, b) => b.length - a.length);
  const wrappedThisCall = new Set<string>();

  const parts = html.split(/(<[^>]+>|&[a-z]+;|&#\d+;)/gi);

  let insideTagSkip = 0;
  let insideClassSkip = 0;
  const skipTags = new Set(['code', 'pre', 'style', 'script']);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.startsWith('<')) {
      if (part.startsWith('<span class="glossary-term"') && part.endsWith('</span>')) {
        continue;
      }
      const closeMatch = part.match(/^<\/(\w+)/);
      const openMatch = part.match(/^<(\w+)/);
      if (closeMatch && skipTags.has(closeMatch[1]!.toLowerCase())) {
        insideTagSkip = Math.max(0, insideTagSkip - 1);
      } else if (openMatch && skipTags.has(openMatch[1]!.toLowerCase())) {
        insideTagSkip++;
      } else if (openMatch && openMatch[1]!.toLowerCase() === 'span' && part.includes('class="no-gloss"')) {
        insideClassSkip++;
      } else if (closeMatch && closeMatch[1]!.toLowerCase() === 'span' && insideClassSkip > 0) {
        insideClassSkip = Math.max(0, insideClassSkip - 1);
      }
      continue;
    }

    if (part.startsWith('&') || insideTagSkip > 0 || insideClassSkip > 0) continue;

    for (const term of sortedTerms) {
      if (wrappedThisCall.has(term)) continue;
      if (highlightedOnce.has(term)) continue;

      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = part.match(new RegExp(`\\b(${escaped})\\b`, 'i'));

      if (match && match.index !== undefined) {
        const original = match[1]!;
        const definition = glossaryTerms[term]!
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        const spanHtml = `<span class="glossary-term" data-glossary="${definition}" title="${definition}">${original}</span>`;
        const before = part.slice(0, match.index);
        const after = part.slice(match.index + original.length);
        parts.splice(i, 1, before, spanHtml, after);
        wrappedThisCall.add(term);
        highlightedOnce.add(term);
        // Rewind to "before" so it gets processed too (outer loop will i++)
        i--;
        break;
      }
    }
  }

  return parts.join('');
}
