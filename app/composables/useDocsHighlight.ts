// DocsSearch.vue writes this payload right before navigating from a search hit.

const HIGHLIGHT_KEY = "docs:highlight";

interface HighlightPayload {
  terms: string[];
  path: string;
  expiresAt: number;
}

function readPayload(): HighlightPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(HIGHLIGHT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HighlightPayload;
    if (!parsed || typeof parsed.path !== "string") return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(HIGHLIGHT_KEY);
      return null;
    }
    if (!Array.isArray(parsed.terms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPayload(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(HIGHLIGHT_KEY);
  } catch {
    // ignore
  }
}

// Skip code and already-marked nodes so we don't break samples or double-wrap.
const SKIP_PARENTS = new Set(["CODE", "PRE", "MARK", "SCRIPT", "STYLE"]);

function highlightTerms(container: HTMLElement, terms: string[]): void {
  const clean = terms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (clean.length === 0) return;
  const escaped = [...new Set(clean)]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${escaped.join("|")})`, "gi");

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_PARENTS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !re.test(node.nodeValue)) {
        // Reset lastIndex because the global flag is stateful.
        re.lastIndex = 0;
        return NodeFilter.FILTER_REJECT;
      }
      re.lastIndex = 0;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const matches: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    matches.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of matches) {
    const text = textNode.nodeValue ?? "";
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const mark = document.createElement("mark");
      mark.className = "docs-search-highlight";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

export function useDocsHighlight(
  containerSelector: string,
  currentPath: () => string,
): void {
  if (typeof window === "undefined") return;

  function tryHighlight(): void {
    const payload = readPayload();
    if (!payload) return;
    if (payload.path !== currentPath()) return;
    // Clear first so a reload won't re-highlight, even if the DOM walk fails.
    clearPayload();
    nextTick(() => {
      const el = document.querySelector(containerSelector);
      if (!(el instanceof HTMLElement)) return;
      try {
        highlightTerms(el, payload.terms);
      } catch (err) {
        console.warn("[docs-search] highlight failed", err);
      }
    });
  }

  const route = useRoute();
  onMounted(tryHighlight);
  watch(
    () => `${route.path}${route.hash}`,
    tryHighlight,
  );
}
