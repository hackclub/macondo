// Markdown rendering and HTML sanitization load on demand and share one bundle.

import type MarkdownIt from "markdown-it";
import type HTMLSanitizer from "./sanitize";

type MarkdownInstance = MarkdownIt;
type SanitizerInstance = typeof HTMLSanitizer;

type Renderer = {
  renderSafeMarkdown: (
    source: string,
    options?: {
      linkify?: boolean;
      typographer?: boolean;
      allowImages?: boolean;
    },
  ) => string;
};

let cachedBundle:
  | { md: MarkdownInstance; purify: SanitizerInstance }
  | null = null;
let cachedPromise:
  | Promise<{ md: MarkdownInstance; purify: SanitizerInstance }>
  | null = null;

async function loadBundle(): Promise<{
  md: MarkdownInstance;
  purify: SanitizerInstance;
}> {
  if (cachedBundle) return cachedBundle;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const [{ default: MarkdownItCtor }, { default: purify }] =
      await Promise.all([import("markdown-it"), import("./sanitize")]);
    cachedBundle = { md: new MarkdownItCtor(), purify };
    return cachedBundle;
  })();
  return cachedPromise;
}

export async function useLazyMarkdown(): Promise<Renderer> {
  const { md, purify } = await loadBundle();
  return {
    renderSafeMarkdown(source, options = {}) {
      const { linkify = true, typographer = false, allowImages = true } = options;
      // The shared instance's options are fixed; a different linkify gets a throwaway copy.
      const renderer = linkify === md.options.linkify ? md : new (md.constructor as any)({ html: false, linkify, typographer });
      return purify.sanitize(renderer.render(source ?? ""), {
        ALLOWED_TAGS: [
          "p", "br", "strong", "em", "del", "s",
          "h1", "h2", "h3", "h4", "h5", "h6",
          "ul", "ol", "li", "pre", "code",
          "a", "img", "blockquote", "hr",
          "table", "thead", "tbody", "tr", "th", "td",
        ],
        ALLOWED_ATTR: ["href", "src", "alt", "title", "class"],
        ALLOW_DATA_ATTR: false,
        ADD_ATTR: ["target", "rel"],
        ...(allowImages ? {} : { FORBID_TAGS: ["img"] }),
      });
    },
  };
}
