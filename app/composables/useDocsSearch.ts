import MiniSearch, { type SearchResult } from "minisearch";
import { getSynonyms } from "~/composables/docsSearchSynonyms";

export interface DocsSearchSection {
  id: string;
  path: string;
  anchor: string | null;
  title: string;
  titles: string[];
  level: number;
  content: string;
  section: string;
  order: number;
  icon?: string;
  pageTitle: string;
  description?: string; // page root only
  keywords?: string;    // page root only
}

export interface DocsSearchHit extends DocsSearchSection {
  publicPath: string;     // /docs/<slug> (locale-free)
  publicHref: string;
  snippet: string;        // body excerpt with <mark> wrapped matches
  score: number;
  matchedTerms: string[];
  sectionKey: string;
}

// Module-scoped so the sidebar pill and the Cmd+K listener share one search state.
const open = ref(false);
const query = ref("");
const selectedIndex = ref(0);
const recentSearches = ref<string[]>([]);
const previouslyFocused = ref<HTMLElement | null>(null);
const isLoading = ref(false);
const locale = ref<"en" | "es">("en");

const indexes = new Map<string, MiniSearch<DocsSearchSection>>();
const sectionsByLocale = new Map<string, DocsSearchSection[]>();

function evictOldestIndex(): void {
  // Hard cap so a locale-spoofing bug can't grow the index cache without bound.
  if (indexes.size <= 8) return; // max cached locales
  // Map keeps insertion order, so the first key is the oldest locale.
  const oldest = indexes.keys().next().value;
  if (oldest !== undefined) {
    indexes.delete(oldest);
    sectionsByLocale.delete(oldest);
  }
}

const RECENT_KEY = "docs:recentSearches";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

function recordRecent(q: string): void {
  const trimmed = q.trim();
  if (!trimmed) return;
  const current = recentSearches.value.filter((r) => r.toLowerCase() !== trimmed.toLowerCase());
  current.unshift(trimmed);
  recentSearches.value = current.slice(0, RECENT_MAX);
  saveRecent(recentSearches.value);
}

function clearRecent(): void {
  recentSearches.value = [];
  saveRecent([]);
}

// Mirrors the toPublic helper in pages/docs/index.vue and docs.vue.
function toPublicPath(internal: string, localeCode: string): string {
  const prefix = localeCode === "es" ? "/docs/es" : "/docs/en";
  if (internal === prefix) return "/docs";
  if (internal.startsWith(`${prefix}/`)) return `/docs/${internal.slice(prefix.length + 1)}`;
  return internal;
}

function splitId(id: string): { path: string; anchor: string | null } {
  const hashIndex = id.indexOf("#");
  if (hashIndex === -1) return { path: id, anchor: null };
  return { path: id.slice(0, hashIndex), anchor: id.slice(hashIndex + 1) };
}

// Runs at index and query time so "shipping"/"ships" share a stem.
// Avoids a 50KB stemmer for ~28 pages per locale.
function stemTerm(t: string, localeCode: "en" | "es"): string {
  if (t.length < 4) return t;
  const suffixes = localeCode === "es"
    ? ["mente", "iendo", "ando", "ado", "ido", "es", "s"]
    : ["ingly", "edly", "ing", "ed", "es", "ly", "s"];
  for (const suf of suffixes) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) {
      return t.slice(0, -suf.length);
    }
  }
  return t;
}

// FAQ content lives in the faq_entries table, not markdown, so fetch it for the index.
async function loadFaqSections(localeCode: "en" | "es"): Promise<DocsSearchSection[]> {
  try {
    const res = await $fetch<{
      items: Array<{ id: number; question: string; answer: string }>;
    }>("/api/faq", { query: { locale: localeCode } });
    const pageTitle = localeCode === "es" ? "Preguntas Frecuentes" : "FAQ";
    const path = localeCode === "es" ? "/docs/es/faq" : "/docs/en/faq";
    return res.items.map((row, idx) => ({
      id: `${path}#faq-${row.id}`,
      path,
      anchor: `faq-${row.id}`,
      title: row.question,
      titles: [pageTitle],
      level: 2,
      content: row.answer,
      section: "help",
      order: idx,
      icon: "circle-help",
      pageTitle,
    }));
  } catch (err) {
    console.warn("[docs-search] failed to load FAQ for search index", err);
    return [];
  }
}

