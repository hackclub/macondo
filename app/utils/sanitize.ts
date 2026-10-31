import sanitizeHtml from "sanitize-html";

interface SanitizeOptions {
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
  ADD_ATTR?: string[];
  FORBID_TAGS?: string[];
  ALLOW_DATA_ATTR?: boolean;
}

// Explicit allowlists shared by SSR and browser rendering, without a server DOM.
export default {
  sanitize(html: string, options: SanitizeOptions = {}): string {
    return sanitizeHtml(html, {
      allowedTags: (options.ALLOWED_TAGS ?? sanitizeHtml.defaults.allowedTags).filter(tag => !options.FORBID_TAGS?.includes(tag)),
      allowedAttributes: { "*": [...(options.ALLOWED_ATTR ?? ["href", "src", "alt", "title", "class"]), ...(options.ADD_ATTR ?? [])] },
      allowedSchemes: ["http", "https", "mailto"],
      allowProtocolRelative: false,
    });
  },
};
