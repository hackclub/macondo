import MarkdownIt from "markdown-it";
import HTMLSanitizer from "./sanitize";

// Only formats browsers can play inline.
const PLAYABLE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];

export function hasPlayableVideoExtension(src: string): boolean {
  let pathname = src;
  try {
    pathname = new URL(src).pathname;
  } catch {
    // Relative or malformed URL: keep the raw string; we only need the suffix.
  }
  const lower = pathname.toLowerCase();
  return PLAYABLE_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function buildMarkdown(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });

  // Protocol-less links would otherwise become relative paths.
  md.core.ruler.after("linkify", "normalize_links", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) continue;
      for (const child of token.children) {
        if (child.type === "link_open") {
          const href = child.attrGet("href");
          if (
            href &&
            !/^https?:\/\//i.test(href) &&
            !/^mailto:/i.test(href) &&
            !/^#/.test(href)
          ) {
            child.attrSet("href", "https://" + href);
          }
        }
      }
    }
  });

  // ![alt](clip.mp4) renders as <video> instead of a broken <img>; other images keep the default rule.
  const defaultImageRule =
    md.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token?.attrGet("src") ?? "";
    if (token && hasPlayableVideoExtension(src)) {
      const alt = self.renderInlineAsText(token.children ?? [], options, env);
      return (
        `<video controls preload="metadata" src="${md.utils.escapeHtml(src)}">` +
        `${md.utils.escapeHtml(alt)}</video>`
      );
    }
    return defaultImageRule(tokens, idx, options, env, self);
  };

  return md;
}

const md = buildMarkdown();

// With html:false, the only <video> tags reaching HTMLSanitizer are the ones our image rule emits.
const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "del", "s", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "pre", "code", "a", "img", "video", "blockquote", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "controls", "preload",
];

// Shared by the published view and the editor preview so the two never drift.
export function renderJournalMarkdown(source: string): string {
  return HTMLSanitizer.sanitize(md.render(source ?? ""), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  }).replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