async function buildIndex(localeCode: "en" | "es"): Promise<void> {
  if (indexes.has(localeCode)) return;
  isLoading.value = true;
  try {
    const rawSections = await $fetch<Array<{
      id: string; title: string; titles: string[]; level: number; content: string;
      section?: string; order?: number; icon?: string; description?: string; keywords?: string;
    }>>(`/_docs/search-${localeCode}.json`);

    // Heading chunks don't carry the page title, so map path -> title for breadcrumbs.
    const pageTitles = new Map<string, string>();
    for (const s of rawSections) {
      const { path, anchor } = splitId(s.id);
      if (!anchor) pageTitles.set(path, s.title);
    }
    // Root-only so description/keywords boosts don't surface one page N times.
    const pageMeta = new Map<string, { description?: string; keywords?: string }>();
    for (const s of rawSections) {
      const { path, anchor } = splitId(s.id);
      if (anchor) continue;
      const record = s as unknown as { description?: string; keywords?: string };
      pageMeta.set(path, {
        description: record.description?.toString().trim() || undefined,
        keywords: record.keywords?.toString().trim() || undefined,
      });
    }

    const sections: DocsSearchSection[] = [];
    for (const s of rawSections) {
      const { path, anchor } = splitId(s.id);
      const record = s as unknown as {
        id: string;
        title: string;
        titles: string[];
        level: number;
        content: string;
        section?: string;
        order?: number;
        icon?: string;
      };
      const meta = pageMeta.get(path);
      sections.push({
        id: s.id,
        path,
        anchor,
        title: s.title,
        titles: Array.isArray(s.titles) ? s.titles : [],
        level: s.level,
        content: (s.content ?? "").trim(),
        section: record.section ?? "misc",
        order: typeof record.order === "number" ? record.order : 99, // unordered pages sort last
        icon: record.icon,
        pageTitle: pageTitles.get(path) ?? s.title,
        description: anchor ? undefined : meta?.description,
        keywords: anchor ? undefined : meta?.keywords,
      });
    }

    sections.push(...(await loadFaqSections(localeCode)));

    const index = new MiniSearch<DocsSearchSection>({
      idField: "id",
      fields: ["title", "titlesJoined", "content", "pageTitle", "description", "keywords"],
      storeFields: [
        "id", "path", "anchor", "title", "titles", "level",
        "content", "section", "order", "icon", "pageTitle",
        "description", "keywords",
      ],
      extractField: (doc, fieldName) => {
        if (fieldName === "titlesJoined") return (doc.titles ?? []).join(" ");
        return ((doc as unknown as Record<string, unknown>)[fieldName] ?? "") as string;
      },
      processTerm: (term) => {
        const lowered = term.toLowerCase();
        if (lowered.length < 2) return null;
        return stemTerm(lowered, localeCode);
      },
      searchOptions: {
        boost: {
          title: 3,
          titlesJoined: 2,
          pageTitle: 2.5,
          content: 1,
          description: 2,
          keywords: 2.5,
        },
        prefix: true,
        fuzzy: 0.2,
        combineWith: "AND",
      },
    });
    index.addAll(sections);

    indexes.set(localeCode, index);
    sectionsByLocale.set(localeCode, sections);
    evictOldestIndex();
  } finally {
    isLoading.value = false;
  }
}

