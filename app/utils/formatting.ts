// Only plain web addresses survive: the readme preview renders in the app's own page, not a sandbox.
// Quotes and brackets are escaped too in case the caller didn't pre-escape.
function safeUrl(url: string): string {
  const u = url.trim();
  // {1,2}, not {0,2}: a bare "/" would let protocol-relative "//host" through.
  if (!/^(https?:\/\/|mailto:|#|\/(?!\/)|\.{1,2}\/)/i.test(u)) return "#";
  return u.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function inlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) =>
      `<img src="${safeUrl(src)}" alt="${alt}" style="max-width:100%;margin:0.5em 0">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) =>
      `<a href="${safeUrl(href)}" style="color:#0366d6">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:0.9em;font-family:monospace">$1</code>');
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function highlightHtml(code: string): string {
  // Per line so an unclosed tag can't swallow the following lines.
  return code.split("\n").map(line => highlightHtmlLine(line)).join("\n");
}

function highlightHtmlLine(code: string): string {
  let result = "";
  let lastIndex = 0;
  const tagRe = /<(!?\/?[\w-][^>]*)>/g;
  let m;
  while ((m = tagRe.exec(code)) !== null) {
    result += esc(code.slice(lastIndex, m.index));
    const inner = m[1]!;

    if (/^!DOCTYPE/i.test(inner)) {
      result += `<span class="text-violet-600">&lt;${esc(inner)}&gt;</span>`;
    } else {
      const tagMatch = inner.match(/^(\/?)([\w-]+)([\s\S]*)$/);
      if (tagMatch) {
        const slash = tagMatch[1];
        const tagName = tagMatch[2];
        const rest = tagMatch[3] || "";
        // Escape every gap between attributes: the tag regex admits "<" in its body.
        const attrRe = /([\w-]+)\s*=\s*("[^"]*"|'[^']*')/g;
        let attrHtml = "";
        let attrLast = 0;
        let am;
        while ((am = attrRe.exec(rest)) !== null) {
          attrHtml += esc(rest.slice(attrLast, am.index));
          const quoted = am[2]!;
          const q = quoted[0]!;
          attrHtml += `<span class="text-amber-600">${esc(am[1]!)}</span>=<span class="text-emerald-600">${q}${esc(quoted.slice(1, -1))}${q}</span>`;
          attrLast = am.index + am[0].length;
        }
        attrHtml += esc(rest.slice(attrLast));
        result += `&lt;${esc(slash || "")}<span class="text-rose-600">${esc(tagName || "")}</span>${attrHtml}&gt;`;
      } else {
        result += `&lt;${esc(inner)}&gt;`;
      }
    }
    lastIndex = m.index + m[0].length;
  }
  result += esc(code.slice(lastIndex));
  return result;
}

export function highlightCss(code: string): string {
  return code.split('\n').map(line => {
    // Find ; before escaping so entities like &quot; aren't split.
    const colonIdx = line.indexOf(':');
    const semiIdx = line.lastIndexOf(';');

    if (colonIdx === -1) {
      return esc(line).replace(/^([\w-]+)(\s*\{)/, '<span class="text-rose-600">$1</span>$2');
    }

    const afterColon = semiIdx > colonIdx
      ? line.slice(colonIdx + 1, semiIdx)
      : line.slice(colonIdx + 1);
    const rest = semiIdx > colonIdx ? line.slice(semiIdx) : '';

    let result = esc(line.slice(0, colonIdx)).replace(/([\w-]+)(\s*)$/, '<span class="text-sky-600">$1</span>$2');
    result += ':';
    if (semiIdx > colonIdx) {
      result += `<span class="text-emerald-600">${esc(afterColon)}</span>${esc(rest)}`;
    } else {
      result += esc(afterColon);
    }
    return result;
  }).join('\n');
}

export function renderMd(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([^`]*?)```/gs, "<pre class=\"bg-black/10 p-2 rounded my-1 overflow-x-auto\"><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}