// Output is intended for v-html. Terms come from SearchResult.terms so fuzzy/prefix matches highlight.
function highlight(text: string, terms: string[]): string {
  if (!text) return "";
  if (terms.length === 0) return escapeHtml(text);
  // Sort longest first so "setup" takes precedence over "set".
  const escaped = [...new Set(terms)]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return escapeHtml(text).replace(re, (m) => `<mark class="docs-search-mark">${m}</mark>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Picks the window with the most distinct terms, so a dense answer beats a passing mention.
// Falls back to the head when only title/description/keywords matched.
function excerptAroundMatch(content: string, terms: string[], window = 120): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (terms.length === 0) return text.slice(0, window * 2);

  const lower = text.toLowerCase();
  type Match = { pos: number; term: string };
  const positions: Match[] = [];
  for (const t of terms) {
    const tLower = t.toLowerCase();
    if (!tLower) continue;
    let idx = lower.indexOf(tLower);
    while (idx !== -1) {
      positions.push({ pos: idx, term: tLower });
      idx = lower.indexOf(tLower, idx + tLower.length);
    }
  }
  if (positions.length === 0) return text.slice(0, window * 2);

  positions.sort((a, b) => a.pos - b.pos);

  let bestStart = 0;
  let bestEnd = Math.min(text.length, window * 2);
  let bestScore = -1;
  for (const { pos } of positions) {
    const start = Math.max(0, pos - window);
    const end = Math.min(text.length, pos + window);
    const distinct = new Set<string>();
    for (const p of positions) {
      if (p.pos >= start && p.pos < end) distinct.add(p.term);
    }
    if (distinct.size > bestScore) {
      bestScore = distinct.size;
      bestStart = start;
      bestEnd = end;
    }
  }

  return (
    (bestStart > 0 ? "… " : "") + text.slice(bestStart, bestEnd) + (bestEnd < text.length ? " …" : "")
  );
}

function rankResults(results: SearchResult[], localeCode: string): DocsSearchHit[] {
  const byId = new Map((sectionsByLocale.get(localeCode) ?? []).map((s) => [s.id, s]));

  const hits: DocsSearchHit[] = [];
  for (const r of results) {
    const section = byId.get(String(r.id));
    if (!section) continue;
    const terms = Array.isArray(r.terms) ? (r.terms as string[]) : [];
    const publicPath = toPublicPath(section.path, locale.value);
    const rawExcerpt = section.content
      ? excerptAroundMatch(section.content, terms)
      : section.titles.join(" › ");

    hits.push({
      ...section,
      publicPath,
      publicHref: section.anchor ? `${publicPath}#${section.anchor}` : publicPath,
      snippet: highlight(rawExcerpt, terms),
      score: typeof r.score === "number" ? r.score : 0,
      matchedTerms: terms,
      sectionKey: section.section,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 50); // cap on returned results
}

// Synonym keys match the stemmed form, so "shipping"/"ships" hit the "ship" entry.
function expandQueryGroups(q: string, localeCode: "en" | "es"): string[] {
  const syns = getSynonyms(localeCode);
  return q
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((tok) => {
      const lower = tok.toLowerCase();
      const matched = syns[stemTerm(lower, localeCode)] ?? syns[lower] ?? [];
      if (matched.length === 0) return tok;
      return [tok, ...matched].join(" ");
    });
}

// Strict AND first; if empty, OR within each synonym group but AND across groups,
// so "submit board" still requires both concepts.
function searchWithFallback(
  idx: MiniSearch<DocsSearchSection>,
  trimmed: string,
  localeCode: "en" | "es",
): SearchResult[] {
  const primary = idx.search(trimmed);
  if (primary.length > 0) return primary;

  const groups = expandQueryGroups(trimmed, localeCode);
  if (groups.length === 0) return [];

  if (groups.length === 1) {
    return idx.search(groups[0]!, { combineWith: "OR" });
  }

  const perGroup = groups.map((g) => idx.search(g, { combineWith: "OR" }));
  if (perGroup.some((r) => r.length === 0)) {
    // a group has no hits: broad OR so the user sees something
    return idx.search(groups.join(" "), { combineWith: "OR" });
  }

  const maps = perGroup.map((r) => new Map(r.map((h) => [String(h.id), h])));
  return [...maps[0]!.keys()]
    .filter((id) => maps.every((m) => m.has(id)))
    .map((id) => {
      const hits = maps.map((m) => m.get(id)!);
      return {
        ...hits[0]!,
        id,
        score: hits.reduce(
          (sum, h) => sum + (typeof h.score === "number" ? h.score : 0),
          0,
        ),
        terms: Array.from(
          new Set(hits.flatMap((h) => (Array.isArray(h.terms) ? h.terms : []))),
        ),
      } as SearchResult;
    })
    .sort(
      (a, b) =>
        (typeof b.score === "number" ? b.score : 0) -
        (typeof a.score === "number" ? a.score : 0),
    );
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
const rawResults = ref<DocsSearchHit[]>([]);
const suggestions = ref<string[]>([]);

function computeSuggestions(idx: MiniSearch<DocsSearchSection>, q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  try {
    const seen = new Set<string>();
    const out: string[] = [];
    // Higher fuzzy than the main search so typos like "haktime" suggest "hackatime".
    for (const s of idx.autoSuggest(trimmed, { fuzzy: 0.3, prefix: true })) {
      const sug = s.suggestion?.trim();
      if (!sug || sug.toLowerCase() === trimmed.toLowerCase()) continue;
      const key = sug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sug);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}

function performSearch(q: string): void {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const index = indexes.get(locale.value);
    if (!index) {
      rawResults.value = [];
      suggestions.value = [];
      return;
    }
    const trimmed = q.trim();
    if (!trimmed) {
      rawResults.value = [];
      suggestions.value = [];
      return;
    }
    rawResults.value = rankResults(searchWithFallback(index, trimmed, locale.value), locale.value);
    suggestions.value =
      rawResults.value.length === 0 ? computeSuggestions(index, trimmed) : [];
  }, 80); // search debounce in ms
}

watch(query, (q) => {
  selectedIndex.value = 0;
  performSearch(q);
});

const results = computed<DocsSearchHit[]>(() => rawResults.value);

function openSearch(): void {
  if (typeof document !== "undefined") {
    const active = document.activeElement;
    previouslyFocused.value = active instanceof HTMLElement ? active : null;
  }
  if (recentSearches.value.length === 0) recentSearches.value = loadRecent();
  open.value = true;
  // Not awaited: the modal shows its empty state while the index builds.
  buildIndex(locale.value).catch((err) => {
    console.error("[docs-search] index build failed", err);
  });
}

function close(): void {
  open.value = false;
  query.value = "";
  rawResults.value = [];
  selectedIndex.value = 0;
  nextTick(() => {
    previouslyFocused.value?.focus?.();
    previouslyFocused.value = null;
  });
}

function toggle(): void {
  if (open.value) close();
  else openSearch();
}

function selectNext(): void {
  const len = results.value.length;
  if (len === 0) return;
  selectedIndex.value = (selectedIndex.value + 1) % len;
}

function selectPrev(): void {
  const len = results.value.length;
  if (len === 0) return;
  selectedIndex.value = (selectedIndex.value - 1 + len) % len;
}

function selectFirst(): void {
  selectedIndex.value = 0;
}

function selectLast(): void {
  const len = results.value.length;
  if (len > 0) selectedIndex.value = len - 1;
}

export function useDocsSearch(currentLocale?: "en" | "es") {
  if (currentLocale && currentLocale !== locale.value) {
    // Indexes stay cached per locale so switching back is instant.
    locale.value = currentLocale;
    query.value = "";
    rawResults.value = [];
    selectedIndex.value = 0;
  }
  if (typeof window !== "undefined" && recentSearches.value.length === 0) {
    recentSearches.value = loadRecent();
  }

  return {
    open,
    query,
    selectedIndex,
    recentSearches,
    isLoading,
    results,
    suggestions,
    openSearch,
    close,
    toggle,
    selectNext,
    selectPrev,
    selectFirst,
    selectLast,
    recordRecent,
    clearRecent,
    prewarm,
  };
}

// Called on docs route mount so the first Cmd+K open has no spinner.
export function prewarm(): void {
  buildIndex(locale.value).catch((err) => {
    console.error("[docs-search] prewarm index build failed", err);
  });
}
